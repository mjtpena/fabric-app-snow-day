/**
 * Hindsight: were the calls right? The hit rate against what the days brought, the same days had the model called
 * them, how well the model's probabilities match the desk's calls, and what the model has learned (rule 4).
 */
import { Link } from 'react-router-dom';
import { Radar } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { useAsync, usePolling } from '@x10/shared/lib';
import { cx, DataState, EmptyState, PageHeader, Section, Skeleton, Stat, StatStrip, Table, TableWrap, Td, Th, Tr } from '@x10/shared/ui';

import { CallMark } from '../components/bits';
import { FEATURE_INFO, FEATURES, PRIOR, rules } from '../config';
import { loadDesk } from '../domain/actions';
import type { ClosureModel } from '../domain/closure';
import type { SiteDay } from '../domain/desk';
import { hindsight, type Hindsight } from '../domain/hindsight';
import type { CalibrationBin } from '../domain/rules';
import { dayWithYear } from '../domain/time';
import type { Schema } from '../model';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function HindsightPage() {
  const { store } = useApp<Schema>();
  const desk = useAsync(() => loadDesk(store, new Date()), [store]);
  usePolling(desk.reload, 5000);
  return (
    <DataState
      state={desk}
      skeleton={
        <div>
          <Skeleton height={36} width={200} />
          <Skeleton height={96} className="mt-6" />
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Skeleton height={360} />
            <Skeleton height={360} />
          </div>
        </div>
      }
    >
      {(d) => {
        const h = hindsight(d);
        return (
          <>
            <PageHeader
              title="Hindsight"
              meta={
                <span className="text-ui text-muted num">
                  {h.people.judged} past calls with an outcome · model {d.model.source === 'fitted' ? `fitted to ${d.model.n} calls` : 'on its hand-set prior'}
                </span>
              }
            />
            {h.people.judged === 0 ? (
              <EmptyState icon={<Radar />} title="No outcomes to judge yet">
                Record what each day brought in the <Link to="/logbook">Logbook</Link>; the hit rate builds from there.
              </EmptyState>
            ) : (
              <Body h={h} model={d.model} />
            )}
          </>
        );
      }}
    </DataState>
  );
}

function Body({ h, model }: { h: Hindsight; model: ClosureModel }) {
  const diff = h.people.rate !== null && h.model.rate !== null ? Math.round((h.people.rate - h.model.rate) * 100) : null;
  const overs = h.judged.filter((c) => c.verdict === 'over-cautious');
  const caught = h.judged.filter((c) => c.verdict === 'caught-out');
  return (
    <>
      <StatStrip>
        <Stat label="Hit rate" value={<span data-testid="hit-rate">{pct(h.people.rate)}</span>} hint={`${h.people.hits} of ${h.people.judged} calls right`} size="lg" />
        <Stat label="Over-cautious" value={<span data-testid="over-cautious">{h.people.overCautious}</span>} hint={`Closed with under ${rules.overCautiousSnowCm} cm and ≤ ${rules.lowIncidents} incident`} />
        <Stat label="Caught out" value={<span data-testid="caught-out">{h.people.caughtOut}</span>} tone={h.people.caughtOut ? 'bad' : undefined} hint={`Open into ${rules.caughtOutSnowCm} cm+, or ${rules.caughtOutIncidents}+ incidents`} />
        <Stat
          label="If the model had called"
          value={pct(h.model.rate)}
          hint={diff === null ? '' : diff === 0 ? 'Level with the desk' : diff > 0 ? `The desk beats it by ${diff} points` : `It beats the desk by ${-diff} points`}
        />
      </StatStrip>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h2 className="m-0 mb-3 text-base font-semibold">Does the model match the desk?</h2>
          <Calibration bins={h.calibration} />
          <p className="m-0 mt-3 text-xs text-muted">
            Each dot is a band of past days by the model’s probability; its height is the share the desk actually closed. On the diagonal, the model says what the desk does. Brier score{' '}
            <span className="font-mono num">{h.brier === null ? '—' : h.brier.toFixed(3)}</span> over <span className="font-mono num">{h.points}</span> calls (0 is perfect).
          </p>
        </section>
        <section>
          <h2 className="m-0 mb-3 text-base font-semibold">What the model has learned</h2>
          <Coefficients model={model} />
        </section>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="m-0 mb-3 text-base font-semibold">Over-cautious ({overs.length})</h2>
          <Days list={overs} empty="No over-cautious closures on record." />
        </section>
        <section>
          <h2 className="m-0 mb-3 text-base font-semibold">Caught out ({caught.length})</h2>
          <Days list={caught} empty="Never caught out. Keep recording outcomes." />
        </section>
      </div>

      <Section title="By region" className="mt-8">
        <StatStrip columns={h.byRegion.length}>
          {h.byRegion.map((r) => (
            <Stat key={r.region} label={r.region} value={pct(r.rate.rate)} hint={`${r.rate.overCautious} over-cautious · ${r.rate.caughtOut} caught out`} size="sm" />
          ))}
        </StatStrip>
      </Section>
    </>
  );
}

/** Reliability diagram drawn in SVG: predicted band vs. observed closure share, dot area by number of days. */
function Calibration({ bins }: { bins: CalibrationBin[] }) {
  const W = 420;
  const H = 300;
  const m = { l: 44, r: 16, t: 14, b: 40 };
  const x = (v: number) => m.l + v * (W - m.l - m.r);
  const y = (v: number) => H - m.b - v * (H - m.t - m.b);
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const pts = bins.filter((b) => b.n && b.predicted !== null && b.observed !== null);
  const summary = pts.map((b) => `${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)}%: ${b.n} days, ${Math.round(b.observed! * 100)}% closed`).join('; ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[520px]" role="img" aria-label={`Calibration. ${summary}`} data-testid="calibration">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
          <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="fill-[var(--text-muted,var(--gray-11))] font-mono text-[10px]">
            {Math.round(t * 100)}%
          </text>
          <text x={x(t)} y={H - m.b + 16} textAnchor="middle" className="fill-[var(--gray-11)] font-mono text-[10px]">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--gray-8)" strokeDasharray="4 4" />
      {pts.length > 1 && <polyline points={pts.map((b) => `${x(b.predicted!)},${y(b.observed!)}`).join(' ')} fill="none" stroke="var(--accent-9)" strokeWidth="2" strokeLinejoin="round" />}
      {pts.map((b) => (
        <g key={b.lo}>
          <circle cx={x(b.predicted!)} cy={y(b.observed!)} r={4 + 10 * Math.sqrt(b.n / maxN)} fill="var(--accent-9)" fillOpacity="0.22" stroke="var(--accent-10)" strokeWidth="1.5" />
          <text x={x(b.predicted!)} y={y(b.observed!) - 12 - 10 * Math.sqrt(b.n / maxN)} textAnchor="middle" className="fill-[var(--gray-12)] font-mono text-[10px]">
            {b.n}
          </text>
        </g>
      ))}
      <text x={(x(0) + x(1)) / 2} y={H - 6} textAnchor="middle" className="fill-[var(--gray-11)] text-[11px]">
        Model’s closure probability
      </text>
      <text transform={`translate(12 ${(y(0) + y(1)) / 2}) rotate(-90)`} textAnchor="middle" className="fill-[var(--gray-11)] text-[11px]">
        Share the desk closed
      </text>
    </svg>
  );
}

export function Coefficients({ model, compact }: { model: ClosureModel; compact?: boolean }) {
  const max = Math.max(...FEATURES.map((k) => Math.abs(model.coef[k] * typical[k])), 0.1);
  return (
    <TableWrap label="Model coefficients">
      <Table density="compact" data-testid="coefficients">
        <thead>
          <tr>
            <Th>Input</Th>
            <Th numeric>Per unit</Th>
            {!compact && <Th numeric className="max-md:hidden">Prior</Th>}
            <Th className="w-[34%]">Effect of a typical storm value</Th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((k) => {
            const eff = model.coef[k] * typical[k];
            return (
              <Tr key={k}>
                <Td>
                  <span className="block font-medium">{FEATURE_INFO[k].label}</span>
                  <span className="text-xs text-muted">{FEATURE_INFO[k].unit}</span>
                </Td>
                <Td numeric>{signed(model.coef[k], 3)}</Td>
                {!compact && (
                  <Td numeric muted className="max-md:hidden">
                    {signed(PRIOR.coef[k], 2)}
                  </Td>
                )}
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="relative block h-1.5 flex-1 overflow-hidden rounded-full bg-gray-3" aria-hidden="true">
                      <span className={cx('absolute inset-y-0 left-0 rounded-full', eff >= 0 ? 'bg-[var(--orange-9)]' : 'bg-[var(--sky-9)]')} style={{ width: `${(Math.abs(eff) / max) * 100}%` }} />
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted num">
                      {typicalLabel[k]} → {signed(eff, 1)}
                    </span>
                  </span>
                </Td>
              </Tr>
            );
          })}
          <Tr>
            <Td>
              <span className="block font-medium">Baseline</span>
              <span className="text-xs text-muted">log-odds at all inputs zero</span>
            </Td>
            <Td numeric>{signed(model.intercept, 2)}</Td>
            {!compact && (
              <Td numeric muted className="max-md:hidden">
                {signed(PRIOR.intercept, 2)}
              </Td>
            )}
            <Td className="text-xs text-muted">≈ {pct(1 / (1 + Math.exp(-model.intercept)))} closure on a dry, mild day at sea level</Td>
          </Tr>
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** A typical storm value of each input, to show coefficients on one scale. */
const typical: Record<(typeof FEATURES)[number], number> = { snow: 20, cold: 8, wind: 50, ice: 2, elevation: 8, exposure: 2, road: 2 };
const typicalLabel: Record<(typeof FEATURES)[number], string> = { snow: '20 cm', cold: '−8 °C', wind: '50 km/h', ice: 'high', elevation: '800 m', exposure: 'exposed', road: 'rural' };

function signed(v: number, digits: number) {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
}

function Days({ list, empty }: { list: SiteDay[]; empty: string }) {
  if (!list.length) return <p className="m-0 text-ui text-muted">{empty}</p>;
  return (
    <TableWrap label="Days" maxHeight={360}>
      <Table density="compact" stickyHeader>
        <thead>
          <tr>
            <Th>Day</Th>
            <Th>Site</Th>
            <Th>Call</Th>
            <Th numeric>Forecast</Th>
            <Th numeric>Actual</Th>
            <Th numeric>Incidents</Th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <Tr key={`${c.site.id}-${c.day}`}>
              <Td className="whitespace-nowrap font-mono text-xs">{dayWithYear(c.day)}</Td>
              <Td>{c.site.name}</Td>
              <Td>
                <CallMark call={c.decision!.call} />
              </Td>
              <Td numeric>{c.forecast ? `${fmt(c.forecast.snowCm)} cm` : '—'}</Td>
              <Td numeric>{fmt(c.outcome!.actualSnowCm)} cm</Td>
              <Td numeric>{c.outcome!.incidents}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
