/**
 * Why the model says what it says: each input's push on the log-odds as a diverging bar (right = toward closing),
 * starting from the baseline, ending at the probability. Every number is the model's own (closure.ts drivers()).
 */
import { cx } from '@x10/shared/ui';

import { FEATURE_INFO } from '../config';
import { drivers, type ClosureModel, type ModelInput } from '../domain/closure';

const valueText: Record<string, (v: number) => string> = {
  snow: (v) => `${round(v)} cm`,
  cold: (v) => `${round(-v)} °C`,
  wind: (v) => `${round(v)} km/h`,
  ice: (v) => ['low', 'medium', 'high'][Math.round(v)] ?? String(v),
  elevation: (v) => `${Math.round(v * 100)} m`,
  exposure: (v) => ['sheltered', 'normal', 'exposed'][Math.round(v)] ?? String(v),
  road: (v) => ['main', 'secondary', 'rural'][Math.round(v)] ?? String(v),
};
function round(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function Drivers({ model, input, className }: { model: ClosureModel; input: ModelInput; className?: string }) {
  const list = drivers(model, input);
  const max = Math.max(1.5, Math.abs(model.intercept), ...list.map((d) => Math.abs(d.push)));
  const bar = (v: number) => (
    <span className="relative block h-2 w-full" aria-hidden="true">
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--line-strong)]" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`,
          width: `${(Math.abs(v) / max) * 50}%`,
          background: v >= 0 ? 'var(--orange-9)' : 'var(--sky-9)',
        }}
      />
    </span>
  );
  return (
    <div className={cx('text-ui', className)} data-testid="drivers">
      <div className="mb-1.5 flex justify-between font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
        <span>Toward open</span>
        <span>Toward closing</span>
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0">
        <li className="grid grid-cols-[120px_minmax(0,1fr)_52px] items-center gap-3">
          <span className="truncate text-muted">Baseline</span>
          {bar(model.intercept)}
          <span className="text-right font-mono text-xs text-muted num">{model.intercept.toFixed(1)}</span>
        </li>
        {list.map((d) => (
          <li key={d.feature} className="grid grid-cols-[120px_minmax(0,1fr)_52px] items-center gap-3" title={FEATURE_INFO[d.feature].meaning}>
            <span className="truncate">
              {FEATURE_INFO[d.feature].label} <span className="font-mono text-xs text-muted">{valueText[d.feature](d.value)}</span>
            </span>
            {bar(d.push)}
            <span className={cx('text-right font-mono text-xs num', d.push > 0.05 ? 'text-[var(--orange-11)]' : d.push < -0.05 ? 'text-[var(--sky-11)]' : 'text-muted')}>
              {d.push >= 0 ? '+' : '−'}
              {Math.abs(d.push).toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
