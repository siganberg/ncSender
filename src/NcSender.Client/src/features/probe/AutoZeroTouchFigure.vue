<!--
  The AutoZero Touch plate's picture: the plate (baked from its STEP,
  models/autozerotouch.ncfx) on a corner of the material, and the tool going
  through the routine on a loop, with a numbered mark and a flash at each
  touch. A small top view beside it shows the touches finding the pocket's
  middle. `still` parks the tool at its start (while a real probe runs).

  Its own small WebGL view; it stops when the dialog closes.
-->
<template>
  <div ref="host" class="azf" role="img" :aria-label="label">
    <canvas ref="canvas" class="azf__canvas"></canvas>
    <span
      v-for="(n, i) in marks"
      :key="i"
      class="azf__num"
      :class="{ 'is-hit': i < touched }"
      :style="{ left: `${n.x}px`, top: `${n.y}px` }"
    >{{ i + 1 }}</span>
    <div class="azf__top">
      <svg ref="topSvg" :viewBox="topView.box" aria-hidden="true">
        <rect :x="topView.board.x" :y="topView.board.y" width="200" height="200" class="azf__wood" />
        <rect :x="topView.ox" :y="topView.oy" width="78" height="78" rx="10" class="azf__block" />
        <rect :x="topView.cx - 22.5" :y="topView.cy - 22.5" width="45" height="45" rx="2" class="azf__hole" />
        <circle :cx="topView.cx" :cy="topView.cy" r="4.5" class="azf__ring" />
        <g v-if="topView.dims" :opacity="centred ? 1 : 0.2">
          <path :d="`M${topView.cx} ${topView.cy}H0M0 ${topView.cy}V0`" class="azf__dim" />
          <path :d="`M${topView.cx - 5} ${topView.cy}h10M${topView.cx} ${topView.cy - 5}v10`" class="azf__cross" />
        </g>
        <circle v-if="topView.zero" cx="0" cy="0" r="3" class="azf__zero" :opacity="finished ? 1 : 0.35" />
        <circle v-for="(d, i) in topView.dots" :key="i" :cx="d.x" :cy="d.y" r="2.6" class="azf__dot" :opacity="i < touched ? 1 : 0" />
        <circle ref="topBit" :r="bit / 2" class="azf__bit" />
      </svg>
      <span>{{ topLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import modelUrl from './models/autozerotouch.ncfx?url';
import { AZT, buildAutoZeroTouchRoutine, type AztAxis, type AztCorner, type AztRoutine } from './autozerotouch-routine';

const props = withDefaults(defineProps<{
  axis: AztAxis;
  both: boolean;          // both walls are touched on each axis
  corner: AztCorner;
  bit: number;            // mm
  still?: boolean;
  probeActive?: boolean;  // the real probe is triggered
  label?: string;
  topLabel?: string;
}>(), { still: false, probeActive: false, label: '', topLabel: '' });

const emit = defineEmits<{
  /** The step the tool is on (steps.length once it has finished), and whether it is touching. */
  (e: 'progress', value: { step: number; done: boolean; touching: boolean }): void;
}>();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const topBit = ref<SVGCircleElement | null>(null);
const marks = ref<{ x: number; y: number }[]>([]);
const touched = ref(0);
const centred = ref(false);
const finished = ref(false);

const SPEED = 30;      // mm/s along the path
const DWELL = 0.45;    // s at a touch
const HOLD = 1.8;      // s at the end before it starts again
const LED_IDLE = 0x3ccf63;

const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const signs = computed(() => ({
  x: props.corner.includes('Right') ? -1 : 1,
  y: props.corner.startsWith('Top') ? -1 : 1,
}));
// The plate is turned to sit on each corner, not mirrored: it is a real part.
const TURN: Record<AztCorner, number> = { BottomLeft: 0, BottomRight: Math.PI / 2, TopRight: Math.PI, TopLeft: -Math.PI / 2 };

let routine: AztRoutine = buildAutoZeroTouchRoutine(props.axis, props.bit, props.both);
type Leg = { v: THREE.Vector3; step: number; n: THREE.Vector3 | null };
let path: Leg[] = [];
let times: number[] = [];
let total = 1;
let touches: { index: number; at: THREE.Vector3; n: THREE.Vector3; mark: THREE.Vector3 }[] = [];

// The top view, in the board's frame with Y flipped for the screen.
const topView = computed(() => {
  const s = signs.value;
  const r = buildAutoZeroTouchRoutine(props.axis, props.bit, props.both);
  const cx = AZT.centre * s.x, cy = -AZT.centre * s.y;
  // The plate's outline and its middle: it reaches further over the material than off it.
  const mid = (AZT.near + AZT.far) / 2;
  const half = props.bit / 2;
  const dots = r.points.filter((p) => p.n).map((p) => ({
    x: (p.p[0] - (p.n![2] ? 0 : p.n![0] * half)) * s.x,
    y: -(p.p[1] - (p.n![2] ? 0 : p.n![1] * half)) * s.y,
  }));
  return {
    box: `${mid * s.x - 47} ${-mid * s.y - 47} 94 94`,
    ox: Math.min(AZT.near * s.x, AZT.far * s.x), oy: Math.min(-AZT.near * s.y, -AZT.far * s.y),
    cx, cy, dots,
    board: { x: s.x > 0 ? 0 : -200, y: s.y > 0 ? -200 : 0 },
    dims: props.axis !== 'Z',
    zero: props.axis === 'XYZ' || props.axis === 'XY',
  };
});

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let board: THREE.Mesh;
let probe: THREE.Group;
let tool: THREE.Group;
let bitMesh: THREE.Mesh;
let zero: THREE.Group;
const sparks: THREE.Mesh[] = [];
const owned: { dispose(): void }[] = [];
let raf = 0;
let resizeObserver: ResizeObserver | null = null;
let startMs = 0;
let lastProgress = '';
const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
const aimNow = new THREE.Vector3();
let camPlaced = false;

// Two lightings: the usual one, and a brighter one for the bit and the
// spindle's nose, so polished steel stands out from the probe's grey body.
const matcapTextures: Record<string, THREE.CanvasTexture> = {};
function matcap(color: number, bright = false) {
  const kind = bright ? 'bright' : 'plain';
  if (!matcapTextures[kind]) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bright ? '#565e69' : '#1a1e24';
    ctx.fillRect(0, 0, size, size);
    const key = ctx.createRadialGradient(size * 0.36, size * 0.30, 0, size * 0.5, size * 0.5, size * 0.62);
    const stops: [number, string][] = bright
      ? [[0, '#ffffff'], [0.2, '#f1f4f8'], [0.55, '#bcc4cf'], [0.85, '#7c8592'], [1, '#565e69']]
      : [[0, '#ffffff'], [0.18, '#dfe5ec'], [0.5, '#8c97a5'], [0.82, '#444c57'], [1, '#1f242b']];
    stops.forEach(([at, tone]) => key.addColorStop(at, tone));
    ctx.fillStyle = key;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    matcapTextures[kind] = new THREE.CanvasTexture(c);
    owned.push(matcapTextures[kind]);
  }
  const m = new THREE.MeshMatcapMaterial({ matcap: matcapTextures[kind], color });
  owned.push(m);
  return m;
}
const geom = <G extends THREE.BufferGeometry>(g: G) => { owned.push(g); return g; };
const upright = (r1: number, r2: number, h: number, seg = 40) => geom(new THREE.CylinderGeometry(r1, r2, h, seg).rotateX(Math.PI / 2));
function outline(mesh: THREE.Mesh, color: number, opacity = 0.5) {
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  owned.push(m);
  mesh.add(new THREE.LineSegments(geom(new THREE.EdgesGeometry(mesh.geometry, 40)), m));
}

// The baked model: "NCFX", header length, JSON header, then the buffers.
async function loadModel(): Promise<{ role: string; geometry: THREE.BufferGeometry }[]> {
  const buffer = await (await fetch(modelUrl)).arrayBuffer();
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x5846434e) throw new Error('Not a probe model');
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  const base = 8 + headerLength;
  const [ox, oy, oz] = header.origin;
  return header.groups.map((g: any) => {
    const q = new Uint16Array(buffer, base + g.pos, g.verts * 3);
    const position = new Float32Array(g.verts * 3);
    for (let i = 0; i < position.length; i += 3) {
      position[i] = ox + q[i] * header.scale;
      position[i + 1] = oy + q[i + 1] * header.scale;
      position[i + 2] = oz + q[i + 2] * header.scale;
    }
    const n = new Int8Array(buffer, base + g.nrm, g.verts * 3);
    const normal = new Float32Array(g.verts * 3);
    for (let i = 0; i < normal.length; i++) normal[i] = n[i] / 127;
    const Index = g.index === 'u32' ? Uint32Array : Uint16Array;
    const geometry = geom(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Index(buffer, base + g.idx, g.tris * 3).slice(), 1));
    return { role: g.role as string, geometry };
  });
}

function buildScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 4 / 3, 5, 3000);
  camera.up.set(0, 0, 1);

  // The material: a board, its top at z = 0.
  // Lit brightly: under the usual lighting its top came out a dull brown, flat on a light theme.
  board = new THREE.Mesh(geom(new THREE.BoxGeometry(230, 170, 18)), matcap(0xecc48a, true));
  outline(board, 0x5a4424, 0.6);
  scene.add(board);

  probe = new THREE.Group();
  scene.add(probe);
  loadModel().then((groups) => {
    if (!renderer) return;
    for (const g of groups) {
      const mesh = new THREE.Mesh(g.geometry, matcap(0xc9d0da));
      outline(mesh, 0x0d1219, 0.45);
      probe.add(mesh);
    }
  }).catch((error) => console.warn('[AutoZeroTouchFigure] model failed to load', error));

  // The tool, its tip at the group's origin.
  tool = new THREE.Group();
  // The same spindle head as the out-of-bounds help pictures: a dark body, a
  // bright tapered nose and the bit, in their proportions.
  // The nose is longer than in those side views: seen from above, a short one
  // hides under the body and its taper reads as a rounded edge.
  const BIT = 34, NOSE = 9, BODY = 20;
  bitMesh = new THREE.Mesh(upright(1, 1, BIT, 28), matcap(0xffffff, true));
  bitMesh.position.z = BIT / 2;
  const nut = new THREE.Mesh(upright(11.5, 7.5, NOSE), matcap(0xffffff, true));
  nut.position.z = BIT + NOSE / 2;
  // Its two rims drawn, so the taper reads as a chamfer and not a rounded end.
  outline(nut, 0x0d1219, 0.55);
  const spindle = new THREE.Mesh(upright(13, 13, BODY), matcap(0x4b5462));
  spindle.position.z = BIT + NOSE + BODY / 2;
  outline(spindle, 0x0d1219, 0.4);
  tool.add(bitMesh, nut, spindle);
  scene.add(tool);

  // A flash where it touches: a ring facing out of the surface.
  const ring = geom(new THREE.TorusGeometry(4, 0.8, 8, 32));
  for (let i = 0; i < 6; i++) {
    const m = new THREE.MeshBasicMaterial({ color: LED_IDLE, transparent: true, opacity: 0, depthTest: false });
    owned.push(m);
    const s = new THREE.Mesh(ring, m);
    s.renderOrder = 6;
    sparks.push(s);
    scene.add(s);
  }

  // The work zero, shown once it is set.
  zero = new THREE.Group();
  const zm = new THREE.MeshBasicMaterial({ color: 0x1abc9c, depthTest: false, transparent: true });
  owned.push(zm);
  const zr = new THREE.Mesh(geom(new THREE.TorusGeometry(5, 0.7, 8, 40)), zm);
  const zd = new THREE.Mesh(geom(new THREE.SphereGeometry(1.6, 16, 12)), zm);
  zr.renderOrder = zd.renderOrder = 7;
  zero.add(zr, zd);
  zero.position.z = 0.5;
  zero.visible = false;
  scene.add(zero);
}

function buildPath() {
  routine = buildAutoZeroTouchRoutine(props.axis, props.bit, props.both);
  const s = signs.value;
  path = routine.points.map((q) => ({
    v: new THREE.Vector3(q.p[0] * s.x, q.p[1] * s.y, q.p[2]),
    step: q.step,
    n: q.n ? new THREE.Vector3(q.n[0] * s.x, q.n[1] * s.y, q.n[2]) : null,
  }));
  times = [0];
  for (let i = 1; i < path.length; i++) {
    times.push(times[i - 1] + path[i].v.distanceTo(path[i - 1].v) / SPEED + (path[i - 1].n ? DWELL : 0));
  }
  total = times[times.length - 1] + HOLD;

  const r = props.bit / 2;
  touches = [];
  path.forEach((leg, index) => {
    if (!leg.n) return;
    // Where the tool meets the surface: its tip going down, its side otherwise.
    const at = leg.v.clone().addScaledVector(leg.n, leg.n.z ? 0 : -r);
    // The number's place. Inside the pocket the touches are close together
    // and hidden by its walls, so each wall's number goes out onto the top
    // face behind that wall, and the pad's sits over the middle.
    const centre = new THREE.Vector3(AZT.centre * s.x, AZT.centre * s.y, AZT.top + 1);
    const mark = leg.n.z ? centre : centre.clone().addScaledVector(leg.n, -(AZT.centre + 8));
    touches.push({ index, at, n: leg.n, mark });
  });
  sparks.forEach((spark, k) => {
    (spark.material as THREE.MeshBasicMaterial).opacity = 0;
    const t = touches[k];
    if (!t) return;
    spark.position.copy(t.at);
    spark.lookAt(t.at.clone().add(t.n));
  });

  board.position.set(s.x * 115, s.y * 85, -9);
  probe.position.set(AZT.centre * s.x, AZT.centre * s.y, 0);
  probe.rotation.z = TURN[props.corner];
  bitMesh.scale.set(r, r, 1);

  // Always from the front, as the user stands at the machine, on the open
  // side of the corner; from higher up for a back corner, to see into the pocket.
  camAim.set(AZT.centre * s.x * 0.9, AZT.centre * s.y * 0.9, 24);
  const from = s.y > 0 ? new THREE.Vector3(-0.55 * s.x, -0.8, 1.0) : new THREE.Vector3(-0.45 * s.x, -0.55, 1.2);
  // Back off in a narrow picture, so the plate and the tool stay in it.
  const aspect = host.value ? host.value.clientWidth / Math.max(1, host.value.clientHeight) : 1.4;
  camPos.copy(camAim).addScaledVector(from.normalize(), 300 * Math.max(1, 1.3 / aspect));
  if (!camPlaced) { camera.position.copy(camPos); aimNow.copy(camAim); camPlaced = true; }
  startMs = performance.now();
  lastProgress = '';
}

/** Where the tool is t seconds into the loop. */
function pose(t: number): { v: THREE.Vector3; leg: number; done: boolean } {
  const last = path.length - 1;
  for (let i = 0; i < last; i++) {
    const start = times[i] + (path[i].n ? DWELL : 0);
    if (t <= start) return { v: path[i].v, leg: i, done: false };
    if (t <= times[i + 1]) {
      const f = (t - start) / Math.max(1e-6, times[i + 1] - start);
      return { v: path[i].v.clone().lerp(path[i + 1].v, f), leg: i + 1, done: false };
    }
  }
  return { v: path[last].v, leg: last, done: true };
}

function placeMarks() {
  if (!host.value) return;
  const w = host.value.clientWidth, h = host.value.clientHeight;
  marks.value = touches.map((t) => {
    const v = t.mark.clone().project(camera);
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  });
}

function resize() {
  if (!renderer || !host.value) return;
  const w = Math.max(1, host.value.clientWidth);
  const h = Math.max(1, host.value.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (path.length) { const at = startMs; buildPath(); startMs = at; }
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (!renderer || document.hidden) return;
  const moving = !props.still && !reduced;
  // Parked at the start while a real probe runs; shown finished where motion is unwanted.
  const t = props.still ? 0 : reduced ? times[times.length - 1] : ((now - startMs) / 1000) % total;
  const p = pose(t);
  tool.position.copy(p.v);

  camera.position.lerp(camPos, 0.1);
  aimNow.lerp(camAim, 0.1);
  camera.lookAt(aimNow);

  let hits = 0;
  let touching = false;
  touches.forEach((touch, k) => {
    const age = t - times[touch.index];
    const on = moving && age >= 0 && age < 0.7;
    const material = sparks[k].material as THREE.MeshBasicMaterial;
    material.opacity = on ? 1 - age / 0.7 : 0;
    sparks[k].scale.setScalar(on ? 0.6 + age * 2 : 1);
    if (!props.still && age >= 0) hits++;
    if (moving && age >= 0 && age < DWELL) touching = true;
  });
  const done = !props.still && p.done;
  touched.value = hits;
  centred.value = touches.length > 0 && hits === touches.length;
  finished.value = done;
  zero.visible = done && topView.value.zero;
  if (topBit.value) {
    topBit.value.setAttribute('cx', String(p.v.x));
    topBit.value.setAttribute('cy', String(-p.v.y));
  }

  const step = props.still ? -1 : done ? routine.steps.length : path[p.leg].step;
  const key = `${step}|${done}|${touching}`;
  if (key !== lastProgress) { lastProgress = key; emit('progress', { step, done, touching }); }

  placeMarks();
  renderer.render(scene, camera);
}

onMounted(() => {
  if (!canvas.value) return;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: true });
  } catch (e) {
    console.warn('[AutoZeroTouchFigure] WebGL unavailable', e);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  buildScene();
  buildPath();
  resizeObserver = new ResizeObserver(resize);
  if (host.value) resizeObserver.observe(host.value);
  resize();
  raf = requestAnimationFrame(frame);
});

watch(() => [props.axis, props.both, props.corner, props.bit], () => { if (renderer) buildPath(); });
watch(() => props.still, () => { startMs = performance.now(); lastProgress = ''; });

/** Play from the beginning. */
defineExpose({ restart: () => { startMs = performance.now(); } });

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  resizeObserver?.disconnect();
  owned.forEach((o) => o.dispose());
  renderer?.dispose();
  renderer = null;
});
</script>

<style src="./probe-figure.css"></style>
