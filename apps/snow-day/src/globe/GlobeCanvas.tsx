/** React wrapper for the three.js snow globe. Default export so it can be lazy-loaded (three.js stays out of the main chunk). */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { useThemeColors } from '@x10/shared/ui';

import type { TownLayout } from './layout';
import { GlobeScene, type DialData, type GlobeTheme, type SiteData } from './GlobeScene';

export interface GlobeApi {
  zoom(factor: number): void;
  shake(): void;
}

export interface GlobeCanvasProps {
  sites: SiteData[];
  layout: TownLayout;
  dayKey: string;
  dial: DialData;
  focus: string | null;
  flyKey: number;
  reduced: boolean;
  lockAt: number | null;
  /** Stage pixels covered by panels at the top and bottom. */
  frame: { top: number; bottom: number };
  label: string;
  onPick(id: string | null): void;
  onDay(index: number): void;
  onError(message: string): void;
  apiRef?: Ref<GlobeApi | null>;
}

/** The globe's materials: the world's own palette, a night version and a winter-morning version. */
function globeTheme(dark: boolean, accent: string): GlobeTheme {
  return dark
    ? {
        dark,
        snow: '#e6eef9',
        ground: '#2c3531',
        ground2: '#3a423b',
        walls: ['#a0836a', '#bfb29b', '#8ea3b4'],
        roof: '#3a414c',
        road: '#262a31',
        pine: '#284435',
        wood: '#5b3a22',
        woodDark: '#24150a',
        brass: '#c99c54',
        ink: '#ecebe7',
        glassRim: '#9cc4f2',
        lake: '#4f7590',
        windows: { open: '#ffcd6e', delayed: '#ff8a26', closed: '#10141b', remote: '#5cb4ff', none: '#c8d0dc' },
        accent,
      }
    : {
        dark,
        snow: '#ffffff',
        ground: '#8c977f',
        ground2: '#a8ad96',
        walls: ['#c59f7b', '#e4d2b2', '#a9bfd0'],
        roof: '#55606e',
        road: '#474c55',
        pine: '#3c5d47',
        wood: '#7a4a2a',
        woodDark: '#4a2b13',
        brass: '#bb904a',
        ink: '#2a2824',
        glassRim: '#eef4fb',
        lake: '#a6c9df',
        windows: { open: '#ffb938', delayed: '#ef730d', closed: '#39404b', remote: '#2b8af0', none: '#97a1ae' },
        accent,
      };
}

export default function GlobeCanvas({ sites, layout, dayKey, dial, focus, flyKey, reduced, lockAt, frame, label, onPick, onDay, onError, apiRef }: GlobeCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const scene = useRef<GlobeScene | null>(null);
  const [ready, setReady] = useState(false);
  const colors = useThemeColors();
  const cbs = useRef({ onPick, onDay, onError });
  cbs.current = { onPick, onDay, onError };

  useEffect(() => {
    const s = new GlobeScene(host.current!, overlay.current!, {
      onPick: (id) => cbs.current.onPick(id),
      onDay: (i) => cbs.current.onDay(i),
      onReady: () => setReady(true),
      onError: (m) => cbs.current.onError(m),
    });
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setTheme(globeTheme(colors.dark, colors.accent[9]));
  }, [colors]);
  useEffect(() => {
    scene.current?.setTown(sites, layout, dayKey);
  }, [sites, layout, dayKey, colors]);
  useEffect(() => {
    scene.current?.setDial(dial);
  }, [dial, colors]);
  useEffect(() => {
    scene.current?.setLock(lockAt);
  }, [lockAt]);
  useEffect(() => {
    scene.current?.setFrame(frame.top, frame.bottom);
  }, [frame.top, frame.bottom]);
  useEffect(() => {
    scene.current?.setMotion(reduced);
  }, [reduced]);
  useEffect(() => {
    scene.current?.setFocus(focus, true);
    // flyKey re-flies to the same focus (a Today item clicked twice, Escape).
  }, [focus, flyKey]);

  useImperativeHandle(apiRef, () => ({ zoom: (f: number) => scene.current?.zoom(f), shake: () => scene.current?.shake() }), []);

  return (
    <div
      ref={host}
      role="group"
      aria-label={label}
      className="absolute inset-y-0 left-0 w-[calc(100%-var(--side-w,0px))] overflow-hidden"
      data-testid="globe-canvas"
      data-ready={ready ? 'true' : 'false'}
      data-renderer="webgl"
    >
      <div ref={overlay} className="x-globe-overlay pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
