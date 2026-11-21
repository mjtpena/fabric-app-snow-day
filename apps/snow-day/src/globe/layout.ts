/**
 * Where everything sits inside the globe, shared by the three.js scene and the SVG map so both draw the same town.
 * Pure and deterministic: the same sites always land in the same places.
 *
 * The town is a disc of radius TOWN_R on the floor of the globe. Each region takes a sector (the first at the back,
 * the rest around the front), each site a hill in its sector whose height follows its elevation. A road runs from the
 * town square in the middle to every site; the first region named like a lake gets a frozen lake in its sector.
 */
import type { Exposure, RoadClass } from '../model';

export const GLOBE_R = 4;
/** Height of the globe's floor (where the glass meets the base). */
export const FLOOR_Y = -2.2;
/** Radius of the floor disc: where the sphere crosses FLOOR_Y. */
export const TOWN_R = Math.sqrt(GLOBE_R * GLOBE_R - FLOOR_Y * FLOOR_Y);
export const HILL_SIGMA = 0.55;

export interface SiteSpot {
  id: string;
  x: number;
  z: number;
  /** Hill height above the floor. */
  hill: number;
  /** Rotation of the building about y (faces the town square). */
  ry: number;
  region: string;
}

export interface RegionSpot {
  name: string;
  /** Sector centre angle (0 = +z, toward the default camera). */
  angle: number;
  /** Label anchor on the rim. */
  x: number;
  z: number;
  count: number;
}

export interface Lake {
  x: number;
  z: number;
  r: number;
}

export interface TownLayout {
  sites: Map<string, SiteSpot>;
  regions: RegionSpot[];
  lake: Lake | null;
  maxElevation: number;
}

export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hillHeight(elevation: number, maxElevation: number): number {
  return 0.18 + 1.3 * Math.max(0, elevation) / Math.max(400, maxElevation);
}

export function layoutTown(sites: { id: string; region: string; elevation: number }[], regionOrder: string[]): TownLayout {
  const regions = regionOrder.filter((r) => sites.some((s) => s.region === r));
  const n = Math.max(1, regions.length);
  const maxElevation = Math.max(400, ...sites.map((s) => s.elevation));
  const out = new Map<string, SiteSpot>();
  const regionSpots: RegionSpot[] = [];
  let lake: Lake | null = null;
  regions.forEach((region, i) => {
    const angle = Math.PI + (i * 2 * Math.PI) / n;
    const list = sites.filter((s) => s.region === region);
    const m = list.length;
    const sector = (2 * Math.PI) / n;
    const spread = Math.min(0.62, (sector * 0.78) / Math.max(1, m - 1 || 1));
    const isLake = !lake && /lake|shore|harbour|harbor|coast|bay/i.test(region);
    list.forEach((s, j) => {
      const a = angle + (j - (m - 1) / 2) * spread;
      // Alternate near and far rings so neighbours don't touch; the lakeside ring keeps clear of the ice.
      const r = (isLake ? 2.15 : 1.75) + (j % 2) * 0.72 + (hash01(s.id, 3) - 0.5) * 0.12;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      out.set(s.id, { id: s.id, x, z, hill: hillHeight(s.elevation, maxElevation), ry: Math.atan2(-x, -z) + Math.PI, region });
    });
    const lr = TOWN_R - 0.35;
    regionSpots.push({ name: region, angle, x: Math.sin(angle) * lr, z: Math.cos(angle) * lr, count: m });
    if (isLake) lake = { x: Math.sin(angle) * 1.05, z: Math.cos(angle) * 1.05, r: 0.62 };
  });
  return { sites: out, regions: regionSpots, lake, maxElevation };
}

/** Terrain height above FLOOR_Y at (x, z): a hill per site, a little roughness, flat at the lake and the rim. */
export function terrainHeight(x: number, z: number, layout: TownLayout): number {
  let h = 0.12;
  for (const s of layout.sites.values()) {
    const d2 = (x - s.x) ** 2 + (z - s.z) ** 2;
    h = Math.max(h, s.hill * Math.exp(-d2 / (2 * HILL_SIGMA * HILL_SIGMA)) + 0.12 * Math.exp(-d2 / 6));
  }
  // Gentle deterministic roughness so the snow catches the light.
  h += 0.04 * Math.sin(x * 2.3 + z * 1.1) * Math.cos(z * 1.9 - x * 0.7);
  if (layout.lake) {
    const d = Math.hypot(x - layout.lake.x, z - layout.lake.z);
    const t = smoothstep(layout.lake.r, layout.lake.r + 0.35, d);
    h = h * t + 0.03 * (1 - t);
  }
  // The town square stays flat.
  const c = smoothstep(0.35, 0.8, Math.hypot(x, z));
  h = h * c + 0.14 * (1 - c);
  const r = Math.hypot(x, z);
  return h * (1 - smoothstep(TOWN_R - 0.55, TOWN_R, r));
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export type BuildingKind = 'school' | 'depot' | 'hall';

/** Building silhouette from the site's name, falling back to a stable hash. */
export function buildingKind(name: string, id: string): BuildingKind {
  if (/school|academy|primary|college/i.test(name)) return 'school';
  if (/depot|yard|works|garage|store/i.test(name)) return 'depot';
  if (/clinic|office|library|pool|hall|centre|center/i.test(name)) return 'hall';
  return (['school', 'depot', 'hall'] as const)[Math.floor(hash01(id, 5) * 3)];
}

/** Road width and how quickly snow buries it (main roads are gritted first). */
export const ROAD_STYLE: Record<RoadClass, { width: number; bury: number }> = {
  main: { width: 0.15, bury: 0.15 },
  secondary: { width: 0.1, bury: 0.55 },
  rural: { width: 0.065, bury: 1 },
};

/** Sheltered sites get a stand of pines on their windward side; exposed sites stand bare. */
export const SHELTER_TREES: Record<Exposure, number> = { sheltered: 5, normal: 2, exposed: 0 };
