// police.js — the wanted system: heat, stars, MPD response, and getting busted.
// The Meridian Police Department answers in proportion to the stars.
import { randRange, clamp } from './util.js';
import { WORLD_W, WORLD_H } from './city.js';
import { spawnPoliceCar } from './vehicles.js';
import { makeCop } from './people.js';
import { sfxBusted } from './audio.js';

const STAR_HEAT = [0, 50, 120, 200, 300, 420]; // heat at which each star lights up

export function starsForHeat(heat) {
  let s = 0;
  for (let i = 1; i < STAR_HEAT.length; i++) if (heat >= STAR_HEAT[i]) s = i;
  return s;
}

export function makeWanted() {
  return { heat: 0, stars: 0, lastCrime: -999, crimeFlash: 0 };
}

export function addHeat(wanted, amount, now) {
  wanted.heat = Math.min(500, wanted.heat + amount);
  wanted.lastCrime = now;
  wanted.crimeFlash = 1;
  wanted.stars = starsForHeat(wanted.heat);
}

export function updateWanted(dt, wanted, now) {
  // Heat cools off when the player lies low.
  if (now - wanted.lastCrime > 12) {
    wanted.heat = Math.max(0, wanted.heat - dt * 5);
    wanted.stars = starsForHeat(wanted.heat);
  }
  if (wanted.crimeFlash > 0) wanted.crimeFlash -= dt;
}

// Spawn and steer the police response. Returns 'busted' when the player is caught.
export function updatePolice(dt, wanted, game, now) {
  const stars = wanted.stars;
  const player = game.player;
  const target = player.inCar ? player.car : player;
  const wantCars = stars === 0 ? 0 : Math.min(4, stars);
  const wantCops = (!player.inCar && stars >= 1) ? Math.min(3, stars) : 0;

  // Police cars.
  let policeCars = game.cars.filter((c) => c.driver === 'police');
  if (policeCars.length < wantCars) {
    const a = randRange(Math.random, 0, Math.PI * 2);
    const d = 700 + Math.random() * 300;
    const x = clamp(target.x + Math.cos(a) * d, 80, WORLD_W - 80);
    const y = clamp(target.y + Math.sin(a) * d, 80, WORLD_H - 80);
    const car = spawnPoliceCar(x, y);
    car.angle = Math.atan2(target.y - y, target.x - x);
    game.cars.push(car);
  } else if (policeCars.length > wantCars) {
    // Extra units stand down.
    const extra = policeCars[wantCars];
    const idx = game.cars.indexOf(extra);
    if (idx >= 0) game.cars.splice(idx, 1);
  }
  for (const car of game.cars.filter((c) => c.driver === 'police')) {
    const { updatePoliceCar } = game.vehicleFns;
    updatePoliceCar(dt, game.city, game.cars, car, target);
    // Ramming the player's car damages it; ramming the player hurts.
    if (!player.inCar) {
      const dx = car.x - player.x, dy = car.y - player.y;
      if (dx * dx + dy * dy < 30 * 30 && car.speed > 60) {
        game.damagePlayer(14, 'run over by MPD');
      }
    } else if (player.car) {
      const dx = car.x - player.car.x, dy = car.y - player.car.y;
      if (dx * dx + dy * dy < 46 * 46 && car.speed > 120) {
        player.car.speed *= 0.7;
        game.damagePlayer(4, 'rammed by MPD');
      }
    }
  }

  // Foot officers.
  let cops = game.cops.filter((c) => !c.dead);
  if (cops.length < wantCops) {
    const a = randRange(Math.random, 0, Math.PI * 2);
    const d = 420 + Math.random() * 200;
    const x = clamp(target.x + Math.cos(a) * d, 80, WORLD_W - 80);
    const y = clamp(target.y + Math.sin(a) * d, 80, WORLD_H - 80);
    game.cops.push(makeCop(x, y, Math.random));
  } else if (cops.length > wantCops) {
    game.cops = game.cops.filter((c) => c.dead || cops.indexOf(c) < wantCops);
  }
  for (const cop of game.cops) {
    if (cop.dead) continue;
    const { updateCop } = game.peopleFns;
    updateCop(dt, game.city, cop, player, () => {
      if (!game.over) {
        sfxBusted();
        game.endRun('busted');
      }
    });
  }
  // Clean up dead cops after a while.
  game.cops = game.cops.filter((c) => !c.dead || (c.deadAt && now - c.deadAt < 8));
  for (const c of game.cops) if (c.dead && !c.deadAt) c.deadAt = now;
}
