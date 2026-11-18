// missions.js — the story of Port Meridian: five jobs for fixer Mara Voss,
// plus taxi fares on the side once Rook has wheels. Original characters,
// original city, original trouble.
import { landmarkDoor, findLandmark } from './city.js';
import { randRange, randInt, dist } from './util.js';
import { sfxMissionDone, sfxFail } from './audio.js';

export const MISSIONS = [
  {
    id: 'hot-wheels',
    title: 'Job 1 — Hot Wheels',
    briefing: 'Mara Voss: "Rook, you\'re out. You need wheels and I need a car. Take any car on the street — nobody here locks theirs — and bring it to Sal\'s Chop Shop."',
    reward: 400,
    steps: [
      { type: 'steal', label: 'Steal a car (walk up to one and press E)' },
      { type: 'goto', place: 'chopshop', label: 'Deliver the car to Sal\'s Chop Shop' },
    ],
  },
  {
    id: 'meridian-express',
    title: 'Job 2 — Meridian Express',
    briefing: 'Mara: "The Meridian Trust moves parcels after dark. Three drops, one driver, no questions. You\'ve got two minutes — the clock is already running."',
    reward: 600,
    steps: [
      { type: 'checkpoints', time: 120, label: 'Hit all three drops before the timer runs out' },
    ],
  },
  {
    id: 'dockside-dispute',
    title: 'Job 3 — Dockside Dispute',
    briefing: 'Mara: "The Harbor Kings are taxing my dock crews. Go down to Docks 7 and remind them who runs this harbor. Bring the pistol. Come back in one piece."',
    reward: 900,
    steps: [
      { type: 'goto', place: 'docks', label: 'Get to Docks 7' },
      { type: 'kill', count: 5, label: 'Clear out the Harbor Kings (5 left)' },
    ],
  },
  {
    id: 'heat-wave',
    title: 'Job 4 — Heat Wave',
    briefing: 'Mara: "You\'re hot, Rook — three stars and every MPD unit in the district. Lose them the old way: get to your safehouse and sit tight till it cools off."',
    reward: 1200,
    steps: [
      { type: 'escape', place: 'safehouse', stars: 3, label: 'Reach your safehouse with the MPD on your tail' },
    ],
  },
  {
    id: 'meridian-job',
    title: 'Job 5 — The Meridian Job',
    briefing: 'Mara: "One last job and we\'re square. Crack the Meridian Trust vault — hold E at the bank door — grab the cash, and get to the safehouse before the whole city wakes up."',
    reward: 2500,
    steps: [
      { type: 'hold', place: 'bank', dur: 6, label: 'Hold E at the bank to crack the vault' },
      { type: 'escape', place: 'safehouse', stars: 4, label: 'Escape to the safehouse with the cash' },
    ],
  },
];

export class MissionRunner {
  constructor(host) {
    this.host = host; // the game: provides player, city, toasts, markers, spawning
    this.index = -1;  // no mission active
    this.step = 0;
    this.done = false;
    this.timer = 0;
    this.checkpoints = [];
    this.checkpointIndex = 0;
    this.killTarget = 0;
    this.killCount = 0;
    this.holdTime = 0;
    this.started = false;
  }

  get current() { return this.index >= 0 && this.index < MISSIONS.length ? MISSIONS[this.index] : null; }
  get stepDef() { const m = this.current; return m ? m.steps[this.step] : null; }

  get completedCount() { return Math.max(0, this.index < 0 ? this.host.save?.missionsDone || 0 : this.index); }

  startMission(i) {
    this.index = i;
    this.step = 0;
    this.done = false;
    this.started = true;
    this.timer = 0;
    this.checkpoints = [];
    this.checkpointIndex = 0;
    this.killTarget = 0;
    this.killCount = 0;
    this.holdTime = 0;
    const m = MISSIONS[i];
    this.host.toast(m.title, 4);
    this.host.toast(m.briefing, 7);
    this.enterStep();
  }

  enterStep() {
    const s = this.stepDef;
    const h = this.host;
    if (!s) { this.completeMission(); return; }
    if (s.type === 'goto' || s.type === 'escape' || s.type === 'hold') {
      const door = landmarkDoor(h.city, s.place);
      h.setMarker(door.x, door.y, s.label);
      if (s.type === 'escape') h.setWantedStars(s.stars);
    } else if (s.type === 'checkpoints') {
      this.timer = s.time;
      this.checkpoints = [
        { x: 700, y: 650 }, { x: 2300, y: 1050 }, { x: 1100, y: 2250 },
      ];
      this.checkpointIndex = 0;
      const c = this.checkpoints[0];
      h.setMarker(c.x, c.y, s.label + ' — drop 1 of 3');
    } else if (s.type === 'kill') {
      this.killTarget = s.count;
      this.killCount = 0;
      const docks = findLandmark(h.city, 'docks');
      h.spawnGang(docks.x, docks.y + 120, s.count);
      h.setMarker(docks.x, docks.y + 120, s.label);
    } else if (s.type === 'steal') {
      h.setMarker(h.player.x, h.player.y, s.label);
      h.clearMarker();
    }
    h.setObjective(s.label);
  }

  nextStep() {
    this.step++;
    this.enterStep();
  }

  completeMission() {
    const m = this.current;
    this.done = true;
    this.host.clearMarker();
    this.host.addMoney(m.reward);
    this.host.setObjective('Job complete — ' + m.title);
    sfxMissionDone();
    this.host.toast('Job complete: ' + m.title + ' — paid $' + m.reward, 5);
    this.host.onMissionComplete(this.index);
    this.index = -1;
    this.step = 0;
  }

  failMission(reason) {
    sfxFail();
    this.host.toast('Job failed: ' + reason, 5);
    this.host.setObjective('Job failed — press M to retry');
    this.index = -1;
    this.step = 0;
    this.host.clearMarker();
  }

  onGangDown() {
    if (this.current && this.stepDef && this.stepDef.type === 'kill') {
      this.killCount++;
      const left = this.killTarget - this.killCount;
      this.host.setObjective(left > 0 ? 'Clear out the Harbor Kings (' + left + ' left)' : 'Docks clear — get out of there');
      if (left <= 0) this.nextStep();
    }
  }

  onCarEntered() {
    if (this.current && this.stepDef && this.stepDef.type === 'steal') this.nextStep();
  }

  update(dt) {
    const m = this.current;
    if (!m) return;
    const s = this.stepDef;
    const h = this.host;
    const p = h.playerPos();
    if (s.type === 'goto') {
      const door = landmarkDoor(h.city, s.place);
      if (dist(p.x, p.y, door.x, door.y) < 70) this.nextStep();
    } else if (s.type === 'escape') {
      const door = landmarkDoor(h.city, s.place);
      if (dist(p.x, p.y, door.x, door.y) < 70) {
        h.setWantedStars(0);
        this.nextStep();
      }
    } else if (s.type === 'checkpoints') {
      this.timer -= dt;
      if (this.timer <= 0) { this.failMission('Out of time on the drops'); return; }
      const c = this.checkpoints[this.checkpointIndex];
      if (c && dist(p.x, p.y, c.x, c.y) < 60) {
        this.checkpointIndex++;
        h.addMoney(100);
        h.toast('Drop ' + this.checkpointIndex + ' of 3 delivered (+$100)', 2.5);
        if (this.checkpointIndex >= this.checkpoints.length) { this.nextStep(); return; }
        const n = this.checkpoints[this.checkpointIndex];
        h.setMarker(n.x, n.y, s.label + ' — drop ' + (this.checkpointIndex + 1) + ' of 3');
      }
      h.setTimer(this.timer);
    } else if (s.type === 'hold') {
      const door = landmarkDoor(h.city, s.place);
      if (dist(p.x, p.y, door.x, door.y) < 80 && h.holdingE()) {
        this.holdTime += dt;
        h.setHoldProgress(this.holdTime / s.dur);
        if (this.holdTime >= s.dur) {
          h.setHoldProgress(0);
          h.spawnCash(door.x, door.y - 40, 800);
          h.addHeat(120);
          this.nextStep();
        }
      } else {
        this.holdTime = Math.max(0, this.holdTime - dt * 2);
        h.setHoldProgress(this.holdTime / s.dur);
      }
    }
  }
}

// Taxi side gig: pick up a fare, drive them across town, get paid.
export class TaxiGig {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.phase = 'idle'; // idle | pickup | dropoff
    this.fare = null;
    this.cooldown = 8;
    this.ped = null;
  }

  update(dt) {
    if (!this.active) {
      this.cooldown -= dt;
      if (this.cooldown <= 0 && this.host.missionsDone >= 2 && this.host.player.inCar) {
        this.offerFare();
      }
      return;
    }
    const p = this.host.playerPos();
    if (this.phase === 'pickup') {
      if (dist(p.x, p.y, this.fare.px, this.fare.py) < 60 && this.host.player.inCar) {
        this.phase = 'dropoff';
        this.host.setMarker(this.fare.dx, this.fare.dy, 'Drop your fare at the pin');
        this.host.toast('Fare picked up — take them to the pin', 3);
      }
    } else if (this.phase === 'dropoff') {
      if (dist(p.x, p.y, this.fare.dx, this.fare.dy) < 70) {
        this.host.addMoney(this.fare.pay);
        this.host.toast('Fare complete — paid $' + this.fare.pay, 3);
        this.host.clearMarker();
        this.active = false;
        this.cooldown = 20;
      }
    }
  }

  offerFare() {
    const h = this.host;
    const p = h.playerPos();
    const px = p.x + randRange(Math.random, -500, 500);
    const py = p.y + randRange(Math.random, -500, 500);
    const dx = randRange(Math.random, 300, 3300);
    const dy = randRange(Math.random, 300, 2200);
    const pay = 120 + randInt(Math.random, 0, 8) * 20;
    this.fare = { px, py, dx, dy, pay };
    this.active = true;
    this.phase = 'pickup';
    h.setMarker(px, py, 'Taxi fare — pick up the passenger ($' + pay + ')');
    h.toast('Taxi fare nearby — pick up the passenger for $' + pay, 4);
  }

  cancel() {
    if (this.active) { this.active = false; this.cooldown = 20; this.host.clearMarker(); }
  }
}
