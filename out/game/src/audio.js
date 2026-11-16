// All sound is synthesised with WebAudio: no audio files, no network, nothing to load.
// Each effect is a short node graph (oscillator or noise buffer through a filter and a
// gain envelope) built once and reused, so firing a gun never allocates a new buffer.

const NOISE_SECONDS = 1;

export function createAudio() {
  let ctx = null;
  let noiseBuffer = null;
  let master = null;
  let enabled = true;
  let lastShotAt = 0;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function noise({ duration, filterType, frequency, q, gain, decay }) {
    const c = ensure();
    if (!c || !enabled) return;
    const source = c.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const amp = c.createGain();
    const t = c.currentTime;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
    source.connect(filter).connect(amp).connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  function tone({ type, from, to, duration, gain, delay = 0 }) {
    const c = ensure();
    if (!c || !enabled) return;
    const osc = c.createOscillator();
    osc.type = type;
    const t = c.currentTime + delay;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const amp = c.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Gunfire: a different crack per weapon class, throttled so a 900 RPM SMG never
  // stacks more than one voice per frame.
  const SHOTS = {
    pistol: { duration: 0.12, filterType: 'bandpass', frequency: 1800, q: 1.1, gain: 0.5, decay: 0.09 },
    smg: { duration: 0.09, filterType: 'bandpass', frequency: 2400, q: 1.4, gain: 0.34, decay: 0.06 },
    rifle: { duration: 0.16, filterType: 'lowpass', frequency: 1400, q: 0.8, gain: 0.62, decay: 0.13 },
    shotgun: { duration: 0.22, filterType: 'lowpass', frequency: 900, q: 0.7, gain: 0.8, decay: 0.18 },
    marksman: { duration: 0.3, filterType: 'lowpass', frequency: 1100, q: 0.9, gain: 0.75, decay: 0.24 },
  };

  return {
    unlock,
    setEnabled(value) {
      enabled = value;
    },
    shot(kind, distant = false) {
      const now = performance.now();
      if (now - lastShotAt < 30) return;
      lastShotAt = now;
      const spec = SHOTS[kind] ?? SHOTS.rifle;
      noise({ ...spec, gain: distant ? spec.gain * 0.35 : spec.gain });
      if (!distant) tone({ type: 'square', from: 160, to: 60, duration: 0.07, gain: 0.18 });
    },
    dryFire() {
      tone({ type: 'square', from: 900, to: 700, duration: 0.03, gain: 0.12 });
    },
    reload() {
      tone({ type: 'square', from: 500, to: 380, duration: 0.05, gain: 0.12 });
      tone({ type: 'square', from: 620, to: 480, duration: 0.05, gain: 0.12, delay: 0.28 });
    },
    hit() {
      tone({ type: 'sine', from: 1250, to: 1250, duration: 0.05, gain: 0.2 });
    },
    kill() {
      tone({ type: 'sine', from: 880, to: 1320, duration: 0.09, gain: 0.22 });
    },
    hurt() {
      noise({ duration: 0.12, filterType: 'lowpass', frequency: 500, q: 0.8, gain: 0.4, decay: 0.1 });
    },
    step() {
      noise({ duration: 0.05, filterType: 'lowpass', frequency: 300, q: 0.6, gain: 0.07, decay: 0.04 });
    },
    plantBeep() {
      tone({ type: 'sine', from: 1560, to: 1560, duration: 0.06, gain: 0.25 });
    },
    plantDone() {
      tone({ type: 'sine', from: 660, to: 990, duration: 0.25, gain: 0.25 });
      tone({ type: 'sine', from: 990, to: 1320, duration: 0.25, gain: 0.2, delay: 0.2 });
    },
    explosion() {
      noise({ duration: 1.1, filterType: 'lowpass', frequency: 320, q: 0.5, gain: 1.0, decay: 1.0 });
      tone({ type: 'sine', from: 90, to: 28, duration: 0.9, gain: 0.7 });
    },
    defuse() {
      tone({ type: 'sine', from: 1170, to: 1170, duration: 0.05, gain: 0.18 });
      tone({ type: 'sine', from: 1170, to: 1170, duration: 0.05, gain: 0.18, delay: 0.15 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ type: 'triangle', from: f, to: f, duration: 0.22, gain: 0.22, delay: i * 0.14 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ type: 'triangle', from: f, to: f, duration: 0.22, gain: 0.2, delay: i * 0.14 }));
    },
    buy() {
      tone({ type: 'sine', from: 1046, to: 1046, duration: 0.07, gain: 0.18 });
      tone({ type: 'sine', from: 1568, to: 1568, duration: 0.09, gain: 0.16, delay: 0.07 });
    },
    denied() {
      tone({ type: 'square', from: 220, to: 180, duration: 0.12, gain: 0.14 });
    },
    tick() {
      tone({ type: 'sine', from: 1900, to: 1900, duration: 0.03, gain: 0.1 });
    },
  };
}

// All sound is synthesised with WebAudio: no audio files, no network, nothing to load.