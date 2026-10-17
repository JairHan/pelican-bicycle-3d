/* ============================================================
   PELICAN POST — HUD controller
   Binds the postcard controls to the app, handles keyboard
   shortcuts, accessibility state, fullscreen, screenshot export,
   the loading sequence and the mobile control sheet.
   ============================================================ */

const CAMERA_ORDER = ['orbit', 'cinematic', 'closeup'];
const SPEED_TO_KMH = 4.6;

function formatDistance(value) {
  const [whole, decimals] = value.toFixed(3).split('.');
  return `${whole.padStart(3, '0')}.${decimals}`;
}

function clockFor(t) {
  const total = 12 * 60 + t * 12 * 60;
  let minutes = Math.round(total) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function labelFor(t) {
  if (t < 0.22) return '正午';
  if (t < 0.42) return '午后';
  if (t < 0.72) return '黄金时刻';
  if (t < 0.9) return '暮色';
  return '夜色';
}

function labelEnFor(t) {
  if (t < 0.22) return 'NOON';
  if (t < 0.42) return 'AFTERNOON';
  if (t < 0.72) return 'GOLDEN HOUR';
  if (t < 0.9) return 'DUSK';
  return 'NIGHT';
}

export function initUI(app) {
  const $ = (id) => document.getElementById(id);
  const el = {
    speed: $('speed'),
    speedOut: $('speed-out'),
    time: $('time'),
    timeOut: $('time-out'),
    pause: $('btn-pause'),
    pauseLabel: $('pause-label'),
    bell: $('btn-bell'),
    wire: $('wire'),
    shot: $('btn-shot'),
    reset: $('btn-reset'),
    sound: $('btn-sound'),
    help: $('btn-help'),
    helpDialog: $('help'),
    helpClose: $('help-close'),
    fullscreen: $('btn-fullscreen'),
    dock: $('dock'),
    dockToggle: $('btn-dock-toggle'),
    dockClose: $('btn-dock-close'),
    toast: $('toast'),
    flash: $('flash'),
    fps: $('fps-value'),
    odo: $('odo'),
    clock: $('clock'),
    todLabel: $('tod-label'),
    loader: $('loader'),
    loaderStatus: $('loader-status'),
    loaderFill: $('loader-bar-fill'),
    cameraButtons: Array.from(document.querySelectorAll('[data-cam]')),
  };

  let toastTimer = 0;
  let loaderTimer = 0;
  let loaderProgress = 8;
  let loaded = false;

  /* ------------------------------ visual helpers ------------------------------ */

  function toast(message, duration = 2200) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.toast.classList.remove('show'), duration);
  }

  function flash() {
    if (!el.flash) return;
    el.flash.classList.remove('on');
    void el.flash.offsetWidth;
    el.flash.classList.add('on');
  }

  function setRangeFill(input, ratio) {
    if (!input) return;
    input.style.setProperty('--p', `${Math.max(0, Math.min(1, ratio)) * 100}%`);
  }

  /* ------------------------------ sync ------------------------------ */

  function syncSpeed() {
    const speed = app.state.speed;
    if (el.speed && document.activeElement !== el.speed) el.speed.value = String(speed);
    if (el.speedOut) {
      el.speedOut.innerHTML = `${(speed * SPEED_TO_KMH).toFixed(1)} <i>km/h</i>`;
    }
    setRangeFill(el.speed, speed / 3);
  }

  function syncTime() {
    const t = app.state.timeOfDay;
    if (el.time && document.activeElement !== el.time) el.time.value = String(t);
    if (el.timeOut) el.timeOut.textContent = clockFor(t);
    if (el.clock) el.clock.textContent = clockFor(t);
    if (el.todLabel) el.todLabel.textContent = labelFor(t);
    setRangeFill(el.time, t);
  }

  function syncPaused() {
    const paused = app.state.paused;
    document.body.classList.toggle('is-paused', paused);
    if (el.pause) el.pause.setAttribute('aria-pressed', String(paused));
    if (el.pauseLabel) el.pauseLabel.textContent = paused ? '继续' : '暂停';
  }

  function syncWire(value) {
    const on = value ?? app.state.wireframe;
    if (el.wire) el.wire.checked = on;
    document.body.classList.toggle('wire-on', on);
  }

  function syncSound(value) {
    const on = value ?? app.state.sound;
    document.body.classList.toggle('sound-on', on);
    if (el.sound) {
      el.sound.setAttribute('aria-pressed', String(on));
      el.sound.setAttribute('aria-label', on ? '关闭环境声音' : '开启环境声音');
    }
  }

  function syncCameraMode(mode) {
    const value = mode || app.state.cameraMode;
    for (const button of el.cameraButtons) {
      const active = button.dataset.cam === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function setDistance(value) {
    if (el.odo) el.odo.textContent = formatDistance(value);
    if (el.clock) el.clock.textContent = clockFor(app.state.timeOfDay);
    if (el.todLabel) el.todLabel.textContent = labelFor(app.state.timeOfDay);
  }

  function setFps(fps) {
    if (el.fps) el.fps.textContent = String(Math.round(fps));
  }

  /* ------------------------------ actions ------------------------------ */

  function bellAndSound() {
    if (!app.state.sound) app.setSound(true);
    app.ringBell();
    if (el.bell) {
      el.bell.animate(
        [
          { transform: 'rotate(0deg) scale(1)' },
          { transform: 'rotate(-9deg) scale(1.06)' },
          { transform: 'rotate(7deg) scale(1.03)' },
          { transform: 'rotate(-3deg) scale(1)' },
          { transform: 'rotate(0deg) scale(1)' },
        ],
        { duration: 520, easing: 'cubic-bezier(.36,.07,.19,.97)' }
      );
    }
    toast('叮铃—— 海风让路');
  }

  function togglePause() {
    const paused = app.togglePause();
    toast(paused ? '旅程暂停，海还在动' : '继续骑行');
  }

  function cycleCamera() {
    const index = CAMERA_ORDER.indexOf(app.state.cameraMode);
    const next = CAMERA_ORDER[(index + 1) % CAMERA_ORDER.length];
    app.setCameraMode(next);
    toast(
      next === 'orbit' ? '环绕视角' : next === 'cinematic' ? '电影镜头' : '凑近看看它的喙'
    );
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        toast('全屏 · 按 Esc 退出');
      } else {
        await document.exitFullscreen();
      }
    } catch {
      toast('当前浏览器不支持全屏');
    }
  }

  function downloadPostcard() {
    if (el.shot) el.shot.disabled = true;
    try {
      const dataUrl = app.capturePostcard();
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
        now.getDate()
      ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
        now.getMinutes()
      ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `pelican-post-${stamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      flash();
      toast('明信片已装进信封（下载完成）', 2800);
    } catch (error) {
      console.error(error);
      toast('保存失败，请重试');
    } finally {
      window.setTimeout(() => {
        if (el.shot) el.shot.disabled = false;
      }, 600);
    }
  }

  function openHelp() {
    if (typeof el.helpDialog?.showModal === 'function') {
      if (!el.helpDialog.open) el.helpDialog.showModal();
    } else {
      el.helpDialog?.setAttribute('open', '');
    }
  }

  function closeHelp() {
    if (!el.helpDialog) return;
    if (typeof el.helpDialog.close === 'function' && el.helpDialog.open) el.helpDialog.close();
    else el.helpDialog.removeAttribute('open');
  }

  function setDockOpen(open) {
    document.body.classList.toggle('dock-open', open);
    el.dock?.classList.toggle('open', open);
    el.dockToggle?.setAttribute('aria-expanded', String(open));
  }

  /* ------------------------------ wiring ------------------------------ */

  el.speed?.addEventListener('input', (event) => {
    app.setSpeed(Number(event.target.value));
    syncSpeed();
  });

  el.time?.addEventListener('input', (event) => {
    app.setTimeOfDay(Number(event.target.value));
    syncTime();
  });

  el.pause?.addEventListener('click', togglePause);
  el.bell?.addEventListener('click', bellAndSound);
  el.wire?.addEventListener('change', (event) => {
    app.setWireframe(event.target.checked);
    toast(event.target.checked ? '线框模式：看见骨架' : '线框模式关闭');
    if (event.target.checked) flash();
  });

  for (const button of el.cameraButtons) {
    button.addEventListener('click', () => {
      app.setCameraMode(button.dataset.cam);
    });
  }

  el.reset?.addEventListener('click', () => {
    app.resetView();
    toast('回到最初的那一眼');
  });

  el.shot?.addEventListener('click', downloadPostcard);

  el.sound?.addEventListener('click', () => {
    const on = app.toggleSound();
    toast(on ? '环境声已开启 · 海风与车铃' : '已静音');
  });

  el.help?.addEventListener('click', openHelp);
  el.helpClose?.addEventListener('click', closeHelp);
  el.helpDialog?.addEventListener('click', (event) => {
    if (event.target === el.helpDialog) closeHelp();
  });

  el.fullscreen?.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    el.fullscreen?.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
  });

  el.dockToggle?.addEventListener('click', () => setDockOpen(true));
  el.dockClose?.addEventListener('click', () => setDockOpen(false));

  document.addEventListener('pointerdown', (event) => {
    if (!document.body.classList.contains('dock-open')) return;
    if (el.dock?.contains(event.target) || el.dockToggle?.contains(event.target)) return;
    setDockOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const tag = target?.tagName?.toLowerCase();
    // Range/checkbox inputs must not swallow letter shortcuts; only true text
    // entry should. After dragging a slider, S/C/R/... should still work.
    const inputType = target?.type || '';
    const textTypes = ['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date'];
    const typing =
      tag === 'textarea' ||
      tag === 'select' ||
      (tag === 'input' && textTypes.includes(inputType));
    const isButton = tag === 'button' || tag === 'a';
    const nativeSpaceTarget =
      tag === 'input' || tag === 'select' || tag === 'textarea' || isButton;

    if (event.key === 'Escape') {
      if (document.body.classList.contains('dock-open')) setDockOpen(false);
      return;
    }

    if (event.code === 'Space') {
      // Range sliders don't use Space natively, so honour the advertised shortcut
      // while the slider is focused. Buttons/checkbox/text inputs keep native behaviour.
      const isRange = tag === 'input' && inputType === 'range';
      if (nativeSpaceTarget && !isRange) return;
      event.preventDefault();
      togglePause();
      return;
    }

    if (typing) return;

    switch (event.key.toLowerCase()) {
      case 'r':
        event.preventDefault();
        bellAndSound();
        break;
      case 'c':
        event.preventDefault();
        cycleCamera();
        break;
      case 'w':
        event.preventDefault();
        app.setWireframe(!app.state.wireframe);
        syncWire();
        toast(app.state.wireframe ? '线框模式：看见骨架' : '线框模式关闭');
        break;
      case 'f':
        event.preventDefault();
        toggleFullscreen();
        break;
      case 's':
        event.preventDefault();
        downloadPostcard();
        break;
      case 'm':
        event.preventDefault();
        {
          const on = app.toggleSound();
          toast(on ? '环境声已开启' : '已静音');
        }
        break;
      case 'h':
      case '?':
        event.preventDefault();
        openHelp();
        break;
      case '1':
        app.setCameraMode('orbit');
        break;
      case '2':
        app.setCameraMode('cinematic');
        break;
      case '3':
        app.setCameraMode('closeup');
        break;
      default:
        break;
    }
  });

  /* ------------------------------ loader ------------------------------ */

  const statusLines = [
    '正在给车链上油…',
    '正在替鹈鹕整理围巾…',
    '正在把海浪调成金色…',
    '正在给太阳找一条水平线…',
    '正在擦亮车铃…',
  ];
  let statusIndex = 0;

  function startLoader() {
    loaderTimer = window.setInterval(() => {
      loaderProgress = Math.min(92, loaderProgress + Math.random() * 9);
      if (el.loaderFill) el.loaderFill.style.width = `${loaderProgress}%`;
      if (Math.random() > 0.55) {
        statusIndex = (statusIndex + 1) % statusLines.length;
        if (el.loaderStatus) el.loaderStatus.textContent = statusLines[statusIndex];
      }
    }, 620);
  }

  function onLoaded() {
    loaded = true;
    window.clearInterval(loaderTimer);
    if (el.loaderFill) el.loaderFill.style.width = '100%';
    if (el.loaderStatus) el.loaderStatus.textContent = '海风就位。';
    setTimeout(() => {
      if (el.loader) el.loader.setAttribute('aria-hidden', 'true');
    }, 1200);
  }

  startLoader();

  /* ------------------------------ initial state ------------------------------ */

  syncSpeed();
  syncTime();
  syncPaused();
  syncWire();
  syncSound();
  syncCameraMode(app.state.cameraMode);
  setDistance(app.state.distance);
  setFps(app.state.fps);
  document.body.classList.toggle('reduced-motion', app.state.reducedMotion);

  window.setInterval(() => {
    setDistance(app.state.distance);
    setFps(app.state.fps);
  }, 500);

  return {
    toast,
    flash,
    onLoaded,
    syncSpeed,
    syncTime,
    syncPaused,
    syncWire,
    syncSound,
    syncCameraMode,
    setDistance,
    setFps,
    pulseBell: () => el.bell?.classList.add('pulse'),
    get loaded() {
      return loaded;
    },
  };
}
