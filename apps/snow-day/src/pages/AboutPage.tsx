import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useApp } from '@x10/shared/runtime';
import { useAsync } from '@x10/shared/lib';
import { PageHeader, Section, Skeleton } from '@x10/shared/ui';

import { CallMark } from '../components/bits';
import { FEATURE_INFO, FEATURES, PRIOR, rules } from '../config';
import { loadDesk } from '../domain/actions';
import type { Schema } from '../model';
import { Coefficients } from './HindsightPage';

function Rule({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm font-semibold">{term}</dt>
      <dd className="m-0 text-ui text-muted">{children}</dd>
    </div>
  );
}

const B = ({ children }: { children: ReactNode }) => <strong className="font-mono text-fg num">{children}</strong>;

/** About: the idea, how to read the globe, the rules and thresholds from config.ts, the model and its limits. */
export function AboutPage() {
  const { store } = useApp<Schema>();
  const desk = useAsync(() => loadDesk(store, new Date()), [store]);
  const model = desk.data?.model;
  return (
    <div className="max-w-[880px]">
      <PageHeader title="About Snow Day" meta={<span className="text-ui text-muted">Snow closure calls from the forecast, with a record.</span>} />
      <p className="m-0 max-w-[68ch] text-base leading-relaxed">
        At five in the morning someone decides whether a school, a depot or an office opens in the snow. Usually it is a weather app and a hunch, and
        nobody writes down why, so next winter’s call is a hunch again. Snow Day is the decision desk: site leads enter the forecast per site, a
        transparent model fitted to your own past calls gives each site a closure probability, the duty manager makes the call with a reason, and every
        call and what the day brought stays on record.
      </p>

      <Section title="Reading the globe">
        <dl className="m-0 divide-y divide-[var(--line)] border-y border-line">
          <Rule term="The town">
            Every site is a building on its own hill; the hill is as high as the site. Regions sit around the floor of the globe, with the town square
            and its clock in the middle. Roads run from the square to each site: main roads are wide and stay dark longest under snow (they are
            gritted first), rural tracks are narrow and vanish first. Sheltered sites stand behind pines; exposed ones stand bare.
          </Rule>
          <Rule term="Snow">
            Snow falls over each site at its forecast for the day on the dial, settles on its roofs and whitens its ground. Turn the dial on the base
            (or press [ and ]) to step through five days. Shake the globe (S) to replay the night’s snowfall.
          </Rule>
          <Rule term="Windows">
            The windows are the call:{' '}
            <span className="inline-flex flex-wrap gap-x-3 gap-y-1 align-middle">
              <CallMark call="open" /> <CallMark call="delayed" /> <CallMark call="closed" /> <CallMark call="remote" /> <CallMark call={null} />
            </span>
          </Rule>
          <Rule term="Lenses and views">
            Keys 1–5 colour the ring round each hill by closure probability, forecast snow, ice risk, decision or the gap between the call and the
            model. V switches between the duty manager’s view and a site lead’s (your own sites stand out). L shows the same day as a decision table.
            Without WebGL the town is drawn from above in SVG.
          </Rule>
          <Rule term="The clock">The red arc on the town clock is the time left before today’s calls lock at 09:00.</Rule>
        </dl>
      </Section>

      <Section title="The rules">
        <dl className="m-0 divide-y divide-[var(--line)] border-y border-line" data-testid="rules">
          <Rule term="1. Closure probability">
            A logistic model on forecast snow, minimum temperature, wind, ice risk, elevation, exposure and road class, fitted to past calls (closed or
            remote count as a closure). With fewer than <B>{rules.minHistory}</B> past calls it uses the hand-set prior below; after that it is fitted by
            maximum likelihood with a ridge penalty of <B>{rules.priorStrength}</B> that pulls each standardised coefficient toward the prior. It is
            refitted every time the desk loads, on days before the current call day only.
          </Rule>
          <Rule term="2. Against the model">
            Each call has a weight: open <B>0</B>, delayed <B>0.5</B>, closed or remote <B>1</B>. A call whose weight differs from the probability by more
            than <B>{rules.overrideGap}</B> needs a reason of at least <B>{rules.overrideReasonMin}</B> characters. Every call needs a reason.
          </Rule>
          <Rule term="3. The 09:00 lock">
            Calls for a day lock at <B>{String(rules.lockHour).padStart(2, '0')}:00</B> site time. Nothing is ever edited: a later change is a new
            decision whose reason starts “Revised”, needs <B>{rules.overrideReasonMin}</B>+ characters, and the call it replaces stays on record.
          </Rule>
          <Rule term="4. Hit rate">
            Over-cautious: closed or remote, under <B>{rules.overCautiousSnowCm} cm</B> of snow and at most <B>{rules.lowIncidents}</B> incident. Caught
            out: open with <B>{rules.caughtOutSnowCm} cm</B> or more, or open or delayed with <B>{rules.caughtOutIncidents}</B> or more incidents. Every
            other call with an outcome is a right call. Hindsight also judges the model’s own call (closed at <B>{Math.round(rules.modelCloseAt * 100)}%</B>{' '}
            or more).
          </Rule>
          <Rule term="Today">
            Sites above <B>{Math.round(rules.todayProbability * 100)}%</B> with no call yet, calls against the model, sites missing a forecast in the next{' '}
            <B>{rules.forecastDays}</B> days, the time to the lock and the heaviest snow ahead.
          </Rule>
          <Rule term="Who does what">
            The duty manager (an admin) makes the calls and keeps the site register. Site leads enter forecasts and outcomes for their own sites; the
            duty manager can for any site.
          </Rule>
        </dl>
      </Section>

      <Section title="The model now">
        {model ? (
          <>
            <p className="m-0 mb-3 text-ui text-muted">
              {model.source === 'fitted'
                ? `Fitted to ${model.n} past calls (${model.positives} closures); it agrees with ${Math.round((model.accuracy ?? 0) * 100)}% of them at 50%.`
                : `Using the hand-set prior: ${model.n} past calls so far, fewer than ${rules.minHistory}.`}{' '}
              Coefficients are log-odds per unit: +0.22 per cm means each extra 10 cm multiplies the odds of a closure by about nine.
            </p>
            <Coefficients model={model} />
          </>
        ) : (
          <Skeleton height={320} />
        )}
        <dl className="m-0 mt-4 divide-y divide-[var(--line)] border-y border-line">
          {FEATURES.map((k) => (
            <Rule key={k} term={FEATURE_INFO[k].label}>
              {FEATURE_INFO[k].meaning} Prior <span className="font-mono num">{PRIOR.coef[k] >= 0 ? '+' : ''}{PRIOR.coef[k]}</span> {FEATURE_INFO[k].unit}.
            </Rule>
          ))}
        </dl>
      </Section>

      <Section title="Tools">
        <dl className="m-0 divide-y divide-[var(--line)] border-y border-line">
          <Rule term="The call">
            <Link to="/call">Decide per site</Link> with the model’s probability, the inputs that drive it and the reason rules.
          </Rule>
          <Rule term="Weather station">
            <Link to="/station">Enter forecasts</Link> one at a time or as a CSV, see the five-day outlook, and keep the site register.
          </Rule>
          <Rule term="Logbook">
            <Link to="/logbook">Every call and outcome</Link>, revisions beside the calls they replaced, with a CSV export and a print view.
          </Rule>
          <Rule term="Hindsight">
            <Link to="/hindsight">The hit rate</Link>, the model’s own score, calibration and what the model has learned.
          </Rule>
        </dl>
      </Section>

      <Section title="What this is not">
        <ul className="m-0 list-disc space-y-1.5 pl-5 text-ui text-muted">
          <li>
            Snow Day supports the closure decision and keeps its record. It is not a weather service, and it is not safety, legal or health and safety
            advice: the duty manager decides, and local guidance and your own duty of care come first.
          </li>
          <li>The model only knows what the desk has called before. It learns your habits, good and bad; Hindsight shows which.</li>
          <li>Sign-in is Fabric single sign-on. Everyone with access to this app can read every site, forecast and call.</li>
        </ul>
        <p className="mb-0 mt-6 text-xs text-faint">Built by Datachain Consulting for AI @Work. Runs on Microsoft Fabric Apps.</p>
      </Section>
    </div>
  );
}
