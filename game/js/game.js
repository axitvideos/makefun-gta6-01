// game.js — Port Meridian: the main loop, input, camera, player, states,
// save/load, and the ?shot= presets the screenshots use.
import { mulberry32, clamp, dist, angleTo, randRange } from './util.js';
import {
  buildCity, drawCity, collideCircle, landmarkDoor, findLandmark,
  WORLD_W, WORLD_H, ROADS_X, ROADS_Y,
} from './city.js';
import {
  makeCar, spawnTraffic, spawnParked, updateTraffic, updatePlayerCar,
  updatePoliceCar, drawCar, separateCars,
} from './vehicles.js';
import {
  spawnPeds, makeGang, updatePeds, updateGang, updateCop, drawPerson,
} from './people.js';
import {
  makeBullets, makeParticles, makePickups, fireBullet, burst,
  updateBullets, updateParticles, drawBullets, drawParticles, drawPickups,
} from './combat.js';
import { makeWanted, addHeat, updateWanted, updatePolice, starsForHeat } from './police.js';
import { MISSIONS, MissionRunner, TaxiGig } from './missions.js';
import { updateHud, drawMinimap, drawObjectiveArrow } from './hud.js';
import {
  initAudio, setEngine, setSiren, setMuted, isMuted,
  sfxShot, sfxPickup, sfxClick, sfxHurt, sfxDoor, startMusic,
} from './audio.js';

const SAVE_KEY = 'port-meridian-save-v1';
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') || '7');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = Math.min(window.innerWidth, 1920);
  canvas.height = Math.min(window.innerHeight, 1080);
}
window.addEventListener('resize', resize);
resize();

const city = buildCity(SEED);
city.ROADS_X = ROADS_X;
city.ROADS_Y = ROADS_Y;

const game = {
  canvas, city,
  state: 'title', // title | playing | paused | busted | wasted | complete
  over: false,
  time: 0,
  clock: 18 * 60 + 32, // game clock in minutes, starts 18:32
  money: 250,
  player: {
    kind: 'player', x: 1500, y: 1450, angle: 0, hp: 100, ammo: 12,
    alive: true, inCar: false, car: null, speed: 0,
    shirt: '#e8e8e8', skin: '#e8b98a', flash: 0, fireCd: 0, reloadT: 0,
  },
  cars: [], peds: [], gang: [], cops: [],
  bullets: makeBullets(), particles: makeParticles(), pickups: makePickups(),
  wanted: makeWanted(),
  camera: { x: 1500, y: 1450 },
  zoom: 1.05,
  objective: 'Press M to start your first job',
  missionTitle: '',
  marker: null,
  timerText: '',
  holdProgress: 0,
  missionsDone: 0,
  vehicleFns: { updatePoliceCar },
  peopleFns: { updateCop },
  autoDrive: false,
  shotFrames: 0,
  toasts: [],
  save: null,
};

const missions = new MissionRunner({
  get player() { return game.player; },
  get city() { return game.city; },
  get missionsDone() { return game.missionsDone; },
  toast: (t, s) => toast(t, s),
  setMarker: (x, y, label) => { game.marker = { x, y, label }; },
  clearMarker: () => { game.marker = null; },
  setObjective: (t) => { game.objective = t; },
  setTimer: (s) => { game.timerText = s > 0 ? '⏱ ' + Math.ceil(s) + 's' : ''; },
  setHoldProgress: (v) => { game.holdProgress = v; },
  holdingE: () => keys.has('KeyE'),
  playerPos: () => ({ x: game.player.x, y: game.player.y }),
  spawnGang: (x, y, n) => spawnGang(x, y, n),
  spawnCash: (x, y, v) => { game.pickups.push({ kind: 'cash', x, y, value: v }); },
  addMoney: (v) => { game.money += v; },
  addHeat: (v) => addHeat(game.wanted, v, game.time),
  setWantedStars: (s) => { game.wanted.heat = [0, 50, 120, 200, 300, 420][s] || 0; game.wanted.stars = s; game.wanted.lastCrime = game.time; },
  onMissionComplete: (i) => onMissionComplete(i),
});
const taxi = new TaxiGig({
  get player() { return game.player; },
  get missionsDone() { return game.missionsDone; },
  playerPos: () => ({ x: game.player.x, y: game.player.y }),
  setMarker: (x, y, label) => { game.marker = { x, y, label }; },
  clearMarker: () => { game.marker = null; },
  addMoney: (v) => { game.money += v; },
  toast: (t, s) => toast(t, s),
});

// ---------- world population ----------
const rng = mulberry32(SEED);
game.cars = [...spawnTraffic(rng, 14, 1500, 1450), ...spawnParked(rng, 18)];
game.peds = spawnPeds(rng, 42, 1500, 1450);

function spawnGang(x, y, n) {
  for (let i = 0; i < n; i++) {
    const gx = x + randRange(Math.random, -90, 90);
    const gy = y + randRange(Math.random, -60, 60);
    game.gang.push(makeGang(gx, gy, Math.random));
  }
}

// ---------- input ----------
const keys = new Set();
let mouse = { x: canvas.width / 2, y: canvas.height / 2, down: false };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyM') startNextMission();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'KeyE') tryEnterExitCar();
  if (e.code === 'KeyH') toggleHelp();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { mouse.down = true; initAudio(); startMusic(); } });
window.addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- toasts ----------
function toast(text, secs) {
  game.toasts.push({ text, until: game.time + (secs || 4) });
  if (game.toasts.length > 3) game.toasts.shift();
  const el = document.getElementById('toast');
  el.innerHTML = game.toasts.map((t) => '<div>' + t.text + '</div>').join('');
}

// ---------- missions ----------
function startNextMission() {
  if (game.state !== 'playing') return;
  if (missions.current) { toast('Finish the current job first', 3); return; }
  if (game.missionsDone >= MISSIONS.length) { toast('Story complete — free roam. Taxi fares still pay.', 4); return; }
  missions.startMission(game.missionsDone);
  game.missionTitle = MISSIONS[game.missionsDone].title;
  saveGame();
}

function onMissionComplete(i) {
  game.missionsDone = i + 1;
  game.missionTitle = '';
  game.timerText = '';
  if (game.missionsDone >= MISSIONS.length) {
    game.state = 'complete';
    showOverlay('complete');
  }
  saveGame();
}

// ---------- save / load ----------
function saveGame() {
  try {
    const p = game.player;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: game.money, missionsDone: game.missionsDone, hp: p.hp,
      x: p.x, y: p.y, clock: game.clock,
    }));
  } catch (e) { /* storage unavailable: keep playing */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function applySave(s) {
  game.money = s.money || 250;
  game.missionsDone = s.missionsDone || 0;
  game.player.hp = s.hp || 100;
  game.player.x = s.x || 1500;
  game.player.y = s.y || 1450;
  game.clock = s.clock || 18 * 60 + 32;
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
}

// ---------- player ----------
function reloadWeapon() {
  const p = game.player;
  if (p.inCar || p.reloadT > 0 || p.ammo === 12) return;
  p.reloadT = 0.7;
  sfxClick();
}

function tryEnterExitCar() {
  const p = game.player;
  if (game.state !== 'playing') return;
  if (p.inCar) {
    const car = p.car;
    car.driver = 'parked';
    car.speed = 0;
    p.inCar = false;
    p.car = null;
    p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
    p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
    const pos = { x: p.x, y: p.y };
    collideCircle(city, pos, 11);
    p.x = pos.x; p.y = pos.y;
    sfxDoor();
    return;
  }
  let best = null, bd = 80;
  for (const car of game.cars) {
    if (car.driver === 'police') continue;
    const d = dist(p.x, p.y, car.x, car.y);
    if (d < bd && Math.abs(car.speed) < 80) { bd = d; best = car; }
  }
  if (best) {
    best.driver = 'player';
    best.parked = false;
    p.inCar = true;
    p.car = best;
    p.x = best.x; p.y = best.y;
    sfxDoor();
    if (!best.owned) {
      best.owned = true;
      addHeat(game.wanted, 40, game.time);
      toast('Car stolen — the MPD noticed (+1 star)', 3);
    }
    missions.onCarEntered();
  }
}

function damagePlayer(dmg, cause) {
  const p = game.player;
  if (!p.alive || game.state !== 'playing') return;
  p.hp -= dmg;
  p.flash = 0.15;
  sfxHurt();
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    endRun('wasted', cause);
  }
}
game.damagePlayer = damagePlayer; // police.js calls it through the game object

function endRun(kind, cause) {
  game.over = true;
  game.state = kind;
  setEngine(0, false);
  setSiren(0);
  const lost = Math.floor(game.money * 0.15);
  game.money -= lost;
  document.getElementById('end-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  document.getElementById('end-text').textContent =
    (kind === 'busted' ? 'The MPD took you in. ' : 'You didn\'t make it. ') +
    (cause ? '(' + cause + ') ' : '') + 'You lost $' + lost + ' in fines and hospital bills.';
  showOverlay('end');
  saveGame();
}

function respawn() {
  const p = game.player;
  const door = landmarkDoor(city, 'hospital');
  p.x = door.x; p.y = door.y;
  p.hp = 100; p.ammo = 12; p.alive = true;
  if (p.inCar && p.car) { p.car.driver = 'parked'; p.car = null; }
  p.inCar = false;
  game.wanted.heat = 0; game.wanted.stars = 0;
  game.camera.x = p.x; game.camera.y = p.y;
  game.over = false;
  game.state = 'playing';
  hideOverlays();
  toast('Patched up at St. Anselm. The heat is off — for now.', 4);
  saveGame();
}

// ---------- overlays ----------
function showOverlay(which) {
  for (const id of ['title-screen', 'pause-screen', 'end-screen', 'complete-screen', 'help-screen']) {
    document.getElementById(id).classList.add('hidden');
  }
  if (which) document.getElementById(which + '-screen').classList.remove('hidden');
}
function hideOverlays() { showOverlay(null); }

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    showOverlay('pause');
    saveGame();
  } else if (game.state === 'paused') {
    game.state = 'playing';
    hideOverlays();
  }
}
function toggleHelp() {
  if (game.state !== 'playing') return;
  const el = document.getElementById('help-screen');
  el.classList.toggle('hidden');
}

// ---------- UI wiring ----------
document.getElementById('btn-start').addEventListener('click', () => {
  initAudio(); startMusic(); sfxClick();
  game.state = 'playing';
  hideOverlays();
  toast('Welcome to Port Meridian. Press M for your first job.', 5);
});
document.getElementById('btn-continue').addEventListener('click', () => {
  initAudio(); startMusic(); sfxClick();
  const s = loadSave();
  if (s) applySave(s);
  game.state = 'playing';
  hideOverlays();
  toast('Back on the streets. Press M for the next job.', 4);
});
document.getElementById('btn-resume').addEventListener('click', () => { sfxClick(); togglePause(); });
document.getElementById('btn-save').addEventListener('click', () => { saveGame(); sfxClick(); toast('Progress saved', 2); });
document.getElementById('btn-mute').addEventListener('click', (e) => {
  setMuted(!isMuted());
  e.target.textContent = isMuted() ? '🔇 Sound: Off' : '🔊 Sound: On';
});
document.getElementById('btn-title').addEventListener('click', () => {
  game.state = 'title';
  showOverlay('title');
});
document.getElementById('btn-respawn').addEventListener('click', () => { sfxClick(); respawn(); });
document.getElementById('btn-free-roam').addEventListener('click', () => {
  sfxClick();
  game.state = 'playing';
  hideOverlays();
  toast('Story complete. Port Meridian is yours — free roam.', 5);
});
document.getElementById('btn-help-close').addEventListener('click', () => {
  document.getElementById('help-screen').classList.add('hidden');
});
if (loadSave()) document.getElementById('btn-continue').style.display = 'inline-block';

// ---------- per-frame update ----------
function inputState() {
  return {
    up: keys.has('KeyW') || keys.has('ArrowUp') || game.autoDrive,
    down: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
  };
}

function update(dt) {
  game.time += dt;
  game.clock += dt * 0.25; // ~4 game-minutes a real minute... actually 0.25 min/s
  if (game.clock >= 24 * 60) game.clock -= 24 * 60;
  const p = game.player;
  const input = inputState();

  // Camera target.
  const target = p.inCar && p.car ? p.car : p;

  if (game.state === 'playing' && p.alive) {
    if (p.inCar && p.car) {
      const car = p.car;
      const spd = updatePlayerCar(dt, city, game.cars, car, input);
      p.x = car.x; p.y = car.y;
      p.angle = car.angle;
      setEngine(Math.abs(car.speed) / car.model.top, true);
      // Running over pedestrians is a crime.
      for (let i = game.peds.length - 1; i >= 0; i--) {
        const ped = game.peds[i];
        if (Math.abs(car.speed) > 120 && dist(car.x, car.y, ped.x, ped.y) < 26) {
          burst(game.particles, ped.x, ped.y, '#e5484d', 10, 180);
          game.peds.splice(i, 1);
          addHeat(game.wanted, 30, game.time);
          toast('Pedestrian hit — the MPD noticed', 3);
        }
      }
      void spd;
    } else {
      setEngine(0, false);
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const sp = sprint ? 320 : 205;
      let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) { mx /= len; my /= len; }
      const pos = { x: p.x + mx * sp * dt, y: p.y + my * sp * dt };
      collideCircle(city, pos, 11);
      p.x = pos.x; p.y = pos.y;
      // Aim at the mouse.
      const wx = game.camera.x + (mouse.x - canvas.width / 2) / game.zoom;
      const wy = game.camera.y + (mouse.y - canvas.height / 2) / game.zoom;
      p.angle = angleTo(p.x, p.y, wx, wy);
      // Shooting.
      if (p.fireCd > 0) p.fireCd -= dt;
      if (p.reloadT > 0) {
        p.reloadT -= dt;
        if (p.reloadT <= 0) p.ammo = 12;
      }
      if (mouse.down && p.fireCd <= 0 && p.reloadT <= 0 && p.ammo > 0) {
        p.fireCd = 0.17;
        p.ammo--;
        fireBullet(game.bullets, p.x, p.y, p.angle, 'player', 0.05);
        sfxShot();
        burst(game.particles, p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22, '#ffd166', 3, 120);
        if (p.ammo === 0) toast('Out of ammo — press R to reload', 2.5);
      }
      // Pickups.
      for (let i = game.pickups.length - 1; i >= 0; i--) {
        const pk = game.pickups[i];
        if (dist(p.x, p.y, pk.x, pk.y) < 32) {
          if (pk.kind === 'cash') { game.money += pk.value; toast('+$' + pk.value, 2); }
          else if (pk.kind === 'ammo') { p.ammo = 12; toast('Ammo restocked', 2); }
          else if (pk.kind === 'health') { p.hp = 100; toast('Health restored', 2); }
          sfxPickup();
          game.pickups.splice(i, 1);
        }
      }
      // Bump into cars: pushed out, hurt if they're fast.
      for (const car of game.cars) {
        if (car.driver === 'player') continue;
        const dx = p.x - car.x, dy = p.y - car.y;
        const d = Math.hypot(dx, dy);
        if (d < 30 && d > 0.01) {
          const push = (30 - d);
          p.x += (dx / d) * push;
          p.y += (dy / d) * push;
          if (Math.abs(car.speed) > 150) damagePlayer(10, 'hit by a car');
        }
      }
    }
    if (p.flash > 0) p.flash -= dt;

    updateTraffic(dt, city, game.cars, p.car);
    separateCars(game.cars, dt);
    updatePeds(dt, city, game.peds, game.bullets.length ? { x: p.x, y: p.y } : null);
    for (const g of game.gang) {
      updateGang(dt, city, g, p, (from, tgt, acc) => {
        const a = angleTo(from.x, from.y, tgt.x, tgt.y) + (Math.random() - 0.5) * 0.35;
        fireBullet(game.bullets, from.x, from.y, a, 'gang', 0.12);
        sfxShot();
      });
    }
    game.gang = game.gang.filter((g) => !g.dead || (game.time - (g.deadAt || 0)) < 10);
    for (const g of game.gang) if (g.dead && !g.deadAt) g.deadAt = game.time;
    updateBullets(dt, city, game.bullets, game.particles, {
      gang: game.gang, cops: game.cops, player: p,
      onPlayerHit: (d) => damagePlayer(d, 'shot'),
      onGangDown: (g) => {
        missions.onGangDown();
        if (Math.random() < 0.35) game.pickups.push({ kind: Math.random() < 0.5 ? 'ammo' : 'health', x: g.x, y: g.y });
      },
      onCopDown: () => { addHeat(game.wanted, 80, game.time); },
      onCarHit: () => {},
    }, p, game.cars);
    updateParticles(dt, game.particles);
    updateWanted(dt, game.wanted, game.time);
    updatePolice(dt, game.wanted, game, game.time);
    setSiren(starsForHeat(game.wanted.heat) / 5);
    missions.update(dt);
    taxi.update(dt);
    // Keep the streets populated.
    if (game.peds.length < 30 && Math.random() < dt * 0.5) {
      const fresh = spawnPeds(mulberry32(Math.floor(Math.random() * 1e9)), 1, p.x, p.y);
      game.peds.push(...fresh);
    }
    if (game.cars.filter((c) => c.driver === 'traffic').length < 10 && Math.random() < dt * 0.3) {
      game.cars.push(...spawnTraffic(mulberry32(Math.floor(Math.random() * 1e9)), 1, p.x, p.y));
    }
  }

  // Camera follows smoothly.
  const k = Math.min(1, 5 * dt);
  game.camera.x += (target.x - game.camera.x) * k;
  game.camera.y += (target.y - game.camera.y) * k;
  game.camera.x = clamp(game.camera.x, canvas.width / 2 / game.zoom, WORLD_W - canvas.width / 2 / game.zoom);
  game.camera.y = clamp(game.camera.y, canvas.height / 2 / game.zoom, WORLD_H - canvas.height / 2 / game.zoom);
  updateHud(game);
  document.getElementById('status').textContent =
    'state=' + game.state + ' money=$' + game.money + ' hp=' + Math.round(game.player.hp) +
    ' stars=' + starsForHeat(game.wanted.heat) + ' missions=' + game.missionsDone +
    ' objective=' + game.objective;
}

// ---------- render ----------
function render() {
  const vw = canvas.width, vh = canvas.height;
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, vw, vh);
  const view = {
    x0: game.camera.x - vw / 2 / game.zoom,
    y0: game.camera.y - vh / 2 / game.zoom,
    x1: game.camera.x + vw / 2 / game.zoom,
    y1: game.camera.y + vh / 2 / game.zoom,
  };
  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(game.zoom, game.zoom);
  ctx.translate(-game.camera.x, -game.camera.y);

  drawCity(ctx, city, view);

  // Mission marker beacon.
  if (game.marker) {
    const m = game.marker;
    const pulse = 1 + Math.sin(game.time * 4) * 0.12;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(m.x, m.y, 34 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d2b36';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◆', m.x, m.y - 42);
    ctx.textAlign = 'left';
  }

  drawPickups(ctx, game.pickups, view, game.time);
  for (const ped of game.peds) drawPerson(ctx, ped, view);
  for (const car of game.cars) drawCar(ctx, car, view);
  for (const g of game.gang) if (!g.dead) drawPerson(ctx, g, view);
  for (const c of game.cops) if (!c.dead) drawPerson(ctx, c, view);
  const p = game.player;
  if (p.alive && !p.inCar) {
    drawPerson(ctx, p, view);
    // Aim line hint.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24);
    ctx.lineTo(p.x + Math.cos(p.angle) * 44, p.y + Math.sin(p.angle) * 44);
    ctx.stroke();
  }
  drawBullets(ctx, game.bullets, view);
  drawParticles(ctx, game.particles, view);
  ctx.restore();

  // Screen-space HUD: minimap + objective arrow + crosshair.
  if (game.state === 'playing' || game.state === 'paused') {
    drawMinimap(ctx, game);
    drawObjectiveArrow(ctx, game);
    if (!p.inCar && game.state === 'playing') {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mouse.x - 13, mouse.y); ctx.lineTo(mouse.x - 5, mouse.y);
      ctx.moveTo(mouse.x + 5, mouse.y); ctx.lineTo(mouse.x + 13, mouse.y);
      ctx.moveTo(mouse.x, mouse.y - 13); ctx.lineTo(mouse.x, mouse.y - 5);
      ctx.moveTo(mouse.x, mouse.y + 5); ctx.lineTo(mouse.x, mouse.y + 13);
      ctx.stroke();
    }
  }
  // Red flash when hurt.
  if (p.flash > 0 && game.state === 'playing') {
    ctx.fillStyle = 'rgba(229,72,77,' + (p.flash * 1.2) + ')';
    ctx.fillRect(0, 0, vw, vh);
  }
  // Wanted flash at screen edge when stars >= 3.
  if (starsForHeat(game.wanted.heat) >= 3 && game.state === 'playing') {
    const a = 0.10 + 0.06 * Math.sin(game.time * 6);
    ctx.fillStyle = 'rgba(45,107,255,' + a + ')';
    ctx.fillRect(0, 0, vw, vh);
  }
}

game.clockText = function () {
  const h = Math.floor(game.clock / 60) % 24;
  const m = Math.floor(game.clock % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
};

// ---------- shot presets ----------
function applyShotPreset() {
  if (!SHOT) return;
  if (SHOT === 'start') {
    game.state = 'title';
    showOverlay('title');
    game.camera.x = 1500; game.camera.y = 1050;
    return;
  }
  game.state = 'playing';
  hideOverlays();
  initAudio();
  if (SHOT === 'drive' || SHOT === 'chase') {
    // Put Rook in a car on Meridian Boulevard, mid-traffic.
    const car = makeCar(1500, 1050, 0, { name: 'Comet', color: '#c94f3d', w: 46, h: 22, top: 560, accel: 420 }, 'player');
    car.owned = true;
    game.cars.push(car);
    game.player.inCar = true;
    game.player.car = car;
    game.player.x = car.x; game.player.y = car.y;
    game.camera.x = car.x; game.camera.y = car.y;
    game.autoDrive = true;
    game.objective = 'Cruise Meridian Boulevard — Port Meridian is yours';
    if (SHOT === 'chase') {
      game.wanted.heat = 200;
      game.wanted.stars = 3;
      game.wanted.lastCrime = game.time;
      game.objective = 'Lose the MPD — 3 stars and climbing';
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const pc = makeCar(1500 + Math.cos(a) * 420, 1050 + Math.sin(a) * 320, 0, { name: 'Interceptor', color: '#22262e', w: 48, h: 23, top: 620, accel: 480 }, 'police');
        pc.speed = 300;
        game.cars.push(pc);
      }
    }
  } else if (SHOT === 'mission') {
    missions.startMission(2);
    missions.step = 1;
    missions.enterStep();
    const door = landmarkDoor(city, 'docks');
    game.player.x = door.x - 60;
    game.player.y = door.y + 150;
    game.player.angle = angleTo(game.player.x, game.player.y, door.x, door.y + 120);
    game.camera.x = game.player.x + 120;
    game.camera.y = game.player.y + 40;
    game.objective = 'Clear out the Harbor Kings (5 left)';
    mouse.x = canvas.width / 2 + 150;
    mouse.y = canvas.height / 2 - 60;
  }
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.state === 'title') {
    // Slow pan over the city behind the title screen.
    game.time += dt;
    document.body.classList.add('title-mode');
    game.camera.x = 1500 + Math.sin(game.time * 0.05) * 400;
    game.camera.y = 1050 + Math.cos(game.time * 0.04) * 260;
    updateHud(game);
  } else {
    document.body.classList.remove('title-mode');
    update(dt);
  }
  render();
  if (SHOT) {
    game.shotFrames++;
    if (game.shotFrames > 90) window.__shotReady = true;
  }
  requestAnimationFrame(frame);
}

applyShotPreset();
if (!SHOT) showOverlay('title');
// Debug/testing handle: lets a playtest move the player and read state.
// It changes nothing in the game itself.
window.__pm = { game, missions, taxi };
requestAnimationFrame(frame);
