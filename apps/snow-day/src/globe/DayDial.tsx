/**
 * The HTML twin of the brass dial on the globe's base: five days, each with its heaviest forecast snow, and the shake
 * button. A radiogroup (arrow keys), so the dial is usable without the 3D scene.
 */
import { useRef, type KeyboardEvent } from 'react';
import { Sparkles } from 'lucide-react';

import { Button, cx } from '@x10/shared/ui';

import { dayRelative, dayShort, dayWeekday, type DayKey } from '../domain/time';

export interface DialDay {
  day: DayKey;
  /** Mean forecast snow over the sites (what the globe's snowfall follows). */
  mean: number;
  /** Heaviest single-site forecast. */
  peak: number;
}

export function DayDial({
  days,
  today,
  value,
  onChange,
  onShake,
  shakeDisabled,
  className,
}: {
  days: DialDay[];
  today: DayKey;
  value: number;
  onChange(i: number): void;
  onShake?: () => void;
  shakeDisabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const maxPeak = Math.max(20, ...days.map((d) => d.peak));
  const onKey = (e: KeyboardEvent) => {
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = Math.min(days.length - 1, value + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = Math.max(0, value - 1);
    if (n < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(n);
    refs.current[n]?.focus();
  };
  return (
    <div className={cx('x-glass flex max-w-full items-center gap-1 rounded-[18px] p-1', className)} data-testid="day-dial">
      <div role="radiogroup" aria-label="Day" className="no-scrollbar flex min-w-0 gap-0.5 overflow-x-auto" onKeyDown={onKey}>
        {days.map((d, i) => {
          const rel = dayRelative(d.day, today);
          const label = rel === 'Today' || rel === 'Tomorrow' ? rel : dayWeekday(d.day);
          return (
            <button
              key={d.day}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={i === value}
              aria-label={`${rel === 'Today' || rel === 'Tomorrow' ? `${rel}, ` : ''}${dayWeekday(d.day)} ${dayShort(d.day)}: up to ${Math.round(d.peak)} cm`}
              tabIndex={i === value ? 0 : -1}
              className="x-dial-day"
              data-day={d.day}
              onClick={() => onChange(i)}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-ui font-semibold leading-4">{label}</span>
                <span className={cx('font-mono text-[11px] leading-4 num', i === value ? 'opacity-80' : 'text-muted')}>{dayShort(d.day).split(' ')[0]}</span>
              </span>
              <span className={cx('mt-0.5 font-mono text-[11px] leading-4 num', i === value ? 'opacity-80' : 'text-muted')}>{d.peak > 0 ? `${Math.round(d.peak)} cm` : 'dry'}</span>
              <span className="x-dial-bar">
                <span style={{ width: `${Math.min(100, (d.peak / maxPeak) * 100)}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      {onShake && (
        <Button variant="ghost" size="md" icon={<Sparkles />} onClick={onShake} disabled={shakeDisabled} className="h-[54px] shrink-0 rounded-[14px] px-3" title="Shake the globe (S)">
          Shake
        </Button>
      )}
    </div>
  );
}
