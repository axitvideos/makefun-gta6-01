// hud.js — the HUD: health, cash, wanted stars, objective, speed, timer,
// and the minimap that shows the whole of Port Meridian at a glance.
import { WORLD_W, WORLD_H } from './city.js';
import { starsForHeat } from './police.js';

export function updateHud(game) {
  const el = (id) => document.getElementById(id);
  const p = game.player;
  el('hud-money').textContent = '$' + game.money.toLocaleString('en-US');
  el('hud-health-fill').style.width = Math.max(0, p.hp) + '%';
  el('hud-health-fill').style.background = p.hp > 50 ? '#58c96b' : p.hp > 25 ? '#e8b93d' : '#e5484d';
  const stars = starsForHeat(game.wanted.heat);
  let starHtml = '';
  for (let i = 0; i < 5; i++) starHtml += '<span class="star' + (i < stars ? ' lit' : '') + '">★</span>';
  el('hud-stars').innerHTML = starHtml;
  el('hud-ammo').textContent = p.inCar ? '' : ('🔫 ' + p.ammo + ' / ∞');
  const speed = p.inCar && p.car ? Math.round(Math.abs(p.car.speed) * 0.12) : 0;
  el('hud-speed').textContent = p.inCar ? speed + ' mph' : '';
  el('hud-car').textContent = p.inCar && p.car ? p.car.model.name : '';
  el('hud-objective').textContent = game.objective || '';
  el('hud-timer').textContent = game.timerText || '';
  const hold = game.holdProgress;
  const holdEl = el('hud-hold');
  if (hold > 0) {
    holdEl.style.display = 'block';
    el('hud-hold-fill').style.width = Math.round(hold * 100) + '%';
  } else {
    holdEl.style.display = 'none';
  }
  el('hud-mission').textContent = game.missionTitle || 'Free roam — press M for the next job';
  el('hud-clock').textContent = game.clockText();
}

export function drawMinimap(ctx, game) {
  const mw = 210, mh = 158;
  const x0 = game.canvas.width - mw - 14, y0 = 14;
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(12,18,24,0.85)';
  ctx.beginPath(); ctx.roundRect(x0 - 4, y0 - 4, mw + 8, mh + 8, 8); ctx.fill();
  ctx.globalAlpha = 1;
  // Water + ground.
  ctx.fillStyle = '#7a6f5c';
  ctx.fillRect(x0, y0, mw, mh);
  ctx.fillStyle = '#3f7d9e';
  ctx.fillRect(x0, y0 + mh * (2580 / WORLD_H), mw, mh - mh * (2580 / WORLD_H));
  // Roads.
  ctx.fillStyle = '#4a4a52';
  for (const rx of game.city.ROADS_X || []) ctx.fillRect(x0 + rx * sx - 2, y0, 4, mh);
  for (const ry of game.city.ROADS_Y || []) ctx.fillRect(x0, y0 + ry * sy - 2, mw, 4);
  // Parks.
  ctx.fillStyle = '#7fae62';
  for (const pk of game.city.parks) ctx.fillRect(x0 + pk.x * sx, y0 + pk.y * sy, pk.w * sx, pk.h * sy);
  // Buildings.
  ctx.fillStyle = '#c9c2b2';
  for (const b of game.city.buildings) {
    ctx.fillRect(x0 + b.x * sx, y0 + b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
  }
  // Mission marker.
  if (game.marker) {
    const mx = x0 + game.marker.x * sx, my = y0 + game.marker.y * sy;
    const pulse = 3 + Math.sin(game.time * 5) * 1.5;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(mx, my, pulse + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a4d00';
    ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // Police blips.
  ctx.fillStyle = '#4d8dff';
  for (const car of game.cars) {
    if (car.driver !== 'police') continue;
    ctx.beginPath(); ctx.arc(x0 + car.x * sx, y0 + car.y * sy, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Gang blips.
  ctx.fillStyle = '#e5484d';
  for (const g of game.gang) {
    if (g.dead) continue;
    ctx.beginPath(); ctx.arc(x0 + g.x * sx, y0 + g.y * sy, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // Player arrow.
  const px = x0 + game.player.x * sx, py = y0 + game.player.y * sy;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(game.player.angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // North + border.
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillText('N', x0 + mw / 2 - 3, y0 + 11);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 4, y0 - 4, mw + 8, mh + 8);
  ctx.restore();
}

export function drawObjectiveArrow(ctx, game) {
  // When the mission marker is off-screen, point at it from the screen edge.
  if (!game.marker) return;
  const cx = game.canvas.width / 2, cy = game.canvas.height / 2;
  const wx = game.marker.x - game.camera.x, wy = game.marker.y - game.camera.y;
  const sx = cx + wx * game.zoom, sy = cy + wy * game.zoom;
  if (sx > 40 && sx < game.canvas.width - 40 && sy > 40 && sy < game.canvas.height - 40) return;
  const ang = Math.atan2(sy - cy, sx - cx);
  const ex = cx + Math.cos(ang) * (Math.min(cx, cy) - 60);
  const ey = cy + Math.sin(ang) * (Math.min(cx, cy) - 60);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffd166';
  ctx.strokeStyle = '#7a4d00';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  const d = Math.round(Math.hypot(wx, wy) / 40);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(d + 'm', ex, ey + 28);
  ctx.textAlign = 'left';
}
