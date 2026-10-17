/* ============================================================
   PELICAN POST — application shell
   Renderer, camera choreography, atmosphere, post-processing,
   integration of the procedural rider + world, and the main loop.
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { createRider } from './rider.js';
import { createWorld, getAtmosphere } from './world.js';
import { createAudio } from './audio.js';
import { initUI } from './ui.js';

const canvas = document.getElementById('scene');
const storeKey = 'pelican-post-v1';
const isCoarse = window.matchMedia('(pointer: coarse)').matches;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ------------------------------ settings ------------------------------ */

function loadSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(storeKey) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const saved = loadSaved();
const clamp = THREE.MathUtils.clamp;

const state = {
  loaded: false,
  paused: false,
  speed: clamp(Number.isFinite(saved.speed) ? saved.speed : 1.83, 0, 3),
  timeOfDay: clamp(Number.isFinite(saved.timeOfDay) ? saved.timeOfDay : 0.56, 0, 1),
  cameraMode: 'orbit',
  wireframe: false,
  sound: false,
  distance: Number.isFinite(saved.distance) ? saved.distance : 12.408,
  quality: isCoarse ? 'high' : 'high',
  reducedMotion: reducedMotionQuery.matches,
  fps: 60,
  adaptDone: false,
};

let saveTimer = 0;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        storeKey,
        JSON.stringify({ speed: state.speed, timeOfDay: state.timeOfDay, distance: state.distance })
      );
    } catch {
      /* storage can be unavailable; the postcard still works */
    }
  }, 500);
}

function showFatal(error) {
  const fatal = document.getElementById('fatal');
  const detail = document.getElementById('fatal-detail');
  if (fatal) fatal.hidden = false;
  if (detail) detail.textContent = error ? String(error.stack || error.message || error) : '';
  document.body.classList.add('loaded');
}

/* ------------------------------ renderer ------------------------------ */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    stencil: false,
  });
} catch (error) {
  showFatal(error);
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* ------------------------------ scene ------------------------------ */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(41, window.innerWidth / window.innerHeight, 0.1, 420);
const defaultCamera = new THREE.Vector3(3.55, 2.82, 7.05);
const defaultTarget = new THREE.Vector3(0, 1.38, 0);
const introCamera = new THREE.Vector3(7.6, 4.35, 11.2);
camera.position.copy(
  state.reducedMotion
    ? homeView().pos
    : new THREE.Vector3(
        introCamera.x * (window.innerWidth / Math.max(1, window.innerHeight) < 1 ? 1.25 : 1),
        introCamera.y,
        introCamera.z * (window.innerWidth / Math.max(1, window.innerHeight) < 1 ? 1.25 : 1)
      )
);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(defaultTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.85;
controls.enablePan = false;
controls.minDistance = 2.7;
controls.maxDistance = 18;
controls.minPolarAngle = 0.32;
controls.maxPolarAngle = Math.PI * 0.496;
controls.enabled = false;
controls.update();

const hemi = new THREE.HemisphereLight(0xffe4c4, 0x24414d, 1.15);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xffce9a, 2.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 90;
keyLight.shadow.camera.left = -6;
keyLight.shadow.camera.right = 6;
keyLight.shadow.camera.top = 6;
keyLight.shadow.camera.bottom = -4;
keyLight.shadow.bias = -0.0006;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.radius = 2.4;
keyLight.target.position.set(0, 1, 0);
scene.add(keyLight, keyLight.target);

// Warm camera-side fill keeps the cream pelican from turning grey against the sunset.
const fillLight = new THREE.DirectionalLight(0xffd9b8, 1.25);
fillLight.position.set(6.5, 4.2, 7.5);
scene.add(fillLight);

const bounceLight = new THREE.DirectionalLight(0xffb98d, 0.42);
bounceLight.position.set(0.5, 1.2, 8);
scene.add(bounceLight);

const rimLight = new THREE.DirectionalLight(0xff9b74, 0.95);
rimLight.position.set(-7, 2.4, -5);
scene.add(rimLight);

scene.fog = new THREE.Fog(0xe8a184, 24, 140);

/* ------------------------------ world + rider ------------------------------ */

let world;
let rider;
try {
  world = createWorld({ quality: state.quality });
  scene.add(world.group);
  rider = createRider({ quality: state.quality });
  scene.add(rider.group);
} catch (error) {
  showFatal(error);
  throw error;
}

/* ------------------------------ post processing ------------------------------ */

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);

const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.34,
  0.62,
  0.86
);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

/* ------------------------------ atmosphere ------------------------------ */

let atmosphere = getAtmosphere(state.timeOfDay);
const sunWorld = new THREE.Vector3();
const cameraDir = new THREE.Vector3();
const projectedSun = new THREE.Vector3();
let flareOpacity = 0.35;

function applyAtmosphere(t, immediate = true) {
  atmosphere = getAtmosphere(t);
  const a = atmosphere;

  keyLight.position.copy(a.sunDir).multiplyScalar(42);
  keyLight.color.copy(a.sunColor);
  keyLight.intensity = a.sunIntensity;

  hemi.color.copy(a.hemiSky);
  hemi.groundColor.copy(a.hemiGround);
  hemi.intensity = a.hemiIntensity;

  scene.fog.color.copy(a.fogColor);
  scene.fog.near = a.fogNear;
  scene.fog.far = a.fogFar;

  fillLight.intensity = 0.32 + 0.95 * (1 - a.isNight * 0.75);
  fillLight.color.copy(a.isNight > 0.55 ? new THREE.Color(0x8098d6) : new THREE.Color(0xffd9b8));
  bounceLight.intensity = 0.12 + 0.36 * (1 - a.isNight);
  bounceLight.color.copy(a.isNight > 0.55 ? new THREE.Color(0x5f78c8) : new THREE.Color(0xffb98d));
  rimLight.intensity = 0.4 + 0.8 * (1 - a.isNight);
  rimLight.color.copy(a.sunColor).lerp(new THREE.Color(0xff7d5a), 0.45);

  renderer.toneMappingExposure = a.exposure;
  bloomPass.strength = a.bloomStrength * (state.quality === 'high' ? 1 : 0.7);
  bloomPass.radius = 0.55;

  // The CSS lens flare follows the real sun.
  sunWorld.copy(a.sunDir).multiplyScalar(110);
  const sunOpacity = Math.pow(1 - a.isNight, 1.8) * 0.62;
  if (immediate) flareOpacity = sunOpacity;
}

applyAtmosphere(state.timeOfDay);

/* ------------------------------ camera choreography ------------------------------ */

const defaultFov = 41;
const closeTarget = new THREE.Vector3();
const headTarget = new THREE.Vector3();
let camTween = null;
let cinematicPhase = 0;
let cinematicAngle = 0;
let cinematicRadius = 7.2;
let orbitPending = false;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function startCameraTween(toPos, toTarget, duration = 1.15, onDone) {
  camTween = {
    elapsed: 0,
    duration: Math.max(0.2, duration),
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: toTarget.clone(),
    onDone,
  };
  controls.enabled = false;
}

function homeView() {
  // Portrait phones need a little more breathing room for the same composition.
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const k = THREE.MathUtils.clamp(1 + (1 - aspect) * 0.56, 1, 1.55);
  return {
    pos: new THREE.Vector3(defaultCamera.x * k, defaultCamera.y + (k - 1) * 0.55, defaultCamera.z * k),
    target: defaultTarget.clone(),
  };
}

function orbitView() {
  return homeView();
}

function beginCinematic() {
  cinematicAngle = Math.atan2(camera.position.x, camera.position.z);
  cinematicRadius = THREE.MathUtils.clamp(Math.hypot(camera.position.x, camera.position.z), 6.4, 9.2);
  cinematicPhase = 0;
}

function cameraTargets() {
  const head = rider?.focus?.head ? rider.focus.head.clone() : new THREE.Vector3(0.34, 2.18, 0.05);
  const desired = head.clone().add(new THREE.Vector3(2.25, 0.5, 3.05));
  return { pos: desired, target: head };
}

function updateCamera(dt) {
  if (camTween) {
    camTween.elapsed += dt;
    const k = Math.min(1, camTween.elapsed / camTween.duration);
    const e = easeInOutCubic(k);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    camera.lookAt(controls.target);
    if (k >= 1) {
      const done = camTween.onDone;
      camTween = null;
      if (state.cameraMode === 'orbit' && !orbitPending) controls.enabled = true;
      if (done) done();
    }
    return;
  }

  if (state.cameraMode === 'cinematic') {
    controls.enabled = false;
    cinematicPhase += dt * (state.reducedMotion ? 0.025 : 0.11);
    const angle = cinematicAngle + cinematicPhase;
    const radius = cinematicRadius + Math.sin(cinematicPhase * 0.8) * 0.65;
    const height = 2.95 + Math.sin(cinematicPhase * 0.52 + 0.7) * 0.85;
    const pos = new THREE.Vector3(
      Math.sin(angle) * radius,
      height,
      Math.cos(angle) * radius
    );
    camera.position.lerp(pos, 1 - Math.exp(-dt * 2.1));
    controls.target.lerp(new THREE.Vector3(0, 1.42, 0), 1 - Math.exp(-dt * 3));
    camera.lookAt(controls.target);
    return;
  }

  if (state.cameraMode === 'closeup') {
    controls.enabled = false;
    const { pos, target } = cameraTargets();
    const k = 1 - Math.exp(-dt * 4.4);
    camera.position.lerp(pos, k);
    controls.target.lerp(target, k);
    camera.lookAt(controls.target);
    return;
  }

  controls.enabled = !camTween;
  if (camera.fov !== defaultFov) {
    camera.fov += (defaultFov - camera.fov) * (1 - Math.exp(-dt * 4));
    camera.updateProjectionMatrix();
  }
  controls.update();
}

function setCameraMode(mode, options = {}) {
  if (!['orbit', 'cinematic', 'closeup'].includes(mode)) return;
  const fromUser = options.fromUser !== false;
  if (state.cameraMode === mode && !options.force) {
    if (mode === 'orbit' && fromUser) resetView();
    return;
  }
  state.cameraMode = mode;

  if (mode === 'cinematic') {
    beginCinematic();
    hudHint(false);
  } else if (mode === 'closeup') {
    const { pos, target } = cameraTargets();
    startCameraTween(pos, target, 1.35);
    hudHint(false);
  } else if (mode === 'orbit') {
    resetView();
  }
  api.ui?.syncCameraMode?.(mode);
}

function resetView() {
  const view = orbitView();
  state.cameraMode = 'orbit';
  startCameraTween(view.pos, view.target, 1.15, () => {
    controls.enabled = true;
    camera.fov = defaultFov;
    camera.updateProjectionMatrix();
  });
  api.ui?.syncCameraMode?.('orbit');
}

/* ------------------------------ interaction ------------------------------ */

function markDragging(on) {
  document.body.classList.toggle('dragging', on);
  if (on) hudHint(false);
}

controls.addEventListener('start', () => {
  if (state.cameraMode !== 'orbit') {
    state.cameraMode = 'orbit';
    controls.enabled = true;
    api.ui?.syncCameraMode?.('orbit');
  }
  markDragging(true);
});
controls.addEventListener('end', () => markDragging(false));

let hintHidden = false;
function hudHint(show) {
  if (!show) {
    hintHidden = true;
    document.body.classList.add('hint-hidden');
  }
}
window.setTimeout(() => hudHint(false), 11000);

/* ------------------------------ atmosphere per-frame ------------------------------ */

const sunNdc = new THREE.Vector3();

function updateSunFlare(dt) {
  const a = atmosphere;
  cameraDir.copy(camera.getWorldDirection(new THREE.Vector3()));
  const facing = cameraDir.dot(a.sunDir);
  const visibility = THREE.MathUtils.smoothstep(facing, -0.05, 0.55);
  projectedSun.copy(a.sunDir).multiplyScalar(110).project(camera);
  const onScreen =
    projectedSun.z < 1 &&
    projectedSun.x > -1.35 &&
    projectedSun.x < 1.35 &&
    projectedSun.y > -1.35 &&
    projectedSun.y < 1.35
      ? 1
      : 0;
  const target =
    visibility *
    onScreen *
    Math.pow(1 - a.isNight, 1.8) *
    (0.34 + 0.26 * (1 - Math.min(1, Math.abs(projectedSun.y))));
  flareOpacity += (target - flareOpacity) * (1 - Math.exp(-dt * 3));
  if (flareOpacity > 0.004) {
    const x = (projectedSun.x * 0.5 + 0.5) * 100;
    const y = (-projectedSun.y * 0.5 + 0.5) * 100;
    document.documentElement.style.setProperty('--sun-x', `${x.toFixed(2)}%`);
    document.documentElement.style.setProperty('--sun-y', `${y.toFixed(2)}%`);
  }
  document.documentElement.style.setProperty('--sun-opacity', flareOpacity.toFixed(3));
}

/* ------------------------------ app API ------------------------------ */

const api = {
  state,
  scene,
  camera,
  renderer,
  composer,
  controls,
  bloomPass,
  get rider() {
    return rider;
  },
  get world() {
    return world;
  },
  get atmosphere() {
    return atmosphere;
  },
  ui: null,
  audio: null,

  setSpeed(value, options = {}) {
    state.speed = clamp(Number(value) || 0, 0, 3);
    api.audio?.setSpeed(state.speed);
    if (options.persist !== false) scheduleSave();
  },

  setTimeOfDay(value) {
    state.timeOfDay = clamp(Number(value) || 0, 0, 1);
    applyAtmosphere(state.timeOfDay);
    api.audio?.setTimeOfDay(state.timeOfDay);
    api.ui?.syncTime?.();
    scheduleSave();
  },

  setPaused(value) {
    state.paused = Boolean(value);
    api.ui?.syncPaused?.();
    if (!state.paused) hudHint(false);
  },

  togglePause() {
    api.setPaused(!state.paused);
    return state.paused;
  },

  setCameraMode,
  resetView,

  setWireframe(value) {
    state.wireframe = Boolean(value);
    rider?.setWireframe?.(state.wireframe);
    world?.setWireframe?.(state.wireframe);
    api.ui?.syncWire?.(state.wireframe);
  },

  toggleWireframe() {
    api.setWireframe(!state.wireframe);
    return state.wireframe;
  },

  ringBell() {
    rider?.ringBell?.();
    api.audio?.bell?.();
    api.ui?.pulseBell?.();
  },

  toggleSound() {
    state.sound = !state.sound;
    if (state.sound) api.audio?.enable?.();
    else api.audio?.disable?.();
    api.ui?.syncSound?.(state.sound);
    return state.sound;
  },

  setSound(value) {
    state.sound = Boolean(value);
    if (state.sound) api.audio?.enable?.();
    else api.audio?.disable?.();
    api.ui?.syncSound?.(state.sound);
    return state.sound;
  },

  capturePostcard() {
    return composePostcard();
  },

  stats() {
    // renderer.info is reset by the composer's fullscreen passes; measure the
    // actual scene once so QA gets the real draw-call / triangle budget.
    renderer.info.autoReset = false;
    renderer.info.reset();
    renderer.render(scene, camera);
    const sceneInfo = {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      lines: renderer.info.render.lines,
    };
    renderer.info.autoReset = true;
    composer.render();
    return {
      fps: state.fps,
      ...sceneInfo,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      quality: state.quality,
      pixelRatio: renderer.getPixelRatio(),
      cameraMode: state.cameraMode,
      speed: state.speed,
      timeOfDay: state.timeOfDay,
      distance: state.distance,
    };
  },
};

/* ------------------------------ postcard export ------------------------------ */

function postcardClock(t) {
  const total = 12 * 60 + t * 12 * 60;
  let minutes = Math.round(total) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function composePostcard() {
  // Always render a clean current frame (HUD is DOM, so it is not included).
  composer.render();
  const source = renderer.domElement;
  const W = 1800;
  const H = 1300;
  const pad = 62;
  const imgW = W - pad * 2;
  const imgH = 1050;
  // Cover-crop the current viewport into the postcard's 16:10 window. This
  // matters on portrait phones, where the canvas aspect is much taller.
  const targetAspect = imgW / imgH;
  const sourceAspect = source.width / source.height;
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;
  if (sourceAspect > targetAspect) {
    sw = source.height * targetAspect;
    sx = (source.width - sw) / 2;
  } else {
    sh = source.width / targetAspect;
    sy = (source.height - sh) / 2;
  }

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');

  // Paper
  ctx.fillStyle = '#f6ecd9';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120, 88, 56, 0.05)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

  // Image
  ctx.save();
  roundRect(ctx, pad, pad, imgW, imgH, 18);
  ctx.clip();
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, imgW, imgH);
  ctx.restore();

  // Frame stroke
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  roundRect(ctx, pad, pad, imgW, imgH, 18);
  ctx.stroke();

  const baseY = pad + imgH + 14;

  // Postmark sits in the bottom-right, above the metadata line.
  ctx.save();
  ctx.translate(W - 172, baseY + 44);
  ctx.rotate(-0.1);
  ctx.strokeStyle = 'rgba(112, 74, 46, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 39, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(112, 74, 46, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(112, 74, 46, 0.72)';
  ctx.textAlign = 'center';
  ctx.font = '600 10px Outfit, sans-serif';
  ctx.fillText('PELICAN POST', 0, -13);
  ctx.font = '500 21px Fraunces, Georgia, serif';
  ctx.fillText(postcardClock(state.timeOfDay), 0, 10);
  ctx.font = '500 8px Outfit, sans-serif';
  ctx.fillText('SHANGHAI', 0, 27);
  ctx.restore();

  // Title block, left.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2f231d';
  ctx.font = '500 34px "Songti SC", "STSong", Georgia, serif';
  ctx.fillText('鹈鹕骑单车', pad + 6, baseY + 58);
  ctx.font = 'italic 400 15px Fraunces, Georgia, serif';
  ctx.fillStyle = 'rgba(72, 53, 38, 0.66)';
  ctx.fillText('A POSTCARD FROM THE GOLDEN COAST', pad + 8, baseY + 81);

  // Metadata line runs under the title, clear of the postmark.
  ctx.font = '500 10px Outfit, sans-serif';
  ctx.fillStyle = 'rgba(72, 53, 38, 0.62)';
  ctx.fillText(
    `${state.distance.toFixed(3)} KM  ·  31°14′N 121°29′E  ·  THREE.JS r180`,
    pad + 6,
    baseY + 112
  );

  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('zh-CN'), W - pad - 6, baseY + 112);

  ctx.strokeStyle = 'rgba(120, 88, 56, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad + 6, baseY + 126);
  ctx.lineTo(W - pad - 6, baseY + 126);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = '500 9px Outfit, sans-serif';
  ctx.fillStyle = 'rgba(72, 53, 38, 0.48)';
  ctx.fillText('PELICAN POST · No. 37', pad + 6, baseY + 142);
  ctx.textAlign = 'right';
  ctx.fillText('PELICAN-BICYCLE-3D · THREE.JS r180', W - pad - 6, baseY + 142);

  return out.toDataURL('image/png');
}

/* ------------------------------ UI + audio ------------------------------ */

const audio = createAudio();
api.audio = audio;
const ui = initUI(api);
api.ui = ui;

/* ------------------------------ loop ------------------------------ */

const clock = new THREE.Clock();
let simTime = 0;
let fpsFrames = 0;
let fpsElapsed = 0;
let totalElapsed = 0;
let uiClock = 0;
let introDone = state.reducedMotion;
const tempVec = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (document.hidden) return;

  totalElapsed += dt;
  simTime += dt;
  fpsFrames += 1;
  fpsElapsed += dt;
  uiClock += dt;

  const speed = state.paused ? 0 : state.speed;
  const speedNorm = clamp(speed / 3, 0, 1);

  if (!state.paused) {
    state.distance += (speed * 4.6 * dt) / 3600;
  }

  rider.update({
    time: simTime,
    dt,
    speed: speedNorm,
    paused: state.paused,
    reducedMotion: state.reducedMotion,
  });

  world.update({
    time: simTime,
    dt,
    speed: speedNorm,
    timeOfDay: state.timeOfDay,
    reducedMotion: state.reducedMotion,
  });

  updateCamera(dt);
  updateSunFlare(dt);

  if (fpsElapsed >= 0.5) {
    state.fps = Math.round(fpsFrames / fpsElapsed);
    fpsFrames = 0;
    fpsElapsed = 0;
    if (state.fps < 38) document.body.classList.add('low-fps');
    else document.body.classList.remove('low-fps');
    ui.setFps?.(state.fps);

    if (!state.adaptDone && totalElapsed > 5 && state.fps < 42) {
      state.adaptDone = true;
      adaptQuality();
    }
  }

  if (uiClock >= 0.25) {
    uiClock = 0;
    ui.setDistance?.(state.distance);
  }

  composer.render(dt);

  if (!introDone && totalElapsed > 0.15) {
    introDone = true;
    const home = homeView();
    startCameraTween(home.pos, home.target, 2.6, () => {
      controls.enabled = true;
    });
  }
}

function adaptQuality() {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  state.quality = 'low';
  ui.toast?.('海风有点大，已自动降低渲染精度');
}

/* ------------------------------ resize ------------------------------ */

let resizeTimer = 0;
function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  }, 80);
}
window.addEventListener('resize', onResize, { passive: true });
window.addEventListener('orientationchange', onResize, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    clock.getDelta();
    ui.toast?.('欢迎回来，海风还在');
  }
});

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showFatal('WebGL context lost. Please reload the page.');
});

reducedMotionQuery.addEventListener?.('change', (event) => {
  state.reducedMotion = event.matches;
  document.body.classList.toggle('reduced-motion', state.reducedMotion);
});

window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem(
      storeKey,
      JSON.stringify({ speed: state.speed, timeOfDay: state.timeOfDay, distance: state.distance })
    );
  } catch {
    /* ignore */
  }
});

/* ------------------------------ boot ------------------------------ */

function boot() {
  resizeNow();
  applyAtmosphere(state.timeOfDay);
  renderer.compile(scene, camera);
  composer.render();

  requestAnimationFrame(() => {
    document.body.classList.add('loaded');
    state.loaded = true;
    ui.onLoaded?.();
    if (state.reducedMotion) {
      const home = homeView();
      camera.position.copy(home.pos);
      controls.target.copy(home.target);
      controls.enabled = true;
      camera.lookAt(home.target);
      introDone = true;
    }
  });

  frame();
}

function resizeNow() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
}

// Expose a deliberate debug surface for the QA harness.
window.__PELICAN__ = {
  api,
  state,
  scene,
  camera,
  renderer,
  composer,
  controls,
  stats: () => api.stats(),
  capturePostcard: () => api.capturePostcard(),
  setCameraMode: (mode) => api.setCameraMode(mode),
  setTimeOfDay: (t) => api.setTimeOfDay(t),
  setSpeed: (v) => api.setSpeed(v),
  toggleWireframe: () => api.toggleWireframe(),
  ringBell: () => api.ringBell(),
  ready: false,
};

// Let the loader breathe for a beat so the first compiled frame is warm.
setTimeout(() => {
  boot();
  window.__PELICAN__.ready = true;
}, state.reducedMotion ? 120 : 420);

// Small helpers for the HUD
function hudTick() {}
