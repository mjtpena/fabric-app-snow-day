/**
 * No-WebGL path: the same town seen from above, inside the globe's rim, as SVG. Same encodings as the 3D globe:
 * hills (contour rings) by elevation, roads by class and buried by snow, window light by call, the lens as a ring,
 * snowflakes over each site in proportion to its forecast for the selected day.
 */
import type { KeyboardEvent } from 'react';

import { ROAD_STYLE, SHELTER_TREES, smoothstep, TOWN_R, hash01, type TownLayout } from './layout';
import type { SiteData } from './GlobeScene';

const S = 100; // world unit → SVG unit
const WINDOW: Record<string, string> = {
  open: 'var(--amber-9)',
  delayed: 'var(--orange-9)',
  closed: 'var(--gray-11)',
  remote: 'var(--blue-9)',
  none: 'var(--gray-6)',
};

export function GlobeSvg({
  sites,
  layout,
  focus,
  dayKey,
  meanSnow,
  label,
  onPick,
}: {
  sites: SiteData[];
  layout: TownLayout;
  focus: string | null;
  dayKey: string;
  meanSnow: number;
  label: string;
  onPick(id: string | null): void;
}) {
  const R = TOWN_R * S;
  const key = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(focus === id ? null : id);
    }
  };
  const flakes = sites.flatMap((s) => {
    const spot = layout.sites.get(s.id);
    if (!spot || !s.snowCm) return [];
    const n = Math.min(26, Math.round(s.snowCm * 0.8) + 1);
    return Array.from({ length: n }, (_, i) => {
      const a = hash01(s.id, i * 3) * Math.PI * 2;
      const r = Math.sqrt(hash01(s.id, i * 3 + 1)) * 78;
      return {
        key: `${s.id}-${i}`,
        x: spot.x * S + Math.sin(a) * r,
        y: spot.z * S + Math.cos(a) * r,
        r: 1.4 + hash01(s.id, i * 3 + 2) * 1.6,
        fall: 5 + hash01(s.id, i + 50) * 4,
        delay: -hash01(s.id, i + 80) * 8,
      };
    });
  });
  return (
    <div className="absolute inset-y-0 left-0 flex w-[calc(100%-var(--side-w,0px))] items-center justify-center p-6 pb-28 pt-24 max-md:p-3" data-testid="globe-svg" data-renderer="svg" data-day={dayKey} data-snow-cm={meanSnow.toFixed(1)} data-flakes={flakes.length}>
      <svg viewBox={`${-R - 60} ${-R - 60} ${2 * R + 120} ${2 * R + 120}`} className="h-full max-h-[720px] w-full max-w-[720px]" role="group" aria-label={label}>
        <defs>
          <radialGradient id="svg-floor" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="var(--world-structure)" />
            <stop offset="100%" stopColor="var(--world-ground)" />
          </radialGradient>
          <radialGradient id="svg-glow">
            <stop offset="0%" stopColor="white" stopOpacity="0.9" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* The glass rim and the brass bezel. */}
        <circle r={R + 46} fill="none" stroke="var(--gray-6)" strokeOpacity="0.5" strokeWidth="2" />
        <circle r={R + 8} fill="none" stroke="var(--gold-8)" strokeWidth="9" />
        <circle r={R} fill="url(#svg-floor)" />
        {layout.lake && <ellipse cx={layout.lake.x * S} cy={layout.lake.z * S} rx={(layout.lake.r + 0.08) * S} ry={(layout.lake.r + 0.02) * S} fill="var(--world-water)" stroke="var(--world-water-2)" strokeWidth="2" />}
        {/* Roads from the town square. */}
        {sites.map((s) => {
          const spot = layout.sites.get(s.id);
          if (!spot) return null;
          const style = ROAD_STYLE[s.roadClass];
          const buried = style.bury * smoothstep(0.3, 8, s.snowCm ?? 0);
          const len = Math.hypot(spot.x, spot.z);
          return (
            <line
              key={`road-${s.id}`}
              x1={(spot.x / len) * 48}
              y1={(spot.z / len) * 48}
              x2={spot.x * S * (1 - 32 / (len * S))}
              y2={spot.z * S * (1 - 32 / (len * S))}
              stroke="var(--gray-10)"
              strokeOpacity={1 - buried * 0.75}
              strokeWidth={style.width * S * 0.55}
              strokeDasharray={buried > 0.6 ? '6 6' : undefined}
              strokeLinecap="round"
            />
          );
        })}
        {/* The town square and its clock. */}
        <circle r={46} fill="var(--world-structure-2)" stroke="var(--line-strong)" />
        <circle r={14} fill="var(--world-structure)" stroke="var(--gray-11)" strokeWidth="2" />
        {layout.regions.map((r) => (
          <text key={r.name} x={r.x * S * 1.06} y={r.z * S * 1.06 + 4} textAnchor="middle" className="fill-[var(--world-ink-muted)] font-mono text-[15px] uppercase tracking-[0.12em]">
            {r.name}
          </text>
        ))}
        {sites.map((s) => {
          const spot = layout.sites.get(s.id);
          if (!spot) return null;
          const x = spot.x * S;
          const y = spot.z * S;
          const rings = 1 + Math.round(spot.hill * 2);
          const active = focus === s.id;
          const win = WINDOW[s.call ?? 'none'];
          const trees = SHELTER_TREES[s.exposure];
          const out = Math.atan2(spot.x, spot.z);
          return (
            <g
              key={s.id}
              className="x-svg-site"
              role="button"
              tabIndex={0}
              aria-label={s.summary}
              aria-pressed={active}
              data-testid="globe-site"
              data-site-id={s.id}
              data-call={s.call ?? 'none'}
              opacity={s.dim ? 0.45 : 1}
              onClick={() => onPick(active ? null : s.id)}
              onKeyDown={key(s.id)}
            >
              {Array.from({ length: rings }, (_, i) => (
                <circle key={i} cx={x} cy={y} r={30 + i * 13} fill="none" stroke="var(--world-ink-muted)" strokeOpacity={0.18} strokeDasharray="2 4" />
              ))}
              <circle className="x-svg-ring" cx={x} cy={y} r={36} fill="none" stroke={s.lensColor} strokeWidth={active ? 7 : 5} strokeOpacity={0.9} />
              {s.call !== 'closed' && <circle cx={x} cy={y} r={28} fill={win} opacity={0.35} />}
              {Array.from({ length: trees }, (_, t) => {
                const a = out + (t - (trees - 1) / 2) * 0.42;
                return <circle key={`t${t}`} cx={x + Math.sin(a) * 52} cy={y + Math.cos(a) * 52} r={7} fill="var(--world-foliage-2)" />;
              })}
              <g transform={`translate(${x} ${y}) rotate(${(-spot.ry * 180) / Math.PI})`}>
                <rect x={-17} y={-11} width={34} height={22} rx={2} fill="var(--world-structure)" stroke="var(--gray-11)" strokeWidth="1.5" />
                <line x1={-17} y1={0} x2={17} y2={0} stroke="var(--gray-10)" strokeWidth="1.5" />
                {[-10, 0, 10].map((wx) => (
                  <rect key={wx} x={wx - 3} y={7} width={6} height={4} fill={win} />
                ))}
              </g>
              <text x={x} y={y + 58} textAnchor="middle" className="fill-[var(--world-ink)] text-[13px] font-semibold">
                {s.name}
              </text>
              <text x={x} y={y + 74} textAnchor="middle" className="fill-[var(--world-ink-muted)] font-mono text-[12px]">
                {s.lensValue}
              </text>
            </g>
          );
        })}
        <g aria-hidden="true">
          {flakes.map((f) => (
            <circle key={f.key} className="x-svg-flake" cx={f.x} cy={f.y} r={f.r} fill="var(--world-ink-muted)" fillOpacity={0.5} style={{ ['--fall' as string]: `${f.fall}s`, ['--delay' as string]: `${f.delay}s` }} />
          ))}
        </g>
      </svg>
    </div>
  );
}
