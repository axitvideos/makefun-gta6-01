// vehicles.js — cars: player driving physics, traffic that follows the road
// grid, parked cars to steal, and police interceptors. All original models.
import { mulberry32, pick, clamp, angleDiff, randRange, randInt } from './util.js';
import { ROADS_X, ROADS_Y, ROAD_W, HARBOR_Y, WORLD_W, WORLD_H, collideCircle, isOnRoad } from './city.js';
import { sfxCrash } from './audio.js';

export const CAR_MODELS = [
  { name: 'Comet', color: '#c94f3d', w: 46, h: 22, top: 560, accel: 420 },
  { name: 'Vulture', color: '#3d6fc9', w: 48, h: 22, top: 520, accel: 380 },
  { name: 'Pinnacle', color: '#d8b23d', w: 44, h: 21, top: 540, accel: 400 },
  { name: 'Dune', color: '#5f8a4e', w: 50, h: 24, top: 470, accel: 340 },
  { name: 'Hauler', color: '#8a6f4d', w: 62, h: 26, top: 420, accel: 300 },
  { name: 'Sable', color: '#5a4a6e', w: 46, h: 22, top: 500, accel: 360 },
];
const POLICE_MODEL = { name: 'Interceptor', color: '#22262e', w: 48, h: 23, top: 620, accel: 480 };

let nextId = 1;

export function makeCar(x, y, angle, model, driver) {
  return {
    id: nextId++, x, y, angle, speed: 0,
    model, driver: driver || 'traffic',
    // traffic AI state
    axis: 'v', road: x, dir: 1, lane: 0,
    stuck: 0, honk: 0,
    // police AI state
    ram: 0, sirenPhase: Math.random() * 6,
    parked: driver === 'parked',
    crashed: 0,
  };
}

export function spawnTraffic(rng, n, avoidX, avoidY) {
  const cars = [];
  let tries = 0;
  while (cars.length < n && tries < n * 30) {
    tries++;
    const vertical = rng() < 0.5;
    let x, y, angle, axis, road, dir;
    if (vertical) {
      road = pick(rng, ROADS_X);
      dir = rng() < 0.5 ? 1 : -1;
      x = road + (dir > 0 ? 26 : -26);
      y = randRange(rng, 100, HARBOR_Y - 100);
      angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      axis = 'v';
    } else {
      road = pick(rng, ROADS_Y);
      dir = rng() < 0.5 ? 1 : -1;
      y = road + (dir > 0 ? 26 : -26);
      x = randRange(rng, 100, WORLD_W - 100);
      angle = dir > 0 ? 0 : Math.PI;
      axis = 'h';
    }
    if (avoidX !== undefined && Math.hypot(x - avoidX, y - avoidY) < 500) continue;
    const car = makeCar(x, y, angle, pick(rng, CAR_MODELS), 'traffic');
    car.axis = axis; car.road = road; car.dir = dir;
    car.speed = randRange(rng, 120, 200);
    cars.push(car);
  }
  return cars;
}

export function spawnParked(rng, n) {
  const cars = [];
  let tries = 0;
  while (cars.length < n && tries < n * 40) {
    tries++;
    const vertical = rng() < 0.5;
    let x, y, angle;
    if (vertical) {
      const road = pick(rng, ROADS_X);
      const side = rng() < 0.5 ? -1 : 1;
      x = road + side * (ROAD_W / 2 - 14);
      y = randRange(rng, 150, HARBOR_Y - 150);
      angle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const road = pick(rng, ROADS_Y);
      const side = rng() < 0.5 ? -1 : 1;
      y = road + side * (ROAD_W / 2 - 14);
      x = randRange(rng, 150, WORLD_W - 150);
      angle = side > 0 ? 0 : Math.PI;
    }
    if (cars.some((c) => Math.hypot(c.x - x, c.y - y) < 90)) continue;
    cars.push(makeCar(x, y, angle, pick(rng, CAR_MODELS), 'parked'));
  }
  return cars;
}

function carRadius(car) { return Math.max(car.model.w, car.model.h) * 0.55; }

// Circle-vs-circle separation between cars; returns true on a hard hit.
export function separateCars(cars, dt) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const r = carRadius(a) + carRadius(b) - 14;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (r - d) / 2;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 120 && a.crashed <= 0 && b.crashed <= 0) {
          a.crashed = 0.4; b.crashed = 0.4;
          a.speed *= 0.5; b.speed *= 0.5;
          sfxCrash();
        }
      }
    }
  }
}

export function updateTraffic(dt, city, cars, playerCar) {
  for (const car of cars) {
    if (car.driver === 'parked' || car.driver === 'player' || car.driver === 'police') continue;
    if (car.crashed > 0) { car.crashed -= dt; car.speed *= (1 - 2 * dt); }
    // Follow the current road; at an intersection, sometimes turn.
    const speed = car.speed;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    car.x += fx * speed * dt;
    car.y += fy * speed * dt;
    if (car.axis === 'v') {
      const nearY = ROADS_Y.find((ry) => Math.abs(car.y - ry) < 26);
      if (nearY !== undefined && Math.abs(car.y - nearY) < 8 && Math.random() < 0.012) {
        // Turn onto the crossing road.
        car.axis = 'h'; car.road = nearY;
        car.dir = Math.random() < 0.5 ? 1 : -1;
        car.angle = car.dir > 0 ? 0 : Math.PI;
        car.y = nearY + (car.dir > 0 ? 26 : -26);
      } else {
        car.y = car.y; // stay on the lane
        const targetX = car.road + (car.dir > 0 ? 26 : -26);
        car.x += (targetX - car.x) * Math.min(1, 2 * dt);
        car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      if (car.y > HARBOR_Y - 80 || car.y < 60) { car.dir *= -1; car.angle += Math.PI; }
    } else {
      const nearX = ROADS_X.find((rx) => Math.abs(car.x - rx) < 26);
      if (nearX !== undefined && Math.abs(car.x - nearX) < 8 && Math.random() < 0.012) {
        car.axis = 'v'; car.road = nearX;
        car.dir = Math.random() < 0.5 ? 1 : -1;
        car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        car.x = nearX + (car.dir > 0 ? 26 : -26);
      } else {
        const targetY = car.road + (car.dir > 0 ? 26 : -26);
        car.y += (targetY - car.y) * Math.min(1, 2 * dt);
        car.angle = car.dir > 0 ? 0 : Math.PI;
      }
      if (car.x > WORLD_W - 60 || car.x < 60) { car.dir *= -1; car.angle += Math.PI; }
    }
    // Slow for the car ahead on the same road.
    for (const other of cars) {
      if (other === car || other.driver === 'parked') continue;
      const dx = other.x - car.x, dy = other.y - car.y;
      const ahead = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
      const side = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
      if (ahead > 0 && ahead < 90 && side < 30) { car.speed = Math.max(60, car.speed - 260 * dt); }
      else if (car.speed < 170) { car.speed = Math.min(190, car.speed + 40 * dt); }
    }
    // Keep off buildings (a turned car can clip a corner).
    const p = { x: car.x, y: car.y };
    if (collideCircle(city, p, 22)) { car.x = p.x; car.y = p.y; car.speed *= 0.6; }
  }
  separateCars(cars, dt);
}

// Player driving: arcade handling with a little drift.
export function updatePlayerCar(dt, city, cars, car, input) {
  const m = car.model;
  const fwd = (input.up ? 1 : 0) - (input.down ? 0.55 : 0);
  const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  if (fwd > 0) car.speed += m.accel * fwd * dt;
  else if (fwd < 0) car.speed += m.accel * fwd * dt * 1.4;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 240 * dt);
  if (Math.abs(car.speed) > 40) {
    car.angle += steer * 2.1 * dt * Math.sign(car.speed) * clamp(Math.abs(car.speed) / 260, 0.35, 1);
  }
  car.speed = clamp(car.speed, -m.top * 0.45, m.top);
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  const prev = { x: car.x, y: car.y };
  car.x += fx * car.speed * dt;
  car.y += fy * car.speed * dt;
  const p = { x: car.x, y: car.y };
  if (collideCircle(city, p, 22)) {
    if (Math.abs(car.speed) > 220) sfxCrash();
    car.x = prev.x; car.y = prev.y;
    car.speed *= -0.25;
  } else { car.x = p.x; car.y = p.y; }
  if (car.crashed > 0) car.crashed -= dt;
  return Math.abs(car.speed);
}

// Police interceptor AI: chase the player's car (or the player on foot).
export function updatePoliceCar(dt, city, cars, car, target) {
  const m = car.model;
  const want = Math.atan2(target.y - car.y, target.x - car.x);
  const d = angleDiff(car.angle, want);
  car.angle += clamp(d, -2.6 * dt, 2.6 * dt);
  const distTo = Math.hypot(target.x - car.x, target.y - car.y);
  const targetSpeed = distTo > 500 ? m.top : distTo > 120 ? m.top * 0.8 : m.top * 0.45;
  car.speed += (targetSpeed - car.speed) * Math.min(1, 1.6 * dt);
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  const prev = { x: car.x, y: car.y };
  car.x += fx * car.speed * dt;
  car.y += fy * car.speed * dt;
  const p = { x: car.x, y: car.y };
  if (collideCircle(city, p, 22)) {
    car.x = prev.x; car.y = prev.y;
    car.speed *= 0.4;
    car.angle += (Math.random() - 0.5) * 1.2; // wiggle free of the wall
  } else { car.x = p.x; car.y = p.y; }
  // Ram the player when close.
  if (distTo < 70) {
    car.ram += dt;
    if (car.ram > 0.35) { car.ram = 0; }
  }
  car.sirenPhase += dt;
}

export function spawnPoliceCar(x, y) {
  const car = makeCar(x, y, 0, POLICE_MODEL, 'police');
  car.speed = 200;
  return car;
}

export function drawCar(ctx, car, view) {
  if (car.x < view.x0 - 80 || car.x > view.x1 + 80 || car.y < view.y0 - 80 || car.y > view.y1 + 80) return;
  const m = car.model;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.roundRect(-m.w / 2 + 3, -m.h / 2 + 4, m.w, m.h, 7); ctx.fill();
  // Body.
  ctx.fillStyle = m.color;
  ctx.beginPath(); ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, 7); ctx.stroke();
  // Cabin + windshield.
  ctx.fillStyle = 'rgba(20,30,40,0.85)';
  ctx.beginPath(); ctx.roundRect(-m.w * 0.12, -m.h / 2 + 3, m.w * 0.28, m.h - 6, 4); ctx.fill();
  ctx.fillStyle = 'rgba(160,200,220,0.7)';
  ctx.fillRect(m.w * 0.16, -m.h / 2 + 4, 4, m.h - 8);
  // Headlights / taillights.
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(m.w / 2 - 2, -m.h / 2 + 2, 3, 5);
  ctx.fillRect(m.w / 2 - 2, m.h / 2 - 7, 3, 5);
  ctx.fillStyle = '#ff4b3e';
  ctx.fillRect(-m.w / 2, -m.h / 2 + 2, 3, 5);
  ctx.fillRect(-m.w / 2, m.h / 2 - 7, 3, 5);
  if (car.driver === 'police') {
    // Light bar, flashing red/blue.
    const phase = Math.floor(car.sirenPhase * 6) % 2 === 0;
    ctx.fillStyle = phase ? '#ff2d2d' : '#2d6bff';
    ctx.fillRect(-6, -m.h / 2 - 2, 12, 6);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MPD', 0, 1);
    ctx.textAlign = 'left';
  }
  if (car.driver === 'player') {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-m.w / 2 - 2, -m.h / 2 - 2, m.w + 4, m.h + 4, 8); ctx.stroke();
  }
  ctx.restore();
}
