// combat.js — gunfire, bullets, impact particles and cash/ammo pickups.
import { pointInBuilding } from './city.js';
import { sfxShot, sfxHurt } from './audio.js';

export function makeBullets() { return []; }
export function makeParticles() { return []; }
export function makePickups() { return []; }

export function fireBullet(bullets, x, y, angle, owner, spread) {
  const a = angle + (Math.random() - 0.5) * (spread || 0.08);
  bullets.push({
    x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 18,
    vx: Math.cos(a) * 950, vy: Math.sin(a) * 950,
    owner, life: 0.9, dmg: owner === 'player' ? 34 : 9,
  });
}

export function burst(particles, x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (speed || 160) * (0.4 + Math.random() * 0.8);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.3, max: 0.6, color, r: 2 + Math.random() * 2.5 });
  }
}

export function updateParticles(dt, particles) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= (1 - 3 * dt);
    p.vy *= (1 - 3 * dt);
    if (p.life <= 0) particles.splice(i, 1);
  }
}

export function drawParticles(ctx, particles, view) {
  for (const p of particles) {
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Move bullets; resolve hits against buildings, people, cars and the player.
// Callbacks: onPlayerHit(dmg), onGangHit(gang, dmg), onCarHit(car, dmg).
export function updateBullets(dt, city, bullets, particles, targets, player, cars) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let dead = b.life <= 0;
    if (!dead && pointInBuilding(city, b.x, b.y)) {
      burst(particles, b.x, b.y, '#c9c9c9', 5, 120);
      dead = true;
    }
    if (!dead && b.owner !== 'player' && player.alive && !player.inCar) {
      const dx = b.x - player.x, dy = b.y - player.y;
      if (dx * dx + dy * dy < 13 * 13) {
        targets.onPlayerHit(b.dmg);
        burst(particles, b.x, b.y, '#e5484d', 6, 140);
        dead = true;
      }
    }
    if (!dead && b.owner === 'player') {
      for (const g of targets.gang) {
        if (g.dead) continue;
        const dx = b.x - g.x, dy = b.y - g.y;
        if (dx * dx + dy * dy < 13 * 13) {
          g.hp -= b.dmg;
          g.flash = 0.12;
          burst(particles, b.x, b.y, '#e5484d', 6, 140);
          if (g.hp <= 0) { g.dead = true; targets.onGangDown(g); }
          dead = true;
          break;
        }
      }
      if (!dead) {
        for (const c of targets.cops) {
          if (c.dead) continue;
          const dx = b.x - c.x, dy = b.y - c.y;
          if (dx * dx + dy * dy < 13 * 13) {
            c.hp -= b.dmg;
            c.flash = 0.12;
            burst(particles, b.x, b.y, '#e5484d', 6, 140);
            if (c.hp <= 0) { c.dead = true; targets.onCopDown(c); }
            dead = true;
            break;
          }
        }
      }
      if (!dead) {
        for (const car of cars) {
          if (car.driver === 'player') continue;
          const dx = b.x - car.x, dy = b.y - car.y;
          if (dx * dx + dy * dy < 24 * 24) {
            burst(particles, b.x, b.y, '#ffd166', 4, 120);
            targets.onCarHit(car);
            dead = true;
            break;
          }
        }
      }
    }
    if (dead) bullets.splice(i, 1);
  }
}

export function drawBullets(ctx, bullets, view) {
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 2;
  for (const b of bullets) {
    if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

export function drawPickups(ctx, pickups, view, time) {
  for (const p of pickups) {
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    const bob = Math.sin(time * 4 + p.x) * 2;
    if (p.kind === 'cash') {
      ctx.fillStyle = '#2f9e5f';
      ctx.fillRect(p.x - 10, p.y - 6 + bob, 20, 12);
      ctx.fillStyle = '#d8f5d8';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('$', p.x, p.y + 3 + bob);
      ctx.textAlign = 'left';
    } else if (p.kind === 'ammo') {
      ctx.fillStyle = '#c9a13d';
      ctx.fillRect(p.x - 7, p.y - 7 + bob, 14, 14);
      ctx.fillStyle = '#222';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AMMO', p.x, p.y + 3 + bob);
      ctx.textAlign = 'left';
    } else if (p.kind === 'health') {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(p.x - 8, p.y - 8 + bob, 16, 16);
      ctx.fillStyle = '#e5484d';
      ctx.fillRect(p.x - 2, p.y - 6 + bob, 4, 12);
      ctx.fillRect(p.x - 6, p.y - 2 + bob, 12, 4);
    }
  }
}
