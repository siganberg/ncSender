<!--
  The 3D probe's picture: the real probe (baked from its STEP,
  models/probe3d.ncfx) in the spindle, going through the chosen routine on a
  loop over the material, a hole or a part (square one time round, round the
  next, as it finds the centre of both), with a numbered mark and a flash
  at each touch, and a small top view beside it. `still` parks it at its
  start (while a real probe runs).

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
      <svg :viewBox="topView.box" aria-hidden="true">
        <rect v-if="topView.board" :x="topView.board.x" :y="topView.board.y" :width="topView.board.w" :height="topView.board.h" class="azf__wood" />
        <circle v-if="topView.shape?.round" :r="topView.shape.r" :class="topView.shape.hole ? 'azf__hole' : 'azf__part'" />
        <rect v-else-if="topView.shape" :x="-topView.shape.hx" :y="-topView.shape.hy" :width="topView.shape.hx * 2" :height="topView.shape.hy * 2" rx="1.5" :class="topView.shape.hole ? 'azf__hole' : 'azf__part'" />
        <path v-if="topView.shape" d="M-6 0h12M0 -6v12" class="azf__cross" :opacity="finished ? 1 : 0.2" />
        <circle v-if="topView.zero" cx="0" cy="0" r="3" class="azf__zero" :opacity="finished ? 1 : 0.35" />
        <circle v-for="(d, i) in topView.dots" :key="i" :cx="d.x" :cy="d.y" :r="topView.dot" class="azf__dot" :opacity="i < touched ? 1 : 0" />
        <circle ref="topTip" :r="topView.tip" class="azf__bit" />
      </svg>
      <span>{{ topLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import modelUrl from './models/probe3d.ncfx?url';
import { P3D, buildProbe3dRoutine, type P3dAxis, type P3dRoutine } from './probe3d-routine';

const props = withDefaults(defineProps<{
  axis: P3dAxis;
  corner: string;         // BottomLeft, BottomRight, TopLeft, TopRight
  side: string | null;    // Left / Right for X, Front / Back for Y
  centerAxes?: string;
  probeZFirst?: boolean;
  still?: boolean;
  probeActive?: boolean;  // the real probe is triggered
  label?: string;
  topLabel?: string;
}>(), { centerAxes: 'XY', probeZFirst: false, still: false, probeActive: false, label: '', topLabel: '' });

const emit = defineEmits<{
  /** The step the probe is on (steps.length once it has finished), and whether it is touching. */
  (e: 'progress', value: { step: number; done: boolean; touching: boolean }): void;
}>();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const topTip = ref<SVGCircleElement | null>(null);
const marks = ref<{ x: number; y: number }[]>([]);
const touched = ref(0);
const finished = ref(false);

const SPEED = 30;      // mm/s along the path
const DWELL = 0.45;    // s at a touch
const HOLD = 1.8;      // s at the end before it starts again
const LED_IDLE = 0x3ccf63;
const LED_HIT = 0xe45858;
const BOARD = { w: 230, d: 170, t: 18 };
const PART_HEIGHT = 20;

const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A Center probe is shown on a square hole or part, then on a round one, in turn.
const round = ref(false);
const current = () => buildProbe3dRoutine(props.axis, props.centerAxes, props.probeZFirst, round.value);

// The routine is written for a front-left corner (or the left / front side):
// these turn it to the one chosen.
const signs = computed(() => {
  const scene = current().scene;
  if (scene === 'sideX') return { x: props.side === 'Right' ? -1 : 1, y: 1 };
  if (scene === 'sideY') return { x: 1, y: props.side === 'Back' ? -1 : 1 };
  if (scene === 'corner') return { x: props.corner.includes('Right') ? -1 : 1, y: props.corner.startsWith('Top') ? -1 : 1 };
  return { x: 1, y: 1 };
});

// The top view, in the picture's frame with Y flipped for the screen.
const topView = computed(() => {
  const s = signs.value;
  const r = current();
  const centre = r.scene === 'hole' || r.scene === 'part';
  const dots = r.points.filter((p) => p.n).map((p) => ({
    x: (p.p[0] - (p.n![2] ? 0 : p.n![0] * P3D.ball)) * s.x,
    y: -(p.p[1] - (p.n![2] ? 0 : p.n![1] * P3D.ball)) * s.y,
  }));
  const size = centre ? 96 : 60;
  const mid = centre ? { x: 0, y: 0 } : { x: 8 * s.x, y: -8 * s.y };
  let board: { x: number; y: number; w: number; h: number } | null = null;
  if (r.scene === 'corner') board = { x: s.x > 0 ? 0 : -200, y: s.y > 0 ? -200 : 0, w: 200, h: 200 };
  else if (r.scene === 'sideX') board = { x: s.x > 0 ? 0 : -200, y: -200, w: 200, h: 400 };
  else if (r.scene === 'sideY') board = { x: -200, y: s.y > 0 ? -200 : 0, w: 400, h: 200 };
  else if (r.scene === 'hole') board = { x: -200, y: -200, w: 400, h: 400 };
  return {
    box: `${mid.x - size / 2} ${mid.y - size / 2} ${size} ${size}`,
    board, dots,
    shape: centre ? { hx: P3D.halfX, hy: P3D.halfY, r: P3D.radius, round: round.value, hole: r.scene === 'hole' } : null,
    zero: props.axis === 'XYZ' || props.axis === 'XY',
    // Drawn larger than the 2 mm ball, to be seen at this size.
    tip: centre ? 3 : 2, dot: centre ? 3 : 2,
  };
});

let routine: P3dRoutine = current();
type Leg = { v: THREE.Vector3; step: number; n: THREE.Vector3 | null };
let path: Leg[] = [];
let times: number[] = [];
let total = 1;
let touches: { index: number; at: THREE.Vector3; n: THREE.Vector3; mark: THREE.Vector3 }[] = [];

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let board: THREE.Mesh;
let holed: THREE.Mesh;
let part: THREE.Mesh;
let holedRound: THREE.Mesh;
let partRound: THREE.Mesh;
let bed: THREE.Mesh;
let probe: THREE.Group;
let zero: THREE.Group;
let ledMaterial: THREE.MeshBasicMaterial | null = null;
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

// Two lightings: the usual one, and a brighter one for the wood and the
// polished steel, which came out dull under the first.
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
  camera = new THREE.PerspectiveCamera(30, 4 / 3, 5, 4000);
  camera.up.set(0, 0, 1);
  const wood = matcap(0xecc48a, true);

  // The material, its top at z = 0: a board, the same board with a hole in
  // it, or a part standing on the bed.
  board = new THREE.Mesh(geom(new THREE.BoxGeometry(BOARD.w, BOARD.d, BOARD.t)), wood);
  outline(board, 0x5a4424, 0.6);
  const sheet = new THREE.Shape();
  sheet.moveTo(-BOARD.w / 2, -BOARD.d / 2); sheet.lineTo(BOARD.w / 2, -BOARD.d / 2);
  sheet.lineTo(BOARD.w / 2, BOARD.d / 2); sheet.lineTo(-BOARD.w / 2, BOARD.d / 2); sheet.closePath();
  const cut = new THREE.Path();
  cut.moveTo(-P3D.halfX, -P3D.halfY); cut.lineTo(-P3D.halfX, P3D.halfY);
  cut.lineTo(P3D.halfX, P3D.halfY); cut.lineTo(P3D.halfX, -P3D.halfY); cut.closePath();
  sheet.holes.push(cut);
  holed = new THREE.Mesh(geom(new THREE.ExtrudeGeometry(sheet, { depth: BOARD.t, bevelEnabled: false })), wood);
  holed.position.z = -BOARD.t;
  outline(holed, 0x5a4424, 0.6);
  part = new THREE.Mesh(geom(new THREE.BoxGeometry(P3D.halfX * 2, P3D.halfY * 2, PART_HEIGHT)), wood);
  part.position.z = -PART_HEIGHT / 2;
  outline(part, 0x5a4424, 0.6);
  // The round ones, shown in turn with the square ones.
  const roundSheet = new THREE.Shape();
  roundSheet.moveTo(-BOARD.w / 2, -BOARD.d / 2); roundSheet.lineTo(BOARD.w / 2, -BOARD.d / 2);
  roundSheet.lineTo(BOARD.w / 2, BOARD.d / 2); roundSheet.lineTo(-BOARD.w / 2, BOARD.d / 2); roundSheet.closePath();
  const bore = new THREE.Path();
  bore.absarc(0, 0, P3D.radius, 0, Math.PI * 2, true);
  roundSheet.holes.push(bore);
  holedRound = new THREE.Mesh(geom(new THREE.ExtrudeGeometry(roundSheet, { depth: BOARD.t, bevelEnabled: false, curveSegments: 64 })), wood);
  holedRound.position.z = -BOARD.t;
  outline(holedRound, 0x5a4424, 0.6);
  partRound = new THREE.Mesh(upright(P3D.radius, P3D.radius, PART_HEIGHT, 72), wood);
  partRound.position.z = -PART_HEIGHT / 2;
  outline(partRound, 0x5a4424, 0.6);
  scene.add(holedRound, partRound);
  // What the hole opens onto.
  bed = new THREE.Mesh(geom(new THREE.BoxGeometry(BOARD.w, BOARD.d, 6)), matcap(0x8d7a5c));
  outline(bed, 0x3b2f1c, 0.5);
  scene.add(board, holed, part, bed);

  // The probe, the ball's centre at the group's origin, hanging from the spindle.
  probe = new THREE.Group();
  // The model's USB port faces the front: turned to the back, away from the camera.
  const model = new THREE.Group();
  model.rotation.z = Math.PI;
  probe.add(model);
  loadModel().then((groups) => {
    if (!renderer) return;
    for (const g of groups) {
      if (g.role === 'led') {
        ledMaterial = new THREE.MeshBasicMaterial({ color: props.probeActive ? LED_HIT : LED_IDLE });
        owned.push(ledMaterial);
        model.add(new THREE.Mesh(g.geometry, ledMaterial));
      } else {
        model.add(new THREE.Mesh(g.geometry, matcap(0x8b94a3)));
      }
    }
  }).catch((error) => console.warn('[Probe3dFigure] model failed to load', error));
  // The same spindle head as the other pictures, right on top of the probe:
  // its shank is inside the collet, so none of it shows.
  const TOP = 48, NOSE = 9, BODY = 20;
  const nose = new THREE.Mesh(upright(11.5, 7.5, NOSE), matcap(0xffffff, true));
  nose.position.z = TOP + NOSE / 2;
  outline(nose, 0x0d1219, 0.55);
  const body = new THREE.Mesh(upright(13, 13, BODY), matcap(0x4b5462));
  body.position.z = TOP + NOSE + BODY / 2;
  outline(body, 0x0d1219, 0.4);
  probe.add(nose, body);
  scene.add(probe);

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

  // The work zero, shown once a corner is set.
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
  routine = current();
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

  touches = [];
  path.forEach((leg, index) => {
    if (!leg.n) return;
    // Where the ball meets the surface, and the number a little off it.
    const at = leg.v.clone().addScaledVector(leg.n, -P3D.ball);
    touches.push({ index, at, n: leg.n, mark: at.clone().addScaledVector(leg.n, leg.n.z ? 12 : 9).setZ(leg.n.z ? 12 : 4) });
  });
  sparks.forEach((spark, k) => {
    (spark.material as THREE.MeshBasicMaterial).opacity = 0;
    const t = touches[k];
    if (!t) return;
    spark.position.copy(t.at);
    spark.lookAt(t.at.clone().add(t.n));
  });

  // The material for this probe, and where it lies.
  const kind = routine.scene;
  board.visible = kind === 'corner' || kind === 'sideX' || kind === 'sideY';
  holed.visible = kind === 'hole' && !round.value;
  part.visible = kind === 'part' && !round.value;
  holedRound.visible = kind === 'hole' && round.value;
  partRound.visible = kind === 'part' && round.value;
  // A part stands alone, close up: nothing under it to draw the eye.
  bed.visible = kind === 'hole';
  bed.position.z = -BOARD.t - 3;
  if (kind === 'corner') board.position.set(s.x * BOARD.w / 2, s.y * BOARD.d / 2, -BOARD.t / 2);
  else if (kind === 'sideX') board.position.set(s.x * BOARD.w / 2, 0, -BOARD.t / 2);
  else if (kind === 'sideY') board.position.set(0, s.y * BOARD.d / 2, -BOARD.t / 2);

  // Always from the front, as the user stands at the machine, on the open side
  // of what is probed; from higher up at the back, to see over the probe.
  const centre = kind === 'hole' || kind === 'part';
  camAim.set(centre ? 0 : 6 * s.x, centre ? 0 : 6 * s.y, 22);
  let from: THREE.Vector3;
  if (centre) from = new THREE.Vector3(-0.35, -0.8, 0.95);
  else if (kind === 'sideY') from = s.y > 0 ? new THREE.Vector3(-0.45, -0.9, 0.7) : new THREE.Vector3(-0.4, -0.55, 1.1);
  else from = s.y > 0 ? new THREE.Vector3(-0.62 * s.x, -0.86, 0.78) : new THREE.Vector3(-0.5 * s.x, -0.6, 1.05);
  // Back off in a narrow picture, so the probe and what it touches stay in it.
  const aspect = host.value ? host.value.clientWidth / Math.max(1, host.value.clientHeight) : 1.4;
  camPos.copy(camAim).addScaledVector(from.normalize(), (kind === 'hole' ? 310 : kind === 'part' ? 250 : 235) * Math.max(1, 1.3 / aspect));
  if (!camPlaced) { camera.position.copy(camPos); aimNow.copy(camAim); camPlaced = true; }
  startMs = performance.now();
  lastProgress = '';
}

/** Where the probe is t seconds into the loop. */
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
  // At the end of a Center probe's loop, the other shape takes its turn.
  if (moving && (routine.scene === 'hole' || routine.scene === 'part') && (now - startMs) / 1000 >= total) {
    round.value = !round.value;
    buildPath();
    startMs = now;
  }
  // Parked at the start while a real probe runs; shown finished where motion is unwanted.
  const t = props.still ? 0 : reduced ? times[times.length - 1] : ((now - startMs) / 1000) % total;
  const p = pose(t);
  probe.position.copy(p.v);

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
  finished.value = done;
  zero.visible = done && topView.value.zero;
  ledMaterial?.color.setHex(props.probeActive || touching ? LED_HIT : LED_IDLE);
  if (topTip.value) {
    topTip.value.setAttribute('cx', String(p.v.x));
    topTip.value.setAttribute('cy', String(-p.v.y));
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
    console.warn('[Probe3dFigure] WebGL unavailable', e);
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

watch(() => [props.axis, props.corner, props.side, props.centerAxes, props.probeZFirst], () => { round.value = false; if (renderer) buildPath(); });
watch(() => props.still, () => { round.value = false; if (renderer) buildPath(); startMs = performance.now(); lastProgress = ''; });

/** Play from the beginning. */
defineExpose({ restart: () => { round.value = false; if (renderer) buildPath(); startMs = performance.now(); } });

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  resizeObserver?.disconnect();
  owned.forEach((o) => o.dispose());
  renderer?.dispose();
  renderer = null;
});
</script>

<style src="./probe-figure.css"></style>
