// audio.js — every sound in Port Meridian is synthesized live with WebAudio:
// engine hum, sirens, gunshots, crashes, pickups and a small bass groove.
// No audio files, no network. Safe to call before any user gesture.
let ctx = null;
let master = null;
let muted = false;
let engineOsc = null;
let engineGain = null;
let engineFilter = null;
let sirenOsc = null;
let sirenGain = null;
let sirenLfo = null;
let musicTimer = null;
let musicStep = 0;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    startEngine();
    startSiren();
  } catch (e) { ctx = null; }
}

export function setMuted(m) {
  muted = m;
  if (master && ctx) master.gain.setValueAtTime(m ? 0 : 0.5, ctx.currentTime);
}
export function isMuted() { return muted; }

function startEngine() {
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 55;
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 320;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
}

function startSiren() {
  sirenOsc = ctx.createOscillator();
  sirenOsc.type = 'triangle';
  sirenOsc.frequency.value = 720;
  sirenLfo = ctx.createOscillator();
  sirenLfo.type = 'square';
  sirenLfo.frequency.value = 0.9;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  sirenLfo.connect(lfoGain);
  lfoGain.connect(sirenOsc.frequency);
  sirenGain = ctx.createGain();
  sirenGain.gain.value = 0;
  sirenOsc.connect(sirenGain);
  sirenGain.connect(master);
  sirenOsc.start();
  sirenLfo.start();
}

// speed01: 0..1 while driving. Call every frame.
export function setEngine(speed01, driving) {
  if (!ctx || !engineGain) return;
  const t = ctx.currentTime;
  engineGain.gain.setTargetAtTime(driving ? 0.05 + speed01 * 0.09 : 0.0, t, 0.1);
  engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, t, 0.1);
  engineFilter.frequency.setTargetAtTime(280 + speed01 * 900, t, 0.1);
}

// wanted01: 0 when no heat, 1 at five stars.
export function setSiren(wanted01) {
  if (!ctx || !sirenGain) return;
  sirenGain.gain.setTargetAtTime(wanted01 > 0 ? 0.018 + wanted01 * 0.02 : 0, ctx.currentTime, 0.3);
}

function noiseBuffer(dur) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function blip(freq, dur, type, vol, slideTo) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export function sfxShot() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.12);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
  blip(160, 0.08, 'square', 0.15, 60);
}

export function sfxCrash() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.25);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
  blip(90, 0.2, 'sine', 0.3, 40);
}

export function sfxPickup() { blip(660, 0.09, 'sine', 0.22); setTimeout(() => blip(990, 0.12, 'sine', 0.22), 70); }
export function sfxClick() { blip(440, 0.05, 'square', 0.1); }
export function sfxHurt() { blip(220, 0.18, 'sawtooth', 0.2, 90); }
export function sfxBusted() { blip(330, 0.4, 'sawtooth', 0.2, 110); blip(220, 0.5, 'sawtooth', 0.15, 80); }
export function sfxMissionDone() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => setTimeout(() => blip(n, 0.22, 'triangle', 0.22), i * 110));
}
export function sfxFail() { blip(392, 0.3, 'triangle', 0.2, 196); }
export function sfxDoor() { blip(300, 0.08, 'square', 0.12, 180); }

// A lazy bass-and-hat groove, scheduled a bar at a time.
const BASS = [55, 0, 55, 0, 65.4, 0, 49, 0, 55, 0, 55, 0, 73.4, 0, 82.4, 0];
export function startMusic() {
  if (!ctx || musicTimer) return;
  musicTimer = setInterval(() => {
    if (!ctx || muted) { musicStep = (musicStep + 1) % 16; return; }
    const n = BASS[musicStep % 16];
    if (n) blip(n, 0.22, 'triangle', 0.12);
    if (musicStep % 4 === 2) blip(1200, 0.03, 'square', 0.03);
    musicStep = (musicStep + 1) % 16;
  }, 210);
}
export function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
