// PELICAN POST — procedural pelican rider on a vintage bicycle.
// Contract module: createRider({ quality }) -> { group, update, ringBell, setWireframe, setQuality, focus, dispose }
// Everything is procedural geometry + canvas textures. Only `three` is imported.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Small scratch objects (build + update).
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// ---------------------------------------------------------------------------
// canvas texture helper
// ---------------------------------------------------------------------------
function canvasTexture(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.anisotropy = 4;
  return tex;
}

function noise(ctx, w, h, count, colors, minR = 0.5, maxR = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = minR + Math.random() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
function mergeGeoms(geoms) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geoms) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const d = (vo + i) * 3;
      pos[d] = p.getX(i); pos[d + 1] = p.getY(i); pos[d + 2] = p.getZ(i);
      if (n) { nor[d] = n.getX(i); nor[d + 1] = n.getY(i); nor[d + 2] = n.getZ(i); }
      else { nor[d + 1] = 1; }
      if (t) { uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i); }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = vo + g.index.getX(i);
    } else {
      for (let i = 0; i < p.count; i++) idx[io++] = vo + i;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

function tf(geom, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const g = geom.clone();
  _e.set(r[0], r[1], r[2], 'XYZ');
  _q.setFromEuler(_e);
  _m4.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  g.applyMatrix4(_m4);
  return g;
}

function tfMat(geom, matrix) {
  const g = geom.clone();
  g.applyMatrix4(matrix);
  return g;
}

// Place a unit Y-axis geometry (height 1 centred at origin) between two points.
function between(geom, a, b, sx, sz = sx) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  _c.copy(_b).sub(_a).normalize();
  _q.setFromUnitVectors(UP, _c);
  _m4.compose(_v.copy(_a).add(_b).multiplyScalar(0.5), _q, _s.set(sx, len, sz));
  return tfMat(geom, _m4);
}

// Catmull-Rom elongated tube with independent width (z) and height (in-plane) profiles.
function taperedTube(points, profile, tubular = 24, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2] || 0)), false, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const sample = (u) => {
    for (let i = 1; i < profile.length; i++) {
      if (u <= profile[i][0]) {
        const a = profile[i - 1];
        const b = profile[i];
        const t = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
        const et = smoothstep(t);
        return [lerp(a[1], b[1], et), lerp(a[2], b[2], et)];
      }
    }
    const last = profile[profile.length - 1];
    return [last[1], last[2]];
  };
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    const P = curve.getPointAt(u);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const [w, h] = sample(u);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * TAU;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      pos.push(P.x + N.x * c * h + B.x * s * w, P.y + N.y * c * h + B.y * s * w, P.z + N.z * c * h + B.z * s * w);
      _a.set(N.x * c + B.x * s, N.y * c + B.y * s, N.z * c + B.z * s);
      _a.normalize();
      nor.push(_a.x, _a.y, _a.z);
      uvs.push(u, j / radial);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// createRider
// ---------------------------------------------------------------------------
export function createRider({ quality = 'high' } = {}) {
  let high = quality !== 'low';
  const SEG = {
    sphere: high ? 20 : 13,
    sphereH: high ? 14 : 9,
    tubeRadial: high ? 12 : 8,
    tubeTub: high ? 26 : 18,
    wheelSeg: high ? 44 : 30,
    spokes: high ? 24 : 16,
    basketSides: high ? 16 : 10,
    featherCount: high ? 6 : 4,
    sparkles: high ? 12 : 8,
  };

  const group = new THREE.Group();
  group.name = 'pelicanRider';

  const materials = [];
  const textures = [];
  const disposables = []; // extra geometries not in a mesh

  // ---- warm procedural environment cube (makes brass/chrome alive without a scene env map)
  const envCube = (() => {
    const faces = [];
    for (let f = 0; f < 6; f++) {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const ctx = cv.getContext('2d');
      if (f === 2) {
        // +Y : warm bright sky
        const g = ctx.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, '#fff6e0');
        g.addColorStop(1, '#ffcf9c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = 'rgba(255,255,240,0.9)';
        ctx.beginPath(); ctx.arc(40, 20, 9, 0, TAU); ctx.fill();
      } else if (f === 3) {
        // -Y : warm ground bounce
        const g = ctx.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, '#9a6a45');
        g.addColorStop(1, '#5b3a26');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, '#ffd9a6');
        g.addColorStop(0.5, '#ffb47f');
        g.addColorStop(0.62, '#e98c63');
        g.addColorStop(1, '#6f513f');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      }
      faces.push(cv);
    }
    const tex = new THREE.CubeTexture(faces);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    textures.push(tex);
    return tex;
  })();

  // ---- textures
  const beakTex = canvasTexture(256, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffd487');
    g.addColorStop(0.45, '#ffc164');
    g.addColorStop(1, '#e9a044');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // subtle longitudinal striations
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = `rgba(${150 + Math.random() * 60 | 0},${90 + Math.random() * 40 | 0},30,${0.05 + Math.random() * 0.07})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      const y = Math.random() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 8, w * 0.6, y + (Math.random() - 0.5) * 8, w, y);
      ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,240,190,${Math.random() * 0.10})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 0, TAU);
      ctx.fill();
    }
  }, { repeat: [1, 1] });
  textures.push(beakTex);

  const pouchTex = canvasTexture(192, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f6ad55');
    g.addColorStop(0.55, '#ee9540');
    g.addColorStop(1, '#d97e2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(150,80,20,${0.05 + Math.random() * 0.1})`;
      ctx.lineWidth = 0.8 + Math.random() * 1.8;
      const x = Math.random() * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 14, h * 0.5, x + (Math.random() - 0.5) * 20, h);
      ctx.stroke();
    }
    noise(ctx, w, h, 100, ['rgba(255,225,170,0.09)', 'rgba(150,80,25,0.06)'], 1, 3);
  }, { repeat: [1, 1] });
  textures.push(pouchTex);

  const wickerTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a9743c';
    ctx.fillRect(0, 0, w, h);
    const bands = 8;
    const bh = h / bands;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = i % 2 ? '#b8803f' : '#c08a48';
      ctx.fillRect(0, i * bh, w, bh * 0.72);
      ctx.fillStyle = 'rgba(92,56,22,0.42)';
      ctx.fillRect(0, i * bh + bh * 0.72, w, bh * 0.28);
      for (let x = 0; x < w; x += 21) {
        ctx.fillStyle = 'rgba(70,42,16,0.25)';
        ctx.fillRect(x + (i % 2) * 10, i * bh, 5, bh * 0.72);
      }
    }
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = 'rgba(88,54,22,0.18)';
      ctx.fillRect(x, 0, 3.5, h);
    }
    noise(ctx, w, h, 260, ['rgba(255,220,160,0.09)', 'rgba(60,35,10,0.10)'], 0.6, 2);
  }, { repeat: [3, 1] });
  textures.push(wickerTex);

  const chainTex = canvasTexture(96, 24, (ctx, w, h) => {
    ctx.fillStyle = '#2a2724';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.strokeStyle = '#6f6a63';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(x + 8, h / 2, 6.2, 5.0, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,18,16,0.9)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(x + 8, h / 2, 3.1, 2.4, 0, 0, TAU);
      ctx.stroke();
    }
  }, { repeat: [28, 1] });
  textures.push(chainTex);

  const leatherTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#5d3a23';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 900, ['rgba(120,80,50,0.20)', 'rgba(40,22,12,0.22)', 'rgba(160,110,70,0.10)'], 0.4, 1.6);
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = 'rgba(30,16,8,0.08)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + 4, w * 0.7, y - 4, w, y);
      ctx.stroke();
    }
  }, { repeat: [2, 2] });
  textures.push(leatherTex);

  const fishTex = canvasTexture(96, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#b9cdd8');
    g.addColorStop(0.5, '#8fb0c4');
    g.addColorStop(1, '#6d8fa6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) {
      for (let x = 0; x < w; x += 12) {
        ctx.strokeStyle = 'rgba(60,90,115,0.32)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x + (y / 10) % 2 * 6, y, 6, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
    }
    noise(ctx, w, h, 200, ['rgba(255,255,255,0.10)', 'rgba(40,70,90,0.08)'], 0.6, 2);
  }, { repeat: [1, 1] });
  textures.push(fishTex);

  const scarfTex = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#b8342b';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = y % 8 ? 'rgba(255,180,150,0.07)' : 'rgba(90,20,16,0.10)';
      ctx.fillRect(0, y, w, 2);
    }
    noise(ctx, w, h, 120, ['rgba(255,150,120,0.08)'], 0.5, 1.4);
  }, { repeat: [2, 2] });
  textures.push(scarfTex);

  const starTex = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,248,214,1)');
    g.addColorStop(0.25, 'rgba(255,214,128,0.9)');
    g.addColorStop(0.6, 'rgba(255,180,80,0.25)');
    g.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  textures.push(starTex);

  const decalTex = canvasTexture(256, 80, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f4e6c8';
    ctx.font = '600 52px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P E L I', w / 2, h / 2 + 2);
  });
  textures.push(decalTex);

  // ---- materials
  const std = (opts) => { const m = new THREE.MeshStandardMaterial(opts); materials.push(m); return m; };
  const phys = (opts) => { const m = new THREE.MeshPhysicalMaterial(opts); materials.push(m); return m; };

  const M = {
    cream: phys({ color: 0xf3e7cf, roughness: 0.78, metalness: 0.0, sheen: 0.55, sheenRoughness: 0.85, sheenColor: new THREE.Color(0xfff4de) }),
    creamDark: phys({ color: 0xe6d6b8, roughness: 0.8, metalness: 0.0, sheen: 0.4, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xf7e8cc) }),
    black: phys({ color: 0x24211f, roughness: 0.46, metalness: 0.05, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x4a4038) }),
    beak: phys({ color: 0xffffff, map: beakTex, roughness: 0.42, metalness: 0.03, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    pouch: phys({ color: 0xffffff, map: pouchTex, roughness: 0.56, metalness: 0.02, clearcoat: 0.15, clearcoatRoughness: 0.5 }),
    pouchLine: std({ color: 0xb9671f, roughness: 0.6 }),
    eye: phys({ color: 0x17110d, roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMap: envCube, envMapIntensity: 1.4 }),
    iris: phys({ color: 0xb07a1f, roughness: 0.28, metalness: 0.0, clearcoat: 0.7, envMap: envCube, envMapIntensity: 0.9 }),
    sclera: phys({ color: 0xfbf4e6, roughness: 0.30, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.22, envMap: envCube, envMapIntensity: 0.9 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    leather: std({ color: 0xffffff, map: leatherTex, roughness: 0.66, metalness: 0.02 }),
    leatherDark: std({ color: 0x4a2f1d, roughness: 0.62, metalness: 0.04 }),
    strap: std({ color: 0x37241a, roughness: 0.7, metalness: 0.02 }),
    teal: phys({ color: 0x1a8a83, roughness: 0.34, metalness: 0.42, clearcoat: 0.65, clearcoatRoughness: 0.24, envMap: envCube, envMapIntensity: 0.85 }),
    tealDark: phys({ color: 0x116a66, roughness: 0.4, metalness: 0.35, clearcoat: 0.4, envMap: envCube, envMapIntensity: 0.6 }),
    brass: std({ color: 0xd9a94f, roughness: 0.27, metalness: 1.0, envMap: envCube, envMapIntensity: 1.15 }),
    brassDark: std({ color: 0x8a6a32, roughness: 0.42, metalness: 0.9, envMap: envCube, envMapIntensity: 0.9 }),
    steel: std({ color: 0xb4b9bd, roughness: 0.32, metalness: 0.95, envMap: envCube, envMapIntensity: 1.0 }),
    steelDark: std({ color: 0x3a3b3d, roughness: 0.46, metalness: 0.85, envMap: envCube, envMapIntensity: 0.7 }),
    tyre: std({ color: 0xe9dec6, roughness: 0.92, metalness: 0.0 }),
    tyreSide: std({ color: 0xdccfb3, roughness: 0.95, metalness: 0.0 }),
    grip: std({ color: 0x7a5232, roughness: 0.8, metalness: 0.0 }),
    wicker: std({ color: 0xffffff, map: wickerTex, roughness: 0.92, metalness: 0.0 }),
    fish: std({ color: 0xffffff, map: fishTex, roughness: 0.42, metalness: 0.25, envMap: envCube, envMapIntensity: 0.7 }),
    fishFin: std({ color: 0x9fbccd, roughness: 0.55, metalness: 0.2 }),
    scarf: std({ color: 0xffffff, map: scarfTex, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide }),
    scarfWrap: std({ color: 0xffffff, map: scarfTex, roughness: 0.9, metalness: 0.0 }),
    chain: std({ color: 0xffffff, map: chainTex, roughness: 0.45, metalness: 0.9, envMap: envCube, envMapIntensity: 0.7 }),
    chain2: std({ color: 0xffffff, map: chainTex.clone(), roughness: 0.45, metalness: 0.9, envMap: envCube, envMapIntensity: 0.7 }),
    dark: std({ color: 0x201d1a, roughness: 0.55, metalness: 0.3 }),
    glass: phys({ color: 0xbfe0e4, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.35, clearcoat: 1, envMap: envCube, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false }),
    decal: new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  };
  M.chain2.map.needsUpdate = true;
  textures.push(M.chain2.map);
  materials.push(M.glass, M.decal, M.glint);

  // ---- geometry cache (unit primitives; never added to the scene directly)
  const GEO = {
    sphere: new THREE.SphereGeometry(1, SEG.sphere, SEG.sphereH),
    sphereLo: new THREE.SphereGeometry(1, 11, 8),
    cyl: new THREE.CylinderGeometry(1, 1, 1, SEG.tubeRadial, 1),
    cylTaper: new THREE.CylinderGeometry(0.72, 1, 1, SEG.tubeRadial, 1),
    torus: new THREE.TorusGeometry(1, 0.08, 6, 16),
    box: new THREE.BoxGeometry(1, 1, 1),
  };

  function addMerged(parent, geoms, material, opts = {}) {
    if (!geoms.length) return null;
    const geom = mergeGeoms(geoms);
    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = !!opts.receive;
    mesh.name = opts.name || '';
    parent.add(mesh);
    return mesh;
  }

  function pivotAt(parent, x, y, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    const local = new THREE.Group();
    local.position.set(-x, -y, -z);
    pivot.add(local);
    return { pivot, local };
  }

  // =========================================================================
  // BICYCLE
  // =========================================================================
  const bike = new THREE.Group();
  bike.name = 'bicycle';
  group.add(bike);

  const BB = [0, 0.56, 0];
  const REAR_AXLE = [-0.68, 0.42, 0];
  const FRONT_AXLE = [0.68, 0.42, 0];
  const WHEEL_R = 0.42;
  const SEAT_TOP = [-0.155, 0.94, 0];
  const HEAD_TOP = [0.515, 1.005, 0];
  const HEAD_BOT = [0.565, 0.845, 0];
  const CRANK_R = 0.17;
  const PEDAL_Z = 0.145;

  // ---- frame (teal)
  {
    const teal = [];
    teal.push(between(GEO.cyl, BB, SEAT_TOP, 0.027));
    teal.push(between(GEO.cylTaper, SEAT_TOP, HEAD_TOP, 0.024));
    teal.push(between(GEO.cylTaper, HEAD_BOT, BB, 0.028));
    teal.push(between(GEO.cyl, HEAD_TOP, HEAD_BOT, 0.036));
    // chain stays / seat stays
    for (const s of [-1, 1]) {
      teal.push(between(GEO.cyl, [BB[0], BB[1], s * 0.028], [REAR_AXLE[0], REAR_AXLE[1], s * 0.05], 0.014));
      teal.push(between(GEO.cyl, [SEAT_TOP[0], SEAT_TOP[1], s * 0.032], [REAR_AXLE[0], REAR_AXLE[1], s * 0.045], 0.011));
    }
    // fork blades + crown
    for (const s of [-1, 1]) {
      teal.push(between(GEO.cylTaper, [HEAD_BOT[0], HEAD_BOT[1], s * 0.045], [0.645, 0.615, s * 0.055], 0.017));
      teal.push(between(GEO.cylTaper, [0.645, 0.615, s * 0.055], [FRONT_AXLE[0], FRONT_AXLE[1], s * 0.055], 0.014));
    }
    teal.push(between(GEO.box, [HEAD_BOT[0], HEAD_BOT[1] + 0.005, -0.06], [HEAD_BOT[0], HEAD_BOT[1] + 0.005, 0.06], 0.05, 0.05));
    // bottom bracket shell
    teal.push(tf(GEO.cyl, BB, [Math.PI / 2, 0, 0], [0.045, 0.12, 0.045]));
    // fender pinstripes are added below with the fenders
    addMerged(bike, teal, M.teal, { name: 'frame', receive: true });
  }

  // ---- steel: seatpost, handlebar, stem, rails, springs, fender stays
  {
    const steel = [];
    steel.push(between(GEO.cyl, [SEAT_TOP[0], SEAT_TOP[1], 0], [-0.178, 1.015, 0], 0.015));
    // stem + handlebar
    steel.push(between(GEO.cyl, [HEAD_TOP[0], HEAD_TOP[1] + 0.005, 0], [0.503, 1.148, 0], 0.017));
    const barPts = [
      [0.503, 1.148, 0], [0.512, 1.156, 0.085], [0.535, 1.152, 0.175],
      [0.548, 1.138, 0.248], [0.533, 1.122, 0.296],
    ];
    steel.push(taperedTube(barPts, [[0, 0.015, 0.015], [1, 0.015, 0.015]], 14, 8));
    const barPtsL = barPts.map((p) => [p[0], p[1], -p[2]]);
    steel.push(taperedTube(barPtsL, [[0, 0.015, 0.015], [1, 0.015, 0.015]], 14, 8));
    // saddle rails
    for (const s of [-1, 1]) {
      steel.push(between(GEO.cyl, [-0.10, 1.005, s * 0.028], [-0.245, 0.985, s * 0.06], 0.006));
    }
    // saddle springs
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        steel.push(tf(new THREE.TorusGeometry(0.022, 0.005, 5, 10), [-0.238, 0.952 + k * 0.026, s * 0.072], [Math.PI / 2, 0, 0], [1, 1, 1]));
      }
    }
    // fender stays
    for (const s of [-1, 1]) {
      steel.push(between(GEO.cyl, [REAR_AXLE[0], REAR_AXLE[1], s * 0.05], [-0.80, 0.72, s * 0.045], 0.0045));
      steel.push(between(GEO.cyl, [REAR_AXLE[0], REAR_AXLE[1], s * 0.05], [-0.44, 0.80, s * 0.045], 0.0045));
      steel.push(between(GEO.cyl, [FRONT_AXLE[0], FRONT_AXLE[1], s * 0.05], [0.50, 0.80, s * 0.045], 0.0045));
    }
    addMerged(bike, steel, M.steel, { name: 'steel', receive: true });
  }

  // ---- brass: headset, seat clamp, bell mount, basket hooks, saddle rivets
  {
    const brass = [];
    brass.push(tf(new THREE.TorusGeometry(0.041, 0.010, 6, 18), [HEAD_TOP[0], HEAD_TOP[1] - 0.006, 0], [Math.PI / 2, 0, 0.15], [1, 1, 1]));
    brass.push(tf(new THREE.TorusGeometry(0.044, 0.011, 6, 18), [HEAD_BOT[0], HEAD_BOT[1] + 0.006, 0], [Math.PI / 2, 0, 0.15], [1, 1, 1]));
    brass.push(tf(new THREE.TorusGeometry(0.033, 0.008, 6, 16), [SEAT_TOP[0], SEAT_TOP[1], 0], [Math.PI / 2, 0, 0], [1, 1, 1]));
    brass.push(tf(GEO.cyl, [0.548, 1.16, 0.238], [Math.PI / 2, 0, 0], [0.026, 0.03, 0.026]));
    for (const s of [-1, 1]) {
      brass.push(tf(GEO.sphereLo, [-0.245, 0.998, s * 0.032], [0, 0, 0], [0.007, 0.007, 0.007]));
      brass.push(tf(GEO.sphereLo, [-0.245, 0.998, s * 0.088], [0, 0, 0], [0.007, 0.007, 0.007]));
      // basket hooks
      brass.push(between(GEO.cyl, [0.635, 1.145, s * 0.12], [0.60, 1.10, s * 0.135], 0.006));
    }
    addMerged(bike, brass, M.brass, { name: 'brass', receive: true });
  }

  // ---- saddle
  {
    const leather = [];
    leather.push(tf(GEO.sphere, [-0.235, 1.0, 0], [0, 0, 0], [0.098, 0.042, 0.108]));
    leather.push(tf(GEO.sphere, [-0.145, 1.008, 0], [0, 0, 0], [0.075, 0.032, 0.06]));
    leather.push(tf(GEO.sphere, [-0.075, 1.012, 0], [0, 0, 0], [0.062, 0.023, 0.032]));
    addMerged(bike, leather, M.leather, { name: 'saddle', receive: true });
    // cream piping / stitching line around the rear lobe
    const piping = [];
    piping.push(tf(GEO.torus, [-0.235, 1.012, 0], [Math.PI / 2, 0, 0], [0.096, 0.096, 0.075]));
    addMerged(bike, piping, M.creamDark, { name: 'saddlestitch' });
  }

  // ---- grips
  {
    const grips = [];
    for (const s of [-1, 1]) {
      const A = s > 0 ? [0.533, 1.122, 0.296] : [0.533, 1.122, -0.296];
      const B = [0.548 - 0.005, 1.118, 0.30 * s];
      grips.push(between(GEO.cylTaper, [0.560, 1.128, 0.27 * s], [0.520, 1.112, 0.30 * s], 0.022));
    }
    addMerged(bike, grips, M.grip, { name: 'grips' });
  }

  // ---- fenders (cream)
  {
    const fenders = [];
    const ft = new THREE.TorusGeometry(0.452, 0.026, 6, 22, Math.PI * 0.82);
    const rr = new THREE.TorusGeometry(0.452, 0.026, 6, 22, Math.PI * 0.86);
    fenders.push(tf(ft, [FRONT_AXLE[0], FRONT_AXLE[1], 0], [0, 0, Math.PI * 0.10], [1, 1, 1]));
    fenders.push(tf(rr, [REAR_AXLE[0], REAR_AXLE[1], 0], [0, 0, Math.PI * 0.30], [1, 1, 1]));
    addMerged(bike, fenders, M.tyre, { name: 'fenders', receive: true });
  }

  // ---- wheels (geometry authored relative to each axle)
  function buildWheel(axle) {
    const wheel = new THREE.Group();
    wheel.position.set(axle[0], axle[1], 0);
    bike.add(wheel);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.032, high ? 10 : 7, SEG.wheelSeg), M.tyre);
    tyre.castShadow = true;
    tyre.receiveShadow = true;
    wheel.add(tyre);
    // pale sidewall ring
    const side = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.005, 0.012, 5, SEG.wheelSeg), M.tyreSide);
    wheel.add(side);
    // brass rim + hub (+ rear cog)
    const rimGeos = [];
    rimGeos.push(tf(new THREE.TorusGeometry(0.396, 0.0125, 7, SEG.wheelSeg), [0, 0, 0], [0, 0, 0], [1, 1, 1]));
    rimGeos.push(tf(GEO.cyl, [0, 0, 0], [Math.PI / 2, 0, 0], [0.038, 0.105, 0.038]));
    rimGeos.push(tf(GEO.cyl, [0, 0, 0], [Math.PI / 2, 0, 0], [0.052, 0.055, 0.052]));
    if (Math.abs(axle[0] - REAR_AXLE[0]) < 0.01) {
      // rear cog (drives with wheel)
      rimGeos.push(tf(new THREE.TorusGeometry(0.055, 0.008, 5, 14), [0, 0, 0.062], [0, 0, 0], [1, 1, 1]));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        rimGeos.push(tf(GEO.box, [0.055 * Math.cos(a), 0.055 * Math.sin(a), 0.062], [0, 0, a], [0.012, 0.012, 0.012]));
      }
    }
    const rim = new THREE.Mesh(mergeGeoms(rimGeos), M.brass);
    rim.castShadow = true;
    wheel.add(rim);
    // spokes + axle
    const spokeGeos = [];
    for (let i = 0; i < SEG.spokes; i++) {
      const a = (i / SEG.spokes) * TAU + (i % 2 ? 0.06 : 0);
      const mid = [Math.cos(a) * 0.215, Math.sin(a) * 0.215, 0];
      spokeGeos.push(tf(GEO.cyl, mid, [0, 0, a - Math.PI / 2], [0.0032, 0.375, 0.0032]));
    }
    spokeGeos.push(tf(GEO.cyl, [0, 0, 0], [Math.PI / 2, 0, 0], [0.008, 0.16, 0.008]));
    // tiny valve
    spokeGeos.push(tf(GEO.cyl, [0, 0.385, 0], [0, 0, 0], [0.006, 0.03, 0.006]));
    const spokes = new THREE.Mesh(mergeGeoms(spokeGeos), M.steel);
    spokes.castShadow = true;
    wheel.add(spokes);
    return { pivot: wheel };
  }
  const wheelRear = buildWheel(REAR_AXLE);
  const wheelFront = buildWheel(FRONT_AXLE);

  // ---- crank, chainring, pedals (geometry authored relative to the bottom bracket)
  const crank = { pivot: new THREE.Group() };
  crank.pivot.position.set(BB[0], BB[1], 0);
  bike.add(crank.pivot);
  const pedals = [];
  {
    const brass = [];
    brass.push(tf(GEO.torus, [0, 0, 0.062], [0, 0, 0], [0.118, 0.118, 0.16]));
    brass.push(tf(GEO.torus, [0, 0, 0.062], [0, 0, 0], [0.075, 0.075, 0.25]));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      brass.push(between(GEO.box, [0, 0, 0.062], [Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0.062], 0.014, 0.014));
    }
    // teeth
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      brass.push(tf(GEO.box, [Math.cos(a) * 0.127, Math.sin(a) * 0.127, 0.062], [0, 0, a], [0.008, 0.012, 0.014]));
    }
    // centre + crank bolt
    brass.push(tf(GEO.cyl, [0, 0, 0.062], [Math.PI / 2, 0, 0], [0.03, 0.035, 0.03]));
    const ring = new THREE.Mesh(mergeGeoms(brass), M.brass);
    ring.castShadow = true;
    crank.pivot.add(ring);

    const arms = [];
    for (const s of [-1, 1]) {
      arms.push(between(GEO.cylTaper, [0, 0, s * 0.078], [s * CRANK_R, 0, s * 0.078], 0.012));
      arms.push(tf(GEO.cyl, [s * CRANK_R, 0, s * 0.078], [Math.PI / 2, 0, 0], [0.012, 0.075, 0.012]));
    }
    const armMesh = new THREE.Mesh(mergeGeoms(arms), M.steelDark);
    armMesh.castShadow = true;
    crank.pivot.add(armMesh);

    // pedals: child pivots counter-rotate so the platforms stay level
    for (const s of [-1, 1]) {
      const pedalPivot = new THREE.Group();
      pedalPivot.position.set(s * CRANK_R, 0, s * PEDAL_Z);
      crank.pivot.add(pedalPivot);
      const bodyGeos = [];
      bodyGeos.push(tf(GEO.box, [0, 0, 0], [0, 0, 0], [0.115, 0.024, 0.075]));
      bodyGeos.push(tf(GEO.cyl, [0, 0, 0], [Math.PI / 2, 0, 0], [0.009, 0.16, 0.009]));
      const bodyMesh = new THREE.Mesh(mergeGeoms(bodyGeos), M.dark);
      bodyMesh.castShadow = true;
      pedalPivot.add(bodyMesh);
      const reflector = new THREE.Mesh(tf(GEO.box, [0, 0, -0.04 * s], [0, 0, 0], [0.075, 0.018, 0.006]), M.creamDark);
      pedalPivot.add(reflector);
      pedals.push({ pivot: pedalPivot, side: s });
    }
  }

  // ---- chain (textured runs)
  {
    const topA = [BB[0], BB[1] + 0.118, 0.062];
    const topB = [REAR_AXLE[0], REAR_AXLE[1] + 0.055, 0.062];
    const botA = [BB[0], BB[1] - 0.118, 0.062];
    const botB = [REAR_AXLE[0], REAR_AXLE[1] - 0.055, 0.062];
    const upper = new THREE.Mesh(between(GEO.box, topA, topB, 0.018, 0.011), M.chain);
    upper.castShadow = false;
    const lower = new THREE.Mesh(between(GEO.box, botA, botB, 0.018, 0.011), M.chain2);
    lower.castShadow = false;
    bike.add(upper, lower);
  }

  // ---- chainguard + PELI decal
  {
    const shape = new THREE.Shape();
    shape.moveTo(0.115, 0.665);
    shape.quadraticCurveTo(-0.18, 0.70, -0.53, 0.585);
    shape.quadraticCurveTo(-0.62, 0.55, -0.55, 0.515);
    shape.quadraticCurveTo(-0.18, 0.575, 0.08, 0.575);
    shape.quadraticCurveTo(0.16, 0.60, 0.115, 0.665);
    const guardGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, steps: 1 });
    const guard = new THREE.Mesh(guardGeo, M.tealDark);
    guard.position.z = 0.093;
    guard.castShadow = true;
    bike.add(guard);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.068), M.decal);
    decal.position.set(-0.245, 0.607, 0.1085);
    decal.rotation.z = 0.075;
    bike.add(decal);
  }

  // ---- bell
  const bell = (() => {
    const pivot = new THREE.Group();
    pivot.position.set(0.528, 1.178, 0.246);
    bike.add(pivot);
    const base = new THREE.Mesh(tf(GEO.cyl, [0, 0, 0], [Math.PI / 2, 0, 0], [0.033, 0.03, 0.033]), M.brassDark);
    pivot.add(base);
    const domeGeo = new THREE.SphereGeometry(0.042, 16, 10, 0, TAU, 0, Math.PI * 0.62);
    const dome = new THREE.Mesh(domeGeo, M.brass);
    dome.position.y = 0.008;
    dome.castShadow = true;
    pivot.add(dome);
    const lever = new THREE.Mesh(tf(GEO.cyl, [0.035, 0.005, 0], [0, 0, Math.PI / 2], [0.005, 0.045, 0.005]), M.brassDark);
    pivot.add(lever);
    return { pivot, dome, lever };
  })();

  // bell sparkles
  const sparkleGeo = new THREE.BufferGeometry();
  {
    const arr = [];
    for (let i = 0; i < SEG.sparkles; i++) {
      const a = (i / SEG.sparkles) * TAU;
      arr.push(Math.cos(a) * 0.075, 0.03 + Math.random() * 0.05, Math.sin(a) * 0.075);
    }
    sparkleGeo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  }
  const sparkleMat = new THREE.PointsMaterial({
    size: 0.055, map: starTex, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xffe6a8, sizeAttenuation: true,
  });
  materials.push(sparkleMat);
  const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
  sparkles.position.set(0.528, 1.19, 0.246);
  sparkles.visible = false;
  bike.add(sparkles);

  // ---- front basket + fish
  const basket = new THREE.Group();
  basket.position.set(0.715, 1.015, 0);
  bike.add(basket);
  {
    const sides = SEG.basketSides;
    const bodyGeo = new THREE.CylinderGeometry(0.155, 0.125, 0.185, sides, 1, true);
    const body = new THREE.Mesh(bodyGeo, M.wicker);
    body.castShadow = true;
    body.receiveShadow = true;
    basket.add(body);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.126, sides), M.wicker);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -0.092;
    basket.add(bottom);
    // brass rim + band
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 6, sides), M.brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.092;
    basket.add(rim);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.143, 0.007, 5, sides), M.brassDark);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.005;
    basket.add(band);
    // hooks to the handlebar (local coords around basket)
    const hooks = [];
    hooks.push(between(GEO.cyl, [-0.05, 0.08, -0.12], [-0.13, 0.115, -0.09], 0.006));
    hooks.push(between(GEO.cyl, [0.05, 0.08, -0.12], [-0.03, 0.115, -0.09], 0.006));
    hooks.push(between(GEO.cyl, [-0.05, 0.08, 0.12], [-0.13, 0.115, 0.09], 0.006));
    hooks.push(between(GEO.cyl, [0.05, 0.08, 0.12], [-0.03, 0.115, 0.09], 0.006));
    addMerged(basket, hooks, M.brassDark, { name: 'basketHooks' });
  }
  const fishGroup = new THREE.Group();
  basket.add(fishGroup);
  const fishTails = [];
  {
    // one little fish body peeking over the rim
    const body = new THREE.Mesh(tf(GEO.sphere, [0.02, 0.115, -0.035], [0.1, 0.4, 0.25], [0.052, 0.075, 0.038]), M.fish);
    body.castShadow = true;
    fishGroup.add(body);
    const eye = new THREE.Mesh(tf(GEO.sphereLo, [0.058, 0.135, -0.058], [0, 0, 0], [0.009, 0.009, 0.009]), M.dark);
    fishGroup.add(eye);
    for (const s of [-1, 1]) {
      const tailPivot = new THREE.Group();
      tailPivot.position.set(s * 0.055, 0.155, 0.02 * s);
      fishGroup.add(tailPivot);
      const finGeos = [];
      finGeos.push(tf(GEO.sphere, [0, 0.055, 0], [0, 0, 0], [0.016, 0.075, 0.008]));
      finGeos.push(tf(GEO.sphere, [-0.026, 0.045, 0], [0, 0, 0.55], [0.013, 0.052, 0.007]));
      finGeos.push(tf(GEO.sphere, [0.026, 0.045, 0], [0, 0, -0.55], [0.013, 0.052, 0.007]));
      const fin = new THREE.Mesh(mergeGeoms(finGeos), M.fishFin);
      fin.castShadow = true;
      tailPivot.add(fin);
      fishTails.push({ pivot: tailPivot, phase: s * 1.7 });
    }
  }

  // =========================================================================
  // PELICAN
  // =========================================================================
  const pelican = new THREE.Group();
  pelican.name = 'pelican';
  group.add(pelican);

  // Body pivot follows the saddle; nested "local" keeps absolute authoring coords.
  const bodyRig = pivotAt(pelican, -0.02, 1.16, 0);
  const bodyPivot = bodyRig.pivot;
  const bodyLocal = bodyRig.local;

  const bodyProfile = [
    [0.012, 0.0], [0.075, 0.045], [0.15, 0.13], [0.205, 0.26], [0.232, 0.40],
    [0.238, 0.54], [0.225, 0.67], [0.195, 0.78], [0.155, 0.875], [0.10, 0.945], [0.035, 1.0],
  ];
  const bodyGeo = (() => {
    const lathe = new THREE.LatheGeometry(bodyProfile.map((p) => new THREE.Vector2(p[0], p[1])), SEG.sphere);
    const g = tf(lathe, [-0.41, 1.17, 0], [0, 0, -0.62], [1.20, 0.88, 0.76]);
    return g;
  })();
  const chestGeo = tf(GEO.sphere, [0.07, 1.80, 0], [0, 0, -0.5], [0.205, 0.235, 0.178]);
  const rumpGeo = tf(GEO.sphere, [-0.315, 1.16, 0], [0, 0, 0], [0.245, 0.155, 0.20]);
  const shoulderL = tf(GEO.sphere, [-0.01, 1.69, 0.15], [0, 0, 0], [0.15, 0.12, 0.10]);
  const shoulderR = tf(GEO.sphere, [-0.01, 1.69, -0.15], [0, 0, 0], [0.15, 0.12, 0.10]);
  addMerged(bodyLocal, [bodyGeo, chestGeo, rumpGeo, shoulderL, shoulderR], M.cream, { name: 'body', receive: true });

  // ---- tail
  const tailRig = pivotAt(bodyLocal, -0.40, 1.19, 0);
  {
    const creamFeathers = [];
    const blackTips = [];
    for (let i = -2; i <= 2; i++) {
      const t = i / 2;
      const base = [-0.40, 1.20, t * 0.035];
      const angle = -0.22 + t * 0.10;
      const dir = [-Math.cos(angle) * 0.34, -Math.sin(angle) * 0.34, t * 0.12];
      const mid = [base[0] + dir[0] * 0.5, base[1] + dir[1] * 0.5, base[2] + dir[2] * 0.5];
      creamFeathers.push(tf(GEO.sphere, mid, [0, t * 0.35, angle], [0.19, 0.042, 0.045]));
      blackTips.push(tf(GEO.sphere, [base[0] + dir[0] * 1.02, base[1] + dir[1] * 1.02, base[2] + dir[2] * 1.02], [0, t * 0.35, angle], [0.075, 0.033, 0.038]));
    }
    addMerged(tailRig.local, creamFeathers, M.cream, { name: 'tail' });
    addMerged(tailRig.local, blackTips, M.black, { name: 'tailtips' });
  }

  // ---- wings
  function buildWing(side) {
    const S = [-0.005, 1.685, side * 0.145];
    const E = [0.275, 1.415, side * 0.245];
    const W = [0.485, 1.175, side * 0.293];
    const H = [0.525, 1.128, side * 0.300];
    const rig = pivotAt(bodyLocal, S[0], S[1], S[2]);
    const cream = [];
    const black = [];
    // arm
    cream.push(taperedTube([S, [0.14, 1.56, side * 0.20], E, W], [
      [0, 0.105, 0.115], [0.35, 0.085, 0.10], [0.7, 0.058, 0.075], [1.0, 0.040, 0.055],
    ], SEG.tubeTub, SEG.tubeRadial));
    // shoulder covert mass
    cream.push(tf(GEO.sphere, [0.03, 1.65, side * 0.185], [0, 0, 0], [0.15, 0.135, 0.075]));
    cream.push(tf(GEO.sphere, [0.16, 1.55, side * 0.215], [0, 0, -0.6], [0.12, 0.085, 0.055]));
    // hand wrapping the grip
    cream.push(tf(GEO.sphere, H, [0, 0, 0], [0.062, 0.055, 0.058]));
    cream.push(tf(GEO.sphere, [0.55, 1.115, side * 0.295], [0, 0, 0], [0.042, 0.038, 0.04]));
    // primary feathers fanning back + down
    const n = SEG.featherCount;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const rootT = 0.25 + t * 0.75;
      const rx = lerp(E[0], W[0], rootT);
      const ry = lerp(E[1], W[1], rootT) - 0.02;
      const rz = side * (lerp(E[2], W[2], rootT) + 0.015);
      const len = lerp(0.26, 0.44, t);
      const ang = Math.PI * 0.80 + t * 0.48;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang) * 0.55 - 0.22;
      const dz = side * 0.10;
      const dl = Math.hypot(dx, dy, dz);
      const ux = dx / dl;
      const uy = dy / dl;
      const uz = dz / dl;
      const mid = [rx + ux * len * 0.5, ry + uy * len * 0.5, rz + uz * len * 0.5];
      const rotZ = Math.atan2(uy, ux);
      const yaw = side * (0.10 + t * 0.22);
      cream.push(tf(GEO.sphere, mid, [0, yaw, rotZ], [len * 0.52, 0.043, 0.020]));
      // black distal section
      const tipC = [rx + ux * len * 0.86, ry + uy * len * 0.86, rz + uz * len * 0.86];
      black.push(tf(GEO.sphere, tipC, [0, yaw, rotZ], [len * 0.21, 0.034, 0.016]));
      // layered covert feather on top
      if (i < n - 1) {
        const cl = len * 0.62;
        const cm = [rx + ux * cl * 0.42 - 0.02 * side * 0, ry + uy * cl * 0.42 + 0.035, rz + uz * cl * 0.42 + side * 0.012];
        cream.push(tf(GEO.sphere, cm, [0, yaw * 1.3, rotZ], [cl * 0.5, 0.036, 0.014]));
      }
    }
    addMerged(rig.local, cream, M.cream, { name: 'wing' });
    addMerged(rig.local, black, M.black, { name: 'wingtips' });
    return rig;
  }
  const wingL = buildWing(1);
  const wingR = buildWing(-1);

  // ---- head rig
  const headRig = pivotAt(bodyLocal, 0.10, 1.86, 0);
  const headPivot = headRig.pivot;
  const headLocal = headRig.local;

  // neck + head + cheeks
  {
    const cream = [];
    cream.push(taperedTube([
      [0.055, 1.78, 0], [0.11, 1.855, 0], [0.175, 1.935, 0], [0.235, 2.005, 0], [0.285, 2.06, 0],
    ], [
      [0, 0.155, 0.16], [0.32, 0.132, 0.135], [0.62, 0.118, 0.12], [0.85, 0.112, 0.115], [1, 0.12, 0.12],
    ], SEG.tubeTub, SEG.tubeRadial));
    cream.push(tf(GEO.sphere, [0.30, 2.10, 0], [0, 0, 0], [0.218, 0.198, 0.186]));
    // cheek / brow ridges around the eyes
    for (const s of [-1, 1]) {
      cream.push(tf(GEO.sphere, [0.405, 2.195, s * 0.105], [0, s * -0.25, 0], [0.077, 0.052, 0.068]));
      cream.push(tf(GEO.sphere, [0.355, 2.045, s * 0.135], [0, 0, 0], [0.09, 0.075, 0.06]));
    }
    // little crest tuft at the back of the head
    for (let i = 0; i < 3; i++) {
      cream.push(tf(GEO.sphere, [0.16 + i * 0.012, 2.22 + i * 0.012, (i - 1) * 0.035], [0, 0, 0.9], [0.06, 0.022, 0.028]));
    }
    addMerged(headLocal, cream, M.cream, { name: 'head', receive: true });
  }

  // ---- beak (upper mandible)
  {
    const pts = [
      [0.395, 2.118, 0], [0.555, 2.117, 0], [0.715, 2.112, 0], [0.865, 2.103, 0],
      [0.972, 2.090, 0], [1.022, 2.058, 0], [1.045, 2.014, 0],
    ];
    const prof = [
      [0, 0.114, 0.080], [0.16, 0.110, 0.068], [0.36, 0.098, 0.056], [0.58, 0.079, 0.045],
      [0.76, 0.056, 0.035], [0.90, 0.031, 0.024], [0.97, 0.016, 0.014], [1.0, 0.004, 0.004],
    ];
    const beakGeo = taperedTube(pts, prof, SEG.tubeTub + 6, SEG.tubeRadial + 2);
    const beakMesh = new THREE.Mesh(beakGeo, M.beak);
    beakMesh.castShadow = true;
    beakMesh.receiveShadow = true;
    headLocal.add(beakMesh);
    // nostril grooves
    const darks = [];
    for (const s of [-1, 1]) {
      darks.push(tf(GEO.sphereLo, [0.505, 2.128, s * 0.040], [0, 0, 0], [0.020, 0.007, 0.007]));
    }
    addMerged(headLocal, darks, M.dark, { name: 'nostrils', cast: false });
    // mouth line
    // dark rim where the mandible overhangs the pouch
    const mouth = new THREE.Mesh(taperedTube([
      [0.445, 2.078, 0], [0.64, 2.066, 0], [0.84, 2.048, 0], [0.985, 2.030, 0], [1.038, 2.020, 0],
    ], [[0, 0.0062, 0.0048], [0.55, 0.0055, 0.0042], [1, 0.0022, 0.002]], 22, 6), M.pouchLine);
    headLocal.add(mouth);
  }

  // ---- gular pouch (jiggles)
  const pouchRig = pivotAt(headLocal, 0.44, 2.052, 0);
  {
    const pts = [
      [0.415, 2.052, 0], [0.525, 2.004, 0], [0.665, 1.958, 0], [0.805, 1.936, 0],
      [0.925, 1.954, 0], [1.000, 1.992, 0], [1.036, 2.016, 0],
    ];
    const prof = [
      [0, 0.078, 0.055], [0.15, 0.106, 0.088], [0.34, 0.132, 0.104], [0.55, 0.126, 0.096],
      [0.74, 0.098, 0.068], [0.90, 0.052, 0.033], [1.0, 0.010, 0.009],
    ];
    const pouchGeo = taperedTube(pts, prof, SEG.tubeTub + 4, SEG.tubeRadial + 2);
    const pouch = new THREE.Mesh(pouchGeo, M.pouch);
    pouch.castShadow = true;
    pouch.receiveShadow = true;
    pouchRig.local.add(pouch);
    // throat joining the pouch to the neck
    const throat = new THREE.Mesh(taperedTube([
      [0.43, 2.06, 0], [0.40, 1.99, 0], [0.355, 1.93, 0], [0.32, 1.88, 0],
    ], [[0, 0.085, 0.07], [0.5, 0.105, 0.085], [1, 0.13, 0.10]], 16, SEG.tubeRadial), M.pouch);
    throat.castShadow = true;
    pouchRig.local.add(throat);
    // soft sag/fold line along the pouch
    const fold = new THREE.Mesh(taperedTube([
      [0.545, 1.992, 0], [0.665, 1.955, 0], [0.805, 1.946, 0], [0.925, 1.962, 0],
    ], [[0, 0.0042, 0.0032], [0.6, 0.0036, 0.0028], [1, 0.0018, 0.0016]], 16, 5), M.pouchLine);
    pouchRig.local.add(fold);
  }

  // ---- eyes / eyelid rigs
  const eyeRigs = [];
  const eyeScleraGeos = [];
  const eyeIrisGeos = [];
  const eyeBallGeos = [];
  const eyeGlintGeos = [];
  const eyeUp = new THREE.Vector3(0, 1, 0);
  function buildEye(side) {
    const dir = new THREE.Vector3(0.66, 0.16, side * 0.73).normalize();
    const c = new THREE.Vector3(0.442, 2.178, side * 0.127);
    // big glossy cream sclera bulging from the head
    eyeScleraGeos.push(tf(GEO.sphere, c.toArray(), [0, 0, 0], [0.051, 0.049, 0.045]));
    // amber iris disc facing the gaze direction
    const irisM = new THREE.Matrix4().compose(
      c.clone().addScaledVector(dir, 0.036),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir),
      new THREE.Vector3(0.038, 0.038, 0.021)
    );
    eyeIrisGeos.push(tfMat(GEO.sphere, irisM));
    // dark pupil
    const pupilM = new THREE.Matrix4().compose(
      c.clone().addScaledVector(dir, 0.049),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir),
      new THREE.Vector3(0.0255, 0.0255, 0.013)
    );
    eyeBallGeos.push(tfMat(GEO.sphere, pupilM));
    // catchlights (emissive white)
    eyeGlintGeos.push(tf(GEO.sphereLo, c.clone().addScaledVector(dir, 0.060).addScaledVector(eyeUp, 0.015).toArray(), [0, 0, 0], [0.0080, 0.0080, 0.006]));
    eyeGlintGeos.push(tf(GEO.sphereLo, c.clone().addScaledVector(dir, 0.060).addScaledVector(eyeUp, -0.012).addScaledVector(dir, -0.006).toArray(), [0, 0, 0], [0.0038, 0.0038, 0.0032]));

    // eyelid: rotating dome around the eye
    const lidPivot = new THREE.Group();
    lidPivot.position.copy(c);
    headLocal.add(lidPivot);
    const lidGeo = new THREE.SphereGeometry(0.058, 16, 10, 0, TAU, 0, Math.PI * 0.58);
    const lid = new THREE.Mesh(lidGeo, M.sclera);
    lid.castShadow = false;
    lidPivot.add(lid);
    const base = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    eyeRigs.push({ pivot: lidPivot, base, side });
  }
  buildEye(1);
  buildEye(-1);
  addMerged(headLocal, eyeScleraGeos, M.sclera, { name: 'sclera', cast: false });
  addMerged(headLocal, eyeIrisGeos, M.iris, { name: 'iris', cast: false });
  addMerged(headLocal, eyeBallGeos, M.eye, { name: 'eyeball', cast: false });
  addMerged(headLocal, eyeGlintGeos, M.glint, { name: 'catchlight', cast: false });

  // ---- leather aviator cap, ear flaps, strap
  {
    const cap = [];
    const dome = new THREE.SphereGeometry(0.228, 24, 14, 0, TAU, 0, Math.PI * 0.40);
    cap.push(tf(dome, [0.288, 2.165, 0], [0.10, 0, -0.05], [1.03, 0.96, 1.0]));
    // back-of-head flap and ear flaps
    cap.push(tf(GEO.sphere, [0.185, 2.12, 0], [0.1, 0, 0], [0.135, 0.125, 0.15]));
    for (const s of [-1, 1]) {
      cap.push(tf(GEO.sphere, [0.285, 2.075, s * 0.196], [0.15, s * 0.15, 0], [0.072, 0.105, 0.040]));
      cap.push(tf(GEO.sphere, [0.272, 2.005, s * 0.176], [0.1, 0, s * 0.2], [0.05, 0.045, 0.032]));
    }
    addMerged(headLocal, cap, M.leather, { name: 'cap', receive: true });
    // cap trim band + buckle
    const straps = [];
    straps.push(tf(new THREE.TorusGeometry(0.209, 0.011, 6, 22), [0.288, 2.232, 0], [Math.PI / 2, 0, 0.05], [1, 1, 1]));
    straps.push(tf(GEO.box, [0.30, 2.05, 0.205], [0, 0, 0.1], [0.028, 0.02, 0.012]));
    addMerged(headLocal, straps, M.strap, { name: 'capstraps' });
  }

  // ---- goggles pushed up on the cap
  {
    const brass = [];
    const glass = [];
    const strap = [];
    for (const s of [-1, 1]) {
      const lensPos = [0.443, 2.298, s * 0.088];
      // rings tilted back to rest on the cap
      brass.push(tf(new THREE.TorusGeometry(0.058, 0.013, 7, 22), lensPos, [-1.05, 0, s * 0.06], [1, 1, 1]));
      brass.push(tf(new THREE.TorusGeometry(0.040, 0.008, 6, 18), lensPos, [-1.05, 0, s * 0.06], [1, 1, 1]));
      glass.push(tf(GEO.sphere, [0.438, 2.291, s * 0.088], [-1.05, 0, s * 0.06], [0.046, 0.046, 0.012]));
    }
    // bridge
    brass.push(between(GEO.cyl, [0.445, 2.306, -0.046], [0.445, 2.306, 0.046], 0.010));
    // goggle strap around the cap
    strap.push(tf(new THREE.TorusGeometry(0.185, 0.014, 6, 24), [0.288, 2.298, 0], [Math.PI / 2, 0, 0], [1, 1, 0.92]));
    addMerged(headLocal, brass, M.brass, { name: 'goggles' });
    addMerged(headLocal, glass, M.glass, { name: 'goggleGlass', cast: false });
    addMerged(headLocal, strap, M.strap, { name: 'goggleStrap' });
  }

  // ---- scarf (wrap + knot + streaming ribbons)
  {
    const wrap = [];
    wrap.push(tf(new THREE.TorusGeometry(0.148, 0.040, 8, 22), [0.175, 1.935, 0], [Math.PI / 2, 0, -0.68], [1, 1, 1]));
    wrap.push(tf(new THREE.TorusGeometry(0.152, 0.034, 8, 22), [0.158, 1.90, 0], [Math.PI / 2, 0, -0.58], [1, 1, 1]));
    addMerged(headLocal, wrap, M.scarfWrap, { name: 'scarfWrap' });
    const knot = new THREE.Mesh(tf(GEO.sphere, [0.085, 1.865, -0.145], [0, 0, 0], [0.055, 0.05, 0.05]), M.scarfWrap);
    knot.castShadow = true;
    bodyLocal.add(knot);
  }

  // dynamic scarf ribbons
  const ribbons = [];
  function makeRibbon(phase, length, width, offset) {
    const N = high ? 12 : 9;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((N + 1) * 2 * 3);
    const normals = new Float32Array((N + 1) * 2 * 3);
    const uvs = new Float32Array((N + 1) * 2 * 2);
    const indices = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(indices);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(-0.3, 1.9, 0), 1.2);
    const mesh = new THREE.Mesh(geo, M.scarf);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    bodyLocal.add(mesh);
    ribbons.push({ mesh, geo, phase, length, width, offset, N });
    return { mesh, geo, N };
  }
  makeRibbon(0.0, 0.72, 0.115, 0);
  makeRibbon(2.1, 0.58, 0.095, 1);

  function updateRibbon(r, time, isMoving, motion) {
    const { geo, N, length, width, phase, offset } = r;
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const segLen = length / N;
    // integrated flowing spine
    let x = 0.085 + offset * 0.01;
    let y = 1.855;
    let z = -0.145 - offset * 0.02;
    let dx = -0.92;
    let dy = 0.30;
    let dz = -0.22;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      if (i > 0) {
        x += dx * segLen;
        y += dy * segLen;
        z += dz * segLen;
      }
      // wind / waves: growing towards the tip, stronger when moving
      const wave = Math.sin(time * (1.6 + isMoving * 2.4) - u * 4.0 + phase) * (0.055 + 0.15 * isMoving) * motion;
      const wave2 = Math.cos(time * 1.15 - u * 2.2 + phase * 1.7) * 0.05 * motion;
      const droop = 0.55 * (0.25 + 0.75 * u);
      let tdx = -0.92 + wave * 0.5;
      let tdy = 0.12 + droop * -0.25 + wave2 * 0.7;
      let tdz = -0.22 + wave * 1.4 + wave2;
      if (i > 0) {
        // smooth the direction update
        dx = lerp(dx, tdx, 0.34);
        dy = lerp(dy, tdy, 0.34);
        dz = lerp(dz, tdz, 0.34);
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
      // lateral direction roughly z with a twist
      const twist = Math.sin(time * 2.6 - u * 5.0 + phase) * 0.5 * u * motion;
      const latX = 0.0;
      const latY = Math.sin(twist) * 0.9;
      const latZ = Math.cos(twist);
      const w = width * (1.0 - u * 0.72) + 0.012;
      const cx = x + (offset ? 0.02 : -0.02) * Math.sin(u * 3);
      const cy = y + (offset ? -0.01 : 0.012) * u;
      const cz = z;
      const i0 = i * 6;
      pos[i0] = cx + latX * w * 0.5;
      pos[i0 + 1] = cy + latY * w * 0.5;
      pos[i0 + 2] = cz + latZ * w * 0.5;
      pos[i0 + 3] = cx - latX * w * 0.5;
      pos[i0 + 4] = cy - latY * w * 0.5;
      pos[i0 + 5] = cz - latZ * w * 0.5;
      // normal from tangent x lateral (approx lateral x tangent)
      const nx = dy * latZ - dz * latY;
      const ny = dz * latX - dx * latZ;
      const nz = dx * latY - dy * latX;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const nx2 = -nx / nl;
      const ny2 = -ny / nl;
      const nz2 = -nz / nl;
      nor[i0] = nx2; nor[i0 + 1] = ny2; nor[i0 + 2] = nz2;
      nor[i0 + 3] = nx2; nor[i0 + 4] = ny2; nor[i0 + 5] = nz2;
      const uvI = i * 4;
      geo.attributes.uv.array[uvI] = 0;
      geo.attributes.uv.array[uvI + 1] = u;
      geo.attributes.uv.array[uvI + 2] = 1;
      geo.attributes.uv.array[uvI + 3] = u;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
  }

  // ---- legs (2-bone IK, meshes in rider-root space)
  const legGeo = (() => {
    const thigh = mergeGeoms([
      // unit-space limb: top at y=0, bottom at y=-1
      tf(GEO.cylTaper, [0, -0.5, 0], [0, 0, 0], [0.075, 1, 0.075]),
      tf(GEO.sphere, [0, 0, 0], [0, 0, 0], [0.082, 0.07, 0.078]),
      tf(GEO.sphere, [0, -1, 0], [0, 0, 0], [0.062, 0.058, 0.06]),
    ]);
    const shin = mergeGeoms([
      tf(GEO.cylTaper, [0, -0.5, 0], [0, 0, 0], [0.055, 1, 0.055]),
      tf(GEO.sphere, [0, 0, 0], [0, 0, 0], [0.06, 0.055, 0.058]),
      tf(GEO.sphere, [0, -0.94, 0], [0, 0, 0], [0.052, 0.048, 0.05]),
      tf(GEO.cyl, [0, -0.98, 0.012], [0, 0, 0], [0.042, 0.055, 0.042]),
    ]);
    return { thigh, shin };
  })();
  // webbed foot geometry (flat, toes forward +X)
  const footGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.055, -0.028);
    s.quadraticCurveTo(0.01, -0.062, 0.055, -0.075);
    s.quadraticCurveTo(0.10, -0.082, 0.155, -0.082);
    s.quadraticCurveTo(0.185, -0.080, 0.175, -0.042);
    s.quadraticCurveTo(0.168, -0.012, 0.148, -0.005);
    s.quadraticCurveTo(0.185, 0.0, 0.19, 0.035);
    s.quadraticCurveTo(0.172, 0.048, 0.152, 0.043);
    s.quadraticCurveTo(0.16, 0.062, 0.14, 0.075);
    s.quadraticCurveTo(0.10, 0.08, 0.05, 0.068);
    s.quadraticCurveTo(0.0, 0.058, -0.055, 0.028);
    s.quadraticCurveTo(-0.072, 0.0, -0.055, -0.028);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.017, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 1, steps: 1, curveSegments: 8 });
    // shape is in XY -> rotate so it lies flat with +Y up, toes +X
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.008, 0);
    return g;
  })();
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Mesh(legGeo.thigh, M.beak);
    thigh.castShadow = true;
    thigh.receiveShadow = true;
    const shin = new THREE.Mesh(legGeo.shin, M.beak);
    shin.castShadow = true;
    shin.receiveShadow = true;
    pelican.add(thigh, shin);
    const foot = new THREE.Mesh(footGeo, M.pouch);
    foot.castShadow = true;
    foot.receiveShadow = true;
    const footPivot = new THREE.Group();
    footPivot.add(foot);
    pelican.add(footPivot);
    legs.push({ side: s, thigh, shin, foot, footPivot });
  }

  const hipsLocal = [new THREE.Vector3(0.0, -0.048, 0.155), new THREE.Vector3(0.0, -0.048, -0.155)];
  const THIGH_LEN = 0.40;
  const SHIN_LEN = 0.42;

  function solveIK(hip, ankle, pole) {
    _a.copy(ankle).sub(hip);
    let dist = _a.length();
    const minD = Math.abs(THIGH_LEN - SHIN_LEN) + 0.002;
    const maxD = THIGH_LEN + SHIN_LEN - 0.002;
    dist = clamp(dist, minD, maxD);
    _a.normalize();
    const along = (THIGH_LEN * THIGH_LEN - SHIN_LEN * SHIN_LEN + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, THIGH_LEN * THIGH_LEN - along * along));
    _a.copy(ankle).sub(hip).normalize();
    _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
    if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0);
    _b.normalize();
    return new THREE.Vector3().copy(hip).addScaledVector(_a, along).addScaledVector(_b, h);
  }

  function orientLimb(mesh, top, bottom) {
    _a.copy(bottom).sub(top);
    const len = _a.length() || 0.001;
    _a.multiplyScalar(1 / len);
    mesh.position.copy(top);
    mesh.quaternion.setFromUnitVectors(_b.set(0, -1, 0), _a);
    mesh.scale.set(1, len, 1);
  }

  // =========================================================================
  // ANIMATION STATE
  // =========================================================================
  let t = 0;
  let drive = 0;
  let wheelAngle = 0;
  let crankAngle = 0;
  let bobPhase = 0;
  let blinkAt = -1;
  let nextBlink = 2.6;
  let look = 0;
  let bellT = -1;
  let wireframe = false;
  let qualityLow = !high;
  let highDetailBits = [];

  // collect a few "detail" meshes that low quality hides
  bike.traverse((o) => {
    if (o.isMesh && o.name && /decal|saddlestitch|goggleGlass|catchlight|nostrils|chain/i.test(o.name)) highDetailBits.push(o);
  });

  // =========================================================================
  // UPDATE
  // =========================================================================
  function update(state = {}) {
    const dt = clamp(Number(state.dt) || 0, 0, 0.05);
    t += dt;
    const time = t;
    const paused = !!state.paused;
    const targetSpeed = paused ? 0 : clamp(Number(state.speed) || 0, 0, 1);
    drive = damp(drive, targetSpeed, 3.2, dt);
    const motion = state.reducedMotion ? 0.32 : 1;

    // ---- trip animation (wheels / cranks / chain)
    wheelAngle += drive * 9.6 * dt;
    crankAngle += drive * 3.55 * dt;
    wheelRear.pivot.rotation.z = -wheelAngle;
    wheelFront.pivot.rotation.z = -wheelAngle;
    crank.pivot.rotation.z = -crankAngle;
    for (const p of pedals) p.pivot.rotation.z = crankAngle;
    M.chain.map.offset.x -= drive * dt * 2.4;
    M.chain2.map.offset.x += drive * dt * 2.4;

    // ---- body bob / roll / breathing
    bobPhase += dt * (2.1 + drive * 7.2);
    const breathe = Math.sin(time * 1.55) * (0.006 + 0.002 * (1 - drive)) * motion;
    const bobY = Math.sin(bobPhase * 2) * 0.013 * drive + Math.sin(bobPhase * 3.1 + 0.8) * 0.004 * drive + breathe;
    const bobX = Math.sin(bobPhase) * 0.008 * drive;
    bodyPivot.position.set(-0.02 + bobX, 1.16 + bobY, 0);
    const roll = Math.sin(bobPhase) * 0.035 * drive * motion + Math.sin(time * 0.62) * 0.006 * motion;
    bodyPivot.rotation.set(
      Math.sin(bobPhase * 2 + 0.6) * 0.012 * drive * motion,
      Math.sin(time * 0.31) * 0.014 * motion,
      roll, 'YXZ'
    );
    bodyPivot.updateMatrix();

    // ---- head counter-bob + look-around
    const lookTarget = Math.sin(time * 0.47) * 0.62 + Math.sin(time * 0.29 + 2.1) * 0.38;
    look = damp(look, lookTarget, 1.3, dt);
    const headYaw = look * 0.19 * motion - 0.10;
    const headPitch = -Math.sin(bobPhase * 2) * 0.026 * drive * motion + Math.sin(time * 0.8 + 1.1) * 0.016 * motion + look * 0.022;
    const headRoll = Math.sin(bobPhase * 3.1 + 0.8) * 0.010 * drive * motion;
    headPivot.position.set(0.10 + bobX * 0.35, 1.86 + bobY * 0.35, 0);
    headPivot.rotation.set(headRoll, headYaw, headPitch, 'YXZ');

    // ---- eyelids / blink
    if (time > nextBlink) {
      blinkAt = time;
      nextBlink = time + 2.8 + Math.random() * 3.4;
    }
    let blink = 0;
    if (blinkAt >= 0) {
      const u = (time - blinkAt) / 0.19;
      if (u >= 1) blinkAt = -1;
      else blink = Math.sin(Math.PI * u);
    }
    for (const er of eyeRigs) {
      const openAngle = -1.45 + look * 0.15 * er.side;
      const angle = lerp(openAngle, 0.25, blink);
      _q.copy(er.base);
      _e.set(angle, 0, 0, 'XYZ');
      _q.multiply(new THREE.Quaternion().setFromEuler(_e));
      er.pivot.quaternion.copy(_q);
    }

    // ---- pouch jiggle
    pouchRig.pivot.rotation.set(
      Math.sin(time * 6.8 + bobPhase * 1.2) * 0.035 * drive * motion + Math.sin(time * 2.1) * 0.012 * motion,
      Math.sin(time * 3.2) * 0.015 * motion,
      Math.sin(time * 5.1 + 0.7) * 0.02 * drive * motion, 'XYZ'
    );
    pouchRig.pivot.scale.set(1 + Math.sin(time * 5.6) * 0.02 * motion, 1 + Math.sin(time * 5.6 + 0.6) * 0.035 * motion, 1);

    // ---- wings micro-motion
    const wingFlap = Math.sin(time * 2.2) * 0.022 * motion;
    wingL.pivot.rotation.set(Math.sin(time * 1.7 + 0.4) * 0.03 * motion - headPitch * 0.3, 0.02 + look * 0.04, wingFlap + drive * 0.03);
    wingR.pivot.rotation.set(Math.sin(time * 1.7 + 1.9) * 0.03 * motion - headPitch * 0.3, -0.02 - look * 0.04, -wingFlap - drive * 0.03);

    // ---- tail wag
    tailRig.pivot.rotation.set(Math.sin(time * 1.5) * 0.03 * motion, look * 0.12 + Math.sin(time * 2.3) * 0.06 * motion, Math.sin(time * 1.9 + 0.5) * 0.035 * motion);

    // ---- scarf ribbons
    for (const r of ribbons) updateRibbon(r, time, drive, motion);
    // scarf wrap subtle breathing
    // ---- basket fish wiggle
    for (const ft of fishTails) {
      ft.pivot.rotation.z = Math.sin(time * 4.2 + ft.phase) * 0.16 * motion;
      ft.pivot.rotation.x = Math.sin(time * 3.1 + ft.phase * 1.3) * 0.10 * motion + drive * 0.06;
    }

    // ---- bell ring
    if (bellT >= 0) {
      bellT += dt;
      const u = bellT / 0.62;
      if (u >= 1) {
        bellT = -1;
        bell.dome.rotation.set(0, 0, 0);
        sparkles.visible = false;
        sparkleMat.opacity = 0;
      } else {
        const damped = Math.exp(-u * 5.2) * Math.sin(u * 52);
        bell.dome.rotation.set(damped * 0.30, 0, damped * 0.16);
        bell.lever.rotation.z = damped * 0.25;
        sparkles.visible = true;
        sparkleMat.opacity = Math.sin(Math.PI * Math.min(1, u * 1.4)) * 0.95;
        sparkles.rotation.y = u * 2.5;
        sparkles.scale.setScalar(0.7 + u * 1.5);
      }
    }

    // ---- legs: 2-bone IK onto pedals
    for (let i = 0; i < 2; i++) {
      const leg = legs[i];
      const s = leg.side;
      const hip = _v.copy(hipsLocal[i]).applyMatrix4(bodyPivot.matrix);
      // pedal centre (in bike/root space)
      const ang = crankAngle + (s > 0 ? 0 : Math.PI);
      const px = Math.cos(ang) * CRANK_R;
      const py = BB[1] + Math.sin(ang) * CRANK_R;
      const pz = s * PEDAL_Z;
      // ankle sits above the pedal platform
      const ankle = new THREE.Vector3(px + 0.012, py + 0.052, pz);
      const pole = new THREE.Vector3(0.52, 0.10, s * 0.30);
      const knee = solveIK(hip, ankle, pole);
      orientLimb(leg.thigh, hip, knee);
      orientLimb(leg.shin, knee, ankle);
      // foot flat on the pedal, toes forward
      leg.footPivot.position.set(px + 0.012, py + 0.013, pz);
      leg.footPivot.rotation.set(0.02 + Math.sin(ang) * 0.10, s * 0.10, 0, 'YXZ');
    }
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================
  function ringBell() {
    bellT = 0;
    sparkleMat.opacity = 0;
    sparkles.visible = true;
  }

  function setWireframe(on) {
    wireframe = !!on;
    const seen = new Set();
    group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if ('wireframe' in m) m.wireframe = wireframe;
        if (m.transparent && m !== M.glass) m.opacity = wireframe ? 0.18 : (m === M.decal ? 1 : 1);
      }
    });
    M.glass.opacity = wireframe ? 1 : 0.35;
    sparkles.visible = wireframe ? false : sparkles.visible;
  }

  function setQuality(q) {
    qualityLow = q === 'low';
    high = !qualityLow;
    for (const mesh of highDetailBits) mesh.visible = high;
    // hide fine chain/gear micro-detail in low quality
    if (M.decal) M.decal.opacity = 1;
  }

  function dispose() {
    const geoms = new Set();
    const mats = new Set();
    const texs = new Set();
    group.traverse((o) => {
      if (o.geometry) geoms.add(o.geometry);
      const mm = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mm) {
        mats.add(m);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap', 'envMap', 'bumpMap', 'aoMap']) {
          if (m[key]) texs.add(m[key]);
        }
      }
    });
    for (const t of textures) texs.add(t);
    for (const g of geoms) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) if (t && t.dispose) t.dispose();
    for (const g of disposables) g.dispose();
    group.clear();
  }

  // initial pose so the very first rendered frame is already correct
  update({ dt: 0.016, time: 0, speed: 0, paused: true, reducedMotion: false });

  return {
    group,
    update,
    ringBell,
    setWireframe,
    setQuality,
    focus: {
      head: new THREE.Vector3(0.30, 2.20, 0.05),
      body: new THREE.Vector3(-0.10, 1.55, 0.0),
      bike: new THREE.Vector3(0.0, 0.75, 0.0),
    },
    dispose,
  };
}
