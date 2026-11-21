/**
 * The call: the duty manager's desk. Pick a day, see every site ranked by the model's closure probability, open one,
 * read why the model says what it says, and make the call with a reason. A call against the model by more than the
 * gap needs a 30+ character reason; after 09:00 a change is recorded as a revision (rules 2 and 3).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CloudSnow, Gavel, Lock, TriangleAlert } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { formatDateTime, useAction, useAsync, useNow, usePolling } from '@x10/shared/lib';
import { Button, Callout, cx, DataState, EmptyState, Field, LinkButton, PageHeader, SegmentedControl, Skeleton, TextArea, Toast, useIsDesktop } from '@x10/shared/ui';

import { CallMark, ProbBar, ProbText } from '../components/bits';
import { Drivers } from '../components/Drivers';
import { CALL_LABEL, CALL_LIGHT, EXPOSURE_LABEL, ICE_LABEL, ROAD_LABEL, rules } from '../config';
import { loadDesk, makeCall } from '../domain/actions';
import { callDays, dayCells, modelInput, nameOf, type Desk, type SiteDay } from '../domain/desk';
import { checkCall, gapOf } from '../domain/rules';
import { dayLong, dayRelative, dayShort, dayWeekday } from '../domain/time';
import { CALL_TOKEN } from '../globe/look';
import { CALLS, type Call, type Schema } from '../model';

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function leftLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function CallPage() {
  const { store } = useApp<Schema>();
  const desk = useAsync(() => loadDesk(store, new Date()), [store]);
  usePolling(desk.reload, 5000);
  return (
    <DataState
      state={desk}
      skeleton={
        <div>
          <Skeleton height={36} width={220} />
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
            <Skeleton height={520} />
            <Skeleton height={520} />
          </div>
        </div>
      }
    >
      {(d) => <CallDesk desk={d} reload={desk.reload} />}
    </DataState>
  );
}

function CallDesk({ desk, reload }: { desk: Desk; reload: () => Promise<void> }) {
  const { isAdmin } = useApp<Schema>();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const days = callDays(desk);
  const day = days.includes(params.get('day') ?? '') ? params.get('day')! : desk.deskDay;
  const cells = useMemo(
    () => [...dayCells(desk, day)].sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || (b.probability ?? -1) - (a.probability ?? -1)),
    [desk, day],
  );
  const siteParam = params.get('site');
  const selected = cells.find((c) => c.site.id === siteParam) ?? (desktop ? cells[0] : null);
  const called = cells.filter((c) => c.decision).length;

  const go = (next: { day?: string; site?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.day !== undefined) p.set('day', next.day);
    if (next.site !== undefined) {
      if (next.site) p.set('site', next.site);
      else p.delete('site');
    }
    setParams(p, { replace: true });
  };

  if (!desk.sites.length)
    return (
      <>
        <PageHeader title="The call" />
        <EmptyState icon={<Gavel />} title="No sites yet" action={isAdmin ? <LinkButton to="/station?tab=sites" variant="primary">Add a site</LinkButton> : undefined}>
          Calls are made per site. Add the sites first.
        </EmptyState>
      </>
    );

  const dayOptions = days.map((x) => {
    const rel = dayRelative(x, desk.today);
    const short = rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday' ? rel : `${dayWeekday(x)} ${dayShort(x).split(' ')[0]}`;
    return { value: x, label: short, icon: dayCells(desk, x)[0]?.locked ? <Lock /> : undefined, ariaLabel: `${dayLong(x)}${dayCells(desk, x)[0]?.locked ? ' (locked)' : ''}` };
  });

  const list = (
    <ol className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line bg-surface p-0" aria-label={`Sites for ${dayLong(day)}`} data-testid="call-list">
      {cells.map((c) => {
        const active = c.site.id === selected?.site.id;
        return (
          <li key={c.site.id}>
            <button
              type="button"
              onClick={() => go({ site: c.site.id })}
              aria-current={active || undefined}
              data-testid="call-row"
              data-site={c.site.name}
              className={cx('grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left transition-colors', active ? 'bg-[color-mix(in_oklab,var(--accent-9)_12%,transparent)]' : 'hover:bg-[var(--row-hover)]')}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{c.site.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  {c.site.region}
                  {!c.forecast && <span className="font-medium text-warn-text">No forecast</span>}
                  {c.against && <span className="font-medium text-[var(--magenta-11)]">Against the model</span>}
                </span>
              </span>
              <ProbText p={c.probability} className="text-lg font-semibold" />
              <ProbBar p={c.probability} call={c.decision?.call ?? null} />
              <CallMark call={c.decision?.call ?? null} muted={!c.decision} className="text-xs" />
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      <PageHeader
        title="The call"
        meta={
          <span className="text-ui text-muted num">
            {dayLong(day)} · {called} of {cells.length} called
            {desk.model.source === 'fitted' ? ` · model fitted to ${desk.model.n} past calls` : ' · hand-set model (short history)'}
          </span>
        }
      />
      <div className="no-scrollbar -mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <SegmentedControl label="Day" value={day} onChange={(v) => go({ day: v, site: null })} options={dayOptions} />
      </div>
      {desktop ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+16px)]">{list}</div>
          {selected && <CallPanel key={`${selected.site.id}-${day}`} desk={desk} cell={selected} reload={reload} />}
        </div>
      ) : selected ? (
        <div>
          <button type="button" onClick={() => go({ site: null })} className="x-tap mb-3 inline-flex cursor-pointer items-center gap-1.5 text-ui text-muted hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden="true" /> All sites
          </button>
          <CallPanel key={`${selected.site.id}-${day}`} desk={desk} cell={selected} reload={reload} />
        </div>
      ) : (
        list
      )}
    </>
  );
}

function CallPanel({ desk, cell, reload }: { desk: Desk; cell: SiteDay; reload: () => Promise<void> }) {
  const { store, me, isAdmin } = useApp<Schema>();
  const now = useNow(30_000);
  const [call, setCall] = useState<Call | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const action = useAction(makeCall);
  const s = cell.site;
  const f = cell.forecast;
  const current = cell.decision?.call ?? null;
  const locked = cell.locked || now.getTime() >= new Date(cell.lockAt).getTime();
  const check = call ? checkCall({ call, reason, probability: cell.probability, current, locked }) : null;
  useEffect(() => setTried(false), [call]);

  const submit = async () => {
    setTried(true);
    if (!call || check?.error) return;
    const r = await action.run(store, me, { siteId: s.id, day: cell.day, call, reason }, new Date());
    if (!r) return;
    setToast(r.revision ? `Revision recorded: ${s.name} is now ${CALL_LABEL[call].toLowerCase()}.` : `${s.name} called ${CALL_LABEL[call].toLowerCase()} for ${dayRelative(cell.day, desk.today).toLowerCase()}.`);
    setCall(null);
    setReason('');
    setTried(false);
    await reload();
  };

  const verb = !current ? 'Make the call' : locked ? 'Record revision' : 'Change the call';
  const reasonHint = check
    ? check.against && check.revision
      ? `At least ${check.reasonMin} characters: against the model, and a revision after the lock.`
      : check.against
        ? `At least ${check.reasonMin} characters: this goes against the model by ${Math.round((check.gap ?? 0) * 100)} points.`
        : check.revision
          ? `At least ${check.reasonMin} characters: a revision after the 09:00 lock.`
          : `What decided it, in a sentence.`
    : 'Choose a call first.';

  return (
    <article className="rounded-xl border border-line bg-surface" data-testid="call-panel" data-site={s.name} data-day={cell.day}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="m-0 text-xl font-semibold">{s.name}</h2>
          <div className="mt-1 text-ui text-muted">
            {s.region} · <span className="font-mono num">{s.elevation} m</span> · {EXPOSURE_LABEL[s.exposure]} · {ROAD_LABEL[s.roadClass]}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">{dayLong(cell.day)}</div>
          <div className={cx('mt-0.5 inline-flex items-center gap-1.5 text-ui font-medium', locked ? 'text-warn-text' : 'text-fg')} data-testid="lock-state">
            {locked ? <Lock className="size-3.5" aria-hidden="true" /> : null}
            {locked ? 'Locked at 09:00' : `Locks at 09:00 · in ${leftLabel(new Date(cell.lockAt).getTime() - now.getTime())}`}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-[var(--line)]">
        {/* The model's side. */}
        <section className="px-5 py-4" aria-label="The model">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-muted">Closure probability</div>
              <ProbText p={cell.probability} className="text-5xl font-semibold leading-none tracking-[-0.03em]" />
            </div>
            <div className="text-right text-xs text-muted">
              {desk.model.source === 'fitted' ? (
                <>
                  Fitted to <span className="font-mono num">{desk.model.n}</span> past calls
                </>
              ) : (
                'Hand-set prior'
              )}
              <div>
                <Link to="/hindsight" className="text-brand-text hover:underline">
                  How well it does
                </Link>
              </div>
            </div>
          </div>
          {f ? (
            <>
              <dl className="m-0 mt-4 grid grid-cols-4 gap-2 border-y border-line py-3 text-center">
                {[
                  ['Snow', fmt(f.snowCm), 'cm'],
                  ['Min', fmt(f.tempMinC), '°C'],
                  ['Wind', fmt(f.windKmh), 'km/h'],
                  ['Ice', ICE_LABEL[f.iceRisk], 'risk'],
                ].map(([k, v, u]) => (
                  <div key={k}>
                    <dt className="text-[11px] text-muted">{k}</dt>
                    <dd className="m-0 font-mono text-lg font-semibold num">{v}</dd>
                    <dd className="m-0 text-[10.5px] text-faint">{u}</dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 mt-2 text-xs text-muted">
                {f.source} · entered by {nameOf(desk.people, f.enteredBy)}, {formatDateTime(f.enteredAt)}
                {cell.forecasts.length > 1 && ` · ${cell.forecasts.length - 1} older forecast${cell.forecasts.length > 2 ? 's' : ''}`}
              </p>
              <Drivers model={desk.model} input={modelInput(s, f)} className="mt-4" />
            </>
          ) : (
            <Callout tone="warn" className="mt-4" title="No forecast for this day" action={<LinkButton to={`/station?site=${s.id}&day=${cell.day}`} size="sm" icon={<CloudSnow />}>Log forecast</LinkButton>}>
              Without a forecast the model has no probability; the call still needs a reason.
            </Callout>
          )}
        </section>

        {/* The duty manager's side. */}
        <section className="border-t border-line px-5 py-4 lg:border-t-0" aria-label="The call">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="m-0 text-sm font-semibold">The call</h3>
            <span className="text-xs text-muted">
              In force: <CallMark call={current} muted={!current} className="ml-1 align-middle" />
            </span>
          </div>
          {cell.decision && (
            <blockquote className={cx('m-0 mt-2 rounded-lg px-3 py-2 text-ui', cell.against ? 'bg-[color-mix(in_oklab,var(--magenta-9)_10%,transparent)]' : 'bg-surface-sunken')} data-testid="current-reason">
              “{cell.decision.reason}”
              <span className="mt-1 block text-xs text-muted">
                {nameOf(desk.people, cell.decision.decidedBy)} · {formatDateTime(cell.decision.decidedAt)}
                {cell.decision.modelProbability !== null && ` · model said ${Math.round(cell.decision.modelProbability * 100)}%`}
              </span>
            </blockquote>
          )}

          {isAdmin ? (
            <div className="mt-4">
              {locked && current && (
                <Callout tone="warn" icon={<Lock />} className="mb-3" title="Calls for this day are locked">
                  A change is recorded as a new decision marked “Revised”; the call it replaces stays on record.
                </Callout>
              )}
              <div role="radiogroup" aria-label="Call" className="grid grid-cols-2 gap-2">
                {CALLS.map((c) => {
                  const gap = cell.probability === null ? null : gapOf(c, cell.probability);
                  const against = gap !== null && gap > rules.overrideGap + 1e-12;
                  const on = call === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={c === current}
                      onClick={() => setCall(c)}
                      title={CALL_LIGHT[c]}
                      className={cx(
                        'x-tap flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                        on ? 'border-[var(--gray-12)] bg-[color-mix(in_oklab,var(--gray-12)_6%,transparent)] ring-1 ring-[var(--gray-12)]' : 'border-line-strong hover:bg-[var(--row-hover)]',
                      )}
                    >
                      <span aria-hidden="true" className="size-5 shrink-0 rounded-[5px] border border-[var(--line-strong)]" style={{ background: `var(${CALL_TOKEN[c]})`, boxShadow: c === 'closed' ? undefined : `0 0 10px color-mix(in oklab, var(${CALL_TOKEN[c]}) 60%, transparent)` }} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{CALL_LABEL[c]}</span>
                        <span className={cx('block text-xs', against ? 'font-medium text-[var(--magenta-11)]' : 'text-muted')}>
                          {c === current ? 'In force' : gap === null ? 'No model' : against ? `Against the model · ${Math.round(gap * 100)} pt` : `With the model · ${Math.round(gap * 100)} pt`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {check?.against && (
                <Callout tone="warn" icon={<TriangleAlert />} className="mt-3" title={`Against the model by ${Math.round((check.gap ?? 0) * 100)} points`}>
                  The gap allowed without a full reason is {Math.round(rules.overrideGap * 100)} points. Say what the model cannot see.
                </Callout>
              )}

              <Field
                label="Reason"
                htmlFor="call-reason"
                className="mt-4"
                hint={reasonHint}
                error={tried ? check?.error ?? (call ? null : 'Choose a call.') : null}
                counter={check ? { value: reason.trim().length, max: check.reasonMax } : undefined}
              >
                <TextArea id="call-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={tried && !!check?.error} placeholder="Ploughs not up the top road before 08:00…" />
              </Field>
              {action.error && <p role="alert" className="m-0 mb-3 text-ui font-medium text-bad">{action.error.message}</p>}
              <div className="sticky bottom-[calc(var(--x-bottom-inset)+8px)] z-[1] flex justify-end md:static">
                <Button variant="primary" size="lg" icon={<Gavel />} onClick={() => void submit()} busy={action.pending} className="max-md:w-full">
                  {verb}
                </Button>
              </div>
              <div className="h-14 md:hidden" aria-hidden="true" />
            </div>
          ) : (
            <Callout className="mt-4" title="Only the duty manager makes the call">
              Site leads log forecasts and outcomes for their sites at the <Link to="/station" className="text-brand-text hover:underline">Weather station</Link> and in the <Link to="/logbook" className="text-brand-text hover:underline">Logbook</Link>.
            </Callout>
          )}

          {cell.history.length > 0 && (
            <div className="mt-5 border-t border-line pt-3">
              <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">On record</h3>
              <ol className="m-0 list-none space-y-2 p-0" data-testid="call-history">
                {cell.history.map((dcs, i) => (
                  <li key={dcs.id} className={cx('text-ui', i > 0 && 'text-muted')} data-testid="history-item">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <CallMark call={dcs.call} className={cx('font-medium', i > 0 && 'line-through decoration-[var(--gray-8)]')} />
                      <span className="text-xs text-muted">
                        {formatDateTime(dcs.decidedAt)} · {nameOf(desk.people, dcs.decidedBy)}
                        {i === 0 ? ' · in force' : ' · replaced'}
                      </span>
                    </div>
                    <p className="m-0 mt-0.5 text-xs">{dcs.reason}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>
      <Toast message={toast} tone="ok" onDone={() => setToast(null)} />
    </article>
  );
}
