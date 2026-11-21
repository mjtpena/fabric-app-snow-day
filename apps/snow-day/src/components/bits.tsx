/** Small shared pieces: the call as window light + label, probability text, a day strip. */
import type { ReactNode } from 'react';

import { cx, Dialog, Kbd } from '@x10/shared/ui';

import { CALL_LABEL } from '../config';
import { CALL_TOKEN } from '../globe/look';
import type { Call } from '../model';

/** The call as the globe shows it: a little lit window and the word. */
export function CallMark({ call, className, muted }: { call: Call | null; className?: string; muted?: boolean }) {
  const token = CALL_TOKEN[call ?? 'none'];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', muted && 'text-muted', className)} data-call={call ?? 'none'}>
      <span
        aria-hidden="true"
        className={cx('inline-block size-2.5 rounded-[3px]', !call && 'border border-dashed border-[var(--gray-8)]')}
        style={call ? { background: `var(${token})`, boxShadow: call === 'closed' ? undefined : `0 0 6px color-mix(in oklab, var(${token}) 70%, transparent)` } : undefined}
      />
      {call ? CALL_LABEL[call] : 'No call'}
    </span>
  );
}

/** A probability as a big mono number with a tone from the bands the globe uses. */
export function ProbText({ p, className }: { p: number | null; className?: string }) {
  if (p === null) return <span className={cx('text-muted', className)}>—</span>;
  const v = Math.round(p * 100);
  const tone = p >= 0.8 ? 'text-[var(--crimson-11)]' : p >= 0.6 ? 'text-[var(--orange-11)]' : p >= 0.4 ? 'text-[var(--amber-11)]' : 'text-[var(--sky-11)]';
  return <span className={cx('font-mono num', tone, className)}>{v}%</span>;
}

/** A horizontal bar from 0 to 100% with a marker for the gap. */
export function ProbBar({ p, call, className }: { p: number | null; call?: Call | null; className?: string }) {
  const w = p === null ? 0 : Math.round(p * 100);
  const weight = call ? { open: 0, delayed: 50, closed: 100, remote: 100 }[call] : null;
  return (
    <span className={cx('relative block h-1.5 w-full overflow-hidden rounded-full bg-gray-4', className)} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: p !== null && p >= 0.6 ? 'var(--orange-9)' : 'var(--sky-9)' }} />
      {weight !== null && <span className="absolute inset-y-[-2px] w-0.5 rounded-full bg-gray-12" style={{ left: `calc(${weight}% - ${weight === 100 ? 2 : weight === 0 ? 0 : 1}px)` }} />}
    </span>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['1', '2', '3', '4', '5'], 'Lenses: probability, forecast snow, ice risk, decision, model disagreement'],
  [['[', ']'], 'Turn the dial to the previous or next day'],
  [['S'], 'Shake the globe and replay the night’s snowfall'],
  [['V'], 'View as duty manager or site lead'],
  [['L'], 'Globe or list'],
  [['←', '→'], 'Previous or next site'],
  [['Esc'], 'Back to the whole globe'],
  [['=', '−'], 'Zoom in or out'],
  [['?'], 'This list'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="m-0 divide-y divide-[var(--line)]">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={what} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-sm">{what}</dt>
            <dd className="m-0 flex shrink-0 gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

/** A label/value row for detail panels. */
export function Fact({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-ui text-muted">{label}</dt>
      <dd className={cx('m-0 text-right text-ui text-fg', mono && 'font-mono num')}>{children}</dd>
    </div>
  );
}
