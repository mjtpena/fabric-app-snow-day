/**
 * The snow globe in three.js. Imperative on purpose: one class owns the renderer, camera, controls, meshes, the snow
 * and the HTML overlay (one focusable button per site), and React drives it through a few setters (town, day, theme,
 * focus, motion, shake). Lazy-loaded with GlobeCanvas so three.js stays out of the main chunk.
 *
 * Every mark maps to data:
 * - each site is a building on its own hill, the hill as high as the site's elevation; the road from the town square
 *   is as wide as its road class and is buried by snow in the same order the ploughs reach it (main roads last);
 *   sheltered sites stand behind a stand of pines, exposed ones stand bare;
 * - the windows show the call (warm = open, amber = delayed, dark = closed, blue = remote, a faint flicker = no call);
 * - snow falls over each site at its forecast for the selected day, settles on its roofs and whitens its ground;
 * - the ring of light round each hill is the lens; the brass plaque on the base is the five-day dial; the clock in the
 *   town square shows the time left to the 09:00 lock.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { buildingKind, FLOOR_Y, GLOBE_R, hash01, ROAD_STYLE, SHELTER_TREES, smoothstep, terrainHeight, TOWN_R, type BuildingKind, type TownLayout } from './layout';
import type { Call, Exposure, RoadClass } from '../model';

export interface SiteData {
  id: string;
  name: string;
  region: string;
  exposure: Exposure;
  roadClass: RoadClass;
  call: Call | null;
  /** Forecast snow for the selected day (null = no forecast). */
  snowCm: number | null;
  lensColor: string;
  lensValue: string;
  dim: boolean;
  summary: string;
}

export interface DialData {
  index: number;
  labels: { weekday: string; date: string; snow: string }[];
}

export interface GlobeTheme {
  dark: boolean;
  snow: string;
  ground: string;
  ground2: string;
  /** Wall colour per region (timber, sandstone, painted boards...), in region order. */
  walls: string[];
  roof: string;
  road: string;
  pine: string;
  wood: string;
  woodDark: string;
  brass: string;
  ink: string;
  glassRim: string;
  lake: string;
  windows: Record<Call | 'none', string>;
  accent: string;
}

interface Callbacks {
  onPick(id: string | null): void;
  onDay(index: number): void;
  onReady(): void;
  onError(message: string): void;
}

interface SiteNode {
  data: SiteData;
  regionIndex: number;
  group: THREE.Group;
  pick: THREE.Mesh[];
  wallMat: THREE.MeshStandardMaterial;
  roofMat: THREE.MeshStandardMaterial;
  windowMat: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  pool: THREE.Mesh;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  caps: THREE.Mesh[];
  capHeights: number[];
  treeCaps: THREE.Mesh[];
  road: THREE.Mesh;
  roadMat: THREE.MeshStandardMaterial;
  button: HTMLButtonElement;
  chip: HTMLSpanElement;
  tip: HTMLSpanElement;
  top: THREE.Vector3;
  /** Settled snow shown now (cm) and the target from the forecast. */
  snow: number;
  phase: number;
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const HOME_TARGET = new THREE.Vector3(0, -0.15, 0);
/** The default view looks at the town a little from the right; the dial on the base faces that way. */
const HOME_AZIMUTH = 0.32;
const HOME_POLAR = 0.42;
const DIAL_ARC = 1.5;
const MAX_FLAKES = 1600;
const MAX_FLAKES_NARROW = 900;
const SNOW_FOR_FULL = 25;

function radialTexture(stops: [number, number][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Turned-wood grain: rings around the base, deterministic. */
function woodTexture(base: string, dark: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    const y = hash01('ring', i) * 256;
    const w = 0.6 + hash01('w', i) * 2.4;
    g.strokeStyle = dark;
    g.globalAlpha = 0.08 + hash01('a', i) * 0.22;
    g.lineWidth = w;
    g.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const yy = y + Math.sin(x / 512 * Math.PI * 2 * (1 + (i % 3)) + i) * (2 + (i % 5));
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A gable roof: triangular prism, ridge along x. */
function gable(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const v = [
    // left slope
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0,
    // right slope
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0,
    // gables
    -x, 0, -z, -x, 0, z, -x, h, 0, x, 0, z, x, 0, -z, x, h, 0,
    // underside
    -x, 0, -z, x, 0, -z, x, 0, z, -x, 0, -z, x, 0, z, -x, 0, z,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const GLASS_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const GLASS_FRAG = /* glsl */ `
  uniform vec3 uRim;
  uniform float uBase;
  uniform float uRimA;
  uniform float uHi;
  uniform float uBack;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 n = normalize(vN) * uBack;
    float f = pow(1.0 - abs(dot(n, normalize(vV))), 2.6);
    // Two window-shaped reflections (a tall pane upper left, a small one right) and a soft rim.
    float h1 = smoothstep(0.935, 0.99, dot(n, normalize(vec3(-0.52, 0.5, 0.69))));
    float h1b = smoothstep(0.0, 0.015, abs(n.x + 0.52 - n.y * 0.2) - 0.03);
    float h2 = smoothstep(0.985, 0.998, dot(n, normalize(vec3(0.6, 0.28, 0.75))));
    float hi = (h1 * h1b + h2 * 0.6) * uHi;
    float a = uBase + f * uRimA + hi;
    gl_FragColor = vec4(mix(uRim, vec3(1.0), clamp(hi * 1.5, 0.0, 1.0)), clamp(a, 0.0, 0.9));
  }
`;

const FLAKE_VERT = /* glsl */ `
  attribute float aSize;
  uniform float uPx;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPx / max(0.1, -mv.z);
  }
`;
const FLAKE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(uColor, a * uOpacity);
  }
`;

export class GlobeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private controls: OrbitControls;
  private host: HTMLElement;
  private overlay: HTMLElement;
  private cb: Callbacks;
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private ready = false;
  private reduced = false;
  private disposed = false;
  private hidden = false;
  private narrow = false;
  private pad = { top: 0, bottom: 0 };
  private ro: ResizeObserver;
  private theme: GlobeTheme | null = null;
  private layout: TownLayout | null = null;
  private townKey = '';
  private nodes = new Map<string, SiteNode>();
  private focus: string | null = null;
  private hovered: string | null = null;
  private flight: { from: { t: THREE.Vector3; p: THREE.Vector3 }; to: { t: THREE.Vector3; p: THREE.Vector3 }; start: number; dur: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down: { x: number; y: number } | null = null;
  private regionLabels: HTMLDivElement[] = [];
  private onVisibility = () => this.visibility();

  // world
  private globe = new THREE.Group();
  private town = new THREE.Group();
  private terrain: THREE.Mesh | null = null;
  private terrainBase: Float32Array | null = null;
  private terrainWeights: Float32Array | null = null;
  private lakeMesh: THREE.Mesh | null = null;
  private square = new THREE.Group();
  private clockTex: THREE.CanvasTexture | null = null;
  private clockCanvas = document.createElement('canvas');
  private clockAt = 0;
  private lockAt: number | null = null;
  private hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1);
  private key = new THREE.DirectionalLight('#ffffff', 2);
  private townGlow = new THREE.PointLight('#ffb35c', 0, 7, 1.8);
  private glassFront!: THREE.Mesh;
  private glassBack!: THREE.Mesh;
  private glassMat!: THREE.ShaderMaterial;
  private glassBackMat!: THREE.ShaderMaterial;
  private baseMat!: THREE.MeshStandardMaterial;
  private brassMat!: THREE.MeshStandardMaterial;
  private plaque!: THREE.Mesh;
  private plaqueCanvas = document.createElement('canvas');
  private plaqueTex!: THREE.CanvasTexture;
  private pointerMesh!: THREE.Mesh;
  private pointerAngle = 0;
  private pointerTarget = 0;
  private dial: DialData | null = null;
  private shadowMat!: THREE.MeshBasicMaterial;
  private wallMats: THREE.MeshStandardMaterial[] = [];
  private snowMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  private pineMat = new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.9, flatShading: true });
  private glowTex = radialTexture([
    [0, 1],
    [0.3, 0.55],
    [1, 0],
  ]);
  private ringTex = radialTexture([
    [0, 0],
    [0.55, 0.05],
    [0.78, 0.75],
    [0.9, 0.35],
    [1, 0],
  ]);

  // snow
  private flakes!: THREE.Points;
  private flakeMat!: THREE.ShaderMaterial;
  private fPos = new Float32Array(MAX_FLAKES * 3);
  private fSize = new Float32Array(MAX_FLAKES);
  private fHome = new Int16Array(MAX_FLAKES);
  private fSpeed = new Float32Array(MAX_FLAKES);
  private fPhase = new Float32Array(MAX_FLAKES);
  private fVy = new Float32Array(MAX_FLAKES);
  private fGround = new Float32Array(MAX_FLAKES);
  private weights: { id: string; w: number; x: number; z: number }[] = [];
  private flakeTarget = 0;
  private flakeCount = 0;
  /** 0..1: how much of the forecast snow has settled (a shake replays it from 0). */
  private settle = 1;
  private shakeStart = -1;
  private dayKeyFor = '';

  constructor(host: HTMLElement, overlay: HTMLElement, cb: Callbacks) {
    this.host = host;
    this.overlay = overlay;
    this.cb = cb;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.renderer = null as unknown as THREE.WebGLRenderer;
      this.controls = null as unknown as OrbitControls;
      this.ro = null as unknown as ResizeObserver;
      cb.onError(e instanceof Error ? e.message : 'WebGL is not available.');
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    Object.assign(r.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
    r.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(r.domElement);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, r.domElement);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minDistance = 7;
    c.maxDistance = 34;
    c.minPolarAngle = 0.45;
    c.maxPolarAngle = 1.62;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.8;
    c.autoRotateSpeed = 0.28;
    c.target.copy(HOME_TARGET);
    c.addEventListener('start', () => {
      this.flight = null;
    });

    this.buildWorld();
    this.buildSnow();

    const el = r.domElement;
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!this.down) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      this.down = null;
      if (moved < 6) this.click(e);
    });
    el.addEventListener('pointermove', (e) => this.hover(e));
    el.addEventListener('pointerleave', () => this.setHovered(null));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.home(false);
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ------------------------------------------------------------------ world */

  private buildWorld() {
    this.scene.add(this.globe);
    this.globe.add(this.town);
    this.scene.add(this.hemi);
    this.key.position.set(-6, 11, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -5;
    sc.right = sc.top = 5;
    sc.near = 1;
    sc.far = 30;
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key);
    this.townGlow.position.set(0, FLOOR_Y + 1.2, 0);
    this.globe.add(this.townGlow);

    // The turned wooden base.
    const profile = [
      [0, FLOOR_Y + 0.02],
      [TOWN_R + 0.02, FLOOR_Y + 0.02],
      [TOWN_R + 0.13, FLOOR_Y - 0.04],
      [TOWN_R + 0.22, FLOOR_Y - 0.17],
      [TOWN_R + 0.26, FLOOR_Y - 0.34],
      [TOWN_R + 0.3, FLOOR_Y - 1.02],
      [TOWN_R + 0.4, FLOOR_Y - 1.1],
      [TOWN_R + 0.48, FLOOR_Y - 1.26],
      [TOWN_R + 0.47, FLOOR_Y - 1.38],
      [TOWN_R + 0.42, FLOOR_Y - 1.42],
      [0, FLOOR_Y - 1.42],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    this.baseMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.0 });
    const base = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), this.baseMat);
    base.receiveShadow = true;
    this.globe.add(base);

    // Brass bezel where the glass sits, and a thin band at the foot.
    this.brassMat = new THREE.MeshStandardMaterial({ color: '#b8904c', roughness: 0.32, metalness: 0.85 });
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(TOWN_R + 0.06, 0.075, 16, 160), this.brassMat);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.y = FLOOR_Y + 0.02;
    this.globe.add(bezel);
    const foot = new THREE.Mesh(new THREE.TorusGeometry(TOWN_R + 0.485, 0.03, 10, 160), this.brassMat);
    foot.rotation.x = Math.PI / 2;
    foot.position.y = FLOOR_Y - 1.27;
    this.globe.add(foot);

    // The dial: a brass plaque round the front of the base with the five days engraved, and a pointer above it.
    this.plaqueCanvas.width = 1280;
    this.plaqueCanvas.height = 160;
    this.plaqueTex = new THREE.CanvasTexture(this.plaqueCanvas);
    this.plaqueTex.colorSpace = THREE.SRGBColorSpace;
    this.plaqueTex.anisotropy = 8;
    const plaqueGeo = new THREE.CylinderGeometry(TOWN_R + 0.282, TOWN_R + 0.302, 0.44, 64, 1, true, HOME_AZIMUTH - DIAL_ARC / 2, DIAL_ARC);
    this.plaque = new THREE.Mesh(
      plaqueGeo,
      new THREE.MeshStandardMaterial({ map: this.plaqueTex, roughness: 0.38, metalness: 0.75, color: '#ffffff' }),
    );
    this.plaque.position.y = FLOOR_Y - 0.7;
    this.plaque.userData.dial = true;
    this.globe.add(this.plaque);
    const ptrGeo = new THREE.ConeGeometry(0.09, 0.16, 3);
    ptrGeo.rotateX(Math.PI);
    this.pointerMesh = new THREE.Mesh(ptrGeo, this.brassMat);
    this.globe.add(this.pointerMesh);

    // Soft contact shadow on the table.
    this.shadowMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 0.55], [0.55, 0.25], [1, 0]]), transparent: true, depthWrite: false, color: '#000000' });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = FLOOR_Y - 1.43;
    this.globe.add(shadow);

    // The glass: a back face (the far wall, faint) and a front face with a fresnel rim and window reflections.
    const sphere = new THREE.SphereGeometry(GLOBE_R, 96, 64, 0, Math.PI * 2, 0, Math.acos(FLOOR_Y / GLOBE_R));
    const glassUniforms = () => ({ uRim: { value: new THREE.Color('#bcd4ee') }, uBase: { value: 0.02 }, uRimA: { value: 0.5 }, uHi: { value: 0.55 }, uBack: { value: 1 } });
    this.glassMat = new THREE.ShaderMaterial({ uniforms: glassUniforms(), vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, transparent: true, depthWrite: false, side: THREE.FrontSide });
    this.glassBackMat = new THREE.ShaderMaterial({ uniforms: glassUniforms(), vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide });
    this.glassBackMat.uniforms.uBack.value = -1;
    this.glassBackMat.uniforms.uHi.value = 0.12;
    this.glassBack = new THREE.Mesh(sphere, this.glassBackMat);
    this.glassBack.renderOrder = 1;
    this.glassFront = new THREE.Mesh(sphere, this.glassMat);
    this.glassFront.renderOrder = 10;
    this.globe.add(this.glassBack, this.glassFront);

    // Town square: the clock tower that counts down to the 09:00 lock.
    this.clockCanvas.width = this.clockCanvas.height = 256;
    this.clockTex = new THREE.CanvasTexture(this.clockCanvas);
    this.clockTex.colorSpace = THREE.SRGBColorSpace;
    this.globe.add(this.square);
  }

  private buildSnow() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.fSize, 1));
    for (let i = 0; i < MAX_FLAKES; i++) {
      this.fSize[i] = 0.055 + hash01('size', i) * 0.07;
      this.fSpeed[i] = 0.32 + hash01('speed', i) * 0.38;
      this.fPhase[i] = hash01('phase', i) * Math.PI * 2;
      this.fHome[i] = -1;
      this.fPos[i * 3 + 1] = -99;
    }
    g.setDrawRange(0, 0);
    this.flakeMat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 600 }, uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0.95 } },
      vertexShader: FLAKE_VERT,
      fragmentShader: FLAKE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.flakes = new THREE.Points(g, this.flakeMat);
    this.flakes.frustumCulled = false;
    this.flakes.renderOrder = 5;
    this.globe.add(this.flakes);
  }

  /** (Re)build the terrain, roads, trees and buildings when the set of sites changes. */
  private buildTown(sites: SiteData[], layout: TownLayout) {
    for (const n of this.nodes.values()) n.button.remove();
    this.nodes.clear();
    this.disposeGroup(this.town);
    this.town.clear();
    this.disposeGroup(this.square);
    this.square.clear();
    for (const l of this.regionLabels) l.remove();
    this.regionLabels = [];
    this.wallMats = [];
    this.layout = layout;

    // Terrain: a polar grid on the floor disc.
    const rings = 40;
    const segs = 120;
    const pos: number[] = [];
    const idx: number[] = [];
    pos.push(0, FLOOR_Y + terrainHeight(0, 0, layout), 0);
    for (let i = 1; i <= rings; i++) {
      const r = (i / rings) * (TOWN_R - 0.005);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        pos.push(x, FLOOR_Y + terrainHeight(x, z, layout), z);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
    for (let i = 1; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = 1 + (i - 1) * segs + j;
        const b = 1 + (i - 1) * segs + ((j + 1) % segs);
        const c = 1 + i * segs + j;
        const d = 1 + i * segs + ((j + 1) % segs);
        idx.push(a, c, b, b, c, d);
      }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    this.terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    this.terrain.receiveShadow = true;
    this.town.add(this.terrain);
    // Per-vertex snow weights: how much each site's forecast whitens this patch of ground.
    const nv = pos.length / 3;
    const ids = sites.map((s) => s.id);
    this.terrainWeights = new Float32Array(nv * ids.length);
    this.terrainBase = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      const x = pos[v * 3];
      const z = pos[v * 3 + 2];
      let sum = 0;
      ids.forEach((id, k) => {
        const s = layout.sites.get(id)!;
        const w = Math.exp(-((x - s.x) ** 2 + (z - s.z) ** 2) / (2 * 0.95 * 0.95));
        this.terrainWeights![v * ids.length + k] = w;
        sum += w;
      });
      for (let k = 0; k < ids.length; k++) this.terrainWeights![v * ids.length + k] /= Math.max(sum, 0.35);
      this.terrainBase[v] = 0.5 + 0.5 * hash01(`${Math.round(x * 20)}:${Math.round(z * 20)}`);
    }

    // The frozen lake.
    if (layout.lake) {
      const lake = new THREE.Mesh(
        new THREE.CircleGeometry(layout.lake.r + 0.08, 64),
        new THREE.MeshStandardMaterial({ color: this.theme?.lake ?? '#9fc4dc', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92 }),
      );
      lake.rotation.x = -Math.PI / 2;
      lake.position.set(layout.lake.x, FLOOR_Y + 0.05, layout.lake.z);
      lake.receiveShadow = true;
      this.lakeMesh = lake;
      this.town.add(lake);
    } else this.lakeMesh = null;

    // Town square: a paved round and the clock tower.
    const paving = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.MeshStandardMaterial({ color: '#6b6e73', roughness: 0.8 }));
    paving.rotation.x = -Math.PI / 2;
    paving.position.y = FLOOR_Y + 0.15;
    paving.receiveShadow = true;
    this.square.add(paving);
    const towerMat = new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 0.7 });
    this.wallMats.push(towerMat);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.2), towerMat);
    tower.position.y = FLOOR_Y + 0.15 + 0.39;
    tower.castShadow = true;
    this.square.add(tower);
    const clockMat = new THREE.MeshBasicMaterial({ map: this.clockTex!, toneMapped: false });
    for (let k = 0; k < 4; k++) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), clockMat);
      const a = (k * Math.PI) / 2;
      face.position.set(Math.sin(a) * 0.101, FLOOR_Y + 0.15 + 0.62, Math.cos(a) * 0.101);
      face.rotation.y = a;
      this.square.add(face);
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshStandardMaterial({ color: '#3d434c', roughness: 0.6 }));
    spire.position.y = FLOOR_Y + 0.15 + 0.78 + 0.15;
    spire.rotation.y = Math.PI / 4;
    spire.castShadow = true;
    this.square.add(spire);
    const spireCap = new THREE.Mesh(new THREE.ConeGeometry(0.165, 0.12, 4), this.snowMat);
    spireCap.position.y = FLOOR_Y + 0.15 + 0.78 + 0.25;
    spireCap.rotation.y = Math.PI / 4;
    spireCap.userData.townCap = true;
    this.square.add(spireCap);

    // Region names on the rim.
    for (const reg of layout.regions) {
      const el = document.createElement('div');
      el.className = 'x-globe-region';
      el.innerHTML = `<span class="x-globe-region-name"></span><span class="x-globe-region-meta"></span>`;
      (el.firstChild as HTMLElement).textContent = reg.name;
      (el.lastChild as HTMLElement).textContent = `${reg.count} site${reg.count === 1 ? '' : 's'}`;
      el.setAttribute('aria-hidden', 'true');
      el.dataset.region = reg.name;
      this.overlay.appendChild(el);
      this.regionLabels.push(el);
    }

    sites.forEach((s, i) => this.buildSite(s, layout, i));
    this.updateOverlayOrder();
  }

  private buildSite(s: SiteData, layout: TownLayout, index: number) {
    const spot = layout.sites.get(s.id)!;
    const theme = this.theme;
    const kind: BuildingKind = buildingKind(s.name, s.id);
    const group = new THREE.Group();
    const groundY = FLOOR_Y + terrainHeight(spot.x, spot.z, layout);
    group.position.set(spot.x, groundY - 0.02, spot.z);
    group.rotation.y = spot.ry;
    this.town.add(group);

    const regionIndex = Math.max(0, layout.regions.findIndex((r) => r.name === s.region));
    const wallMat = new THREE.MeshStandardMaterial({ color: theme ? theme.walls[regionIndex % theme.walls.length] : '#e9e2d6', roughness: 0.75 });
    const roofMat = new THREE.MeshStandardMaterial({ color: theme?.roof ?? '#454b55', roughness: 0.6 });
    const windowMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', toneMapped: false });
    const pick: THREE.Mesh[] = [];
    const caps: THREE.Mesh[] = [];
    const capHeights: number[] = [];

    const dims = kind === 'school' ? { w: 0.68, h: 0.3, d: 0.36, roof: 0.2 } : kind === 'depot' ? { w: 0.74, h: 0.28, d: 0.46, roof: 0.1 } : { w: 0.44, h: 0.48, d: 0.38, roof: 0.18 };
    const body = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), wallMat);
    body.position.y = dims.h / 2;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    pick.push(body);
    const roofGeo = gable(dims.w + 0.06, dims.roof, dims.d + 0.08);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = dims.h;
    roof.castShadow = true;
    group.add(roof);
    pick.push(roof);
    const cap = new THREE.Mesh(gable(dims.w + 0.09, dims.roof, dims.d + 0.12), this.snowMat);
    cap.position.y = dims.h + 0.005;
    cap.castShadow = true;
    group.add(cap);
    caps.push(cap);
    capHeights.push(dims.roof);

    if (kind === 'school') {
      const bell = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), wallMat);
      bell.position.set(0, dims.h + dims.roof + 0.03, 0);
      group.add(bell);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 4), roofMat);
      top.position.set(0, dims.h + dims.roof + 0.15, 0);
      top.rotation.y = Math.PI / 4;
      group.add(top);
      const tcap = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.06, 4), this.snowMat);
      tcap.position.set(0, dims.h + dims.roof + 0.19, 0);
      tcap.rotation.y = Math.PI / 4;
      group.add(tcap);
      caps.push(tcap);
      capHeights.push(-1);
    } else if (kind === 'hall') {
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), roofMat);
      chimney.position.set(dims.w * 0.25, dims.h + dims.roof * 0.7, -0.06);
      group.add(chimney);
    } else {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.7 }));
      door.position.set(-0.12, 0.1, dims.d / 2 + 0.002);
      group.add(door);
    }

    // Windows on the front and back faces.
    const cols = kind === 'school' ? 5 : kind === 'depot' ? 2 : 3;
    const rows = kind === 'hall' ? 2 : 1;
    const ww = kind === 'hall' ? 0.07 : 0.075;
    const wh = 0.085;
    const winGeo = new THREE.PlaneGeometry(ww, wh);
    for (const side of [1, -1])
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (kind === 'depot' && side === 1 && c === 0) continue;
          const span = dims.w * 0.72;
          const x = -span / 2 + (c * span) / (cols - 1);
          const y = rows === 1 ? dims.h * 0.52 : dims.h * (0.3 + r * 0.38);
          const win = new THREE.Mesh(winGeo, windowMat);
          win.position.set(kind === 'depot' && side === 1 ? x + 0.18 : x, y, side * (dims.d / 2 + 0.003));
          if (side === -1) win.rotation.y = Math.PI;
          group.add(win);
        }

    // Window glow and the pool of light it throws on the snow.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ffd27a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(spot.x, groundY + dims.h * 0.55, spot.z);
    glow.scale.setScalar(1.25);
    glow.renderOrder = 4;
    this.town.add(glow);
    const pool = this.conformDisc(spot.x, spot.z, 0.62, 0.012, layout, new THREE.MeshBasicMaterial({ map: this.glowTex, color: '#ffd27a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.town.add(pool);

    // Lens halo: a ring of light round the hill top.
    const haloMat = new THREE.MeshBasicMaterial({ map: this.ringTex, color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false });
    const halo = this.conformDisc(spot.x, spot.z, 0.74, 0.02, layout, haloMat);
    halo.renderOrder = 3;
    this.town.add(halo);

    // Pines on the windward (outer) side of sheltered sites.
    const trees = SHELTER_TREES[s.exposure];
    const treeCaps: THREE.Mesh[] = [];
    const out = Math.atan2(spot.x, spot.z);
    for (let t = 0; t < trees; t++) {
      const a = out + (t - (trees - 1) / 2) * 0.42 + (hash01(s.id, t + 10) - 0.5) * 0.15;
      const rr = 0.5 + hash01(s.id, t + 20) * 0.12;
      const tx = spot.x + Math.sin(a) * rr;
      const tz = spot.z + Math.cos(a) * rr;
      const ty = FLOOR_Y + terrainHeight(tx, tz, layout);
      const hgt = 0.26 + hash01(s.id, t + 30) * 0.12;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(hgt * 0.36, hgt, 7), this.pineMat);
      tree.position.set(tx, ty + hgt / 2, tz);
      tree.castShadow = true;
      this.town.add(tree);
      const tc = new THREE.Mesh(new THREE.ConeGeometry(hgt * 0.2, hgt * 0.4, 7), this.snowMat);
      tc.position.set(tx, ty + hgt * 0.82, tz);
      this.town.add(tc);
      treeCaps.push(tc);
    }

    // The road from the town square, as wide as its class.
    const roadMat = new THREE.MeshStandardMaterial({ color: theme?.road ?? '#3b3f46', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
    const road = this.buildRoad(spot.x, spot.z, ROAD_STYLE[s.roadClass].width, layout, s.id, roadMat);
    this.town.add(road);

    for (const m of pick) m.userData.id = s.id;
    for (const c of caps) c.userData.baseY = c.position.y;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-globe-site';
    button.dataset.siteId = s.id;
    button.dataset.testid = 'globe-site';
    button.setAttribute('data-testid', 'globe-site');
    const chip = document.createElement('span');
    chip.className = 'x-globe-chip';
    const tip = document.createElement('span');
    tip.className = 'x-globe-tip';
    tip.textContent = s.name;
    button.append(chip, tip);
    button.addEventListener('click', () => this.cb.onPick(this.focus === s.id ? null : s.id));
    button.addEventListener('mouseenter', () => this.setHovered(s.id));
    button.addEventListener('mouseleave', () => this.setHovered(null));
    this.overlay.appendChild(button);

    const node: SiteNode = {
      data: s,
      regionIndex,
      group,
      pick,
      wallMat,
      roofMat,
      windowMat,
      glow,
      pool,
      halo,
      haloMat,
      caps,
      capHeights,
      treeCaps,
      road,
      roadMat,
      button,
      chip,
      tip,
      top: new THREE.Vector3(spot.x, groundY + dims.h + dims.roof + 0.2, spot.z),
      snow: 0,
      phase: index * 1.7,
    };
    this.nodes.set(s.id, node);
    this.applySite(node, s);
  }

  /** A small disc that follows the terrain (for halos and light pools on hills). */
  private conformDisc(cx: number, cz: number, r: number, lift: number, layout: TownLayout, mat: THREE.Material): THREE.Mesh {
    const rings = 10;
    const segs = 40;
    const pos: number[] = [cx, FLOOR_Y + terrainHeight(cx, cz, layout) + lift, cz];
    const uv: number[] = [0.5, 0.5];
    const idx: number[] = [];
    for (let i = 1; i <= rings; i++) {
      const rr = (i / rings) * r;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = cx + Math.sin(a) * rr;
        const z = cz + Math.cos(a) * rr;
        pos.push(x, FLOOR_Y + terrainHeight(x, z, layout) + lift, z);
        uv.push(0.5 + (Math.sin(a) * (rr / r)) / 2, 0.5 + (Math.cos(a) * (rr / r)) / 2);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
    for (let i = 1; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = 1 + (i - 1) * segs + j;
        const b = 1 + (i - 1) * segs + ((j + 1) % segs);
        const c = 1 + i * segs + j;
        const d = 1 + i * segs + ((j + 1) % segs);
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    return m;
  }

  private buildRoad(sx: number, sz: number, width: number, layout: TownLayout, id: string, mat: THREE.Material): THREE.Mesh {
    const len = Math.hypot(sx, sz);
    const ux = sx / len;
    const uz = sz / len;
    const bend = (hash01(id, 40) - 0.5) * 0.5;
    const n = 36;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const d = 0.48 + t * (len - 0.48 - 0.32);
      const off = Math.sin(t * Math.PI) * bend;
      const x = ux * d - uz * off;
      const z = uz * d + ux * off;
      pts.push(new THREE.Vector3(x, FLOOR_Y + terrainHeight(x, z, layout) + 0.022, z));
    }
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      const q = pts[Math.min(n, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      const dx = q.x - o.x;
      const dz = q.z - o.z;
      const l = Math.hypot(dx, dz) || 1;
      const px = (-dz / l) * (width / 2);
      const pz = (dx / l) * (width / 2);
      pos.push(p.x + px, FLOOR_Y + terrainHeight(p.x + px, p.z + pz, layout) + 0.022, p.z + pz);
      pos.push(p.x - px, FLOOR_Y + terrainHeight(p.x - px, p.z - pz, layout) + 0.022, p.z - pz);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  /* ------------------------------------------------------------------ setters */

  setTown(sites: SiteData[], layout: TownLayout, dayKey: string) {
    if (!this.renderer) return;
    const key = JSON.stringify([...layout.sites.values()].map((s) => [s.id, s.x.toFixed(3), s.z.toFixed(3), s.hill.toFixed(3)])) + sites.map((s) => `${s.id}${s.name}${s.exposure}${s.roadClass}`).join();
    if (key !== this.townKey) {
      this.townKey = key;
      this.buildTown(sites, layout);
    } else for (const s of sites) {
      const n = this.nodes.get(s.id);
      if (n) this.applySite(n, s);
    }
    // Snow distribution for the falling flakes: each site's forecast, plus a little everywhere.
    this.weights = sites.map((s) => {
      const spot = layout.sites.get(s.id)!;
      return { id: s.id, w: Math.max(0, s.snowCm ?? 0), x: spot.x, z: spot.z };
    });
    const total = this.weights.reduce((t, w) => t + w.w, 0);
    const forecast = sites.filter((s) => s.snowCm !== null);
    const mean = forecast.length ? total / forecast.length : 0;
    const max = this.narrow ? MAX_FLAKES_NARROW : MAX_FLAKES;
    this.flakeTarget = total > 0 ? Math.round(Math.min(1, Math.max(0.05, mean / SNOW_FOR_FULL)) * max) : 0;
    if (dayKey !== this.dayKeyFor) {
      this.dayKeyFor = dayKey;
      this.host.dataset.day = dayKey;
    }
    this.host.dataset.snowCm = mean.toFixed(1);
    this.host.dataset.flakes = String(this.flakeTarget);
  }

  private applySite(n: SiteNode, s: SiteData) {
    n.data = s;
    n.chip.textContent = s.lensValue;
    n.button.setAttribute('aria-label', s.summary);
    n.button.dataset.call = s.call ?? 'none';
    n.button.style.setProperty('--lens', s.lensColor);
    n.button.dataset.dim = s.dim ? 'true' : 'false';
    n.haloMat.color.set(s.lensColor);
    const win = this.theme?.windows[s.call ?? 'none'] ?? '#ffd27a';
    n.windowMat.color.set(win);
    (n.glow.material as THREE.SpriteMaterial).color.set(win);
    (n.pool.material as THREE.MeshBasicMaterial).color.set(win);
  }

  setDial(dial: DialData) {
    if (!this.renderer) return;
    this.dial = dial;
    this.pointerTarget = HOME_AZIMUTH - DIAL_ARC / 2 + ((dial.index + 0.5) / Math.max(1, dial.labels.length)) * DIAL_ARC;
    if (this.reduced) this.pointerAngle = this.pointerTarget;
    this.drawPlaque();
  }

  private drawPlaque() {
    const t = this.theme;
    const d = this.dial;
    const c = this.plaqueCanvas;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const brass = g.createLinearGradient(0, 0, 0, H);
    brass.addColorStop(0, '#d8b46a');
    brass.addColorStop(0.45, '#b48a45');
    brass.addColorStop(1, '#8a6630');
    g.fillStyle = brass;
    g.fillRect(0, 0, W, H);
    // Brushed lines.
    g.globalAlpha = 0.12;
    for (let i = 0; i < 140; i++) {
      g.fillStyle = i % 2 ? '#fff3d0' : '#5a4220';
      g.fillRect(0, hash01('brush', i) * H, W, 1);
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(60,40,15,0.55)';
    g.lineWidth = 3;
    g.strokeRect(6, 6, W - 12, H - 12);
    if (!d) return;
    const n = d.labels.length;
    const cw = (W - 24) / n;
    d.labels.forEach((l, i) => {
      const x = 12 + i * cw;
      const sel = i === d.index;
      if (sel) {
        g.fillStyle = 'rgba(40,26,8,0.78)';
        g.fillRect(x + 6, 14, cw - 12, H - 28);
      }
      if (i > 0) {
        g.fillStyle = 'rgba(60,40,15,0.45)';
        g.fillRect(x, 26, 2, H - 52);
      }
      g.textAlign = 'center';
      g.fillStyle = sel ? '#ffe6ad' : 'rgba(45,30,10,0.9)';
      g.font = '600 30px "Geist Mono Variable", ui-monospace, monospace';
      g.fillText(`${l.weekday.toUpperCase()} ${l.date}`, x + cw / 2, 66);
      g.font = '500 34px "Geist Mono Variable", ui-monospace, monospace';
      g.fillStyle = sel ? '#ffffff' : 'rgba(45,30,10,0.78)';
      g.fillText(l.snow, x + cw / 2, 116);
    });
    void t;
    this.plaqueTex.needsUpdate = true;
  }

  setLock(lockAtMs: number | null) {
    this.lockAt = lockAtMs;
    this.clockAt = 0;
  }

  private drawClock(now: number) {
    if (!this.clockTex) return;
    const c = this.clockCanvas;
    const g = c.getContext('2d')!;
    const S = c.width;
    const r = S / 2 - 6;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#f6f1e6';
    g.beginPath();
    g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#2b2a28';
    g.stroke();
    const d = new Date(now);
    const h = d.getHours() % 12;
    const m = d.getMinutes();
    // Time left to the lock as a red arc from now to the lock, when it is within 12 hours.
    if (this.lockAt !== null && this.lockAt > now && this.lockAt - now < 12 * 3600_000) {
      const from = ((h + m / 60) / 12) * Math.PI * 2 - Math.PI / 2;
      const to = from + ((this.lockAt - now) / (12 * 3600_000)) * Math.PI * 2;
      g.strokeStyle = '#d8453b';
      g.lineWidth = 26;
      g.beginPath();
      g.arc(S / 2, S / 2, r - 30, from, to);
      g.stroke();
    }
    g.strokeStyle = '#2b2a28';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.lineWidth = k % 3 === 0 ? 10 : 5;
      g.beginPath();
      g.moveTo(S / 2 + Math.sin(a) * (r - 8), S / 2 - Math.cos(a) * (r - 8));
      g.lineTo(S / 2 + Math.sin(a) * (r - 30), S / 2 - Math.cos(a) * (r - 30));
      g.stroke();
    }
    const hand = (a: number, len: number, w: number) => {
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(S / 2, S / 2);
      g.lineTo(S / 2 + Math.sin(a) * len, S / 2 - Math.cos(a) * len);
      g.stroke();
    };
    hand(((h + m / 60) / 12) * Math.PI * 2, r * 0.5, 14);
    hand((m / 60) * Math.PI * 2, r * 0.78, 9);
    this.clockTex.needsUpdate = true;
  }

  setTheme(t: GlobeTheme) {
    if (!this.renderer) return;
    this.theme = t;
    const dark = t.dark;
    this.hemi.color.set(dark ? '#5d6f92' : '#ffffff');
    this.hemi.groundColor.set(dark ? '#121723' : '#aeb8c4');
    this.hemi.intensity = dark ? 0.7 : 1.15;
    this.key.color.set(dark ? '#a9c2f0' : '#fff2df');
    this.key.intensity = dark ? 1.05 : 2.1;
    this.scene.environmentIntensity = dark ? 0.28 : 0.62;
    this.townGlow.intensity = dark ? 0.9 : 0;
    this.renderer.toneMappingExposure = dark ? 1.05 : 1.0;
    this.snowMat.color.set(t.snow);
    this.pineMat.color.set(t.pine);
    const wood = woodTexture(t.wood, t.woodDark);
    this.baseMat.map?.dispose();
    this.baseMat.map = wood;
    this.baseMat.needsUpdate = true;
    this.brassMat.color.set(t.brass);
    this.shadowMat.opacity = dark ? 0.75 : 0.32;
    for (const m of [this.glassMat, this.glassBackMat]) {
      m.uniforms.uRim.value.set(t.glassRim);
      m.uniforms.uRimA.value = dark ? 0.42 : 0.55;
      m.uniforms.uBase.value = dark ? 0.015 : 0.03;
    }
    this.glassMat.uniforms.uHi.value = dark ? 0.5 : 0.75;
    this.glassBackMat.uniforms.uRimA.value = dark ? 0.12 : 0.16;
    this.flakeMat.uniforms.uColor.value.set(t.snow);
    this.flakeMat.uniforms.uOpacity.value = dark ? 0.95 : 0.9;
    if (this.lakeMesh) (this.lakeMesh.material as THREE.MeshStandardMaterial).color.set(t.lake);
    for (const m of this.wallMats) m.color.set(t.walls[1 % t.walls.length]);
    for (const n of this.nodes.values()) {
      n.wallMat.color.set(t.walls[n.regionIndex % t.walls.length]);
      n.roofMat.color.set(t.roof);
      this.applySite(n, n.data);
    }
    this.drawPlaque();
    this.clockAt = 0;
  }

  /** Pixels of the stage covered by panels at the top and bottom: the globe is framed in the band between. */
  setFrame(top: number, bottom: number) {
    if (!this.renderer || (top === this.pad.top && bottom === this.pad.bottom)) return;
    this.pad = { top, bottom };
    this.resize();
  }

  setMotion(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) {
      this.settle = 1;
      this.shakeStart = -1;
      this.pointerAngle = this.pointerTarget;
    }
  }

  setFocus(id: string | null, fly: boolean) {
    this.focus = id;
    if (!this.renderer) return;
    for (const n of this.nodes.values()) n.button.dataset.active = n.data.id === id ? 'true' : 'false';
    if (!fly) return;
    if (!id) {
      this.home(true);
      return;
    }
    const n = this.nodes.get(id);
    if (!n) return;
    // Look at the site from outside the glass on its side, a little above; the target sits between the site and the
    // town square so the neighbours stay in view, shifted left on desktop so the site clears the card.
    const site = new THREE.Vector3(n.group.position.x, n.group.position.y + 0.2, n.group.position.z);
    const out = new THREE.Vector3(site.x, 0, site.z).normalize();
    const dir = new THREE.Vector3(out.x * 0.8, 0.75, out.z * 0.8).normalize();
    const t = site.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, -0.4, 0));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    if (!this.narrow) t.addScaledVector(right, -2.2);
    const dist = this.narrow ? 22 : 19;
    const p = t.clone().add(dir.multiplyScalar(dist));
    this.flyTo(t, p);
  }

  zoom(factor: number) {
    if (!this.renderer) return;
    const c = this.controls;
    const off = this.camera.position.clone().sub(c.target);
    const len = Math.min(c.maxDistance, Math.max(c.minDistance, off.length() * factor));
    this.flyTo(c.target.clone(), c.target.clone().add(off.setLength(len)), 380);
  }

  /** Shake the globe: it wobbles, the snow swirls up, and the night's snowfall settles again. */
  shake() {
    if (!this.renderer) return;
    if (this.reduced) return;
    this.shakeStart = this.time;
    this.settle = 0;
    const max = this.narrow ? MAX_FLAKES_NARROW : MAX_FLAKES;
    for (let i = 0; i < max; i++) {
      if (i >= this.flakeCount) this.respawn(i, true);
      this.fVy[i] = 1.2 + hash01('kick', i + Math.floor(this.time * 10)) * 2.6;
    }
    this.flakeCount = max;
  }

  private home(animate: boolean) {
    const dist = this.fitDistance();
    const p = HOME_TARGET.clone().add(
      new THREE.Vector3(Math.sin(HOME_AZIMUTH) * Math.cos(HOME_POLAR), Math.sin(HOME_POLAR), Math.cos(HOME_AZIMUTH) * Math.cos(HOME_POLAR)).multiplyScalar(dist),
    );
    if (animate && !this.reduced) this.flyTo(HOME_TARGET.clone(), p);
    else {
      this.flight = null;
      this.controls.target.copy(HOME_TARGET);
      this.camera.position.copy(p);
    }
  }

  private fitDistance() {
    const halfH = 4.25;
    const halfW = 4.55;
    const v = (this.camera.fov * Math.PI) / 360;
    const h = this.host.clientHeight || 1;
    const band = Math.max(h * 0.45, h - this.pad.top - this.pad.bottom);
    return Math.max((halfH / Math.tan(v)) * (h / band), halfW / (Math.tan(v) * this.camera.aspect)) * 1.03;
  }

  private flyTo(t: THREE.Vector3, p: THREE.Vector3, dur = 1100) {
    if (this.reduced) {
      this.flight = null;
      this.controls.target.copy(t);
      this.camera.position.copy(p);
      return;
    }
    this.flight = { from: { t: this.controls.target.clone(), p: this.camera.position.clone() }, to: { t, p }, start: performance.now(), dur };
  }

  /* ------------------------------------------------------------------ input */

  private ndc(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [this.plaque];
    for (const n of this.nodes.values()) list.push(...n.pick);
    return list;
  }

  private click(e: PointerEvent) {
    this.ndc(e);
    const hit = this.raycaster.intersectObjects(this.pickables(), false)[0];
    if (!hit) {
      if (this.focus) this.cb.onPick(null);
      return;
    }
    if (hit.object.userData.dial && hit.uv && this.dial) {
      const i = Math.min(this.dial.labels.length - 1, Math.max(0, Math.floor(hit.uv.x * this.dial.labels.length)));
      this.cb.onDay(i);
      return;
    }
    const id = hit.object.userData.id as string | undefined;
    if (id) this.cb.onPick(this.focus === id ? null : id);
  }

  private hover(e: PointerEvent) {
    if (e.buttons) return;
    this.ndc(e);
    const hit = this.raycaster.intersectObjects(this.pickables(), false)[0];
    const id = (hit?.object.userData.id as string | undefined) ?? null;
    this.renderer.domElement.style.cursor = id || hit?.object.userData.dial ? 'pointer' : 'grab';
    this.setHovered(id);
  }

  private setHovered(id: string | null) {
    if (this.hovered === id) return;
    this.hovered = id;
    for (const n of this.nodes.values()) if (n.data.id !== this.focus) n.button.dataset.active = n.data.id === id ? 'hover' : 'false';
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.narrow = w < 640;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Shift the picture so the globe centres in the band between the panels.
    this.camera.setViewOffset(w, h, 0, (this.pad.bottom - this.pad.top) / 2, w, h);
    this.camera.updateProjectionMatrix();
    this.overlay.dataset.narrow = this.narrow ? 'true' : 'false';
    this.flakeMat.uniforms.uPx.value = h * 0.9 * Math.min(window.devicePixelRatio || 1, 2);
    if (!this.focus && !this.flight) this.home(false);
  }

  private visibility() {
    this.hidden = document.visibilityState === 'hidden';
    if (this.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.raf && !this.disposed) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  /* ------------------------------------------------------------------ snow */

  private groundAt(x: number, z: number): number {
    return this.layout ? FLOOR_Y + terrainHeight(x, z, this.layout) : FLOOR_Y;
  }

  private pickHome(seed: number): number {
    const total = this.weights.reduce((t, w) => t + w.w, 0);
    if (total <= 0) return -1;
    // A fifth of the flakes fall anywhere; the rest over each site in proportion to its forecast.
    if (hash01('amb', seed) < 0.2) return -1;
    let r = hash01('home', seed) * total;
    for (let k = 0; k < this.weights.length; k++) {
      r -= this.weights[k].w;
      if (r <= 0) return k;
    }
    return this.weights.length - 1;
  }

  private respawn(i: number, anywhere: boolean) {
    const seed = i * 7919 + Math.floor(this.time * 13);
    const home = this.pickHome(seed);
    this.fHome[i] = home;
    let x: number;
    let z: number;
    const a = hash01('a', seed) * Math.PI * 2;
    if (home >= 0) {
      const w = this.weights[home];
      const rr = Math.sqrt(hash01('r', seed)) * 0.95;
      x = w.x + Math.sin(a) * rr;
      z = w.z + Math.cos(a) * rr;
    } else {
      const rr = Math.sqrt(hash01('r', seed)) * (TOWN_R - 0.3);
      x = Math.sin(a) * rr;
      z = Math.cos(a) * rr;
    }
    const lim = TOWN_R - 0.2;
    const len = Math.hypot(x, z);
    if (len > lim) {
      x *= lim / len;
      z *= lim / len;
    }
    const ground = this.groundAt(x, z);
    const top = Math.sqrt(Math.max(0, (GLOBE_R - 0.25) ** 2 - x * x - z * z));
    this.fGround[i] = ground;
    this.fPos[i * 3] = x;
    this.fPos[i * 3 + 2] = z;
    this.fPos[i * 3 + 1] = anywhere ? ground + hash01('y', seed) * (top - ground) : top;
    this.fVy[i] = 0;
  }

  private stepSnow(dt: number) {
    const max = this.narrow ? MAX_FLAKES_NARROW : MAX_FLAKES;
    const shaking = this.shakeStart >= 0 && this.time - this.shakeStart < 6;
    if (!shaking) {
      const target = Math.min(max, this.flakeTarget);
      if (this.flakeCount < target) {
        const add = Math.min(target - this.flakeCount, Math.ceil(max * dt * 0.9));
        for (let i = this.flakeCount; i < this.flakeCount + add; i++) this.respawn(i, true);
        this.flakeCount += add;
      } else if (this.flakeCount > target) this.flakeCount = Math.max(target, this.flakeCount - Math.ceil(max * dt * 0.9));
    }
    const t = this.time;
    const R2 = (GLOBE_R - 0.2) ** 2;
    for (let i = 0; i < this.flakeCount; i++) {
      const j = i * 3;
      let x = this.fPos[j];
      let y = this.fPos[j + 1];
      let z = this.fPos[j + 2];
      if (y < -50) {
        this.respawn(i, true);
        continue;
      }
      if (this.fVy[i] > 0) {
        // Swirl after a shake: rise, spin round the axis, then fall.
        y += this.fVy[i] * dt;
        this.fVy[i] = Math.max(0, this.fVy[i] - 2.4 * dt);
        const ang = 0.9 * dt;
        const cx = x * Math.cos(ang) - z * Math.sin(ang);
        z = x * Math.sin(ang) + z * Math.cos(ang);
        x = cx;
      } else {
        y -= this.fSpeed[i] * dt;
        x += Math.sin(t * 0.9 + this.fPhase[i]) * 0.06 * dt;
        z += Math.cos(t * 0.7 + this.fPhase[i]) * 0.06 * dt;
      }
      const d2 = x * x + y * y + z * z;
      if (d2 > R2) {
        const k = Math.sqrt(R2 / d2);
        x *= k;
        y *= k;
        z *= k;
      }
      this.fPos[j] = x;
      this.fPos[j + 1] = y;
      this.fPos[j + 2] = z;
      if (y <= this.fGround[i] + 0.02 && this.fVy[i] <= 0) this.respawn(i, false);
    }
    const geo = this.flakes.geometry;
    geo.setDrawRange(0, this.flakeCount);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Settled snow on roofs, trees, roads and ground, eased toward the forecast. */
  private stepSettled(dt: number) {
    if (!this.terrain || !this.terrainWeights || !this.terrainBase || !this.theme) return;
    if (this.settle < 1) this.settle = this.reduced ? 1 : Math.min(1, this.settle + dt / 5.5);
    const k = ease(this.settle);
    const nodes = [...this.nodes.values()];
    let changed = false;
    for (const n of nodes) {
      const target = (n.data.snowCm ?? 0) * k;
      const next = this.reduced ? target : n.snow + (target - n.snow) * Math.min(1, dt * 2.4);
      if (Math.abs(next - n.snow) > 0.001 || !this.ready) changed = true;
      n.snow = next;
      const depth = Math.min(1, n.snow / 30);
      const visible = n.snow > 0.25;
      n.caps.forEach((cap, ci) => {
        cap.visible = visible;
        const baseY = cap.userData.baseY as number;
        if (n.capHeights[ci] > 0) {
          cap.scale.set(1, 1 + depth * 0.9, 1);
          cap.position.y = baseY + 0.004 + depth * 0.02;
        } else cap.scale.setScalar(0.6 + depth * 0.6);
      });
      for (const tc of n.treeCaps) {
        tc.visible = visible;
        tc.scale.setScalar(0.7 + depth * 0.8);
      }
      const cover = smoothstep(0.3, 8, n.snow);
      const bury = ROAD_STYLE[n.data.roadClass].bury * cover;
      n.roadMat.color.set(this.theme.road).lerp(new THREE.Color(this.theme.snow), bury * 0.85);
    }
    if (!changed && this.ready) return;
    const col = this.terrain.geometry.attributes.color as THREE.BufferAttribute;
    const g1 = new THREE.Color(this.theme.ground);
    const g2 = new THREE.Color(this.theme.ground2);
    const snow = new THREE.Color(this.theme.snow);
    const tmp = new THREE.Color();
    const m = nodes.length;
    const pos = this.terrain.geometry.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < col.count; v++) {
      let depth = 0;
      for (let s = 0; s < m; s++) depth += this.terrainWeights[v * m + s] * nodes[s].snow;
      const cover = smoothstep(0.2, 6, depth);
      // Higher ground holds snow longer, so it whitens first.
      const lift = smoothstep(0.1, 1.4, pos.getY(v) - FLOOR_Y) * 0.12;
      tmp.copy(g1).lerp(g2, this.terrainBase[v]).lerp(snow, Math.min(1, cover + (cover > 0.05 ? lift : 0)));
      col.setXYZ(v, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
    const townCover = smoothstep(0.3, 8, nodes.reduce((s, n) => s + n.snow, 0) / Math.max(1, m));
    this.square.traverse((o) => {
      if (o.userData.townCap) o.visible = townCover > 0.05;
    });
  }

  /* ------------------------------------------------------------------ frame */

  private loop = () => {
    if (this.disposed || this.hidden) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.reduced) this.time += dt;

    if (this.flight) {
      const f = this.flight;
      const k = Math.min(1, (now - f.start) / f.dur);
      const e = ease(k);
      this.controls.target.lerpVectors(f.from.t, f.to.t, e);
      this.camera.position.lerpVectors(f.from.p, f.to.p, e);
      if (k >= 1) this.flight = null;
    }
    this.controls.autoRotate = false;
    this.controls.update(dt);

    // The shake: a damped wobble of the whole globe.
    if (this.shakeStart >= 0) {
      const s = this.time - this.shakeStart;
      const amp = Math.exp(-s * 2.2);
      this.globe.rotation.z = Math.sin(s * 17) * 0.07 * amp;
      this.globe.rotation.x = Math.sin(s * 13 + 1) * 0.035 * amp;
      this.globe.position.x = Math.sin(s * 19) * 0.12 * amp;
      if (s > 6) {
        this.shakeStart = -1;
        this.globe.rotation.set(0, 0, 0);
        this.globe.position.set(0, 0, 0);
      }
    }

    if (!this.reduced) this.stepSnow(dt);
    else {
      this.flakeCount = 0;
      this.flakes.geometry.setDrawRange(0, 0);
    }
    this.stepSettled(dt);

    // Dial pointer turns to the selected day.
    this.pointerAngle += (this.pointerTarget - this.pointerAngle) * (this.reduced ? 1 : Math.min(1, dt * 6));
    const pr = TOWN_R + 0.33;
    this.pointerMesh.position.set(Math.sin(this.pointerAngle) * pr, FLOOR_Y - 0.4, Math.cos(this.pointerAngle) * pr);
    this.pointerMesh.rotation.y = this.pointerAngle;

    // Windows and halos.
    const dark = this.theme?.dark ?? false;
    for (const n of this.nodes.values()) {
      const d = n.data;
      const focus = this.focus === d.id;
      const call = d.call;
      const flicker = call === null && !this.reduced ? 0.55 + 0.45 * Math.sin(this.time * 3.1 + n.phase) : 1;
      const lit = call === 'closed' ? 0 : call === null ? 0.35 * flicker : 1;
      const dimK = d.dim ? 0.3 : 1;
      const gm = n.glow.material as THREE.SpriteMaterial;
      gm.opacity = lit * dimK * (dark ? 0.75 : 0.3);
      n.glow.visible = gm.opacity > 0.01;
      const pm = n.pool.material as THREE.MeshBasicMaterial;
      pm.opacity = lit * dimK * (dark ? 0.55 : 0.18);
      n.pool.visible = pm.opacity > 0.01;
      if (call === 'closed') n.windowMat.color.set(dark ? '#0f131a' : '#39404b');
      else if (call === null) n.windowMat.color.set(this.theme?.windows.none ?? '#c9cfd8').multiplyScalar(0.55 + 0.45 * flicker);
      const breathe = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(this.time * 2 + n.phase);
      n.haloMat.opacity = (focus ? 1 : 0.78) * breathe * dimK;
      n.group.scale.setScalar(focus ? 1.12 : 1);
    }

    // The clock in the square, once a few seconds.
    const wall = Date.now();
    if (wall - this.clockAt > 15_000) {
      this.clockAt = wall;
      this.drawClock(wall);
    }

    this.renderer.render(this.scene, this.camera);
    this.layoutOverlay();
    if (!this.ready) {
      this.ready = true;
      this.cb.onReady();
    }
  };

  private v = new THREE.Vector3();

  private project(p: THREE.Vector3, w: number, h: number) {
    this.v.copy(p).applyMatrix4(this.globe.matrixWorld);
    this.v.project(this.camera);
    return { x: (this.v.x * 0.5 + 0.5) * w, y: (-this.v.y * 0.5 + 0.5) * h, behind: this.v.z > 1 };
  }

  private updateOverlayOrder() {
    // Tab order follows the regions, then the names (the order the sites were given in).
    for (const n of this.nodes.values()) this.overlay.appendChild(n.button);
  }

  private layoutOverlay() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const n of this.nodes.values()) {
      const p = this.project(n.top, w, h);
      n.button.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      n.button.dataset.hidden = p.behind ? 'true' : 'false';
    }
    if (this.layout)
      this.layout.regions.forEach((reg, i) => {
        const el = this.regionLabels[i];
        if (!el) return;
        const p = this.project(new THREE.Vector3(reg.x, FLOOR_Y + 0.2, reg.z), w, h);
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        // Only the regions on the near side of the glass are labelled (the far ones sit behind the hills).
        const cx = this.camera.position.x - this.controls.target.x;
        const cz = this.camera.position.z - this.controls.target.z;
        const facing = (reg.x * cx + reg.z * cz) / (Math.hypot(reg.x, reg.z) * Math.hypot(cx, cz) || 1);
        el.dataset.hidden = p.behind || !!this.focus || facing < -0.2 ? 'true' : 'false';
      });
  }

  private disposeGroup(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x !== this.snowMat && x !== this.pineMat && x.dispose());
      else if (mat && mat !== this.snowMat && mat !== this.pineMat) mat.dispose();
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (!this.renderer) return;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ro.disconnect();
    this.controls.dispose();
    this.disposeGroup(this.scene);
    this.snowMat.dispose();
    this.pineMat.dispose();
    this.glowTex.dispose();
    this.ringTex.dispose();
    this.plaqueTex.dispose();
    this.clockTex?.dispose();
    this.baseMat.map?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    for (const n of this.nodes.values()) n.button.remove();
    for (const l of this.regionLabels) l.remove();
  }
}
