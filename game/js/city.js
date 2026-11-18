// city.js — Port Meridian: the city itself. Roads on a grid, blocks of
// buildings, parks, the harbor strip, and the collision helpers everyone uses.
import { mulberry32, pick, randRange, randInt, clamp } from './util.js';

export const WORLD_W = 3600;
export const WORLD_H = 2700;
export const ROAD_W = 110;
export const ROADS_X = [300, 700, 1100, 1500, 1900, 2300, 2700, 3100];
export const ROADS_Y = [250, 650, 1050, 1450, 1850, 2250];
// Harbor water along the south edge; the docks sit just above it.
export const HARBOR_Y = 2420;
export const WATER_Y = 2580;

const ROOF_COLORS = ['#b5673f', '#8a7f74', '#6f7f8a', '#a08a5f', '#7d6a8a', '#96604a', '#5f7a63', '#8f8a7d'];
const WALL_COLORS = ['#d8cbb8', '#cbb9a0', '#b8c4c9', '#d3c4b0', '#c2b3a4', '#b0b8a8'];

export function buildCity(seed) {
  const rng = mulberry32(seed);
  const buildings = [];
  const trees = [];
  const parks = [];
  const landmarkBlocks = new Set();

  // Landmark blocks, keyed by (col,row) of the block grid between roads.
  // col = index of the road to the left, row = index of the road above.
  const landmarks = {
    '3,1': 'bank',       // Meridian Trust Bank
    '1,0': 'hospital',   // St. Anselm Hospital
    '6,4': 'safehouse',  // Rook's safehouse
    '0,3': 'chopshop',   // Sal's Chop Shop
    '4,0': 'plaza',      // Meridian Plaza (park)
    '2,3': 'park',       // Coral Park
  };
  for (const k of Object.keys(landmarks)) landmarkBlocks.add(k);

  for (let col = 0; col < ROADS_X.length - 1; col++) {
    for (let row = 0; row < ROADS_Y.length - 1; row++) {
      const x0 = ROADS_X[col] + ROAD_W / 2 + 14;
      const x1 = ROADS_X[col + 1] - ROAD_W / 2 - 14;
      const y0 = ROADS_Y[row] + ROAD_W / 2 + 14;
      const y1 = ROADS_Y[row + 1] - ROAD_W / 2 - 14;
      const key = col + ',' + row;
      const kind = landmarks[key];
      if (kind === 'park' || kind === 'plaza') {
        parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, plaza: kind === 'plaza' });
        const n = randInt(rng, 6, 10);
        for (let i = 0; i < n; i++) {
          trees.push({ x: randRange(rng, x0 + 20, x1 - 20), y: randRange(rng, y0 + 20, y1 - 20), r: randRange(rng, 10, 16) });
        }
        continue;
      }
      // One or two buildings per block; a landmark name goes on one building only.
      const split = rng() < 0.45;
      const spots = split
        ? [{ x: x0, y: y0, w: (x1 - x0) * 0.48, h: y1 - y0 }, { x: x0 + (x1 - x0) * 0.52, y: y0, w: (x1 - x0) * 0.48, h: y1 - y0 }]
        : [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }];
      let named = false;
      for (const s of spots) {
        const bw = Math.max(70, s.w - randRange(rng, 8, 30));
        const bh = Math.max(60, s.h - randRange(rng, 8, 30));
        const bx = s.x + randRange(rng, 0, Math.max(0, s.w - bw));
        const by = s.y + randRange(rng, 0, Math.max(0, s.h - bh));
        const b = {
          x: bx, y: by, w: bw, h: bh,
          roof: pick(rng, ROOF_COLORS), wall: pick(rng, WALL_COLORS),
          tier: randInt(rng, 1, 3), // visual height tier (shadow + roof detail)
          name: !named && kind ? kind : null,
        };
        if (b.name) named = true;
        buildings.push(b);
        if (rng() < 0.5) {
          trees.push({ x: bx - 14, y: by + bh / 2, r: randRange(rng, 8, 12) });
        }
      }
    }
  }

  // Docks strip: warehouses along the harbor.
  const docks = [];
  for (let i = 0; i < 5; i++) {
    const w = 190, h = 90;
    const x = 260 + i * 620 + randRange(rng, -30, 30);
    const y = HARBOR_Y + 18;
    buildings.push({ x, y, w, h, roof: '#5d6b78', wall: '#9aa5ad', tier: 1, name: i === 2 ? 'docks' : null });
    docks.push({ x: x + w / 2, y: y + h + 60 });
  }
  // Crates on the docks.
  const crates = [];
  for (let i = 0; i < 26; i++) {
    crates.push({ x: randRange(rng, 220, WORLD_W - 260), y: randRange(rng, HARBOR_Y + 130, WATER_Y - 40), s: randRange(rng, 16, 26) });
  }
  // Sidewalk trees along a few roads.
  for (let i = 0; i < 40; i++) {
    const rx = pick(rng, ROADS_X);
    trees.push({ x: rx + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 12), y: randRange(rng, 120, HARBOR_Y - 60), r: randRange(rng, 8, 13) });
  }

  return { buildings, trees, parks, docks, crates, seed };
}

export function isOnRoad(x, y) {
  for (const rx of ROADS_X) if (Math.abs(x - rx) <= ROAD_W / 2) return true;
  for (const ry of ROADS_Y) if (Math.abs(y - ry) <= ROAD_W / 2) return true;
  return false;
}

export function nearestRoadX(x) {
  let best = ROADS_X[0], bd = Infinity;
  for (const rx of ROADS_X) { const d = Math.abs(x - rx); if (d < bd) { bd = d; best = rx; } }
  return best;
}
export function nearestRoadY(y) {
  let best = ROADS_Y[0], bd = Infinity;
  for (const ry of ROADS_Y) { const d = Math.abs(y - ry); if (d < bd) { bd = d; best = ry; } }
  return best;
}

// Push a circle out of every building it overlaps. Returns true if it hit one.
export function collideCircle(city, p, r) {
  let hit = false;
  for (const b of city.buildings) {
    const cx = clamp(p.x, b.x, b.x + b.w);
    const cy = clamp(p.y, b.y, b.y + b.h);
    const dx = p.x - cx, dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.y = cy + (dy / d) * r;
      } else {
        // Center inside the rect: push out along the smallest axis.
        const left = p.x - b.x, right = b.x + b.w - p.x;
        const top = p.y - b.y, bottom = b.y + b.h - p.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) p.x = b.x - r;
        else if (m === right) p.x = b.x + b.w + r;
        else if (m === top) p.y = b.y - r;
        else p.y = b.y + b.h + r;
      }
    }
  }
  // Crates are solid too.
  for (const c of city.crates) {
    const cx = clamp(p.x, c.x, c.x + c.s);
    const cy = clamp(p.y, c.y, c.y + c.s);
    const dx = p.x - cx, dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r && d2 > 0.0001) {
      hit = true;
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r;
      p.y = cy + (dy / d) * r;
    }
  }
  // Water is not walkable / drivable.
  if (p.y > WATER_Y - r) { p.y = WATER_Y - r; hit = true; }
  p.x = clamp(p.x, 20 + r, WORLD_W - 20 - r);
  p.y = clamp(p.y, 20 + r, WORLD_H - 20 - r);
  return hit;
}

export function pointInBuilding(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

export function findLandmark(city, name) {
  for (const b of city.buildings) if (b.name === name) return { x: b.x + b.w / 2, y: b.y + b.h / 2, w: b.w, h: b.h };
  return null;
}

// A point on the road just outside a landmark's front door.
export function landmarkDoor(city, name) {
  const lm = findLandmark(city, name);
  if (!lm) return { x: WORLD_W / 2, y: WORLD_H / 2 };
  return { x: lm.x, y: lm.y + lm.h / 2 + 70 };
}

export function drawCity(ctx, city, view) {
  const { x0, y0, x1, y1 } = view;
  // Ground: sun-baked pavement base.
  ctx.fillStyle = '#b7ab8e';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Parks.
  for (const p of city.parks) {
    if (p.x > x1 || p.x + p.w < x0 || p.y > y1 || p.y + p.h < y0) continue;
    ctx.fillStyle = p.plaza ? '#c9bd9e' : '#7fae62';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    if (p.plaza) {
      ctx.fillStyle = '#8fb7c9';
      ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 26, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#6d9c52';
      ctx.beginPath(); ctx.arc(p.x + p.w * 0.3, p.y + p.h * 0.65, 30, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x + p.w * 0.72, p.y + p.h * 0.3, 24, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Harbor water.
  if (y1 > WATER_Y) {
    ctx.fillStyle = '#3f7d9e';
    ctx.fillRect(Math.max(x0, 0), WATER_Y, Math.min(x1, WORLD_W) - Math.max(x0, 0), WORLD_H - WATER_Y);
    ctx.fillStyle = '#5d97b5';
    for (let wx = 120; wx < WORLD_W; wx += 260) {
      if (wx < x0 - 100 || wx > x1 + 100) continue;
      ctx.fillRect(wx, WATER_Y + 42, 120, 3);
      ctx.fillRect(wx + 60, WATER_Y + 96, 90, 3);
    }
  }
  // Docks concrete.
  if (y1 > HARBOR_Y) {
    ctx.fillStyle = '#a89c83';
    ctx.fillRect(Math.max(x0, 0), HARBOR_Y, Math.min(x1, WORLD_W) - Math.max(x0, 0), WATER_Y - HARBOR_Y);
  }
  // Roads.
  ctx.fillStyle = '#4a4a52';
  for (const rx of ROADS_X) {
    if (rx + ROAD_W / 2 < x0 || rx - ROAD_W / 2 > x1) continue;
    ctx.fillRect(rx - ROAD_W / 2, Math.max(y0, 0), ROAD_W, Math.min(y1, HARBOR_Y) - Math.max(y0, 0));
  }
  for (const ry of ROADS_Y) {
    if (ry + ROAD_W / 2 < y0 || ry - ROAD_W / 2 > y1) continue;
    ctx.fillRect(Math.max(x0, 0), ry - ROAD_W / 2, Math.min(x1, WORLD_W) - Math.max(x0, 0), ROAD_W);
  }
  // Lane dashes.
  ctx.fillStyle = '#d8c95a';
  for (const rx of ROADS_X) {
    if (rx + ROAD_W / 2 < x0 || rx - ROAD_W / 2 > x1) continue;
    for (let y = 40; y < HARBOR_Y; y += 64) {
      if (y < y0 - 20 || y > y1 + 20) continue;
      ctx.fillRect(rx - 3, y, 6, 30);
    }
  }
  for (const ry of ROADS_Y) {
    if (ry + ROAD_W / 2 < y0 || ry - ROAD_W / 2 > y1) continue;
    for (let x = 40; x < WORLD_W; x += 64) {
      if (x < x0 - 20 || x > x1 + 20) continue;
      ctx.fillRect(x, ry - 3, 30, 6);
    }
  }
  // Sidewalk edges.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  for (const rx of ROADS_X) {
    if (rx + ROAD_W / 2 < x0 || rx - ROAD_W / 2 > x1) continue;
    ctx.beginPath(); ctx.moveTo(rx - ROAD_W / 2, Math.max(y0, 0)); ctx.lineTo(rx - ROAD_W / 2, Math.min(y1, HARBOR_Y)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx + ROAD_W / 2, Math.max(y0, 0)); ctx.lineTo(rx + ROAD_W / 2, Math.min(y1, HARBOR_Y)); ctx.stroke();
  }
  // Buildings: soft shadow, wall, roof, roof detail.
  for (const b of city.buildings) {
    if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    const inset = 5 + (b.tier || 1) * 2;
    ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
    // Roof units.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(b.x + b.w * 0.3, b.y + b.h * 0.3, 12, 9);
    ctx.fillRect(b.x + b.w * 0.6, b.y + b.h * 0.55, 12, 9);
    if (b.name) {
      ctx.fillStyle = '#1d2b36';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const label = { bank: 'MERIDIAN TRUST', hospital: 'ST. ANSELM HOSPITAL', safehouse: "ROOK'S PLACE", chopshop: "SAL'S CHOP SHOP", docks: 'DOCKS 7' }[b.name] || b.name.toUpperCase();
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 5);
      ctx.textAlign = 'left';
    }
  }
  // Crates.
  ctx.fillStyle = '#8a6b45';
  for (const c of city.crates) {
    if (c.x > x1 || c.x + c.s < x0 || c.y > y1 || c.y + c.s < y0) continue;
    ctx.fillRect(c.x, c.y, c.s, c.s);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(c.x, c.y, c.s, c.s);
  }
  // Trees.
  for (const t of city.trees) {
    if (t.x < x0 - 20 || t.x > x1 + 20 || t.y < y0 - 20 || t.y > y1 + 20) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.arc(t.x + 3, t.y + 4, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4e8a3f';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#66a854';
    ctx.beginPath(); ctx.arc(t.x - 3, t.y - 3, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
  }
}
