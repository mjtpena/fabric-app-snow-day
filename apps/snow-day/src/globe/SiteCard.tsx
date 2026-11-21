/** The card a focused site opens: the day's forecast and probability, the call and its reason, and the five-day strip. */
import { CloudSnow, Gavel, X } from 'lucide-react';

import type { Person } from '@x10/shared/identity';
import { formatDateTime } from '@x10/shared/lib';
import { FloatingPanel, IconButton, LinkButton, cx } from '@x10/shared/ui';

import { CallMark, ProbText } from '../components/bits';
import { EXPOSURE_LABEL, ICE_LABEL, ROAD_LABEL } from '../config';
import { nameOf, type SiteDay } from '../domain/desk';
import { dayLong, dayRelative, dayWeekday, type DayKey } from '../domain/time';

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function SiteCard({
  cell,
  strip,
  today,
  people,
  floating,
  canCall,
  canReport,
  onDay,
  onClose,
}: {
  cell: SiteDay;
  strip: SiteDay[];
  today: DayKey;
  people: Person[];
  floating: boolean;
  canCall: boolean;
  canReport: boolean;
  onDay(day: DayKey): void;
  onClose(): void;
}) {
  const s = cell.site;
  const f = cell.forecast;
  const d = cell.decision;
  const maxSnow = Math.max(10, ...strip.map((c) => c.forecast?.snowCm ?? 0));
  const body = (
    <div data-testid="site-card" data-site={s.name} className="flex min-h-0 flex-col">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="x-legend-label text-[10.5px] text-muted">
            {s.region} · {dayRelative(cell.day, today)}
          </div>
          <h2 className="m-0 mt-0.5 text-lg font-semibold leading-6">{s.name}</h2>
          <div className="mt-1 text-xs text-muted">
            <span className="font-mono num">{s.elevation} m</span> · {EXPOSURE_LABEL[s.exposure]} · {ROAD_LABEL[s.roadClass]}
          </div>
        </div>
        <IconButton label="Back to the whole globe" icon={<X />} size="sm" onClick={onClose} />
      </div>

      <div className="mt-3 min-h-0 overflow-y-auto">
        <div className="flex items-end justify-between gap-4 border-t border-line pt-3">
          <div>
            <div className="text-xs text-muted">Closure probability</div>
            <ProbText p={cell.probability} className="text-4xl font-semibold leading-none tracking-[-0.03em]" />
          </div>
          <div className="text-right">
            <div className="text-xs text-muted">The call</div>
            <CallMark call={d?.call ?? null} className="mt-1 text-sm font-medium" muted={!d} />
          </div>
        </div>
        {d && (
          <figure className={cx('m-0 mt-3 rounded-lg px-3 py-2', cell.against ? 'bg-[color-mix(in_oklab,var(--magenta-9)_10%,transparent)]' : 'bg-surface-sunken')} data-testid="site-card-reason">
            {cell.against && <div className="mb-1 text-xs font-semibold text-[var(--magenta-11)]">Against the model by {Math.round((cell.gap ?? 0) * 100)} points</div>}
            <blockquote className="m-0 text-ui text-fg">“{d.reason}”</blockquote>
            <figcaption className="mt-1 text-xs text-muted">
              {nameOf(people, d.decidedBy)} · {formatDateTime(d.decidedAt)}
              {cell.history.length > 1 && ` · ${cell.history.length - 1} earlier call${cell.history.length > 2 ? 's' : ''} on record`}
            </figcaption>
          </figure>
        )}

        <dl className="m-0 mt-3 grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
          {[
            ['Snow', f ? `${fmt(f.snowCm)}` : '—', 'cm'],
            ['Min', f ? `${fmt(f.tempMinC)}` : '—', '°C'],
            ['Wind', f ? `${fmt(f.windKmh)}` : '—', 'km/h'],
            ['Ice', f ? ICE_LABEL[f.iceRisk] : '—', 'risk'],
          ].map(([k, v, u]) => (
            <div key={k}>
              <dt className="text-[11px] text-muted">{k}</dt>
              <dd className="m-0 font-mono text-base font-semibold num">{v}</dd>
              <dd className="m-0 text-[10.5px] text-faint">{u}</dd>
            </div>
          ))}
        </dl>
        {!f && <p className="m-0 mt-2 text-ui text-warn-text">No forecast for {dayLong(cell.day)} yet.</p>}

        <div className="mt-3 border-t border-line pt-3">
          <div className="x-legend-label mb-2 text-[10.5px] text-muted">Five days</div>
          <ol className="m-0 grid list-none grid-cols-5 gap-1 p-0" aria-label="Five-day outlook">
            {strip.map((c) => {
              const snow = c.forecast?.snowCm ?? 0;
              const sel = c.day === cell.day;
              return (
                <li key={c.day}>
                  <button
                    type="button"
                    onClick={() => onDay(c.day)}
                    aria-pressed={sel}
                    aria-label={`${dayLong(c.day)}: ${c.forecast ? `${fmt(snow)} cm` : 'no forecast'}${c.probability !== null ? `, ${Math.round(c.probability * 100)}% closure` : ''}`}
                    className={cx('flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors', sel ? 'bg-gray-4' : 'hover:bg-gray-3')}
                  >
                    <span className="flex h-10 w-3 items-end overflow-hidden rounded-full bg-gray-3">
                      <span className="w-full rounded-full bg-[var(--sky-9)]" style={{ height: `${c.forecast ? Math.max(6, (snow / maxSnow) * 100) : 0}%` }} />
                    </span>
                    <span className="font-mono text-[11px] num">{c.forecast ? fmt(Math.round(snow)) : '—'}</span>
                    <span className="text-[10.5px] text-muted">{dayWeekday(c.day)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        {canCall && (
          <LinkButton to={`/call?site=${s.id}&day=${cell.day}`} variant="primary" size="sm" icon={<Gavel />}>
            {d ? 'Change the call' : 'Make the call'}
          </LinkButton>
        )}
        {canReport && (
          <LinkButton to={`/station?site=${s.id}&day=${cell.day}`} size="sm" icon={<CloudSnow />}>
            {f ? 'Update forecast' : 'Log forecast'}
          </LinkButton>
        )}
      </div>
    </div>
  );
  if (!floating) return <div className="rounded-xl border border-line bg-surface p-4">{body}</div>;
  return <FloatingPanel padding="md" className="pointer-events-auto flex max-h-full flex-col animate-x-in">{body}</FloatingPanel>;
}
