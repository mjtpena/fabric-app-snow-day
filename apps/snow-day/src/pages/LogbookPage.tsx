/**
 * Logbook: every call on record, day by day, with the reason, who made it, what the model said at the time and what
 * the day brought. Revisions sit with the call they replaced. Site leads record outcomes for their own sites.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Download, Printer, Snowflake } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { downloadText, formatDateTime, toCsv, useAction, useAsync, usePolling } from '@x10/shared/lib';
import { Button, cx, DataState, Dialog, EmptyState, Field, FilterSelect, Input, PageHeader, Skeleton, TextArea, Toast, Toolbar } from '@x10/shared/ui';

import { CallMark } from '../components/bits';
import { ICE_LABEL } from '../config';
import { canReport, loadDesk, recordOutcome, validateOutcome, type OutcomeInput } from '../domain/actions';
import { dayCells, nameOf, type Desk, type SiteDay } from '../domain/desk';
import { VERDICT_LABEL, type Verdict } from '../domain/rules';
import { dayLong, dayRelative, dayWithYear, winterOf } from '../domain/time';
import { limits, type Schema } from '../model';

type VerdictFilter = 'all' | Verdict | 'pending';
const PAGE = 5;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const VERDICT_TONE: Record<Verdict, string> = { hit: 'bg-ok-solid', 'over-cautious': 'bg-[var(--sky-9)]', 'caught-out': 'bg-bad-solid' };

export function LogbookPage() {
  const { store } = useApp<Schema>();
  const desk = useAsync(() => loadDesk(store, new Date()), [store]);
  usePolling(desk.reload, 5000);
  return (
    <DataState
      state={desk}
      skeleton={
        <div>
          <Skeleton height={36} width={200} />
          <Skeleton height={36} className="mt-6" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={120} className="mt-4" />
          ))}
        </div>
      }
    >
      {(d) => <Logbook desk={d} reload={desk.reload} />}
    </DataState>
  );
}

function Logbook({ desk, reload }: { desk: Desk; reload: () => Promise<void> }) {
  const { me } = useApp<Schema>();
  const [site, setSite] = useState('all');
  const [verdictF, setVerdictF] = useState<VerdictFilter>('all');
  const [winter, setWinter] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [recording, setRecording] = useState<SiteDay | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const entries = useMemo(() => {
    const upcoming = desk.days.flatMap((d) => dayCells(desk, d).filter((c) => c.decision));
    return [...upcoming.reverse(), ...desk.past];
  }, [desk]);
  const winters = useMemo(() => [...new Set(entries.map((e) => winterOf(e.day)))], [entries]);
  const filtered = entries.filter(
    (e) =>
      (site === 'all' || e.site.id === site) &&
      (winter === 'all' || winterOf(e.day) === winter) &&
      (verdictF === 'all' || (verdictF === 'pending' ? !e.outcome && e.day <= desk.today : e.verdict === verdictF)),
  );
  const days = [...new Set(filtered.map((e) => e.day))].sort((a, b) => b.localeCompare(a));
  const visible = days.slice(0, shown);

  const exportCsv = () => {
    const rows = entries.flatMap((e) =>
      e.history.map((d, i) => [
        e.day,
        e.site.name,
        e.site.region,
        d.call,
        i === 0 ? 'in force' : 'replaced',
        d.reason,
        nameOf(desk.people, d.decidedBy),
        d.decidedAt,
        d.modelProbability ?? '',
        e.forecast?.snowCm ?? '',
        e.outcome?.actualSnowCm ?? '',
        e.outcome?.incidents ?? '',
        i === 0 && e.verdict ? VERDICT_LABEL[e.verdict] : '',
      ]),
    );
    downloadText(
      'snow-day-logbook.csv',
      toCsv(['day', 'site', 'region', 'call', 'status', 'reason', 'decided_by', 'decided_at', 'model_probability', 'forecast_snow_cm', 'actual_snow_cm', 'incidents', 'verdict'], rows),
    );
  };

  return (
    <div className="x-logbook">
      <PageHeader
        title="Logbook"
        meta={
          <span className="text-ui text-muted num">
            {entries.length} calls on record · {winters.length} winter{winters.length === 1 ? '' : 's'}
          </span>
        }
        actions={
          <div className="x-noprint flex gap-2">
            <Button variant="ghost" icon={<Printer />} onClick={() => window.print()}>
              Print
            </Button>
            <Button icon={<Download />} onClick={exportCsv}>
              CSV
            </Button>
          </div>
        }
      />
      <Toolbar sticky>
        <FilterSelect label="Site" value={site} onChange={(v) => { setSite(v); setShown(PAGE); }} options={[{ value: 'all', label: 'All sites' }, ...desk.sites.map((s) => ({ value: s.id, label: s.name }))]} />
        <FilterSelect<VerdictFilter>
          label="Verdict"
          value={verdictF}
          onChange={(v) => { setVerdictF(v); setShown(PAGE); }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'hit', label: 'Right call' },
            { value: 'over-cautious', label: 'Over-cautious' },
            { value: 'caught-out', label: 'Caught out' },
            { value: 'pending', label: 'No outcome yet' },
          ]}
        />
        <FilterSelect label="Winter" value={winter} onChange={(v) => { setWinter(v); setShown(PAGE); }} options={[{ value: 'all', label: 'All' }, ...winters.map((w) => ({ value: w, label: w }))]} />
      </Toolbar>

      {visible.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="Nothing matches" className="mt-6">
          No calls on record for these filters.
        </EmptyState>
      ) : (
        <div className="mt-4 space-y-6">
          {visible.map((day) => {
            const list = filtered.filter((e) => e.day === day);
            return (
              <section key={day} aria-labelledby={`day-${day}`} data-testid="logbook-day" data-day={day}>
                <h2 id={`day-${day}`} className="m-0 mb-2 flex items-baseline gap-3 text-sm font-semibold">
                  {dayWithYear(day)}
                  <span className="font-normal text-muted">{Math.abs(new Date(day).getTime() - new Date(desk.today).getTime()) < 8 * 86_400_000 ? dayRelative(day, desk.today) : `Winter ${winterOf(day)}`}</span>
                </h2>
                <ol className="m-0 list-none divide-y divide-[var(--line)] rounded-xl border border-line bg-surface p-0">
                  {list.map((e) => (
                    <Entry key={e.site.id} e={e} desk={desk} canRecord={canReport(me, e.site) && !e.outcome && e.day <= desk.today} onRecord={() => setRecording(e)} />
                  ))}
                </ol>
              </section>
            );
          })}
          {days.length > shown && (
            <div className="x-noprint flex justify-center">
              <Button onClick={() => setShown((n) => n + PAGE)}>Show older days ({days.length - shown} more)</Button>
            </div>
          )}
        </div>
      )}
      {recording && (
        <OutcomeDialog
          e={recording}
          today={desk.today}
          onClose={() => setRecording(null)}
          onSaved={async (msg) => {
            setRecording(null);
            setToast(msg);
            await reload();
          }}
        />
      )}
      <Toast message={toast} tone="ok" onDone={() => setToast(null)} />
    </div>
  );
}

function Entry({ e, desk, canRecord, onRecord }: { e: SiteDay; desk: Desk; canRecord: boolean; onRecord(): void }) {
  const d = e.decision!;
  const revised = /^revised/i.test(d.reason);
  return (
    <li className="grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[200px_minmax(0,1fr)_220px]" data-testid="logbook-entry" data-site={e.site.name}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{e.site.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <CallMark call={d.call} className="text-ui font-medium" />
          {revised && <span className="rounded-[5px] bg-warn-soft px-1.5 py-px text-[11px] font-medium text-warn-text">Revised</span>}
          {e.against && <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--magenta-9)_12%,transparent)] px-1.5 py-px text-[11px] font-medium text-[var(--magenta-11)]">Against model</span>}
        </div>
      </div>
      <div className="min-w-0 text-ui">
        <p className="m-0">{d.reason}</p>
        <p className="m-0 mt-1 text-xs text-muted">
          {nameOf(desk.people, d.decidedBy)} · {formatDateTime(d.decidedAt)}
          {d.modelProbability !== null && <> · model said <span className="font-mono num">{Math.round(d.modelProbability * 100)}%</span></>}
          {e.forecast && <> · forecast <span className="font-mono num">{fmt(e.forecast.snowCm)} cm</span>, {ICE_LABEL[e.forecast.iceRisk].toLowerCase()} ice</>}
        </p>
        {e.history.length > 1 && (
          <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer text-muted hover:text-fg">
              {e.history.length - 1} earlier call{e.history.length > 2 ? 's' : ''} on record
            </summary>
            <ol className="m-0 mt-1.5 list-none space-y-1 border-l-2 border-line p-0 pl-3">
              {e.history.slice(1).map((h) => (
                <li key={h.id}>
                  <CallMark call={h.call} className="line-through decoration-[var(--gray-8)]" /> <span className="text-muted">{formatDateTime(h.decidedAt)}</span> — {h.reason}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 md:flex-col md:items-end">
        {e.outcome ? (
          <>
            <div className="text-right font-mono text-ui num" data-testid="outcome">
              <span className="text-fg">{fmt(e.outcome.actualSnowCm)} cm</span>
              <span className="text-muted"> · {e.outcome.incidents} incident{e.outcome.incidents === 1 ? '' : 's'}</span>
            </div>
            {e.verdict && (
              <span className="inline-flex items-center gap-1.5 text-ui font-medium" data-testid="verdict" data-verdict={e.verdict}>
                <span aria-hidden="true" className={cx('size-2 rounded-full', VERDICT_TONE[e.verdict])} />
                {VERDICT_LABEL[e.verdict]}
              </span>
            )}
            {e.outcome.note && <span className="text-right text-xs text-muted">{e.outcome.note}</span>}
          </>
        ) : e.day > desk.today ? (
          <span className="text-ui text-muted">Day not here yet</span>
        ) : canRecord ? (
          <Button size="sm" icon={<Snowflake />} onClick={onRecord} className="x-noprint">
            Record outcome
          </Button>
        ) : (
          <span className="text-ui text-muted">No outcome yet</span>
        )}
      </div>
    </li>
  );
}

function OutcomeDialog({ e, today, onClose, onSaved }: { e: SiteDay; today: string; onClose(): void; onSaved(msg: string): Promise<void> }) {
  const { store, me } = useApp<Schema>();
  const [v, setV] = useState({ actualSnowCm: '', incidents: '0', note: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof OutcomeInput, string>>>({});
  const action = useAction(recordOutcome);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const input: OutcomeInput = {
      siteId: e.site.id,
      day: e.day,
      actualSnowCm: v.actualSnowCm.trim() === '' ? Number.NaN : Number(v.actualSnowCm),
      incidents: v.incidents.trim() === '' ? Number.NaN : Number(v.incidents),
      note: v.note,
    };
    const errs = validateOutcome(input, today);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await action.run(store, me, input, new Date());
    if (r) await onSaved(`Outcome recorded for ${e.site.name}.`);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record outcome"
      description={`${e.site.name} · ${dayLong(e.day)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="outcome-form" busy={action.pending}>
            Record outcome
          </Button>
        </>
      }
    >
      <form id="outcome-form" onSubmit={(ev) => void submit(ev)} noValidate>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Snow on the ground (cm)" htmlFor="o-snow" error={errors.actualSnowCm}>
            <Input id="o-snow" type="number" step="0.5" min={0} inputMode="decimal" value={v.actualSnowCm} onChange={(x) => setV({ ...v, actualSnowCm: x.target.value })} invalid={!!errors.actualSnowCm} className="font-mono" />
          </Field>
          <Field label="Incidents" htmlFor="o-inc" error={errors.incidents} hint="Slips, crashes, stuck vehicles.">
            <Input id="o-inc" type="number" step="1" min={0} inputMode="numeric" value={v.incidents} onChange={(x) => setV({ ...v, incidents: x.target.value })} invalid={!!errors.incidents} className="font-mono" />
          </Field>
        </div>
        <Field label="Note" htmlFor="o-note" error={errors.note} counter={{ value: v.note.trim().length, max: limits.note.max }}>
          <TextArea id="o-note" rows={2} value={v.note} onChange={(x) => setV({ ...v, note: x.target.value })} placeholder="Snow stayed on the hills; roads wet all day." />
        </Field>
        {action.error && <p role="alert" className="m-0 text-ui font-medium text-bad">{action.error.message}</p>}
      </form>
    </Dialog>
  );
}
