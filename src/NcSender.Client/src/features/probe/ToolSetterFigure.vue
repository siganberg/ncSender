<!--
  The Tool Length Setter's picture: the setter (baked from its STEP,
  models/toolsetter.ncfx) standing on the material, and the tool going through
  the routine on a loop: a fast touch, a lift, then the slow touch that sets Z.
  The plunger gives under the tool and springs back when it lifts. `still`
  parks the tool at its start (while a real probe runs).

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
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import modelUrl from './models/toolsetter.ncfx?url';
import { TLS, buildToolSetterRoutine, type TlsRoutine } from './toolsetter-routine';

const props = withDefaults(defineProps<{
  bit: number;            // mm
  still?: boolean;
  probeActive?: boolean;  // the real probe is triggered
  label?: string;
}>(), { still: false, probeActive: false, label: '' });

const emit = defineEmits<{
  /** The step the tool is on (steps.length once it has finished), and whether it is touching. */
  (e: 'progress', value: { step: number; done: boolean; touching: boolean }): void;
}>();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const marks = ref<{ x: number; y: number }[]>([]);
const touched = ref(0);

const SPEED = 30;      // mm/s along the path
const DWELL = 0.45;    // s at a touch
const HOLD = 1.8;      // s at the end before it starts again
const LED_IDLE = 0x3ccf63;

const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let routine: TlsRoutine = buildToolSetterRoutine();
type Leg = { v: THREE.Vector3; step: number; n: THREE.Vector3 | null; hold: number; speed: number };
let path: Leg[] = [];
let times: number[] = [];
let total = 1;
let touches: { index: number; at: THREE.Vector3; n: THREE.Vector3; mark: THREE.Vector3 }[] = [];

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let board: THREE.Mesh;
let probe: THREE.Group;
let tool: THREE.Group;
let bitMesh: THREE.Mesh;
// The plunger's parts, and how far it is pushed in (negative) and how fast it moves.
const plunger: THREE.Mesh[] = [];
let pushed = 0;
let pushSpeed = 0;
let lastFrame = 0;
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
  board = new THREE.Mesh(geom(new THREE.BoxGeometry(170, 130, 18)), matcap(0xecc48a, true));
  board.position.z = -9;
  outline(board, 0x5a4424, 0.6);
  scene.add(board);

  probe = new THREE.Group();
  scene.add(probe);
  loadModel().then((groups) => {
    if (!renderer) return;
    for (const g of groups) {
      // The disc the tool touches is bare steel; the body and the slider are dark.
      const mesh = new THREE.Mesh(g.geometry, g.role === 'disc' ? matcap(0xe6eaef, true) : matcap(0x5d6673));
      outline(mesh, 0x0d1219, 0.45);
      if (g.role !== 'body') plunger.push(mesh);
      probe.add(mesh);
    }
  }).catch((error) => console.warn('[ToolSetterFigure] model failed to load', error));

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

}

function buildPath() {
  routine = buildToolSetterRoutine();
  path = routine.points.map((q) => ({
    v: new THREE.Vector3(q.p[0], q.p[1], q.p[2]),
    step: q.step,
    n: q.n ? new THREE.Vector3(q.n[0], q.n[1], q.n[2]) : null,
    hold: q.hold ?? (q.n ? DWELL : 0),
    speed: q.speed ?? 1,
  }));
  times = [0];
  for (let i = 1; i < path.length; i++) {
    times.push(times[i - 1] + path[i].v.distanceTo(path[i - 1].v) / (SPEED * path[i].speed) + path[i - 1].hold);
  }
  total = times[times.length - 1] + HOLD;

  const r = props.bit / 2;
  touches = [];
  path.forEach((leg, index) => {
    if (!leg.n) return;
    // Both touches land on the same spot: the flash at the plunger's top, the
    // numbers one to each side of the tool.
    const at = new THREE.Vector3(leg.v.x, leg.v.y, TLS.top);
    const mark = new THREE.Vector3(touches.length ? 24 : -24, 0, TLS.top + 6);
    touches.push({ index, at, n: leg.n, mark });
  });
  sparks.forEach((spark, k) => {
    (spark.material as THREE.MeshBasicMaterial).opacity = 0;
    const t = touches[k];
    if (!t) return;
    spark.position.copy(t.at);
    spark.lookAt(t.at.clone().add(t.n));
  });

  bitMesh.scale.set(r, r, 1);

  // From the front, as the user stands at the machine.
  camAim.set(0, 0, 30);
  const from = new THREE.Vector3(-0.5, -0.86, 0.62);
  // Back off in a narrow picture, so the setter and the tool stay in it.
  const aspect = host.value ? host.value.clientWidth / Math.max(1, host.value.clientHeight) : 1.4;
  camPos.copy(camAim).addScaledVector(from.normalize(), 250 * Math.max(1, 1.3 / aspect));
  if (!camPlaced) { camera.position.copy(camPos); aimNow.copy(camAim); camPlaced = true; }
  startMs = performance.now();
  lastProgress = '';
}

/** Where the tool is t seconds into the loop. */
function pose(t: number): { v: THREE.Vector3; leg: number; done: boolean } {
  const last = path.length - 1;
  for (let i = 0; i < last; i++) {
    const start = times[i] + path[i].hold;
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

  // The plunger: held down by the tool while it presses, and on a spring
  // otherwise, so it follows the tool up and settles with a small bounce.
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!moving) { pushed = 0; pushSpeed = 0; }
  else {
    pushSpeed += (-pushed * 900 - pushSpeed * 11) * dt;
    pushed += pushSpeed * dt;
    const limit = p.v.z - TLS.top;
    if (pushed > limit) { pushed = limit; pushSpeed = Math.min(pushSpeed, 0); }
  }
  plunger.forEach((part) => { part.position.z = pushed; });
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
    console.warn('[ToolSetterFigure] WebGL unavailable', e);
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

watch(() => props.bit, () => { if (renderer) buildPath(); });
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
