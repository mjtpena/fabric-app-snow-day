/**
 * Home: the snow globe. Every site is a building on its own hill in a tiny town under glass; the snow falls at the
 * selected day's forecast, the windows show the call. Lenses re-paint the rings round the hills, the dial steps
 * through five days, Today flies to the site behind each item, view-as narrows it to a lead's sites, and the list
 * view holds the same decision table.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleHelp, CloudOff, Gavel, List as ListIcon, MapPin, Minus, Plus, Snowflake, UserRound } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { useAsync, useNow, usePolling } from '@x10/shared/lib';
import {
  Button,
  cssVar,
  IconButton,
  Legend,
  LensBar,
  LinkButton,
  Spinner,
  StageMessage,
  StagePage,
  supportsWebGL,
  TodayPanel,
  useHotkeys,
  useIsDesktop,
  useReducedMotion,
  useThemeColors,
  ViewAsSwitch,
  ViewToggle,
  type LensOption,
  type StageView,
  type TodayItem,
} from '@x10/shared/ui';

import { ShortcutsDialog } from '../components/bits';
import { loadDesk } from '../domain/actions';
import { dayCells, meanSnow, type SiteDay } from '../domain/desk';
import { todayEntries, type GlobeLens, type Perspective } from '../domain/today';
import { dayRelative, dayShort, dayWeekday } from '../domain/time';
import type { Schema } from '../model';
import { DayDial, type DialDay } from '../globe/DayDial';
import type { GlobeApi } from '../globe/GlobeCanvas';
import { GlobeList } from '../globe/GlobeList';
import type { SiteData } from '../globe/GlobeScene';
import { GlobeSvg } from '../globe/GlobeSvg';
import { layoutTown } from '../globe/layout';
import { LENS_LABEL, legendItems, lensToken, lensValue, siteSummary } from '../globe/look';
import { SiteCard } from '../globe/SiteCard';

const GlobeCanvas = lazy(() => import('../globe/GlobeCanvas'));

const LENSES: LensOption<GlobeLens>[] = [
  { value: 'probability', label: 'Probability', swatch: 'linear-gradient(90deg, var(--sky-7), var(--amber-8), var(--crimson-9))', description: 'Closure probability from the model' },
  { value: 'snow', label: 'Snow', swatch: 'linear-gradient(90deg, var(--ice-7), var(--sky-9), var(--violet-10))', description: 'Forecast snow' },
  { value: 'ice', label: 'Ice', swatch: 'linear-gradient(90deg, var(--jade-8) 0 33%, var(--amber-9) 0 66%, var(--crimson-9) 0)', description: 'Ice risk' },
  { value: 'decision', label: 'Decision', swatch: 'conic-gradient(var(--gold-8) 0 25%, var(--orange-9) 0 50%, var(--gray-11) 0 75%, var(--blue-9) 0)', description: 'The call in force' },
  { value: 'disagreement', label: 'Disagreement', swatch: 'linear-gradient(90deg, var(--jade-8), var(--magenta-9))', description: 'Gap between the call and the model' },
];
const LENS_VALUES = LENSES.map((l) => l.value);

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function leftLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function GlobePage() {
  const { store, me, isAdmin } = useApp<Schema>();
  const now = useNow(30_000);
  const desk = useAsync(() => loadDesk(store, new Date()), [store]);
  usePolling(desk.reload, 5000);
  const desktop = useIsDesktop();
  const reduced = useReducedMotion();
  const colors = useThemeColors();
  const [params, setParams] = useSearchParams();
  const gl = useMemo(() => supportsWebGL(), []);
  const [glFailed, setGlFailed] = useState(false);
  const useGl = gl && !glFailed;

  const [lens, setLens] = useState<GlobeLens>(() => (LENS_VALUES.includes(params.get('lens') as GlobeLens) ? (params.get('lens') as GlobeLens) : 'probability'));
  const [view, setView] = useState<StageView>(params.get('view') === 'list' ? 'list' : 'stage');
  const [perspective, setPerspective] = useState<Perspective>(() => (params.get('as-role') === 'lead' || (!isAdmin && params.get('as-role') !== 'duty') ? 'lead' : 'duty'));
  const [focus, setFocus] = useState<string | null>(params.get('site'));
  const [dayParam, setDayParam] = useState<string | null>(params.get('day'));
  const [flyKey, setFlyKey] = useState(0);
  const [help, setHelp] = useState(false);
  const api = useRef<GlobeApi | null>(null);

  const d = desk.data;
  const days = useMemo(() => d?.days ?? [], [d]);
  const dayIndex = Math.max(0, dayParam ? days.indexOf(dayParam) : 0);
  const day = days[dayIndex] ?? days[0] ?? '';
  const cells = useMemo(() => (d && day ? dayCells(d, day) : []), [d, day]);
  const layout = useMemo(() => (d ? layoutTown(d.sites, d.regions) : null), [d]);
  const focused = cells.find((c) => c.site.id === focus) ?? null;
  const mean = useMemo(() => meanSnow(cells), [cells]);

  // Keep the URL in step (only when these change, so leaving the page never races it).
  const paramsKey = params.toString();
  useEffect(() => {
    const p = new URLSearchParams(paramsKey);
    const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
    set('site', focus);
    set('lens', lens === 'probability' ? null : lens);
    set('day', dayIndex === 0 ? null : day);
    if (p.toString() !== paramsKey) setParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, lens, day]);

  useEffect(() => {
    if (focus && d && !d.sites.some((s) => s.id === focus)) setFocus(null);
  }, [focus, d]);

  const select = useCallback((id: string | null, fly = true) => {
    setFocus(id);
    if (fly) setFlyKey((k) => k + 1);
  }, []);
  const setDay = useCallback((i: number) => setDayParam(days[Math.max(0, Math.min(days.length - 1, i))] ?? null), [days]);

  const dimmed = useMemo(() => {
    const s = new Set<string>();
    if (perspective === 'lead' && d) for (const site of d.sites) if (site.leadSub !== me.sub) s.add(site.id);
    return s;
  }, [perspective, d, me.sub]);

  const sites: SiteData[] = useMemo(() => {
    const resolve = (token: string) => (useGl ? cssVar(token) || '#999999' : `var(${token})`);
    return cells.map((c) => ({
      id: c.site.id,
      name: c.site.name,
      region: c.site.region,
      exposure: c.site.exposure,
      roadClass: c.site.roadClass,
      call: c.decision?.call ?? null,
      snowCm: c.forecast?.snowCm ?? null,
      lensColor: resolve(lensToken(c, lens)),
      lensValue: lensValue(c, lens),
      dim: dimmed.has(c.site.id),
      summary: siteSummary(c),
    }));
    // colors: re-resolve CSS variables when the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, lens, dimmed, useGl, colors]);

  const dialDays: DialDay[] = useMemo(
    () =>
      d
        ? days.map((day) => {
            const cs = dayCells(d, day);
            return { day, mean: meanSnow(cs), peak: Math.max(0, ...cs.map((c) => c.forecast?.snowCm ?? 0)) };
          })
        : [],
    [d, days],
  );
  const dial = useMemo(
    () => ({
      index: dayIndex,
      labels: dialDays.map((x) => ({ weekday: dayWeekday(x.day), date: dayShort(x.day).split(' ')[0], snow: x.peak > 0 ? `${Math.round(x.peak)} cm` : 'dry' })),
    }),
    [dialDays, dayIndex],
  );

  const today = useMemo(() => (d ? todayEntries(d, perspective, me.sub) : []), [d, perspective, me.sub]);
  const todayItems: TodayItem[] = today.map((t) => ({ id: t.id, title: t.title, severity: t.severity, value: t.value, unit: t.unit, lens: LENS_LABEL[t.lens], meta: t.meta }));
  const activeToday = today.find((t) => t.siteId === focus && t.day === day)?.id ?? null;

  const lockMs = useMemo(() => {
    if (!d) return null;
    const first = dayCells(d, d.deskDay)[0];
    return first ? new Date(first.lockAt).getTime() : null;
  }, [d]);

  /* ---------------------------------------------------------------- keyboard */

  const step = (dir: 1 | -1) => {
    if (!cells.length) return;
    const i = focus ? cells.findIndex((c) => c.site.id === focus) : -1;
    select(cells[(i + dir + cells.length) % cells.length].site.id);
  };
  useHotkeys(
    {
      arrowright: () => step(1),
      arrowleft: () => step(-1),
      ']': () => setDay(dayIndex + 1),
      '[': () => setDay(dayIndex - 1),
      s: () => api.current?.shake(),
      escape: () => select(null),
      'shift+?': () => setHelp(true),
      '=': () => api.current?.zoom(0.85),
      '-': () => api.current?.zoom(1.18),
    },
    { enabled: view === 'stage' },
  );

  /* ---------------------------------------------------------------- render */

  const calledCount = d ? dayCells(d, d.deskDay).filter((c) => c.decision).length : 0;
  const meta = d ? (
    <>
      <span className="num">
        {d.sites.length} sites · {calledCount} of {d.sites.length} called for {dayRelative(d.deskDay, d.today).toLowerCase()}
      </span>
      {lockMs !== null && lockMs > now.getTime() && <span className="num">locks in {leftLabel(lockMs - now.getTime())}</span>}
    </>
  ) : (
    <span>Shaking the globe…</span>
  );

  const label = d
    ? `Snow globe for ${dayRelative(day, d.today)}: ${cells.map((c) => siteSummary(c)).join('; ')}`
    : 'Snow globe';
  const svg = layout ? <GlobeSvg sites={sites} layout={layout} focus={focus} dayKey={day} meanSnow={mean} label={label} onPick={(id) => select(id)} /> : null;
  const strip = d && focused ? days.map((x) => d.cell(focused.site.id, x)) : [];
  const card =
    focused && d ? (
      <SiteCard
        key={focused.site.id}
        cell={focused}
        strip={strip}
        today={d.today}
        people={d.people}
        floating={desktop}
        canCall={isAdmin}
        canReport={isAdmin || focused.site.leadSub === me.sub}
        onDay={(x) => setDayParam(x)}
        onClose={() => select(null)}
      />
    ) : null;
  const dayDial = d ? <DayDial days={dialDays} today={d.today} value={dayIndex} onChange={setDay} onShake={useGl && !reduced ? () => api.current?.shake() : undefined} /> : null;

  let stage: ReactNode;
  if (desk.error && !d)
    stage = (
      <StageMessage icon={<CloudOff />} title="The globe did not load" action={<Button onClick={() => void desk.reload()}>Retry</Button>}>
        {desk.error.message}
      </StageMessage>
    );
  else if (!d || !layout)
    stage = (
      <StageMessage icon={<Spinner small />} title="Shaking the globe…">
        Reading sites, forecasts and calls.
      </StageMessage>
    );
  else if (d.sites.length === 0)
    stage = (
      <StageMessage icon={<MapPin />} title="The globe is empty" action={isAdmin ? <LinkButton to="/station?tab=sites" variant="primary">Add a site</LinkButton> : undefined}>
        {isAdmin ? 'Add the first site to build the town.' : 'The duty manager has not added any sites yet.'}
      </StageMessage>
    );
  else
    stage = (
      <>
        {useGl ? (
          <CanvasBoundary fallback={svg}>
            <Suspense fallback={<StageMessage icon={<Spinner small />} title="Shaking the globe…" />}>
              <GlobeCanvas
                sites={sites}
                layout={layout}
                dayKey={day}
                dial={dial}
                focus={focus}
                flyKey={flyKey}
                reduced={reduced}
                lockAt={lockMs}
                frame={desktop ? { top: 72, bottom: 176 } : { top: 52, bottom: 8 }}
                label={label}
                onPick={(id) => select(id)}
                onDay={setDay}
                onError={() => setGlFailed(true)}
                apiRef={api}
              />
            </Suspense>
          </CanvasBoundary>
        ) : (
          svg
        )}
        {!useGl && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[1] -translate-x-1/2 md:top-auto md:bottom-[150px]" data-testid="nowebgl-note">
            <span className="x-glass rounded-full px-3 py-1 text-xs text-muted">Seen from above: this browser has no WebGL</span>
          </div>
        )}
        {desktop && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[76px] z-[2] flex justify-center" style={{ right: 'var(--side-w, 0px)' }}>
            <div className="pointer-events-auto">{dayDial}</div>
          </div>
        )}
        {desktop && card && <div className="pointer-events-none absolute bottom-[160px] left-4 top-4 z-[3] flex w-[340px] flex-col">{card}</div>}
        {desktop && useGl && (
          <div className="absolute bottom-[160px] right-[calc(16px+var(--side-w,0px))] z-[1] flex flex-col gap-1">
            <IconButton label="Zoom in" icon={<Plus />} className="x-glass rounded-full!" onClick={() => api.current?.zoom(0.85)} />
            <IconButton label="Zoom out" icon={<Minus />} className="x-glass rounded-full!" onClick={() => api.current?.zoom(1.18)} />
          </div>
        )}
      </>
    );

  return (
    <>
      <StagePage
        label="Snow globe"
        view={view}
        title="The snow globe"
        breadcrumb={[{ label: 'Desk', onClick: () => select(null) }, { label: focused ? focused.site.name : d && day ? `${dayRelative(day, d.today)}, all sites` : 'All sites' }]}
        meta={meta}
        background="var(--snow-room)"
        topRight={
          <>
            <ViewToggle value={view} onChange={setView} glass={view === 'stage'} stageLabel="Globe" stageIcon={<Snowflake />} listIcon={<ListIcon />} />
            {desktop && <IconButton label="Keyboard shortcuts" icon={<CircleHelp />} onClick={() => setHelp(true)} className={view === 'stage' ? 'x-glass rounded-full!' : undefined} />}
          </>
        }
        lenses={<LensBar lenses={LENSES} value={lens} onChange={setLens} showLabel={false} />}
        legend={desktop && card ? undefined : <Legend key={`${lens}-${desktop}`} title={LENS_LABEL[lens]} items={legendItems(cells, lens)} collapsible defaultOpen={desktop} />}
        bottomRight={
          <ViewAsSwitch<Perspective>
            value={perspective}
            onChange={setPerspective}
            options={[
              { value: 'duty', label: 'Duty', icon: <Gavel /> },
              { value: 'lead', label: 'Lead', icon: <UserRound /> },
            ]}
          />
        }
        side={
          <TodayPanel
            bare
            items={todayItems}
            date={new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(now)}
            activeId={activeToday}
            empty={perspective === 'lead' ? 'Your sites need nothing right now.' : 'Every site is forecast and called.'}
            onSelect={(it) => {
              const t = today.find((x) => x.id === it.id);
              if (!t) return;
              setLens(t.lens);
              setDayParam(t.day);
              if (t.siteId) select(t.siteId);
              else select(null);
            }}
          />
        }
        sideCount={today.length}
        stage={stage}
        list={d ? <GlobeList cells={cells} day={day} meanSnow={mean} people={d.people} selectedId={focus} dimmed={dimmed} /> : <div className="x-skeleton h-64 rounded-xl" />}
      >
        {!desktop && view === 'stage' && d && (
          <div className="flex flex-col gap-3">
            {dayDial}
            {card ?? <PhoneSites cells={cells} lens={lens} onPick={(id) => select(id)} />}
          </div>
        )}
        {view === 'list' && d && <div className="mt-4">{dayDial}</div>}
      </StagePage>
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}

/** Phones: under the globe, the sites by region so every one is one tap away. */
function PhoneSites({ cells, lens, onPick }: { cells: SiteDay[]; lens: GlobeLens; onPick(id: string): void }) {
  const regions = [...new Set(cells.map((c) => c.site.region))];
  return (
    <div className="divide-y divide-[var(--line)] rounded-xl border border-line bg-surface" data-testid="phone-sites">
      {regions.map((r) => (
        <div key={r} className="px-4 py-3">
          <div className="x-legend-label text-[11px] text-fg">{r}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cells
              .filter((c) => c.site.region === r)
              .map((c) => (
                <button key={c.site.id} type="button" onClick={() => onPick(c.site.id)} className="x-tap inline-flex h-8 cursor-pointer items-center gap-2 rounded-full bg-gray-3 pl-2.5 pr-3 text-ui text-fg hover:bg-gray-4">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: `var(${lensToken(c, lens)})` }} />
                  {c.site.name}
                  <span className="font-mono text-xs text-muted num">{lensValue(c, lens)}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
