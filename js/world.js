/**
 * PELICAN POST — world.js
 * Entire environment for the seaside pier diorama:
 *   shader sky dome (sun/moon/stars/haze), animated ocean shader, wooden pier,
 *   railing + lamp, props, islands, lighthouse, clouds, gulls, buoys, fish, dust.
 *
 * Public API per docs/CONTRACT.md:
 *   export function getAtmosphere(t)
 *   export function createWorld({ quality = 'high' } = {})
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * small utilities
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const WHITE = new THREE.Color(0xffffff);

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function smoothstepJs(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** deterministic small PRNG (mulberry32) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** color helper: hex -> THREE.Color (sRGB source) */
function C(hex) { return new THREE.Color(hex); }

/** transform matrix from position / euler / scale arrays */
function M(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    q,
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  return m;
}

/* ------------------------------------------------------------------ *
 * atmosphere — day (0) -> golden hour (0.55) -> dusk (0.8) -> night (1)
 * ------------------------------------------------------------------ */

const ATMO_STOPS = [
  {
    t: 0.0,
    sunDir: new THREE.Vector3(-0.425, 0.819, -0.385).normalize(),
    sunColor: C('#fff4e0'), sunIntensity: 3.2,
    hemiSky: C('#b9d8ff'), hemiGround: C('#87946e'), hemiIntensity: 1.0,
    fogColor: C('#c9e0ec'), fogNear: 32, fogFar: 240,
    exposure: 0.92, bloomStrength: 0.12,
    skyTop: C('#2a79cc'), skyHorizon: C('#cfe7f0'),
    waterDeep: C('#06384f'), waterShallow: C('#2da3ae'),
    starOpacity: 0.0, isNight: 0.0,
  },
  {
    t: 0.55,
    sunDir: new THREE.Vector3(-0.593, 0.0346, -0.804).normalize(),
    sunColor: C('#ffbe7a'), sunIntensity: 3.0,
    hemiSky: C('#ab93c4'), hemiGround: C('#6a4634'), hemiIntensity: 0.52,
    fogColor: C('#eaa088'), fogNear: 26, fogFar: 215,
    exposure: 0.99, bloomStrength: 0.38,
    skyTop: C('#5c4fa6'), skyHorizon: C('#ff8f5e'),
    waterDeep: C('#042e3b'), waterShallow: C('#1b9089'),
    starOpacity: 0.010, isNight: 0.0,
  },
  {
    t: 0.8,
    sunDir: new THREE.Vector3(-0.602, 0.0105, -0.798).normalize(),
    sunColor: C('#ff7d55'), sunIntensity: 0.80,
    hemiSky: C('#5c4f88'), hemiGround: C('#2a2133'), hemiIntensity: 0.50,
    fogColor: C('#96688a'), fogNear: 22, fogFar: 180,
    exposure: 1.05, bloomStrength: 0.52,
    skyTop: C('#2e2960'), skyHorizon: C('#e07b6a'),
    waterDeep: C('#051b29'), waterShallow: C('#185a68'),
    starOpacity: 0.35, isNight: 0.35,
  },
  {
    t: 1.0,
    sunDir: new THREE.Vector3(-0.833, 0.156, -0.527).normalize(),
    sunColor: C('#8ba3ea'), sunIntensity: 0.34,
    hemiSky: C('#263a6e'), hemiGround: C('#05080f'), hemiIntensity: 0.38,
    fogColor: C('#0d1830'), fogNear: 18, fogFar: 170,
    exposure: 1.18, bloomStrength: 0.62,
    skyTop: C('#04081c'), skyHorizon: C('#16264d'),
    waterDeep: C('#020a17'), waterShallow: C('#0c2c40'),
    starOpacity: 1.0, isNight: 1.0,
  },
];

const COLOR_FIELDS = ['sunColor', 'hemiSky', 'hemiGround', 'fogColor', 'skyTop', 'skyHorizon', 'waterDeep', 'waterShallow'];
const NUM_FIELDS = ['sunIntensity', 'hemiIntensity', 'fogNear', 'fogFar', 'exposure', 'bloomStrength', 'starOpacity', 'isNight'];

/**
 * Pure atmosphere blend for the given time of day.
 * @param {number} t 0 = clear day, 0.55 = golden hour, 1 = night
 * @returns {{sunDir: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number,
 *   hemiSky: THREE.Color, hemiGround: THREE.Color, hemiIntensity: number,
 *   fogColor: THREE.Color, fogNear: number, fogFar: number,
 *   exposure: number, bloomStrength: number, skyTop: THREE.Color,
 *   skyHorizon: THREE.Color, waterDeep: THREE.Color, waterShallow: THREE.Color,
 *   starOpacity: number, isNight: number}}
 */
export function getAtmosphere(t) {
  const tt = clamp(Number.isFinite(t) ? t : 0.55, 0, 1);

  let ia = 0;
  for (let i = 0; i < ATMO_STOPS.length - 1; i++) {
    if (tt >= ATMO_STOPS[i].t) ia = i;
  }
  const a = ATMO_STOPS[ia];
  const b = ATMO_STOPS[Math.min(ia + 1, ATMO_STOPS.length - 1)];
  const span = Math.max(1e-5, b.t - a.t);
  const raw = clamp((tt - a.t) / span, 0, 1);
  const p = raw * raw * (3 - 2 * raw);

  const out = {
    sunDir: a.sunDir.clone().lerp(b.sunDir, p).normalize(),
    sunIntensity: 0,
    fogNear: 0, fogFar: 0, exposure: 0, bloomStrength: 0,
    starOpacity: 0, isNight: 0,
  };
  for (const f of COLOR_FIELDS) out[f] = a[f].clone().lerp(b[f], p);
  for (const f of NUM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * p;
  return out;
}

/* ------------------------------------------------------------------ *
 * procedural canvas textures
 * ------------------------------------------------------------------ */

function makeCanvasTexture(w, h, draw, { repeat = null, anisotropy = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function makeWoodTexture() {
  const rand = mulberry32(7);
  return makeCanvasTexture(512, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#8d6b48');
    g.addColorStop(0.35, '#9a7852');
    g.addColorStop(0.72, '#876444');
    g.addColorStop(1, '#7d5c3e');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);

    // long vertical grain (planks run along texture V)
    for (let i = 0; i < 300; i++) {
      const px = rand() * w;
      const wob = 3 + rand() * 11;
      const dark = 30 + rand() * 34;
      x.strokeStyle = `rgba(${dark | 0},${(dark * 0.72) | 0},${(dark * 0.46) | 0},${0.04 + rand() * 0.13})`;
      x.lineWidth = 0.7 + rand() * 2.6;
      x.beginPath();
      x.moveTo(px, -12);
      x.bezierCurveTo(px + wob, h * 0.3, px - wob, h * 0.72, px + (rand() - 0.5) * 9, h + 12);
      x.stroke();
    }
    // pale sun-bleached streaks
    for (let i = 0; i < 90; i++) {
      const px = rand() * w;
      x.strokeStyle = `rgba(228,200,160,${0.025 + rand() * 0.07})`;
      x.lineWidth = 1 + rand() * 3;
      x.beginPath();
      x.moveTo(px, -8);
      x.bezierCurveTo(px + 6, h * 0.35, px - 6, h * 0.7, px + (rand() - 0.5) * 6, h + 8);
      x.stroke();
    }
    // a few knots
    for (let i = 0; i < 5; i++) {
      const kx = rand() * w, ky = rand() * h;
      const kr = 3 + rand() * 7;
      for (let j = 4; j >= 0; j--) {
        x.strokeStyle = `rgba(${54 + j * 6},${38 + j * 4},${24 + j * 3},${0.18 - j * 0.02})`;
        x.lineWidth = 1;
        x.beginPath();
        x.ellipse(kx, ky, kr + j * 2.2, (kr + j * 2.2) * 1.6, 0.2, 0, TAU);
        x.stroke();
      }
    }
    // fine tooth
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = `rgba(60,40,24,${0.02 + rand() * 0.035})`;
      x.fillRect(rand() * w, rand() * h, 1, 1 + rand() * 2);
    }
  });
}

function makeRopeTexture() {
  const rand = mulberry32(23);
  return makeCanvasTexture(256, 256, (x, w, h) => {
    x.fillStyle = '#b89462';
    x.fillRect(0, 0, w, h);
    for (let i = -w; i < w * 2; i += 10) {
      x.strokeStyle = 'rgba(88,64,38,0.5)';
      x.lineWidth = 4.5;
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + w, h);
      x.stroke();
      x.strokeStyle = 'rgba(236,210,166,0.30)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(i + 5, 0);
      x.lineTo(i + 5 + w, h);
      x.stroke();
    }
    for (let i = 0; i < 320; i++) {
      x.fillStyle = `rgba(60,40,20,${0.04 + rand() * 0.07})`;
      x.fillRect(rand() * w, rand() * h, 1, 2);
    }
  }, { repeat: [1, 1] });
}

function drawPelican(ctx, cx, cy, s, ink) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4;
  // body
  ctx.beginPath();
  ctx.ellipse(-6, 6, 34, 20, -0.1, 0, TAU);
  ctx.fill();
  // tail
  ctx.beginPath();
  ctx.moveTo(-34, 2);
  ctx.lineTo(-52, -6);
  ctx.lineTo(-40, 10);
  ctx.closePath();
  ctx.fill();
  // neck
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.quadraticCurveTo(30, -26, 22, -46);
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.lineWidth = 2.4;
  // head
  ctx.beginPath();
  ctx.arc(24, -50, 11, 0, TAU);
  ctx.fill();
  // long beak
  ctx.beginPath();
  ctx.moveTo(30, -54);
  ctx.quadraticCurveTo(72, -58, 96, -44);
  ctx.quadraticCurveTo(66, -40, 32, -44);
  ctx.closePath();
  ctx.fill();
  // pouch
  ctx.beginPath();
  ctx.moveTo(34, -43);
  ctx.quadraticCurveTo(66, -26, 88, -40);
  ctx.quadraticCurveTo(60, -50, 34, -43);
  ctx.fill();
  // wing line
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.quadraticCurveTo(2, -12, 18, 2);
  ctx.lineWidth = 2;
  ctx.stroke();
  // legs
  ctx.beginPath();
  ctx.moveTo(-2, 24); ctx.lineTo(-4, 38);
  ctx.moveTo(8, 24); ctx.lineTo(10, 38);
  ctx.stroke();
  ctx.restore();
}

function makeSignTexture() {
  const rand = mulberry32(41);
  return makeCanvasTexture(1024, 512, (x, w, h) => {
    // painted board
    x.fillStyle = '#f1dfba';
    x.fillRect(0, 0, w, h);
    // subtle vertical grain
    for (let i = 0; i < 120; i++) {
      x.strokeStyle = `rgba(120,90,52,${0.03 + rand() * 0.05})`;
      x.lineWidth = 1 + rand() * 2;
      const px = rand() * w;
      x.beginPath();
      x.moveTo(px, 0);
      x.bezierCurveTo(px + 5, h * 0.4, px - 5, h * 0.7, px, h);
      x.stroke();
    }
    // border
    x.strokeStyle = '#1f5250';
    x.lineWidth = 10;
    x.strokeRect(22, 22, w - 44, h - 44);
    x.lineWidth = 3;
    x.strokeRect(40, 40, w - 80, h - 80);

    x.fillStyle = '#1f5250';
    x.textAlign = 'center';
    x.textBaseline = 'middle';

    x.font = '600 27px Georgia, "Times New Roman", serif';
    x.fillText('S E A S I D E   P I E R   ·   E S T .   1 9 2 4', w / 2, 92);

    x.font = '700 104px Georgia, "Times New Roman", serif';
    x.fillText('PELICAN POST', w / 2, 214);

    // rule
    x.strokeStyle = 'rgba(31,82,80,0.6)';
    x.lineWidth = 2.5;
    x.beginPath();
    x.moveTo(190, 280);
    x.lineTo(w - 190, 280);
    x.stroke();

    drawPelican(x, w / 2, 372, 1.55, '#22524d');

    x.font = '600 24px Georgia, "Times New Roman", serif';
    x.fillText('P O S T   O F F I C E     ·     F R E S H   F I S H     ·     O P E N   A T   S U N R I S E', w / 2, 468);
  });
}

function makeLifebuoyTexture() {
  const rand = mulberry32(63);
  return makeCanvasTexture(1024, 256, (x, w, h) => {
    x.fillStyle = '#f2e6cc';
    x.fillRect(0, 0, w, h);
    const bands = 8;
    for (let i = 0; i < bands; i += 2) {
      x.fillStyle = '#d4453a';
      x.fillRect((i / bands) * w, 0, w / bands, h);
    }
    // painted wear
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(${rand() > 0.5 ? '255,250,235' : '120,70,55'},${0.05 + rand() * 0.14})`;
      x.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
    }
    x.strokeStyle = 'rgba(60,30,22,0.35)';
    x.lineWidth = 3;
    for (let i = 0; i <= bands; i++) {
      x.beginPath();
      x.moveTo((i / bands) * w, 0);
      x.lineTo((i / bands) * w, h);
      x.stroke();
    }
  }, { repeat: [1, 1] });
}

function makePostPlateTexture() {
  return makeCanvasTexture(256, 128, (x, w, h) => {
    x.fillStyle = '#f2e6cc';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#274a48';
    x.lineWidth = 7;
    x.strokeRect(10, 10, w - 20, h - 20);
    x.fillStyle = '#274a48';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '700 58px Georgia, "Times New Roman", serif';
    x.fillText('POST', w / 2, h / 2 + 4);
  }, { repeat: [1, 1] });
}

function makeCrateTexture() {
  const rand = mulberry32(87);
  return makeCanvasTexture(256, 256, (x, w, h) => {
    x.fillStyle = '#8d6b48';
    x.fillRect(0, 0, w, h);
    // planks
    for (let i = 0; i < 4; i++) {
      x.fillStyle = i % 2 ? '#93704c' : '#84633f';
      x.fillRect(0, (i / 4) * h, w, h / 4 - 3);
      x.strokeStyle = 'rgba(48,32,18,0.6)';
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(0, (i / 4) * h + 2);
      x.lineTo(w, (i / 4) * h + 2);
      x.stroke();
    }
    // diagonal brace
    x.strokeStyle = '#6d4f33';
    x.lineWidth = 17;
    x.beginPath();
    x.moveTo(6, h - 8);
    x.lineTo(w - 6, 8);
    x.stroke();
    x.strokeStyle = 'rgba(48,32,18,0.5)';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(8, h - 8);
    x.lineTo(w - 8, 8);
    x.stroke();
    // grain + nails
    for (let i = 0; i < 180; i++) {
      x.fillStyle = `rgba(50,34,20,${0.03 + rand() * 0.05})`;
      x.fillRect(rand() * w, rand() * h, 1, 2 + rand() * 4);
    }
    for (const [nx, ny] of [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20]]) {
      x.fillStyle = '#3d3126';
      x.beginPath();
      x.arc(nx, ny, 4, 0, TAU);
      x.fill();
    }
  }, { repeat: [1, 1] });
}

function makeGlowTexture() {
  return makeCanvasTexture(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,246,224,0.85)');
    g.addColorStop(0.55, 'rgba(255,210,150,0.30)');
    g.addColorStop(1, 'rgba(255,180,110,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */

/**
 * Merge a list of { geometry, matrix?, color?, keepColors? } into one BufferGeometry.
 * Produces position + normal, plus color (default) and optionally uv.
 * Source geometries are cloned; originals are left untouched.
 */
function mergeParts(parts, { color = true, uv = false } = {}) {
  const prepared = [];
  let total = 0;
  for (const part of parts) {
    let g = part.geometry.clone();
    if (part.matrix) g.applyMatrix4(part.matrix);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      g = ng;
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    prepared.push({ g, part });
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = color ? new Float32Array(total * 3) : null;
  const uvArr = uv ? new Float32Array(total * 2) : null;
  const tmp = new THREE.Color();
  let offset = 0;
  for (const { g, part } of prepared) {
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, offset * 3);
    nor.set(g.attributes.normal.array, offset * 3);
    if (col) {
      if (part.keepColors && g.attributes.color) {
        col.set(g.attributes.color.array, offset * 3);
      } else {
        tmp.copy(part.color || WHITE);
        for (let i = 0; i < cnt; i++) {
          const o = (offset + i) * 3;
          col[o] = tmp.r; col[o + 1] = tmp.g; col[o + 2] = tmp.b;
        }
      }
    }
    if (uvArr) {
      if (g.attributes.uv) uvArr.set(g.attributes.uv.array, offset * 2);
    }
    offset += cnt;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvArr) geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return geo;
}

/** colour each triangle of a non-indexed geometry from a callback */
function paintFaces(geo, colorFn) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const cen = new THREE.Vector3(), n = new THREE.Vector3();
  const triCount = Math.floor(pos.count / 3);
  for (let f = 0; f < triCount; f++) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    n.fromBufferAttribute(nor, f * 3);
    const col = colorFn(cen, n, f);
    for (let k = 0; k < 3; k++) {
      const o = (f * 3 + k) * 3;
      colors[o] = col.r; colors[o + 1] = col.g; colors[o + 2] = col.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/* ------------------------------------------------------------------ *
 * shaders
 * ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonColor;
  uniform vec3 uMoonDir;
  uniform float uSunVis;
  uniform float uMoonVis;
  uniform float uStarOpacity;
  uniform float uTime;

  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float up = clamp(h, 0.0, 1.0);

    vec3 col = mix(uHorizon, uTop, pow(up, 0.34));

    // horizon haze band
    float hazeBand = exp(-pow(up / 0.055, 1.3));
    col = mix(col, uHaze, hazeBand * 0.26);

    // below horizon (mostly covered by the ocean)
    float below = smoothstep(0.0, 0.05, -h);
    col = mix(col, mix(uHaze, uHorizon, 0.4) * 0.8, below * 0.9);

    // sun disc + layered glow
    float sa = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    float disc = 1.0 - smoothstep(0.0105, 0.0215, sa);
    float gCore = exp(-sa * sa * 1600.0);
    float gMed  = exp(-sa * sa * 180.0);
    float gWide = exp(-sa * sa * 18.0);
    col += uSunColor * uSunVis * (disc * 11.0 + gCore * 2.4 + gMed * 0.42 + gWide * 0.12);

    // ---- stars ----
    float starMask = smoothstep(0.015, 0.16, h) * uStarOpacity;
    vec2 sph = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0)));
    vec2 grid = sph * vec2(170.0, 95.0);
    vec2 sid = floor(grid);
    vec2 sf = fract(grid) - 0.5;
    float rnd = hash21(sid);
    float star = step(0.982, rnd) * (1.0 - smoothstep(0.0, 0.30, length(sf)));
    float tw = 0.55 + 0.45 * sin(uTime * (1.2 + rnd * 2.6) + rnd * 40.0);
    col += vec3(0.82, 0.89, 1.0) * star * tw * (0.5 + 0.5 * rnd) * starMask * 2.4;

    float rnd2 = hash21(sid + 31.7);
    float star2 = step(0.9973, rnd2) * (1.0 - smoothstep(0.0, 0.22, length(sf)));
    col += vec3(1.0, 0.93, 0.84) * star2 * starMask * 1.6;

    // faint milky way
    vec3 mwAxis = normalize(vec3(0.42, 0.30, 0.86));
    float mw = exp(-pow(dot(d, mwAxis) * 2.4, 2.0));
    float mwTex = vnoise(vec2(atan(d.z, d.x) * 3.0, h * 7.0)) * 0.65
                + vnoise(vec2(atan(d.z, d.x) * 9.0, h * 19.0)) * 0.35;
    col += vec3(0.17, 0.21, 0.40) * mw * (0.30 + 0.75 * mwTex) * starMask * 0.9;

    // ---- moon ----
    vec3 moonRight = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 moonUp = cross(moonRight, uMoonDir);
    float ma = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
    float mdisc = 1.0 - smoothstep(0.016, 0.027, ma);
    float crater = vnoise(vec2(dot(d, moonRight), dot(d, moonUp)) * 75.0);
    float maria = vnoise(vec2(dot(d, moonRight), dot(d, moonUp)) * 23.0 + 4.0);
    vec3 moonCol = uMoonColor * (0.72 + 0.30 * crater + 0.16 * maria);
    col = mix(col, moonCol * (1.0 + 0.9 * uMoonVis), mdisc * uMoonVis);
    col += uMoonColor * uMoonVis * (exp(-ma * ma * 900.0) * 1.1 + exp(-ma * ma * 90.0) * 0.15);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWaveAmp;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vWave;

  float waveH(vec2 p, float t) {
    float h = 0.0;
    h += sin(p.x * 0.33 + t * 0.55) * 0.155;
    h += sin(p.y * 0.45 - t * 0.42) * 0.100;
    h += sin((p.x + p.y) * 0.21 + t * 0.30) * 0.190;
    h += sin(p.x * 0.90 - p.y * 0.60 + t * 0.95) * 0.050;
    h += sin(p.x * 1.80 + p.y * 1.20 + t * 1.60) * 0.026;
    return h * uWaveAmp;
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 p = wp.xz;
    float t = uTime;
    float h = waveH(p, t);
    float e = 0.8;
    float hx = waveH(p + vec2(e, 0.0), t) - waveH(p - vec2(e, 0.0), t);
    float hz = waveH(p + vec2(0.0, e), t) - waveH(p - vec2(0.0, e), t);
    wp.y += h;
    vWorld = wp.xyz;
    vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
    vWave = h;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uSpeed;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonColor;
  uniform vec3 uMoonDir;
  uniform vec3 uFogColor;
  uniform float uSunVis;
  uniform float uNight;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vWave;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec2 p = vWorld.xz;
    float t = uTime;
    float dist = length(cameraPosition - vWorld);

    // fine ripple detail on top of the vertex waves
    vec2 dn = vec2(0.0);
    dn.x += cos(p.x * 1.9 + t * 1.7) * 0.110;
    dn.y += cos(p.y * 2.3 - t * 1.5) * 0.095;
    dn.x += cos((p.x + p.y) * 3.7 - t * 2.6) * 0.055;
    dn.y += cos((p.x - p.y) * 4.1 + t * 2.1) * 0.048;
    dn.x += cos(p.x * 7.3 + p.y * 5.1 + t * 3.4) * 0.018;
    dn.y += cos(p.y * 6.7 - p.x * 4.3 - t * 3.0) * 0.016;
    vec3 N = normalize(vNormal + vec3(dn.x, 0.0, dn.y) * 0.5);

    vec3 base = mix(uShallow, uDeep, smoothstep(1.5, 48.0, dist));
    base = mix(base, uShallow * 1.06, smoothstep(0.10, 0.40, vWave) * 0.16);

    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    // keep the far field from glowing cyan: damp sky reflection with distance
    fres *= mix(1.0, 0.42, smoothstep(25.0, 130.0, dist));
    vec3 R = reflect(-V, N);
    vec3 refl = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
    refl *= 0.88;
    float sunRef = max(dot(R, uSunDir), 0.0);
    refl += uSunColor * uSunVis * (pow(sunRef, 8.0) * 0.22 + pow(sunRef, 80.0) * 0.45);

    vec3 col = mix(base, refl, clamp(fres * 0.82, 0.0, 0.78));

    // warm sun glitter
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    float glitterMask = smoothstep(0.55, 0.95, vnoise(p * 5.0 + vec2(t * 0.35, -t * 0.25)));
    float spec = pow(nh, 900.0) * 4.2 + pow(nh, 140.0) * 0.28 + pow(nh, 24.0) * 0.03;
    col += uSunColor * uSunVis * spec * (0.45 + 0.9 * glitterMask);

    // moonlight path
    vec3 MH = normalize(uMoonDir + V);
    float mh = max(dot(N, MH), 0.0);
    col += uMoonColor * uNight * (pow(mh, 700.0) * 2.4 + pow(mh, 80.0) * 0.12);

    // foam near piles + pier edges
    float px = abs(mod(vWorld.x + 5.6, 1.6) - 0.8);
    float dz = abs(abs(vWorld.z) - 1.88);
    float pd = sqrt(px * px + dz * dz);
    float foam = (1.0 - smoothstep(0.16, 0.50, pd))
               * (0.36 + 0.28 * sin(t * 1.5 + pd * 11.0))
               * (1.0 - smoothstep(5.0, 5.8, abs(vWorld.x)));
    float edge = (1.0 - smoothstep(0.0, 0.45, abs(abs(vWorld.z) - 1.9)))
               * (1.0 - smoothstep(4.6, 5.5, abs(vWorld.x)));
    foam += edge * (0.28 + 0.26 * vnoise(p * 2.0 + t * 0.4));
    foam += smoothstep(0.18, 0.36, abs(vWave)) * 0.16
          * (0.35 + 0.65 * vnoise(p * 1.2 + vec2(t * 0.2, 0.0)));
    foam *= 0.80 + 0.25 * uSpeed;

    vec3 foamCol = mix(vec3(0.86, 0.92, 0.95), uSunColor, 0.35);
    foamCol = mix(foamCol, vec3(0.26, 0.38, 0.55), uNight * 0.75);
    col = mix(col, foamCol, clamp(foam, 0.0, 0.65));

    // shade under the pier
    float under = (1.0 - smoothstep(1.55, 2.05, abs(vWorld.z)))
                * (1.0 - smoothstep(4.6, 5.2, abs(vWorld.x)));
    col *= 1.0 - 0.40 * under;

    // atmospheric fog
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DUST_VERT = /* glsl */`
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aPhase;
  varying float vA;
  void main() {
    vec3 p = position;
    float t = uTime * 0.32 + aPhase * 6.2831;
    p.x += sin(t + aPhase * 9.0) * 0.55;
    p.y += sin(t * 0.7 + aPhase * 13.0) * 0.38;
    p.z += cos(t * 0.8 + aPhase * 17.0) * 0.55;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uPixelRatio * (200.0 / max(0.4, -mv.z)), 1.0, 16.0);
    vA = 0.35 + 0.65 * smoothstep(0.0, 1.0, 0.5 + 0.5 * sin(uTime * 1.1 + aPhase * 20.0));
  }
`;

const DUST_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(uColor, a * vA * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const BEAM_VERT = /* glsl */`
  uniform float uLen;
  varying float vT;
  void main() {
    vT = clamp(position.y / uLen, 0.0, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BEAM_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  void main() {
    float a = pow(1.0 - vT, 1.9) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ *
 * default camera framing helpers (used to place distant scenery nicely)
 * ------------------------------------------------------------------ */

const VIEW_CAM = new THREE.Vector3(4.8, 3.0, 6.6);
const VIEW_TARGET = new THREE.Vector3(0, 1.35, 0);
const VIEW_FWD = VIEW_TARGET.clone().sub(VIEW_CAM).normalize();
const VIEW_FWD_H = new THREE.Vector3(VIEW_FWD.x, 0, VIEW_FWD.z).normalize();
const VIEW_RIGHT = new THREE.Vector3().crossVectors(
  new THREE.Vector3(0, 1, 0),
  VIEW_CAM.clone().sub(VIEW_TARGET).normalize()
).normalize();

/** direction from camera for azimuth (+ = left of view) and elevation in degrees */
function viewDir(azDeg, elevDeg = 0) {
  const az = azDeg * DEG;
  const el = elevDeg * DEG;
  const hx = VIEW_FWD_H.x * Math.cos(az) - VIEW_RIGHT.x * Math.sin(az);
  const hz = VIEW_FWD_H.z * Math.cos(az) - VIEW_RIGHT.z * Math.sin(az);
  return new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize();
}

/* ================================================================== *
 * createWorld
 * ================================================================== */

export function createWorld({ quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'world';

  const isLow = quality === 'low';
  const textures = [];
  const noWireframe = new Set();

  const T = {
    wood: makeWoodTexture(),
    rope: makeRopeTexture(),
    sign: makeSignTexture(),
    buoy: makeLifebuoyTexture(),
    plate: makePostPlateTexture(),
    crate: makeCrateTexture(),
    glow: makeGlowTexture(),
  };
  for (const k of Object.keys(T)) textures.push(T[k]);

  /* ---------------- sky dome ---------------- */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonColor: { value: C('#cfd9ff') },
      uMoonDir: { value: viewDir(-5, 4.5) },
      uSunVis: { value: 1 },
      uMoonVis: { value: 0 },
      uStarOpacity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  noWireframe.add(skyMat);
  const skySeg = isLow ? [28, 20] : [64, 40];
  const skyGeo = new THREE.SphereGeometry(120, skySeg[0], skySeg[1]);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.name = 'sky';
  group.add(sky);

  /* ---------------- ocean ---------------- */
  const waterUniforms = {
    uTime: { value: 0 },
    uWaveAmp: { value: 1 },
    uSpeed: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uSkyTop: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonColor: { value: C('#cfd9ff') },
    uMoonDir: { value: viewDir(-5, 4.5) },
    uFogColor: { value: new THREE.Color() },
    uSunVis: { value: 1 },
    uNight: { value: 0 },
    uFogNear: { value: 20 },
    uFogFar: { value: 180 },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    fog: false,
  });
  const waterSegs = isLow ? 88 : 170;
  let waterGeo = new THREE.PlaneGeometry(420, 420, waterSegs, waterSegs);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -0.5;
  water.name = 'ocean';
  water.receiveShadow = false;
  group.add(water);

  /* ---------------- materials ---------------- */
  const woodTexMat = new THREE.MeshStandardMaterial({
    map: T.wood, roughness: 0.82, metalness: 0.0,
  });
  const woodDarkMat = new THREE.MeshStandardMaterial({
    map: T.wood, color: C('#6e5138'), roughness: 0.9, metalness: 0.0,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: C('#2b3a39'), roughness: 0.48, metalness: 0.55,
  });
  const vertexColorMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0.05,
  });
  const vertexColorFlatMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0, flatShading: true,
  });

  /* ---------------- pier ---------------- */
  const pier = new THREE.Group();
  pier.name = 'pier';
  group.add(pier);

  const PIER_HALF_X = 5.0;
  const PIER_HALF_Z = 1.8;

  // planks
  const plankW = 0.358;
  const plankGap = 0.024;
  const plankStep = plankW + plankGap;
  const plankCount = Math.floor((PIER_HALF_X * 2) / plankStep);
  const plankGeo = new THREE.BoxGeometry(plankW, 0.08, 3.56);
  const plankMesh = new THREE.InstancedMesh(plankGeo, woodTexMat, plankCount);
  plankMesh.name = 'planks';
  plankMesh.castShadow = true;
  plankMesh.receiveShadow = true;
  {
    const rand = mulberry32(11);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < plankCount; i++) {
      dummy.position.set(-PIER_HALF_X + plankStep * (i + 0.5), -0.04 + (rand() - 0.5) * 0.006, 0);
      dummy.rotation.set((rand() - 0.5) * 0.008, (rand() - 0.5) * 0.01, (rand() - 0.5) * 0.004);
      dummy.scale.set(1, 1, 1 + (rand() - 0.5) * 0.012);
      dummy.updateMatrix();
      plankMesh.setMatrixAt(i, dummy.matrix);
      const v = 0.72 + rand() * 0.30;
      color.setRGB(v, v * (0.97 + rand() * 0.05), v * (0.95 + rand() * 0.06));
      plankMesh.setColorAt(i, color);
    }
    plankMesh.instanceMatrix.needsUpdate = true;
    if (plankMesh.instanceColor) plankMesh.instanceColor.needsUpdate = true;
  }
  pier.add(plankMesh);

  // undercarriage: slab, fascias, cross beams -> one merged mesh
  {
    const parts = [];
    const slab = new THREE.BoxGeometry(10.2, 0.24, 3.72);
    parts.push({ geometry: slab, matrix: M([0, -0.17, 0]) });
    const fasciaZ = new THREE.BoxGeometry(10.3, 0.26, 0.12);
    parts.push({ geometry: fasciaZ, matrix: M([0, -0.20, 1.84]) });
    parts.push({ geometry: fasciaZ, matrix: M([0, -0.20, -1.84]) });
    const fasciaX = new THREE.BoxGeometry(0.12, 0.26, 3.76);
    parts.push({ geometry: fasciaX, matrix: M([5.08, -0.20, 0]) });
    parts.push({ geometry: fasciaX, matrix: M([-5.08, -0.20, 0]) });
    const beam = new THREE.BoxGeometry(0.16, 0.18, 3.86);
    for (let k = 0; k < 7; k++) {
      const x = -4.8 + k * 1.6;
      parts.push({ geometry: beam, matrix: M([x, -0.36, 0]) });
    }
    const geo = mergeParts(parts, { color: true });
    slab.dispose(); fasciaZ.dispose(); fasciaX.dispose(); beam.dispose();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: T.wood, color: C('#5c442e'), roughness: 0.92, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'pier-frame';
    pier.add(mesh);
  }

  // piles
  {
    const postGeo = new THREE.CylinderGeometry(0.125, 0.155, 2.9, 8, 1);
    const count = 14;
    const mesh = new THREE.InstancedMesh(postGeo, woodDarkMat, count);
    mesh.name = 'piles';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const rand = mulberry32(5);
    let i = 0;
    for (const z of [-1.88, 1.88]) {
      for (let k = 0; k < 7; k++) {
        const x = -4.8 + k * 1.6;
        dummy.position.set(x, -1.36, z + (rand() - 0.5) * 0.05);
        dummy.rotation.set((rand() - 0.5) * 0.03, rand() * TAU, (rand() - 0.5) * 0.03);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    pier.add(mesh);

    // a few cross braces between far-side piles, merged
    const braceParts = [];
    const braceGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
    for (let k = 0; k < 6; k++) {
      const x0 = -4.8 + k * 1.6;
      const x1 = x0 + 1.6;
      for (const zz of [-1.88, 1.88]) {
        const a = new THREE.Vector3(x0, -1.55, zz);
        const b = new THREE.Vector3(x1, -0.45, zz);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a);
        const len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, len, 1));
        braceParts.push({ geometry: braceGeo, matrix: m });
      }
    }
    const braceMerged = mergeParts(braceParts, { color: true });
    braceGeo.dispose();
    const braceMesh = new THREE.Mesh(braceMerged, woodDarkMat.clone());
    braceMesh.material.vertexColors = false;
    braceMesh.name = 'braces';
    pier.add(braceMesh);
  }

  // far-side railing: posts + top rail + two sagging rope lines
  {
    const postGeo = new THREE.BoxGeometry(0.095, 1.06, 0.095);
    const count = 13;
    const mesh = new THREE.InstancedMesh(postGeo, woodTexMat, count);
    mesh.name = 'rail-posts';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const rand = mulberry32(19);
    for (let k = 0; k < count; k++) {
      dummy.position.set(-4.8 + k * 0.8, 0.53, -1.74);
      dummy.rotation.set(0, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.02);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    pier.add(mesh);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.085, 0.13), woodTexMat);
    rail.position.set(0, 1.07, -1.74);
    rail.castShadow = true;
    rail.receiveShadow = true;
    rail.name = 'rail-top';
    pier.add(rail);

    // sagging ropes
    const ropeParts = [];
    const ropeMat = new THREE.MeshStandardMaterial({ map: T.rope, roughness: 0.92, metalness: 0 });
    for (const hy of [0.76, 0.40]) {
      for (let k = 0; k < count - 1; k++) {
        const x0 = -4.8 + k * 0.8;
        const x1 = x0 + 0.8;
        const pts = [];
        for (let s = 0; s <= 6; s++) {
          const u = s / 6;
          const sag = Math.sin(Math.PI * u) * 0.065;
          pts.push(new THREE.Vector3(x0 + (x1 - x0) * u, hy - sag, -1.74));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        ropeParts.push({ geometry: new THREE.TubeGeometry(curve, 7, 0.021, 5, false) });
      }
    }
    const ropeGeo = mergeParts(ropeParts, { color: false, uv: true });
    for (const p of ropeParts) p.geometry.dispose();
    const ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
    ropeMesh.name = 'rail-ropes';
    ropeMesh.castShadow = false;
    pier.add(ropeMesh);
  }

  /* ---------------- lamp post ---------------- */
  const lampGroup = new THREE.Group();
  lampGroup.name = 'lamp';
  lampGroup.position.set(3.15, 0, -1.28);
  pier.add(lampGroup);

  let lampGlassMat;
  {
    const parts = [];
    const iron = C('#263533');
    const brass = C('#bd8b4d');
    // base + pole + collars
    parts.push({ geometry: new THREE.CylinderGeometry(0.20, 0.24, 0.12, 12), color: iron, matrix: M([0, 0.06, 0]) });
    parts.push({ geometry: new THREE.CylinderGeometry(0.155, 0.20, 0.16, 12), color: iron, matrix: M([0, 0.20, 0]) });
    parts.push({ geometry: new THREE.CylinderGeometry(0.052, 0.085, 2.52, 10), color: iron, matrix: M([0, 1.54, 0]) });
    parts.push({ geometry: new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10), color: brass, matrix: M([0, 0.42, 0]) });
    parts.push({ geometry: new THREE.CylinderGeometry(0.070, 0.070, 0.06, 10), color: brass, matrix: M([0, 2.66, 0]) });
    // lantern bottom plate
    parts.push({ geometry: new THREE.CylinderGeometry(0.22, 0.16, 0.08, 8), color: iron, matrix: M([0, 2.82, 0]) });
    // crown cap
    parts.push({ geometry: new THREE.ConeGeometry(0.26, 0.18, 8), color: iron, matrix: M([0, 3.10, 0]) });
    parts.push({ geometry: new THREE.SphereGeometry(0.035, 8, 6), color: brass, matrix: M([0, 3.21, 0]) });
    // little corner ribs of the lantern
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      parts.push({
        geometry: new THREE.BoxGeometry(0.026, 0.34, 0.026),
        color: iron,
        matrix: M([Math.cos(a) * 0.185, 2.96, Math.sin(a) * 0.185], [0, -a, 0]),
      });
    }
    const geo = mergeParts(parts, { color: true });
    const mesh = new THREE.Mesh(geo, vertexColorMat.clone());
    mesh.material.metalness = 0.5;
    mesh.material.roughness = 0.45;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    lampGroup.add(mesh);
  }
  {
    lampGlassMat = new THREE.MeshStandardMaterial({
      color: C('#ffe9c4'),
      emissive: C('#ffb066'),
      emissiveIntensity: 0.4,
      roughness: 0.28,
      metalness: 0,
      transparent: true,
      opacity: 0.9,
    });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.19, 0.34, 8, 1, true), lampGlassMat);
    glass.position.y = 2.96;
    lampGroup.add(glass);
  }
  const lampLight = new THREE.PointLight(C('#ffb26a'), 0, 13, 2);
  lampLight.position.set(0, 2.96, 0);
  lampGroup.add(lampLight);

  const lampGlowMat = new THREE.SpriteMaterial({
    map: T.glow, color: C('#ffb168'),
    transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const lampGlow = new THREE.Sprite(lampGlowMat);
  lampGlow.scale.set(2.0, 2.0, 1);
  lampGlow.position.set(0, 2.96, 0);
  lampGroup.add(lampGlow);
  const lampHaloMat = lampGlowMat.clone();
  lampHaloMat.opacity = 0;
  const lampHalo = new THREE.Sprite(lampHaloMat);
  lampHalo.scale.set(6.0, 6.0, 1);
  lampHalo.position.set(0, 2.96, 0);
  lampGroup.add(lampHalo);

  /* ---------------- PELICAN POST sign ---------------- */
  {
    const signGroup = new THREE.Group();
    signGroup.name = 'sign';
    signGroup.position.set(-4.15, 0, 1.5);
    const toCam = new THREE.Vector3(4.8 - signGroup.position.x, 0, 6.6 - signGroup.position.z);
    signGroup.rotation.y = Math.atan2(toCam.x, toCam.z);

    const parts = [];
    const postGeo = new THREE.BoxGeometry(0.1, 2.1, 0.1);
    parts.push({ geometry: postGeo, matrix: M([-0.58, 1.0, 0], [0.02, 0, 0.03]) });
    parts.push({ geometry: postGeo, matrix: M([0.58, 1.0, 0], [0.02, 0, -0.03]) });
    const board = new THREE.BoxGeometry(1.56, 0.98, 0.07);
    parts.push({ geometry: board, matrix: M([0, 1.72, 0]) });
    const cap = new THREE.BoxGeometry(1.7, 0.07, 0.12);
    parts.push({ geometry: cap, matrix: M([0, 2.24, 0]) });
    const geo = mergeParts(parts, { color: false, uv: true });
    postGeo.dispose(); board.dispose(); cap.dispose();
    const frame = new THREE.Mesh(geo, woodDarkMat);
    frame.castShadow = true;
    frame.receiveShadow = true;
    signGroup.add(frame);

    const boardMat = new THREE.MeshStandardMaterial({ map: T.sign, roughness: 0.72, metalness: 0 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 0.9), boardMat);
    face.position.set(0, 1.72, 0.038);
    face.castShadow = true;
    signGroup.add(face);
    pier.add(signGroup);
  }

  /* ---------------- pillar postbox ---------------- */
  {
    const boxGroup = new THREE.Group();
    boxGroup.name = 'postbox';
    boxGroup.position.set(-3.0, 0, 0.72);
    const toCam = new THREE.Vector3(4.8 - boxGroup.position.x, 0, 6.6 - boxGroup.position.z);
    boxGroup.rotation.y = Math.atan2(toCam.x, toCam.z) + 0.25;

    const coral = C('#b8483c');
    const coralDark = C('#93352c');
    const iron = C('#2a3838');
    const cream = C('#f0e3c8');
    const brass = C('#c19151');
    const parts = [];
    parts.push({ geometry: new THREE.CylinderGeometry(0.27, 0.29, 0.1, 16), color: iron, matrix: M([0, 0.05, 0]) });
    parts.push({ geometry: new THREE.CylinderGeometry(0.245, 0.27, 0.86, 16), color: coral, matrix: M([0, 0.55, 0]) });
    parts.push({ geometry: new THREE.TorusGeometry(0.255, 0.018, 6, 16), color: cream, matrix: M([0, 0.20, 0], [Math.PI / 2, 0, 0]) });
    parts.push({ geometry: new THREE.TorusGeometry(0.248, 0.016, 6, 16), color: brass, matrix: M([0, 0.92, 0], [Math.PI / 2, 0, 0]) });
    parts.push({ geometry: new THREE.SphereGeometry(0.255, 16, 8, 0, TAU, 0, Math.PI / 2), color: coral, matrix: M([0, 0.98, 0]) });
    parts.push({ geometry: new THREE.CylinderGeometry(0.035, 0.05, 0.12, 8), color: coralDark, matrix: M([0, 1.2, 0]) });
    parts.push({ geometry: new THREE.SphereGeometry(0.055, 8, 6), color: brass, matrix: M([0, 1.29, 0]) });
    // slot
    parts.push({ geometry: new THREE.BoxGeometry(0.19, 0.03, 0.05), color: C('#141719'), matrix: M([0, 0.80, 0.245]) });
    parts.push({ geometry: new THREE.BoxGeometry(0.23, 0.05, 0.03), color: brass, matrix: M([0, 0.855, 0.248]) });
    // little posting aperture plate
    parts.push({ geometry: new THREE.BoxGeometry(0.12, 0.09, 0.02), color: cream, matrix: M([0, 0.68, 0.252]) });
    const geo = mergeParts(parts, { color: true });
    const mesh = new THREE.Mesh(geo, vertexColorMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    boxGroup.add(mesh);

    const plateMat = new THREE.MeshStandardMaterial({ map: T.plate, roughness: 0.65 });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), plateMat);
    plate.position.set(0, 0.68, 0.264);
    boxGroup.add(plate);

    pier.add(boxGroup);
  }

  /* ---------------- coiled rope ---------------- */
  {
    const parts = [];
    const coilGeo = new THREE.TorusGeometry(0.24, 0.04, 6, 22);
    for (let i = 0; i < 3; i++) {
      parts.push({
        geometry: coilGeo,
        matrix: M([0, 0.045 + i * 0.055, 0], [Math.PI / 2 + (i - 1) * 0.04, i * 0.7, 0], [1, 1, 1 + i * 0.05]),
      });
    }
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.22, 0.16, 0.05),
      new THREE.Vector3(0.42, 0.06, 0.16),
      new THREE.Vector3(0.55, 0.03, 0.30),
      new THREE.Vector3(0.48, 0.03, 0.44),
    ]);
    parts.push({ geometry: new THREE.TubeGeometry(tailCurve, 10, 0.035, 5, false) });
    const geo = mergeParts(parts, { color: false, uv: true });
    coilGeo.dispose();
    const mat = new THREE.MeshStandardMaterial({ map: T.rope, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(2.55, 0.005, 1.18);
    mesh.rotation.y = 0.35;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'rope-coil';
    pier.add(mesh);
  }

  /* ---------------- lifebuoy ---------------- */
  {
    const groupB = new THREE.Group();
    groupB.name = 'lifebuoy';
    groupB.position.set(-4.3, 0.82, -1.59);
    groupB.rotation.set(0.06, 0.06, -0.10);
    const mat = new THREE.MeshStandardMaterial({ map: T.buoy, roughness: 0.78, metalness: 0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.075, 10, 28), mat);
    ring.castShadow = true;
    groupB.add(ring);

    // rope hanger to the top rail
    const pts = [
      new THREE.Vector3(0, 0.30, 0),
      new THREE.Vector3(0.02, 0.55, 0.02),
      new THREE.Vector3(0.0, 0.8, 0.0),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const hanger = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 8, 0.02, 5, false),
      new THREE.MeshStandardMaterial({ map: T.rope, roughness: 0.9 })
    );
    hanger.position.set(-4.3, 0.82, -1.59);
    pier.add(hanger);
    pier.add(groupB);
  }

  /* ---------------- seagull on the railing ---------------- */
  {
    const gullGroup = new THREE.Group();
    gullGroup.name = 'seagull';
    gullGroup.position.set(1.35, 1.115, -1.74);
    gullGroup.rotation.y = -0.55;

    const bodyParts = [];
    const white = C('#f4efe2');
    const grey = C('#b9c0c2');
    const darkGrey = C('#8f979b');
    const orange = C('#e8a03c');
    bodyParts.push({ geometry: new THREE.SphereGeometry(0.14, 10, 8), color: white, matrix: M([0, 0.02, 0], [0, 0, 0.1], [1.35, 0.92, 0.92]) });
    // folded wings
    bodyParts.push({ geometry: new THREE.SphereGeometry(0.11, 8, 6), color: grey, matrix: M([-0.02, 0.02, 0.10], [0.2, 0.15, 0.1], [1.25, 0.6, 0.38]) });
    bodyParts.push({ geometry: new THREE.SphereGeometry(0.11, 8, 6), color: grey, matrix: M([-0.02, 0.02, -0.10], [-0.2, -0.15, 0.1], [1.25, 0.6, 0.38]) });
    // wing tips
    bodyParts.push({ geometry: new THREE.ConeGeometry(0.06, 0.18, 5), color: darkGrey, matrix: M([-0.14, 0.0, 0.10], [0, 0, 1.7], [1, 1, 0.5]) });
    bodyParts.push({ geometry: new THREE.ConeGeometry(0.06, 0.18, 5), color: darkGrey, matrix: M([-0.14, 0.0, -0.10], [0, 0, 1.7], [1, 1, 0.5]) });
    // tail
    bodyParts.push({ geometry: new THREE.ConeGeometry(0.065, 0.2, 6), color: white, matrix: M([-0.19, 0.03, 0], [0, 0, Math.PI / 2 + 0.18]) });
    // legs
    bodyParts.push({ geometry: new THREE.CylinderGeometry(0.008, 0.008, 0.13, 5), color: orange, matrix: M([0.02, -0.09, 0.04]) });
    bodyParts.push({ geometry: new THREE.CylinderGeometry(0.008, 0.008, 0.13, 5), color: orange, matrix: M([0.02, -0.09, -0.04]) });
    const bodyGeo = mergeParts(bodyParts, { color: true });
    for (const p of bodyParts) p.geometry.dispose();
    const body = new THREE.Mesh(bodyGeo, vertexColorMat.clone());
    body.material.roughness = 0.82;
    body.castShadow = true;
    gullGroup.add(body);

    const headGroup = new THREE.Group();
    headGroup.position.set(0.14, 0.115, 0);
    const headParts = [];
    headParts.push({ geometry: new THREE.SphereGeometry(0.062, 9, 7), color: white, matrix: M([0, 0.01, 0]) });
    headParts.push({ geometry: new THREE.ConeGeometry(0.026, 0.16, 6), color: orange, matrix: M([0.115, 0.0, 0], [0, 0, -Math.PI / 2 + 0.08]) });
    headParts.push({ geometry: new THREE.SphereGeometry(0.012, 6, 5), color: C('#1a1a1a'), matrix: M([0.035, 0.03, 0.045]) });
    headParts.push({ geometry: new THREE.SphereGeometry(0.012, 6, 5), color: C('#1a1a1a'), matrix: M([0.035, 0.03, -0.045]) });
    const headGeo = mergeParts(headParts, { color: true });
    for (const p of headParts) p.geometry.dispose();
    const head = new THREE.Mesh(headGeo, vertexColorMat.clone());
    head.material.roughness = 0.82;
    head.castShadow = true;
    headGroup.add(head);
    gullGroup.add(headGroup);
    pier.add(gullGroup);

    var gullHeadGroup = headGroup; // captured by update()
  }

  /* ---------------- crates at the near corner ---------------- */
  {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const parts = [];
    parts.push({ geometry: box, matrix: M([0, 0.255, 0], [0, 0.18, 0], [0.52, 0.51, 0.52]) });
    parts.push({ geometry: box, matrix: M([0.06, 0.71, -0.04], [0, -0.42, 0.02], [0.40, 0.4, 0.40]) });
    const geo = mergeParts(parts, { color: false, uv: true });
    box.dispose();
    const mat = new THREE.MeshStandardMaterial({ map: T.crate, roughness: 0.85, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(3.95, 0.0, 0.55);
    mesh.rotation.y = 0.3;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'crates';
    pier.add(mesh);
  }

  /* ---------------- distant islands ---------------- */
  const islandsGroup = new THREE.Group();
  islandsGroup.name = 'islands';
  group.add(islandsGroup);

  function makeIsland(seed, radius, height) {
    const rand = mulberry32(seed);
    let geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n1 = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 0.7) * Math.sin(v.z * 3.6 + seed * 1.3);
      const n2 = Math.sin(v.x * 6.7 + v.z * 5.3 + seed * 2.1) * Math.cos(v.y * 5.1 + seed);
      const rr = radius * (0.78 + 0.30 * (0.5 + 0.5 * n2) + 0.10 * n1);
      v.x *= rr;
      v.z *= rr;
      v.y = v.y > 0 ? v.y * height * (0.55 + 0.5 * (0.5 + 0.5 * n2)) : v.y * height * 0.15;
      pos.setXYZ(i, v.x, v.y + height * 0.12, v.z);
    }
    geo.computeVertexNormals();
    if (geo.index) geo = geo.toNonIndexed();
    geo.computeVertexNormals();

    const rock = C('#39423f');
    const rockDark = C('#2a3230');
    const grass = C('#4d5a45');
    const grassLight = C('#5f6c4e');
    const sand = C('#8a7355');
    paintFaces(geo, (cen, n) => {
      const hNorm = cen.y / height;
      if (hNorm < 0.06 && n.y > 0.1) return rand() > 0.5 ? sand : rock;
      if (n.y > 0.6 && hNorm > 0.35) return rand() > 0.45 ? grass : grassLight;
      if (n.y > 0.28) return rand() > 0.5 ? rock : grass;
      return rand() > 0.5 ? rockDark : rock;
    });
    return geo;
  }

  function makeTrees(seed, radius, height, count) {
    const rand = mulberry32(seed);
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5);
    const cone = new THREE.ConeGeometry(1, 2.4, 6);
    for (let i = 0; i < count; i++) {
      const a = rand() * TAU;
      const r = radius * (0.15 + rand() * 0.5);
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      const py = height * (0.45 + rand() * 0.12);
      const s = 0.6 + rand() * 0.6;
      parts.push({ geometry: trunk, color: C('#3b3226'), matrix: M([px, py + 0.6 * s, pz], [0, rand() * TAU, 0], [s, s, s]) });
      parts.push({ geometry: cone, color: C('#33452f'), matrix: M([px, py + 1.6 * s, pz], [0, rand() * TAU, 0], [s * 1.1, s, s * 1.1]) });
      parts.push({ geometry: cone, color: C('#2c3b2b'), matrix: M([px, py + 2.4 * s, pz], [0, rand() * TAU, 0], [s * 0.75, s * 0.8, s * 0.75]) });
    }
    const geo = mergeParts(parts, { color: true });
    trunk.dispose(); cone.dispose();
    return geo;
  }

  const islandDefs = [
    { seed: 3, radius: 15, height: 6.5, pos: [-30, -0.6, -87], trees: 0 },
    { seed: 8, radius: 24, height: 8.0, pos: [-109, -0.6, -55], trees: 7 },
    { seed: 14, radius: 7, height: 5.0, pos: [-52, -0.6, -132], trees: 0 },
  ];
  for (const def of islandDefs) {
    const geo = makeIsland(def.seed, def.radius, def.height);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
      emissive: C('#0b0d12'), emissiveIntensity: 0.35,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(def.pos[0], def.pos[1], def.pos[2]);
    mesh.name = 'island';
    islandsGroup.add(mesh);

    if (def.trees > 0) {
      const treeGeo = makeTrees(def.seed + 1, def.radius, def.height, def.trees);
      const treeMesh = new THREE.Mesh(treeGeo, vertexColorFlatMat);
      treeMesh.position.copy(mesh.position);
      islandsGroup.add(treeMesh);
    }
  }

  /* ---------------- lighthouse ---------------- */
  const lighthouseGroup = new THREE.Group();
  lighthouseGroup.name = 'lighthouse';
  const LIGHTHOUSE_POS = new THREE.Vector3(-30, 4.55, -87);
  lighthouseGroup.position.copy(LIGHTHOUSE_POS);
  group.add(lighthouseGroup);

  let lighthouseLanternMat;
  let lighthouseBeamGroup;
  let lighthouseBeamMat;
  let lighthouseGlowMat;
  {
    const white = C('#e8e2d4');
    const red = C('#a8433a');
    const iron = C('#2a3333');
    const parts = [];
    // base plinth
    parts.push({ geometry: new THREE.CylinderGeometry(1.15, 1.35, 0.9, 10), color: C('#5a5f57'), matrix: M([0, 0.45, 0]) });
    // tower: taper with alternating bands
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const t1 = (i + 1) / bands;
      const r0 = 0.92 - t0 * 0.34;
      const r1 = 0.92 - t1 * 0.34;
      const h = 4.6 / bands;
      parts.push({
        geometry: new THREE.CylinderGeometry(r1, r0, h, 10),
        color: i % 2 === 0 ? white : red,
        matrix: M([0, 1.0 + h * (i + 0.5), 0]),
      });
    }
    // gallery deck
    parts.push({ geometry: new THREE.CylinderGeometry(0.95, 0.85, 0.16, 10), color: iron, matrix: M([0, 5.72, 0]) });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      parts.push({
        geometry: new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4),
        color: iron,
        matrix: M([Math.cos(a) * 0.8, 5.98, Math.sin(a) * 0.8]),
      });
    }
    parts.push({ geometry: new THREE.TorusGeometry(0.82, 0.02, 4, 12), color: iron, matrix: M([0, 6.16, 0], [Math.PI / 2, 0, 0]) });
    // lantern frame base
    parts.push({ geometry: new THREE.CylinderGeometry(0.42, 0.5, 0.14, 8), color: iron, matrix: M([0, 6.28, 0]) });
    // roof
    parts.push({ geometry: new THREE.ConeGeometry(0.5, 0.55, 8), color: iron, matrix: M([0, 6.9, 0]) });
    parts.push({ geometry: new THREE.SphereGeometry(0.06, 6, 5), color: C('#c9a25c'), matrix: M([0, 7.2, 0]) });
    const geo = mergeParts(parts, { color: true });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lighthouse-tower';
    lighthouseGroup.add(mesh);

    lighthouseLanternMat = new THREE.MeshStandardMaterial({
      color: C('#fff0c8'),
      emissive: C('#ffcf87'),
      emissiveIntensity: 0.4,
      roughness: 0.2,
      metalness: 0,
    });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.6, 8), lighthouseLanternMat);
    lantern.position.y = 6.56;
    lighthouseGroup.add(lantern);

    // sweeping beams
    const beamLen = 34;
    const beamGeo = new THREE.CylinderGeometry(2.9, 0.08, beamLen, 14, 1, true);
    beamGeo.translate(0, beamLen / 2, 0);
    beamGeo.rotateZ(-Math.PI / 2); // +Y -> +X
    lighthouseBeamMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: C('#ffe6b8') },
        uOpacity: { value: 0 },
        uLen: { value: beamLen },
      },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    lighthouseBeamGroup = new THREE.Group();
    lighthouseBeamGroup.position.y = 6.56;
    const beam1 = new THREE.Mesh(beamGeo, lighthouseBeamMat);
    const beam2 = new THREE.Mesh(beamGeo, lighthouseBeamMat);
    beam2.rotation.y = Math.PI;
    lighthouseBeamGroup.add(beam1);
    lighthouseBeamGroup.add(beam2);
    lighthouseGroup.add(lighthouseBeamGroup);

    lighthouseGlowMat = new THREE.SpriteMaterial({
      map: T.glow, color: C('#ffe3ac'),
      transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const lhGlow = new THREE.Sprite(lighthouseGlowMat);
    lhGlow.scale.set(7, 7, 1);
    lhGlow.position.y = 6.56;
    lighthouseGroup.add(lhGlow);
  }

  /* ---------------- clouds ---------------- */
  // Soft, warm, semi-transparent sunset clouds: merged puff clusters per cloud,
  // kept to the sides of the frame so the central sky (rider / beak / title) stays clear.
  const cloudMat = new THREE.MeshStandardMaterial({
    color: C('#fff3e6'), roughness: 1, metalness: 0,
    vertexColors: true, transparent: true, opacity: 0.78,
    depthWrite: false, fog: false,
    emissive: C('#ffcf9f'), emissiveIntensity: 0.95,
  });
  const cloudDefs = [
    { az: 17, dist: 170, elev: 4.1, size: 9.5 },
    { az: 24, dist: 200, elev: 5.3, size: 11 },
    { az: 30, dist: 225, elev: 3.7, size: 12 },
    { az: -17, dist: 175, elev: 4.5, size: 9.5 },
    { az: -25, dist: 210, elev: 5.1, size: 11 },
    { az: -31, dist: 230, elev: 3.5, size: 12 },
    { az: 33, dist: 245, elev: 5.8, size: 13 },
    { az: -34, dist: 250, elev: 6.0, size: 13 },
  ];
  const cloudMeshes = [];
  const cloudData = [];
  {
    const rand = mulberry32(101);
    const puffGeo = new THREE.SphereGeometry(1, 10, 7);
    const color = new THREE.Color();
    const maxClouds = isLow ? 4 : cloudDefs.length;
    const puffsPerCloud = isLow ? 8 : 14;
    for (let i = 0; i < maxClouds; i++) {
      const def = cloudDefs[i];
      const dir = viewDir(def.az, def.elev);
      const base = VIEW_CAM.clone().add(dir.multiplyScalar(def.dist));
      const parts = [];
      const halfW = def.size * 0.46;
      for (let p = 0; p < puffsPerCloud; p++) {
        const u = puffsPerCloud === 1 ? 0.5 : p / (puffsPerCloud - 1);
        const lift = Math.sin(u * Math.PI);
        const px = (u - 0.5) * (halfW * 2) + (rand() - 0.5) * def.size * 0.26;
        const py = lift * def.size * (0.10 + rand() * 0.16) + (rand() - 0.3) * def.size * 0.06;
        const pz = (rand() - 0.5) * def.size * 0.42;
        const s = def.size * (0.135 + rand() * 0.085) * (0.72 + lift * 0.45);
        const top = clamp01(py / (def.size * 0.22));
        color.setRGB(1.0, 0.93 + 0.055 * top, 0.865 + 0.10 * top);
        parts.push({
          geometry: puffGeo,
          matrix: M([px, py, pz], [0, rand() * TAU, 0], [s * 1.55, s * 0.70, s * 1.15]),
          color: color.clone(),
        });
      }
      // low base wisps to soften the underside
      for (let p = 0; p < 4; p++) {
        const px = (rand() - 0.5) * def.size * 0.95;
        const s = def.size * (0.12 + rand() * 0.07);
        color.setRGB(1.0, 0.92, 0.87);
        parts.push({
          geometry: puffGeo,
          matrix: M([px, -def.size * 0.09 - rand() * def.size * 0.04, (rand() - 0.5) * def.size * 0.42], [0, 0, 0], [s * 1.5, s * 0.5, s]),
          color: color.clone(),
        });
      }
      const geo = mergeParts(parts, { color: true });
      const mesh = new THREE.Mesh(geo, cloudMat);
      mesh.position.copy(base);
      mesh.name = 'cloud';
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      group.add(mesh);
      cloudMeshes.push(mesh);
      cloudData.push({ mesh, base: base.clone(), speed: 0.30 + rand() * 0.40, offset: 0 });
    }
    puffGeo.dispose();
  }

  /* ---------------- distant gulls ---------------- */
  const gullWingGeo = (() => {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0.02, 0.0, 0.0,
      0.46, 0.03, 0.14,
      0.10, 0.0, -0.11,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  })();
  const gullMat = new THREE.MeshBasicMaterial({
    color: C('#3a3550'), side: THREE.DoubleSide, transparent: true, opacity: 0.92,
  });
  const gullCount = isLow ? 4 : 8;
  const gullLeft = new THREE.InstancedMesh(gullWingGeo, gullMat, gullCount);
  const gullRight = new THREE.InstancedMesh(gullWingGeo, gullMat, gullCount);
  gullLeft.frustumCulled = false;
  gullRight.frustumCulled = false;
  gullLeft.name = 'gulls-l';
  gullRight.name = 'gulls-r';
  const gullData = [];
  {
    const rand = mulberry32(53);
    const flocks = [
      { c: new THREE.Vector3(-4, 7.4, -38), r: 12 },
      { c: new THREE.Vector3(-22, 8.6, -52), r: 10 },
      { c: new THREE.Vector3(24, 6.8, -46), r: 14 },
    ];
    for (let i = 0; i < 9; i++) {
      const f = flocks[i % flocks.length];
      gullData.push({
        center: f.c.clone().add(new THREE.Vector3((rand() - 0.5) * 8, (rand() - 0.5) * 3, (rand() - 0.5) * 8)),
        radius: f.r * (0.5 + rand() * 0.7),
        speed: 0.10 + rand() * 0.10,
        phase: rand() * TAU,
        yBob: 0.6 + rand() * 1.2,
        scale: 0.85 + rand() * 0.7,
        flap: 1.6 + rand() * 1.3,
      });
    }
  }
  group.add(gullLeft);
  group.add(gullRight);

  /* ---------------- buoys ---------------- */
  const buoyGroup = new THREE.Group();
  buoyGroup.name = 'buoys';
  group.add(buoyGroup);
  const buoyData = [];
  {
    const buoyDefs = [
      { az: -22, dist: 36, phase: 0.0 },
      { az: 28, dist: 58, phase: 2.1 },
    ];
    const bodyParts = [];
    bodyParts.push({ geometry: new THREE.CylinderGeometry(0.42, 0.16, 0.34, 10), color: C('#b44638'), matrix: M([0, 0.1, 0]) });
    bodyParts.push({ geometry: new THREE.CylinderGeometry(0.14, 0.34, 0.5, 10), color: C('#e8dcc2'), matrix: M([0, -0.12, 0]) });
    bodyParts.push({ geometry: new THREE.CylinderGeometry(0.44, 0.44, 0.06, 10), color: C('#b44638'), matrix: M([0, 0.3, 0]) });
    bodyParts.push({ geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.36, 5), color: C('#2d3335'), matrix: M([0, 0.5, 0]) });
    const bodyGeo = mergeParts(bodyParts, { color: true });
    for (const p of bodyParts) p.geometry.dispose();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    for (const def of buoyDefs) {
      const dir = viewDir(def.az, 0);
      const pos = new THREE.Vector3(
        VIEW_CAM.x + dir.x * def.dist,
        -0.4,
        VIEW_CAM.z + dir.z * def.dist
      );
      const mesh = new THREE.Mesh(bodyGeo, mat);
      mesh.position.copy(pos);
      mesh.castShadow = false;
      buoyGroup.add(mesh);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshBasicMaterial({ color: C('#ffd9a0') })
      );
      lamp.position.set(0, 0.69, 0);
      mesh.add(lamp);
      buoyData.push({ mesh, base: pos.clone(), phase: def.phase });
    }
  }

  /* ---------------- jumping fish + splash rings ---------------- */
  const fishCount = isLow ? 2 : 3;
  const fishParts = [];
  {
    fishParts.push({ geometry: new THREE.SphereGeometry(0.16, 8, 6), color: C('#a9bfc9'), matrix: M([0, 0, 0], [0, 0, 0], [2.3, 0.75, 0.55]) });
    fishParts.push({ geometry: new THREE.ConeGeometry(0.13, 0.24, 5), color: C('#7f99a5'), matrix: M([-0.35, 0, 0], [0, 0, Math.PI / 2]) });
    fishParts.push({ geometry: new THREE.ConeGeometry(0.05, 0.14, 4), color: C('#7f99a5'), matrix: M([0, 0.12, 0], [0.3, 0, 0], [1, 1, 0.4]) });
  }
  const fishGeo = mergeParts(fishParts, { color: true });
  for (const p of fishParts) p.geometry.dispose();
  const fishMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.32, metalness: 0.55,
  });
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, fishCount);
  fishMesh.name = 'fish';
  fishMesh.frustumCulled = false;
  group.add(fishMesh);

  const ringGeo = new THREE.RingGeometry(0.34, 0.43, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: C('#ffffff'), transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, fishCount * 2);
  ringMesh.name = 'splash-rings';
  ringMesh.frustumCulled = false;
  group.add(ringMesh);

  const fishData = [];
  {
    const rand = mulberry32(151);
    const spots = [
      { x: 1.5, z: -5.5, dx: 0.6, dz: -0.8, period: 7.4 },
      { x: -7.5, z: -6.0, dx: 0.9, dz: 0.3, period: 9.2 },
      { x: -1.2, z: -8.4, dx: 0.8, dz: 0.4, period: 8.3 },
    ];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < fishCount; i++) {
      const s = spots[i % spots.length];
      fishData.push({
        start: new THREE.Vector3(s.x, -0.45, s.z),
        dir: new THREE.Vector3(s.dx, 0, s.dz).normalize(),
        jumpDist: 2.4 + rand() * 1.6,
        jumpHeight: 1.15 + rand() * 0.5,
        period: s.period,
        offset: rand() * 10,
      });
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      fishMesh.setMatrixAt(i, dummy.matrix);
      ringMesh.setMatrixAt(i * 2, dummy.matrix);
      ringMesh.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    fishMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
    const c = new THREE.Color(0, 0, 0);
    for (let i = 0; i < fishCount * 2; i++) ringMesh.setColorAt(i, c);
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
  }

  /* ---------------- floating dust / sparkles ---------------- */
  const dustCount = isLow ? 110 : 220;
  const dustGeo = new THREE.BufferGeometry();
  {
    const rand = mulberry32(211);
    const pos = new Float32Array(dustCount * 3);
    const size = new Float32Array(dustCount);
    const phase = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = -6 + rand() * 13;
      pos[i * 3 + 1] = 0.25 + rand() * 4.6;
      pos[i * 3 + 2] = -4.5 + rand() * 9.5;
      size[i] = 0.055 + rand() * 0.16;
      phase[i] = rand();
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  }
  const dustUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1.5 },
    uColor: { value: C('#ffd9a4') },
    uOpacity: { value: 0.5 },
  };
  const dustMat = new THREE.ShaderMaterial({
    uniforms: dustUniforms,
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'dust';
  dust.frustumCulled = false;
  // sort after transparent water? additive dust
  dust.renderOrder = 5;
  group.add(dust);

  /* ---------------- minimoon / sky reference ---------------- */
  const moonDir = viewDir(-5, 4.5);

  /* ---------------- state & update ---------------- */
  let simTime = 0;
  let currentQuality = quality;
  let lastTimeOfDay = null;

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();

  function applyAtmosphere(atmo) {
    lastTimeOfDay = atmo;
    // sky
    const su = skyMat.uniforms;
    su.uTop.value.copy(atmo.skyTop);
    su.uHorizon.value.copy(atmo.skyHorizon);
    su.uHaze.value.copy(atmo.skyHorizon).lerp(atmo.sunColor, 0.28).multiplyScalar(1.04);
    su.uSunColor.value.copy(atmo.sunColor);
    su.uSunDir.value.copy(atmo.sunDir);
    su.uSunVis.value = smoothstepJs(-0.012, 0.03, atmo.sunDir.y) * (1 - smoothstepJs(0.30, 0.65, atmo.isNight));
    su.uMoonVis.value = atmo.isNight;

    // water
    const wu = waterUniforms;
    wu.uDeep.value.copy(atmo.waterDeep);
    wu.uShallow.value.copy(atmo.waterShallow);
    wu.uSkyTop.value.copy(atmo.skyTop);
    wu.uSkyHorizon.value.copy(atmo.skyHorizon);
    wu.uSunColor.value.copy(atmo.sunColor);
    wu.uSunDir.value.copy(atmo.sunDir);
    wu.uMoonDir.value.copy(moonDir);
    wu.uFogColor.value.copy(atmo.fogColor).multiplyScalar(0.90);
    wu.uSunVis.value = su.uSunVis.value;
    wu.uNight.value = atmo.isNight;
    wu.uFogNear.value = atmo.fogNear;
    wu.uFogFar.value = atmo.fogFar;

    // lamp: warms up and glows at night
    const lampOn = smoothstepJs(0.06, 0.55, atmo.isNight) * (1 - smoothstepJs(0.85, 1.0, atmo.isNight) * 0.25);
    lampLight.intensity = 0.45 + lampOn * 17;
    lampGlassMat.emissiveIntensity = 1.15 + lampOn * 5.0;
    lampGlowMat.opacity = 0.22 + lampOn * 0.78;
    lampHaloMat.opacity = 0.06 + lampOn * 0.20;
    lampGlow.scale.setScalar(1.6 + lampOn * 0.9);
    lampHalo.scale.setScalar(5.0 + lampOn * 2.5);

    // lighthouse
    lighthouseLanternMat.emissiveIntensity = 0.3 + atmo.isNight * 4.5;
    lighthouseGlowMat.opacity = atmo.isNight * 0.8;
    lighthouseBeamMat.uniforms.uOpacity.value = atmo.isNight * 0.13;

    // clouds: warm cream/peach, softly self-lit so they stay airy when backlit
    const cloudWarm = tmpColor.copy(atmo.sunColor).lerp(C('#fff0dc'), 0.55);
    const nightDim = 1 - 0.86 * atmo.isNight;
    cloudMat.emissive.copy(cloudWarm).multiplyScalar(0.85 * nightDim);
    cloudMat.emissiveIntensity = 0.95;
    cloudMat.color.copy(WHITE).lerp(C('#1b2740'), atmo.isNight * 0.82);
    cloudMat.opacity = 0.74 + (1 - atmo.isNight) * 0.06 - atmo.isNight * 0.12;

    // dust tint
    dustUniforms.uColor.value.copy(atmo.sunColor).lerp(C('#fff0d4'), 0.5);
    dustUniforms.uOpacity.value = 0.16 + atmo.isNight * 0.40;

    // distant island emissive keeps them readable as silhouettes
    islandsGroup.children.forEach((child) => {
      if (child.material && child.material.emissive) {
        child.material.emissive.copy(atmo.skyHorizon).multiplyScalar(0.20);
        child.material.emissiveIntensity = 0.55;
      }
    });
  }

  function update({ time = 0, dt = 0, speed = 0, timeOfDay = 0.56, reducedMotion = false } = {}) {
    const dtc = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    const motion = reducedMotion ? 0.35 : 1;
    simTime += dtc * motion;

    const atmo = getAtmosphere(timeOfDay);
    applyAtmosphere(atmo);

    skyMat.uniforms.uTime.value = simTime;
    waterUniforms.uTime.value = simTime;
    waterUniforms.uSpeed.value = clamp(speed, 0, 1);
    waterUniforms.uWaveAmp.value = 0.9 + clamp(speed, 0, 1) * 0.25;
    dustUniforms.uTime.value = simTime;

    // clouds drift slowly across the sky
    for (let i = 0; i < cloudData.length; i++) {
      const cloud = cloudData[i];
      cloud.offset += dtc * motion * cloud.speed;
      if (cloud.offset > 70) cloud.offset -= 140;
      if (cloud.offset < -70) cloud.offset += 140;
      cloud.mesh.position.set(cloud.base.x + cloud.offset, cloud.base.y, cloud.base.z);
    }

    // gulls
    for (let i = 0; i < gullData.length; i++) {
      const g = gullData[i];
      const ang = simTime * g.speed + g.phase;
      const px = g.center.x + Math.cos(ang) * g.radius;
      const pz = g.center.z + Math.sin(ang) * g.radius;
      const py = g.center.y + Math.sin(simTime * 0.35 + g.phase) * g.yBob;
      const yaw = -ang - Math.PI / 2;
      const flap = Math.sin(simTime * g.flap + g.phase) * 0.55;
      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, yaw, flap);
      dummy.scale.set(g.scale, g.scale, g.scale);
      dummy.updateMatrix();
      gullLeft.setMatrixAt(i, dummy.matrix);
      dummy.rotation.set(0, yaw, -flap);
      dummy.scale.set(-g.scale, g.scale, g.scale);
      dummy.updateMatrix();
      gullRight.setMatrixAt(i, dummy.matrix);
    }
    gullLeft.instanceMatrix.needsUpdate = true;
    gullRight.instanceMatrix.needsUpdate = true;
    gullMat.opacity = 0.55 + (1 - atmo.isNight) * 0.4;

    // buoys bob
    for (const b of buoyData) {
      const bob = Math.sin(simTime * 0.9 + b.phase) * 0.05;
      b.mesh.position.y = b.base.y + bob;
      b.mesh.rotation.z = Math.sin(simTime * 0.7 + b.phase) * 0.07;
      b.mesh.rotation.x = Math.cos(simTime * 0.8 + b.phase * 1.3) * 0.06;
    }

    // fish jumps + splash rings
    const ringColor = new THREE.Color();
    for (let i = 0; i < fishData.length; i++) {
      const f = fishData[i];
      const local = ((simTime + f.offset) % f.period + f.period) % f.period;
      const jumpDur = 1.05;
      let visible = false;
      if (local < jumpDur) {
        visible = true;
        const p = local / jumpDur;
        const arc = Math.sin(Math.PI * p);
        const x = f.start.x + f.dir.x * f.jumpDist * p;
        const z = f.start.z + f.dir.z * f.jumpDist * p;
        const y = f.start.y + arc * f.jumpHeight + 0.25;
        const pitch = Math.atan2(Math.cos(Math.PI * p) * f.jumpHeight * Math.PI, f.jumpDist) * 0.9;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, Math.atan2(-f.dir.z, f.dir.x), pitch);
        const s = 0.9 + arc * 0.25;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        fishMesh.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.position.set(0, -10, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.updateMatrix();
        fishMesh.setMatrixAt(i, dummy.matrix);
      }
      // splash rings at take-off and landing
      const rings = [
        { t: local, at: 0.0 },
        { t: local - jumpDur, at: 1.0 },
      ];
      for (let r = 0; r < 2; r++) {
        const rg = rings[r];
        const idx = i * 2 + r;
        let scale = 0;
        let alpha = 0;
        if (rg.t >= 0 && rg.t < 1.15) {
          const p = rg.t / 1.15;
          scale = 0.35 + p * 2.5;
          alpha = (1 - p) * (1 - p) * 0.7;
        }
        const bx = f.start.x + f.dir.x * f.jumpDist * rg.at;
        const bz = f.start.z + f.dir.z * f.jumpDist * rg.at;
        dummy.position.set(bx, -0.42, bz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        ringMesh.setMatrixAt(idx, dummy.matrix);
        ringColor.setRGB(alpha, alpha, alpha);
        ringMesh.setColorAt(idx, ringColor);
      }
    }
    fishMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;

    // seagull head idle
    if (gullHeadGroup) {
      gullHeadGroup.rotation.y = Math.sin(simTime * 0.31) * 0.55 + Math.sin(simTime * 1.7) * 0.08;
      gullHeadGroup.rotation.x = Math.sin(simTime * 0.43 + 1.2) * 0.12;
    }

    // lighthouse beam sweep + soft blink
    lighthouseBeamGroup.rotation.y = simTime * 0.55;
    const pulse = 0.65 + 0.35 * Math.sin(simTime * 1.7);
    lighthouseBeamMat.uniforms.uOpacity.value = atmo.isNight * 0.13 * pulse;
    lighthouseGlowMat.opacity = atmo.isNight * (0.55 + 0.25 * pulse);

    // subtle lamp flicker
    if (lampLight.intensity > 0.01) {
      const flick = 1 + Math.sin(simTime * 7.3) * 0.022 + Math.sin(simTime * 17.1 + 1.3) * 0.014;
      lampLight.intensity *= flick;
      lampGlowMat.opacity *= 0.96 + Math.sin(simTime * 5.7) * 0.04;
    }
  }

  /* ---------------- quality / wireframe / dispose ---------------- */
  function setQuality(q) {
    if (q !== 'low' && q !== 'high') return;
    if (q === currentQuality) return;
    currentQuality = q;
    const low = q === 'low';

    // water resolution
    const segs = low ? 88 : 170;
    const oldGeo = water.geometry;
    water.geometry = (() => {
      const g = new THREE.PlaneGeometry(420, 420, segs, segs);
      g.rotateX(-Math.PI / 2);
      return g;
    })();
    oldGeo.dispose();

    // sky resolution
    const skySegs = low ? [28, 20] : [64, 40];
    const oldSkyGeo = sky.geometry;
    sky.geometry = new THREE.SphereGeometry(120, skySegs[0], skySegs[1]);
    oldSkyGeo.dispose();

    // clouds: low quality keeps fewer clusters
    for (let i = 0; i < cloudMeshes.length; i++) {
      cloudMeshes[i].visible = i < (low ? 4 : cloudDefs.length);
    }
    dustGeo.setDrawRange(0, low ? 110 : 220);
    fishMesh.count = low ? 2 : 3;
    ringMesh.count = (low ? 2 : 3) * 2;
    gullLeft.count = low ? 4 : 8;
    gullRight.count = low ? 4 : 8;
  }

  function setWireframe(on) {
    group.traverse((obj) => {
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (noWireframe.has(mat)) continue;
        if ('wireframe' in mat) mat.wireframe = !!on;
      }
    });
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    for (const t of textures) t.dispose();
    textures.length = 0;
  }

  // initial atmosphere so the very first render is already correct
  update({ time: 0, dt: 0, speed: 0, timeOfDay: 0.56, reducedMotion: false });

  return {
    group,
    update,
    setWireframe,
    setQuality,
    dispose,
  };
}
