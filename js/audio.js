/* ============================================================
   PELICAN POST — tiny procedural soundscape
   Ocean noise + wind, plus a bicycle bell. No audio assets.
   The context is created lazily on the first gesture.
   ============================================================ */

export function createAudio() {
  let ctx = null;
  let master = null;
  let oceanGain = null;
  let windGain = null;
  let oceanFilter = null;
  let windFilter = null;
  let compressor = null;
  let started = false;
  let enabled = false;
  let lastSpeed = 1.8;
  let lastTime = 0.56;

  function ensure() {
    if (ctx) return ctx;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      ctx = new AudioContextClass();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.0001;
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 22;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.3;
    master.connect(compressor);
    compressor.connect(ctx.destination);
    return ctx;
  }

  function makeNoiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 2.6 + white * 0.12;
    }
    return buffer;
  }

  function buildAmbience() {
    const ocean = ctx.createBufferSource();
    ocean.buffer = makeNoiseBuffer(6);
    ocean.loop = true;

    oceanFilter = ctx.createBiquadFilter();
    oceanFilter.type = 'lowpass';
    oceanFilter.frequency.value = 420;
    oceanFilter.Q.value = 0.55;

    oceanGain = ctx.createGain();
    oceanGain.gain.value = 0.055;

    const oceanLfo = ctx.createOscillator();
    oceanLfo.frequency.value = 0.075;
    const oceanLfoGain = ctx.createGain();
    oceanLfoGain.gain.value = 150;
    oceanLfo.connect(oceanLfoGain);
    oceanLfoGain.connect(oceanFilter.frequency);

    ocean.connect(oceanFilter);
    oceanFilter.connect(oceanGain);
    oceanGain.connect(master);
    ocean.start();
    oceanLfo.start();

    const wind = ctx.createBufferSource();
    wind.buffer = makeNoiseBuffer(4);
    wind.loop = true;

    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.7;

    windGain = ctx.createGain();
    windGain.gain.value = 0.012;

    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.11;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.008;
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windGain.gain);

    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    wind.start();
    windLfo.start();

    started = true;
    setSpeed(lastSpeed);
    setTimeOfDay(lastTime);
  }

  function rampMaster(to, seconds = 0.8) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), now + seconds);
  }

  async function enable() {
    const context = ensure();
    if (!context) return false;
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    if (!started) buildAmbience();
    enabled = true;
    rampMaster(0.9, 1.1);
    return true;
  }

  function disable() {
    enabled = false;
    rampMaster(0.0001, 0.5);
  }

  function setSpeed(value) {
    lastSpeed = value;
    if (!ctx || !windGain) return;
    const norm = Math.max(0, Math.min(1, value / 3));
    const now = ctx.currentTime;
    windGain.gain.cancelScheduledValues(now);
    windGain.gain.setTargetAtTime(0.006 + norm * 0.024, now, 0.5);
    windFilter.frequency.setTargetAtTime(650 + norm * 750, now, 0.6);
    oceanGain.gain.setTargetAtTime(0.045 + norm * 0.025, now, 0.6);
  }

  function setTimeOfDay(value) {
    lastTime = value;
    if (!ctx || !oceanFilter) return;
    const night = Math.max(0, Math.min(1, (value - 0.62) / 0.38));
    oceanFilter.frequency.setTargetAtTime(430 - night * 170, ctx.currentTime, 0.8);
  }

  function bell() {
    const context = ensure();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;
    const bus = ctx.createGain();
    bus.gain.value = 0.16;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = 0.16;
      bus.connect(pan);
      pan.connect(master);
    } else {
      bus.connect(master);
    }

    const partials = [
      { f: 1568, gain: 0.55, decay: 0.7, type: 'sine' },
      { f: 2093, gain: 0.3, decay: 0.55, type: 'sine' },
      { f: 3136, gain: 0.12, decay: 0.35, type: 'sine' },
      { f: 784, gain: 0.08, decay: 0.9, type: 'triangle' },
    ];

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(partial.f, now);
      osc.frequency.exponentialRampToValueAtTime(partial.f * 0.995, now + 0.8);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(partial.gain, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(now);
      osc.stop(now + partial.decay + 0.05);
    }

    // A tiny mechanical "ting" transient.
    const transient = ctx.createOscillator();
    const transientGain = ctx.createGain();
    transient.type = 'square';
    transient.frequency.value = 4200;
    transientGain.gain.setValueAtTime(0.04, now);
    transientGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    transient.connect(transientGain);
    transientGain.connect(bus);
    transient.start(now);
    transient.stop(now + 0.06);
  }

  function dispose() {
    try {
      if (ctx) ctx.close();
    } catch {
      /* noop */
    }
    ctx = null;
    started = false;
  }

  return {
    enable,
    disable,
    bell,
    setSpeed,
    setTimeOfDay,
    dispose,
    get enabled() {
      return enabled;
    },
  };
}
