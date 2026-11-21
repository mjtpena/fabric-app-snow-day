import type { DataStore } from '@x10/shared/data';
import type { SeedContext } from '@x10/shared/runtime';

import { EXPOSURE_LEVEL, ICE_LEVEL, ROAD_LEVEL } from './config';
import { predict, priorModel } from './domain/closure';
import { buildDesk } from './domain/desk';
import { addDaysKey, dayIso, deskDay, localTimeZone, zonedInstant, type DayKey } from './domain/time';
import type { Call, Exposure, IceRisk, RoadClass, Schema, Site } from './model';

/**
 * Fictional, generic seed. Ten sites in three regions; two winters of forecasts, calls and outcomes generated from a
 * fixed random seed (so the model always fits the same way); five days of forecasts from the desk day with a storm
 * on day 2; today's calls partly made, one of them against the model; one site missing its forecast.
 * Dates come from ctx.now and the seeding machine's time zone (sites carry no zone of their own, so they follow the
 * desk's). Runs once (runSeed checks a marker row).
 */

type SiteSpec = { name: string; region: string; elevation: number; exposure: Exposure; roadClass: RoadClass; lead: number };

export const SITES: SiteSpec[] = [
  { name: 'Summit Primary', region: 'Ridge', elevation: 920, exposure: 'exposed', roadClass: 'rural', lead: 1 },
  { name: 'Pine Hollow Depot', region: 'Ridge', elevation: 780, exposure: 'normal', roadClass: 'rural', lead: 1 },
  { name: 'Ridge Road Clinic', region: 'Ridge', elevation: 850, exposure: 'exposed', roadClass: 'secondary', lead: 1 },
  { name: 'Upper Fells School', region: 'Ridge', elevation: 640, exposure: 'normal', roadClass: 'secondary', lead: 1 },
  { name: 'Millbrook Academy', region: 'Valley', elevation: 240, exposure: 'sheltered', roadClass: 'main', lead: 2 },
  { name: 'Valley Depot', region: 'Valley', elevation: 210, exposure: 'normal', roadClass: 'main', lead: 2 },
  { name: 'Old Ford Library', region: 'Valley', elevation: 310, exposure: 'normal', roadClass: 'secondary', lead: 2 },
  { name: 'Harbour Lane School', region: 'Lakeshore', elevation: 60, exposure: 'exposed', roadClass: 'main', lead: 3 },
  { name: 'North Shore Pool', region: 'Lakeshore', elevation: 90, exposure: 'exposed', roadClass: 'secondary', lead: 3 },
  { name: 'Lakeside Offices', region: 'Lakeshore', elevation: 40, exposure: 'sheltered', roadClass: 'main', lead: 3 },
];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (sd = 1) => {
    const u = Math.max(1e-9, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
  };
  const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  return { next, normal, pick };
}

const half = (v: number) => Math.round(v * 2) / 2;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Storm strength (0..1) and kind of each past event day, per winter. */
const WINTERS: { offsets: number[]; storms: number[]; kinds: ('snow' | 'ice')[] }[] = [
  {
    offsets: [-18, -4, 9, 23, 36, 50, 64, 79],
    storms: [0.15, 0.55, 0.9, 0.08, 0.35, 0.7, 0.2, 1.0],
    kinds: ['snow', 'snow', 'snow', 'ice', 'snow', 'snow', 'ice', 'snow'],
  },
  {
    offsets: [-12, 2, 15, 27, 41, 55, 68, 82],
    storms: [0.4, 0.1, 0.75, 0.25, 0.95, 0.05, 0.6, 0.3],
    kinds: ['snow', 'ice', 'snow', 'snow', 'snow', 'ice', 'snow', 'snow'],
  },
];

const SOURCES = ['Met service 04:00 run', 'Regional model 03:00', 'Road weather station', 'Met service 22:00 run'];

const REASONS: Record<Call, string[]> = {
  closed: [
    'Ploughs will not reach the site road before 08:00; staff and pupils cannot get in safely.',
    'Heavy overnight snow on a rural route; bus operator has cancelled the morning runs.',
    'Drifting across the top road and more snow due mid-morning; closing to keep people off it.',
    'Paths and car park are sheet ice and the gritter is two hours behind; closed for the day.',
  ],
  remote: [
    'Roads passable but treacherous; office work moves online for the day, nobody needs to travel.',
    'Freezing rain on the approach roads; staff work from home, the site stays locked.',
  ],
  delayed: [
    'Opening at 10:00 so the caretaker can clear and grit the paths and the car park.',
    'Main roads clear by 08:30 on the gritting schedule; a two-hour delay keeps the morning safe.',
    'Light snow on untreated side roads; late start while the plough finishes the estate.',
  ],
  open: [
    'Main roads gritted overnight and only a dusting on site; opening as normal.',
    'Forecast snow stays above the ridge; roads here are wet, not frozen. Open as normal.',
    'Under 2 cm and above freezing by 07:00; normal opening with paths gritted.',
    'Cold but dry; the site road was treated at 04:00. Open as normal.',
  ],
};

export async function seed(store: DataStore<Schema>, ctx: SeedContext): Promise<void> {
  const [duty, ...leads] = ctx.people;
  const tz = localTimeZone();
  const now = ctx.now;
  const nowMs = now.getTime();
  const d0 = deskDay(now, tz);
  const r = rng(20261122);
  const at = (day: DayKey, h: number, m: number) => {
    const t = zonedInstant(day, h, m, tz).getTime();
    return new Date(Math.min(t, nowMs - 60_000)).toISOString();
  };

  // Sites.
  const sites: Site[] = [];
  for (const s of SITES) {
    const lead = leads[s.lead - 1] ?? duty;
    sites.push(
      await store.repo('Site').create({
        name: s.name,
        region: s.region,
        elevation: s.elevation,
        exposure: s.exposure,
        roadClass: s.roadClass,
        leadSub: lead.sub,
        leadName: lead.displayName,
        timeZone: null,
      }),
    );
  }

  const prior = priorModel();
  const forecasts = store.repo('Forecast');
  const decisions = store.repo('Decision');
  const outcomes = store.repo('Outcome');

  /** The duty manager's habits: what the model should learn (close a little sooner on rural roads and ice). */
  const habit = (snow: number, temp: number, wind: number, ice: IceRisk, site: Site) =>
    -4.7 +
    0.27 * snow +
    0.07 * -temp +
    0.022 * wind +
    1.15 * ICE_LEVEL[ice] +
    0.06 * (site.elevation / 100) +
    0.3 * EXPOSURE_LEVEL[site.exposure] +
    0.75 * ROAD_LEVEL[site.roadClass];

  /* ---------------------------------------------------------------- two winters of history */

  for (let w = 0; w < WINTERS.length; w++) {
    const winter = WINTERS[w];
    for (let e = 0; e < winter.offsets.length; e++) {
      const day = addDaysKey(d0, -365 * (w + 1) + winter.offsets[e]);
      const S = winter.storms[e];
      const kind = winter.kinds[e];
      const bust = w === 0 && e === 4; // forecast bust: the snow never came to the valley or the lake
      const surprise = w === 1 && e === 3; // under-forecast: far more snow on the ridge than forecast
      for (const site of sites) {
        const lead = leads.find((p) => p.sub === site.leadSub) ?? duty;
        const elev = site.elevation;
        const expo = EXPOSURE_LEVEL[site.exposure];
        const lake = site.region === 'Lakeshore';
        let snow = kind === 'ice' ? Math.max(0, S * 6 * (elev / 1000) + r.normal(0.6)) : S * 34 * (0.25 + elev / 1000) * (0.9 + expo * 0.1) + r.normal(1.5);
        snow = Math.max(0, half(snow));
        const temp = round1(1.5 - S * 7 - elev / 220 + r.normal(1.3) + (kind === 'ice' ? 2 : 0));
        const wind = Math.max(0, Math.round(12 + S * 35 + expo * 9 + (lake ? 8 : 0) + r.normal(5)));
        let ice: IceRisk = 'low';
        if (kind === 'ice') ice = elev < 500 ? 'high' : 'medium';
        else if ((temp > -4 && temp < 1.5 && snow > 1) || (S > 0.6 && temp < -6)) ice = 'medium';
        if (kind === 'snow' && S > 0.85 && elev < 400) ice = 'high';

        const fAt = at(day, 4, 20 + Math.floor(r.next() * 30));
        await forecasts.create({
          siteId: site.id,
          day: dayIso(day),
          snowCm: snow,
          tempMinC: temp,
          windKmh: wind,
          iceRisk: ice,
          source: r.pick(SOURCES),
          enteredBy: lead.sub,
          enteredAt: fAt,
        });

        const z = habit(snow, temp, wind, ice, site) + r.normal(1.15);
        let call: Call = z > 0 ? 'closed' : z > -1.3 ? 'delayed' : 'open';
        if (call === 'closed' && /Offices|Library/.test(site.name)) call = 'remote';
        const p = predict(prior, { snowCm: snow, tempMinC: temp, windKmh: wind, iceRisk: ice, elevation: elev, exposure: site.exposure, roadClass: site.roadClass });
        const decidedAt = at(day, 5, 15 + Math.floor(r.next() * 75));

        // Two revisions after the 09:00 lock, kept beside the call they replaced.
        const revised =
          (w === 0 && e === 7 && site.name === 'Valley Depot') || (w === 1 && e === 2 && site.name === 'Lakeside Offices');
        if (revised) {
          const first: Call = site.name === 'Valley Depot' ? 'delayed' : 'open';
          const second: Call = site.name === 'Valley Depot' ? 'closed' : 'remote';
          await decisions.create({ siteId: site.id, day: dayIso(day), call: first, reason: REASONS[first][1], decidedBy: duty.sub, decidedAt, modelProbability: round3(p) });
          await decisions.create({
            siteId: site.id,
            day: dayIso(day),
            call: second,
            reason:
              site.name === 'Valley Depot'
                ? 'Revised: plough crews were pulled up to the ridge; valley roads still blocked at 09:30.'
                : 'Revised: power cut on the lakeshore feeder at 09:10; staff sent home to work remotely.',
            decidedBy: duty.sub,
            decidedAt: at(day, 9, 35 + Math.floor(r.next() * 20)),
            modelProbability: round3(p),
          });
          call = second;
        } else {
          await decisions.create({ siteId: site.id, day: dayIso(day), call, reason: r.pick(REASONS[call]), decidedBy: duty.sub, decidedAt, modelProbability: round3(p) });
        }

        let actual = Math.max(0, half(snow * (0.75 + r.next() * 0.5) + r.normal(0.8)));
        if (bust && site.region !== 'Ridge') actual = half(snow * 0.08);
        if (surprise && site.region === 'Ridge') actual = half(snow * 2.4 + 7);
        const closedish = call === 'closed' || call === 'remote';
        const base = actual / 7 + ICE_LEVEL[ice] * 0.7 + ROAD_LEVEL[site.roadClass] * 0.35;
        const incidents = Math.max(0, Math.floor(base * (closedish ? 0.3 : 1) + r.next() * 1.1 - 0.2));
        await outcomes.create({
          siteId: site.id,
          day: dayIso(day),
          actualSnowCm: actual,
          incidents,
          note: bust && site.region !== 'Ridge' ? 'Snow stayed on the hills; roads wet all day.' : surprise && site.region === 'Ridge' ? 'Band of heavy snow stalled over the ridge from 06:00.' : null,
          enteredBy: lead.sub,
          enteredAt: at(day, 17, 30),
        });
      }
    }
  }

  /* ---------------------------------------------------------------- yesterday: called, locked, one revision */

  const prev = addDaysKey(d0, -1);
  for (const site of sites) {
    const lead = leads.find((p) => p.sub === site.leadSub) ?? duty;
    const ridge = site.region === 'Ridge';
    const snow = ridge ? half(3 + r.next() * 2) : half(r.next() * 1);
    const temp = round1(ridge ? -5 - r.next() * 2 : -1 - r.next());
    const wind = Math.round(ridge ? 32 + r.next() * 8 : 14 + r.next() * 6);
    const ice: IceRisk = ridge ? 'medium' : 'low';
    await forecasts.create({ siteId: site.id, day: dayIso(prev), snowCm: snow, tempMinC: temp, windKmh: wind, iceRisk: ice, source: SOURCES[0], enteredBy: lead.sub, enteredAt: at(prev, 4, 35) });
    const p = predict(prior, { snowCm: snow, tempMinC: temp, windKmh: wind, iceRisk: ice, elevation: site.elevation, exposure: site.exposure, roadClass: site.roadClass });
    if (site.name === 'Summit Primary') {
      await decisions.create({ siteId: site.id, day: dayIso(prev), call: 'delayed', reason: REASONS.delayed[0], decidedBy: duty.sub, decidedAt: at(prev, 5, 40), modelProbability: round3(p) });
      await decisions.create({
        siteId: site.id,
        day: dayIso(prev),
        call: 'closed',
        reason: 'Revised: the bus operator pulled the ridge route at 09:30 after drifting on the top road.',
        decidedBy: duty.sub,
        decidedAt: at(prev, 9, 45),
        modelProbability: round3(p),
      });
    } else {
      const call: Call = ridge && site.roadClass === 'rural' ? 'delayed' : 'open';
      await decisions.create({ siteId: site.id, day: dayIso(prev), call, reason: REASONS[call][ridge ? 2 : 0], decidedBy: duty.sub, decidedAt: at(prev, 5, 25), modelProbability: round3(p) });
    }
    // Ridge outcomes are still to be recorded by their lead.
    if (!ridge)
      await outcomes.create({ siteId: site.id, day: dayIso(prev), actualSnowCm: half(snow * 0.8), incidents: 0, note: null, enteredBy: lead.sub, enteredAt: at(prev, 17, 10) });
  }

  /* ---------------------------------------------------------------- the next five days: a storm on day 2 */

  type F = [snow: number, temp: number, wind: number, ice: IceRisk];
  const FORECAST: Record<string, F[]> = {
    'Summit Primary': [[12, -6.5, 44, 'medium'], [34, -9.5, 64, 'medium'], [11, -12, 30, 'high'], [0.5, -15, 12, 'medium'], [0, -4, 14, 'low']],
    'Pine Hollow Depot': [[9, -6, 36, 'medium'], [30, -9, 52, 'medium'], [10, -11, 26, 'high'], [0, -14, 10, 'medium'], [0, -4, 12, 'low']],
    'Ridge Road Clinic': [[11, -6, 42, 'medium'], [31, -9, 60, 'medium'], [12, -11.5, 28, 'high'], [0.5, -14, 12, 'medium'], [0, -3.5, 14, 'low']],
    'Upper Fells School': [[7, -5, 30, 'medium'], [26, -8, 48, 'medium'], [9, -10, 24, 'high'], [0, -12, 10, 'medium'], [0, -3, 12, 'low']],
    'Millbrook Academy': [[5.5, -3.5, 18, 'medium'], [14, -6, 28, 'medium'], [4, -8, 18, 'high'], [0, -9, 8, 'high'], [0, -2, 10, 'low']],
    'Valley Depot': [[2, -1.5, 18, 'low'], [15, -6, 32, 'medium'], [5, -8, 18, 'high'], [0, -9, 8, 'high'], [0, -2, 10, 'low']],
    'Old Ford Library': [[3.5, -2.5, 20, 'medium'], [17, -6.5, 30, 'medium'], [5, -8.5, 20, 'high'], [0, -9.5, 8, 'high'], [0, -2.5, 10, 'low']],
    'Harbour Lane School': [[1, 0.5, 38, 'low'], [8, -4, 58, 'high'], [2, -6, 30, 'high'], [0, -6, 14, 'high'], [0, -1, 16, 'medium']],
    'North Shore Pool': [[1.5, 0, 40, 'low'], [9, -4.5, 60, 'high'], [3, -6.5, 32, 'high'], [0, -6.5, 14, 'high'], [0, -1, 16, 'medium']],
    'Lakeside Offices': [[0.5, 0.5, 22, 'low'], [6, -3.5, 40, 'high'], [2, -5.5, 20, 'high'], [0, -6, 10, 'high'], [0, -0.5, 12, 'low']],
  };
  const MISSING: Record<string, number[]> = { 'Pine Hollow Depot': [0, 1], 'North Shore Pool': [3, 4] };
  const entered = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();
  for (const site of sites) {
    const lead = leads.find((p) => p.sub === site.leadSub) ?? duty;
    const rows = FORECAST[site.name];
    for (let i = 0; i < rows.length; i++) {
      if (MISSING[site.name]?.includes(i)) continue;
      const [snowCm, tempMinC, windKmh, iceRisk] = rows[i];
      await forecasts.create({
        siteId: site.id,
        day: dayIso(addDaysKey(d0, i)),
        snowCm,
        tempMinC,
        windKmh,
        iceRisk,
        source: i === 0 ? SOURCES[0] : SOURCES[1],
        enteredBy: i === 0 ? lead.sub : duty.sub,
        enteredAt: entered(i === 0 ? 70 + sites.indexOf(site) * 3 : 300 + i * 5),
      });
    }
  }

  /* ---------------------------------------------------------------- today's calls, partly made */

  const byName = (n: string) => sites.find((s) => s.name === n)!;
  // The probability the desk showed: the model fitted to the history above.
  const desk = buildDesk(
    {
      sites,
      forecasts: await forecasts.list(),
      decisions: await decisions.list(),
      outcomes: [],
      people: ctx.people,
    },
    now,
    tz,
  );
  const today: { site: string; call: Call; reason: string; minutesAgo: number }[] = [
    { site: 'Summit Primary', call: 'closed', reason: '12 cm on the ridge road by 05:00 and still falling; the plough is not up the top road before 08:00.', minutesAgo: 52 },
    { site: 'Valley Depot', call: 'open', reason: 'Two centimetres on gritted main roads; crews start on time.', minutesAgo: 41 },
    { site: 'Harbour Lane School', call: 'closed', reason: 'Power cut on the harbour feeder since 03:00; the heating will not be back before noon.', minutesAgo: 33 },
    { site: 'Millbrook Academy', call: 'delayed', reason: 'Freezing drizzle on the school paths; the caretaker needs two hours to grit them.', minutesAgo: 24 },
  ];
  for (const t of today) {
    const site = byName(t.site);
    const p = desk.cell(site.id, d0).probability;
    await decisions.create({ siteId: site.id, day: dayIso(d0), call: t.call, reason: t.reason, decidedBy: duty.sub, decidedAt: entered(t.minutesAgo), modelProbability: p === null ? null : round3(p) });
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
