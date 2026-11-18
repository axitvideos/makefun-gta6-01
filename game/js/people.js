// people.js — the people of Port Meridian: pedestrians on the sidewalks,
// Harbor Kings gang members who fight back, and MPD officers on foot.
import { mulberry32, pick, randRange, randInt, clamp, angleTo, angleDiff, dist } from './util.js';
import { ROADS_X, ROADS_Y, ROAD_W, HARBOR_Y, WORLD_W, WORLD_H, collideCircle, isOnRoad } from './city.js';

const SHIRTS = ['#c94f3d', '#3d6fc9', '#d8b23d', '#5f8a4e', '#8a5f9e', '#e07a4a', '#4aa8a0', '#c9c9c9', '#7a3b3b', '#3b5a7a'];
const SKINS = ['#e8b98a', '#c98d5f', '#8a5a3b', '#f0c8a0', '#a06b42'];

export function makePed(rng, x, y) {
  return {
    kind: 'ped', x, y, angle: randRange(rng, 0, Math.PI * 2),
    speed: randRange(rng, 45, 75), tx: x, ty: y,
    shirt: pick(rng, SHIRTS), skin: pick(rng, SKINS),
    flee: 0, panic: 0, wait: randRange(rng, 0, 3),
  };
}

export function spawnPeds(rng, n, avoidX, avoidY) {
  const peds = [];
  let tries = 0;
  while (peds.length < n && tries < n * 30) {
    tries++;
    // Sidewalk spots: just off a road edge.
    const vertical = rng() < 0.5;
    let x, y;
    if (vertical) {
      const road = pick(rng, ROADS_X);
      x = road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 16);
      y = randRange(rng, 120, HARBOR_Y - 80);
    } else {
      const road = pick(rng, ROADS_Y);
      y = road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 16);
      x = randRange(rng, 120, WORLD_W - 120);
    }
    if (avoidX !== undefined && Math.hypot(x - avoidX, y - avoidY) < 400) continue;
    peds.push(makePed(rng, x, y));
  }
  return peds;
}

export function makeGang(x, y, rng) {
  return {
    kind: 'gang', x, y, angle: randRange(rng, 0, Math.PI * 2),
    hp: 60, speed: 95, shootCd: randRange(rng, 0.4, 1.4),
    shirt: '#2b2b33', skin: pick(rng, SKINS), vest: '#c94f3d',
    state: 'guard', tx: x, ty: y, dead: false, flash: 0,
  };
}

export function makeCop(x, y, rng) {
  return {
    kind: 'cop', x, y, angle: randRange(rng, 0, Math.PI * 2),
    hp: 100, speed: 150, shootCd: 1,
    shirt: '#1d2b4d', skin: pick(rng, SKINS),
    state: 'chase', bust: 0, dead: false, flash: 0,
  };
}

function pickWanderTarget(rng, p) {
  // A nearby sidewalk point.
  const vertical = rng() < 0.5;
  if (vertical) {
    const road = pick(rng, ROADS_X);
    p.tx = road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 16);
    p.ty = clamp(p.y + randRange(rng, -300, 300), 100, HARBOR_Y - 80);
  } else {
    const road = pick(rng, ROADS_Y);
    p.ty = road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 16);
    p.tx = clamp(p.x + randRange(rng, -300, 300), 100, WORLD_W - 100);
  }
}

export function updatePeds(dt, city, peds, danger) {
  for (const p of peds) {
    if (p.flee > 0) p.flee -= dt;
    if (danger && dist(p.x, p.y, danger.x, danger.y) < 320) {
      p.flee = 2.5;
      p.tx = p.x + (p.x - danger.x) * 1.5;
      p.ty = p.y + (p.y - danger.y) * 1.5;
    }
    const d = dist(p.x, p.y, p.tx, p.ty);
    if (d < 14) {
      p.wait -= dt;
      if (p.wait <= 0) { pickWanderTarget(Math.random, p); p.wait = randRange(Math.random, 0, 4); }
      continue;
    }
    const sp = p.flee > 0 ? p.speed * 2.6 : p.speed;
    const a = angleTo(p.x, p.y, p.tx, p.ty);
    p.angle = a;
    const nx = p.x + Math.cos(a) * sp * dt;
    const ny = p.y + Math.sin(a) * sp * dt;
    const pos = { x: nx, y: ny };
    collideCircle(city, pos, 10);
    p.x = pos.x; p.y = pos.y;
  }
}

// Gang AI: guard until the player is near, then close in and shoot.
export function updateGang(dt, city, gang, player, fireAt) {
  if (gang.dead) return;
  if (gang.flash > 0) gang.flash -= dt;
  const d = dist(gang.x, gang.y, player.x, player.y);
  const sees = d < 520;
  if (sees) {
    gang.state = 'fight';
    const want = angleTo(gang.x, gang.y, player.x, player.y);
    gang.angle = angleLerpSafe(gang.angle, want, Math.min(1, 6 * dt));
    if (d > 260) {
      const pos = { x: gang.x + Math.cos(want) * gang.speed * dt, y: gang.y + Math.sin(want) * gang.speed * dt };
      collideCircle(city, pos, 11);
      gang.x = pos.x; gang.y = pos.y;
    } else if (d < 140) {
      const pos = { x: gang.x - Math.cos(want) * gang.speed * 0.5 * dt, y: gang.y - Math.sin(want) * gang.speed * 0.5 * dt };
      collideCircle(city, pos, 11);
      gang.x = pos.x; gang.y = pos.y;
    }
    gang.shootCd -= dt;
    if (gang.shootCd <= 0 && d < 480) {
      gang.shootCd = randRange(Math.random, 0.9, 1.7);
      fireAt(gang, player, 0.72);
    }
  } else {
    gang.state = 'guard';
    gang.shootCd = Math.max(gang.shootCd, 0.4);
  }
}

function angleLerpSafe(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Foot-cop AI: run at the player; standing on them builds the bust meter.
export function updateCop(dt, city, cop, player, onBusted) {
  if (cop.dead) return;
  if (cop.flash > 0) cop.flash -= dt;
  const d = dist(cop.x, cop.y, player.x, player.y);
  const want = angleTo(cop.x, cop.y, player.x, player.y);
  cop.angle = angleLerpSafe(cop.angle, want, Math.min(1, 8 * dt));
  if (d > 34) {
    const pos = { x: cop.x + Math.cos(want) * cop.speed * dt, y: cop.y + Math.sin(want) * cop.speed * dt };
    collideCircle(city, pos, 11);
    cop.x = pos.x; cop.y = pos.y;
    cop.bust = Math.max(0, cop.bust - dt * 0.8);
  } else {
    cop.bust += dt;
    if (cop.bust > 1.4) onBusted();
  }
}

export function drawPerson(ctx, p, view) {
  if (p.x < view.x0 - 30 || p.x > view.x1 + 30 || p.y < view.y0 - 30 || p.y > view.y1 + 30) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(2, 3, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(p.angle);
  const flash = p.flash > 0;
  // Body.
  ctx.fillStyle = flash ? '#ffffff' : p.shirt;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  if (p.kind === 'gang') {
    ctx.fillStyle = '#c94f3d';
    ctx.fillRect(-6, -11, 12, 5); // vest stripe
  }
  if (p.kind === 'cop') {
    ctx.fillStyle = '#d8c95a';
    ctx.fillRect(-6, -11, 12, 3); // badge strip
  }
  // Head + facing gun/arm.
  ctx.fillStyle = flash ? '#ffffff' : p.skin;
  ctx.beginPath(); ctx.arc(7, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(5, 0, 6.5, Math.PI * 0.5, Math.PI * 1.5); ctx.fill(); // hair
  if (p.kind === 'gang' || p.kind === 'cop' || p.kind === 'player') {
    ctx.strokeStyle = '#1c1c22';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(8, 4); ctx.lineTo(20, 4); ctx.stroke(); // gun
  }
  ctx.restore();
  if (p.kind === 'gang' && !p.dead) {
    // Health pip.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(p.x - 14, p.y - 22, 28, 4);
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(p.x - 14, p.y - 22, 28 * Math.max(0, p.hp / 60), 4);
  }
}
