// Canvas layer: cage background, fighter sprites and impact effects. Knows nothing about the rules.

const SCALE = 2; // sprite pixels to screen points
const POSES = ["idle", "punch", "kick", "hit", "shoot", "down", "gkneel", "gpunch", "gpass", "gguard", "gcover", "gup"];
// A fighter without the ground poses (docs/ART_SPEC.md) keeps the old look: the top man in his shot, the man underneath flat on his back.
const FALLBACK = { gkneel: "shoot", gpunch: "shoot", gpass: "shoot", gguard: "down", gcover: "down", gup: "shoot" };
// Ground poses by position (full guard, half guard, side control, mount, back): the man on top and the man underneath.
const TOP_REST = ["gkneel", "gpass", "gpass", "gkneel", "gpass"];
const BOTTOM_REST = ["gguard", "gguard", "gcover", "gcover", "gcover"];
// How far the man on top leans over the other one at each position: the higher, the closer.
const GROUND_SHIFT = [38, 30, 20, 10, 2];
const FLOOR_Y = 296;
const CAGE_EDGE = 128; // where a fighter against the fence stands
// Half the gap between the two fighters at each distance (far, mid, close, clinch), and how far a strike reaches.
const HALF_GAP = [190, 140, 96, 54];
export const REACH = [100, 76, 44, 18];
const PLACEHOLDER_TINT = { khabib: "#49648c", oliveira: "#2f8f83", neutral: "#777c8c" };

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function tinted(img, color) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function whiteOf(img) {
  return tinted(img, "#ffffff");
}

/** Where the head is in a pose, in sprite pixels: the middle of the topmost rows that have anything in them. */
function headOf(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const { data } = x.getImageData(0, 0, img.width, img.height);
  let top = 0;
  const alphaAt = (px, py) => data[(py * img.width + px) * 4 + 3] > 0;
  scan: for (; top < img.height; top++) for (let px = 0; px < img.width; px++) if (alphaAt(px, top)) break scan;
  let sum = 0;
  let count = 0;
  for (let py = top; py < Math.min(img.height, top + 12); py++) {
    for (let px = 0; px < img.width; px++) {
      if (alphaAt(px, py)) {
        sum += px;
        count++;
      }
    }
  }
  return { x: count ? sum / count : img.width / 2, y: top + 7 };
}

/** Loads real sprites where they exist. Fighters without art borrow a flat silhouette of whatever art exists. */
export async function loadAssets(fighterIds) {
  const assets = { fighters: {}, portraits: {} };
  let manifest = null;
  try {
    const res = await fetch("assets/private/manifest.json");
    if (res.ok) manifest = await res.json();
  } catch {
    manifest = null;
  }
  const loadSet = async (id, meta) => {
    const set = {};
    for (const pose of POSES) {
      const img = meta[pose] && (await loadImage(`assets/private/${id}/${pose}.png`));
      if (img) set[pose] = { img, white: whiteOf(img), w: meta[pose].w, h: meta[pose].h, anchorX: meta[pose].anchorX, head: headOf(img) };
    }
    return set;
  };
  const real = {};
  for (const id of Object.keys(manifest?.fighters || {})) real[id] = await loadSet(id, manifest.fighters[id]);
  const donor = Object.values(real)[0] || null;
  for (const id of fighterIds) {
    if (real[id]) {
      assets.fighters[id] = { poses: real[id], placeholder: false };
    } else if (donor) {
      const poses = {};
      for (const pose of POSES) {
        const d = donor[pose];
        if (!d) continue;
        const img = tinted(d.img, PLACEHOLDER_TINT[id] || "#777c8c");
        poses[pose] = { img, white: d.white, w: d.w, h: d.h, anchorX: d.anchorX, head: d.head };
      }
      assets.fighters[id] = { poses, placeholder: true };
    } else {
      assets.fighters[id] = { poses: null, placeholder: true };
    }
    const portrait = `assets/private/${id}/portrait.png`;
    if (await loadImage(portrait)) assets.portraits[id] = portrait;
  }
  return assets;
}

function buildBackground() {
  const c = document.createElement("canvas");
  c.width = 844;
  c.height = 390;
  const x = c.getContext("2d");
  const sky = x.createLinearGradient(0, 0, 0, 240);
  sky.addColorStop(0, "#05060b");
  sky.addColorStop(1, "#141826");
  x.fillStyle = sky;
  x.fillRect(0, 0, 844, 390);
  // Overhead lights.
  for (const lx of [150, 330, 514, 694]) {
    const g = x.createRadialGradient(lx, 0, 4, lx, 0, 170);
    g.addColorStop(0, "rgba(255,244,214,0.3)");
    g.addColorStop(1, "rgba(255,244,214,0)");
    x.fillStyle = g;
    x.fillRect(lx - 170, 0, 340, 200);
  }
  // Crowd, as dim noise behind the fence.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    x.fillStyle = `rgba(${90 + rand() * 90},${90 + rand() * 80},${110 + rand() * 80},${0.05 + rand() * 0.12})`;
    x.fillRect(Math.floor(rand() * 844), 112 + Math.floor(rand() * 60), 3, 4);
  }
  // Fence.
  x.fillStyle = "#0d0f17";
  for (const [px, w] of [[0, 8], [200, 6], [420, 6], [638, 6], [836, 8]]) x.fillRect(px, 66, w, 160);
  x.strokeStyle = "rgba(190,200,220,0.09)";
  x.lineWidth = 1;
  for (let i = -240; i < 1000; i += 16) {
    x.beginPath();
    x.moveTo(i, 66);
    x.lineTo(i + 160, 226);
    x.moveTo(i + 160, 66);
    x.lineTo(i, 226);
    x.stroke();
  }
  x.fillStyle = "#0a0b11";
  x.fillRect(0, 62, 844, 5);
  // Canvas floor.
  const floor = x.createLinearGradient(0, 226, 0, 390);
  floor.addColorStop(0, "#2d3347");
  floor.addColorStop(1, "#1a1e2c");
  x.fillStyle = floor;
  x.fillRect(0, 226, 844, 164);
  x.fillStyle = "rgba(255,255,255,0.05)";
  x.beginPath();
  x.ellipse(422, 296, 330, 58, 0, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = "rgba(255,255,255,0.08)";
  x.lineWidth = 2;
  x.beginPath();
  x.ellipse(422, 296, 330, 58, 0, 0, Math.PI * 2);
  x.stroke();
  return c;
}

export class Stage {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.background = buildBackground();
    this.fx = [];
    this.flashAlpha = 0;
    this.shakeAmp = 0;
    this.cam = { zoom: 1, side: null, target: 1 }; // signature close-up: zoom toward one fighter
    this.dim = 0;
    this.dimTarget = 0;
    this.lines = 0; // speed lines, 0 to 1
    this.timeScale = 1;
    this.freezeUntil = 0;
    this.last = performance.now();
    this.time = 0;
    this.fighters = { a: this.makeFighter("a"), b: this.makeFighter("b") };
    this.dpr = 1;
    this.resize(1);
    requestAnimationFrame((t) => this.frame(t));
  }

  makeFighter(side) {
    return { side, id: null, x: side === "a" ? 250 : 594, y: FLOOR_Y, tx: side === "a" ? 250 : 594, ty: FLOOR_Y, pose: "idle", restPose: "idle", poseUntil: 0, flip: side === "b", ox: 0, oy: 0, wx: 0, whiteUntil: 0, z: 0, downed: false, cut: 0 };
  }

  /** Bleeding level 0-3 for each fighter, drawn as a cut on the face with drips. */
  setCuts(a, b) {
    this.fighters.a.cut = a;
    this.fighters.b.cut = b;
  }

  resize(ratio) {
    this.dpr = ratio;
    this.canvas.width = Math.round(844 * ratio);
    this.canvas.height = Math.round(390 * ratio);
  }

  setFighters(idA, idB) {
    this.fighters.a.id = idA;
    this.fighters.b.id = idB;
  }

  /** Where everyone should stand for this situation. */
  setLayout(view, snap = false) {
    const { a, b } = this.fighters;
    for (const f of [a, b]) {
      f.flip = f.side === "b";
      f.z = 0;
      f.downed = false;
    }
    if (view.ground) {
      this.cage = null;
      const topSide = view.ground.top;
      const top = this.fighters[topSide];
      const bottom = this.fighters[topSide === "a" ? "b" : "a"];
      const dir = topSide === "a" ? 1 : -1; // the top fighter faces along this direction
      const pos = view.ground.pos ?? 1;
      const shift = GROUND_SHIFT[pos] ?? 20;
      const holder = typeof view.ground.lock === "string" ? view.ground.lock : view.ground.lock?.attacker ?? null;
      // A lock from underneath keeps the man on top kneeling; a lock from above puts him down into it.
      top.restPose = holder === topSide ? "gpass" : holder ? "gkneel" : TOP_REST[pos] ?? "gpass";
      top.tx = 422 - dir * (40 + shift);
      // Raised so the fighter underneath stays visible above the hand.
      top.ty = FLOOR_Y - 34;
      top.flip = dir < 0;
      top.z = 1;
      bottom.restPose = BOTTOM_REST[pos] ?? "gguard";
      if (holder && holder !== topSide) bottom.restPose = "gguard";
      bottom.tx = 422 + dir * 10;
      bottom.ty = FLOOR_Y - 18;
      bottom.flip = dir < 0;
      bottom.downed = true;
    } else {
      const gap = HALF_GAP[view.dist ?? 1];
      const pin = typeof view.cage === "string" ? view.cage : view.cage?.side ?? null;
      this.cage = pin;
      a.restPose = "idle";
      b.restPose = "idle";
      a.tx = 422 - gap;
      b.tx = 422 + gap;
      // A fighter on the fence stands at the edge of the cage and the other one comes to him.
      if (pin === "a") {
        a.tx = CAGE_EDGE;
        b.tx = CAGE_EDGE + 2 * gap;
      } else if (pin === "b") {
        b.tx = 844 - CAGE_EDGE;
        a.tx = 844 - CAGE_EDGE - 2 * gap;
      }
      a.ty = FLOOR_Y;
      b.ty = FLOOR_Y;
    }
    for (const f of [a, b]) {
      if (performance.now() >= f.poseUntil) f.pose = f.restPose;
      if (snap) {
        f.x = f.tx;
        f.y = f.ty;
        f.ox = 0;
        f.oy = 0;
      }
    }
  }

  /** Attacker steps in with a pose and returns. */
  strike(side, pose, reach, ms) {
    const f = this.fighters[side];
    f.pose = pose;
    f.poseUntil = performance.now() + ms;
    const dir = f.flip ? -1 : 1;
    f.anim = { kind: "lunge", start: performance.now(), ms, reach: reach * dir };
  }

  /** A passing change of pose (for example a scramble to the feet) with no lunge. */
  pose(side, pose, ms) {
    const f = this.fighters[side];
    f.pose = pose;
    f.poseUntil = performance.now() + ms;
  }

  /** Defender is knocked back with a white flash. */
  recoil(side, amount, ms, pose = "hit") {
    const f = this.fighters[side];
    if (!f.downed) {
      f.pose = pose;
      f.poseUntil = performance.now() + ms;
    }
    const dir = f.flip ? 1 : -1;
    f.anim = { kind: "knock", start: performance.now(), ms, reach: amount * dir };
    f.whiteUntil = performance.now() + 90;
  }

  stagger(side, ms) {
    const f = this.fighters[side];
    f.pose = "hit";
    f.poseUntil = performance.now() + ms;
    f.anim = { kind: "wobble", start: performance.now(), ms };
  }

  fall(side) {
    const f = this.fighters[side];
    f.restPose = "down";
    f.pose = "down";
    f.poseUntil = 0;
    f.ty = FLOOR_Y - 18;
    f.downed = true;
    f.flip = f.side === "b" ? false : true;
    f.anim = null;
  }

  victory(side) {
    const f = this.fighters[side];
    f.restPose = "idle";
    f.pose = "idle";
    f.ty = FLOOR_Y;
  }

  /** Signature close-up: darken the cage and push in on one fighter. `cinema(null)` puts the camera back. */
  cinema(side, zoom = 1.4) {
    if (side) this.cam.side = side;
    this.cam.target = side ? zoom : 1;
    this.dimTarget = side ? 0.62 : 0;
    this.lines = side ? 1 : 0;
  }

  floater(side, text, color, size = 22) {
    const f = this.fighters[side];
    this.fx.push({ x: f.x + (f.flip ? -20 : 20), y: f.y - 150, text, color, size, born: performance.now(), life: 900 });
  }

  flash(alpha) {
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  shake(amp) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  hitStop(ms) {
    this.freezeUntil = performance.now() + ms;
  }

  frame(now) {
    const realDt = Math.min(50, now - this.last);
    this.last = now;
    const frozen = now < this.freezeUntil;
    const dt = frozen ? 0 : realDt * this.timeScale;
    this.time += dt;
    for (const f of Object.values(this.fighters)) this.updateFighter(f, dt, now);
    this.flashAlpha = Math.max(0, this.flashAlpha - realDt * 0.004);
    const ease = 1 - Math.pow(0.002, realDt / 400);
    this.cam.zoom += (this.cam.target - this.cam.zoom) * ease;
    this.dim += (this.dimTarget - this.dim) * ease;
    if (this.lines > 0 && this.cam.target === 1) this.lines = Math.max(0, this.lines - realDt * 0.004);
    this.shakeAmp = Math.max(0, this.shakeAmp - realDt * 0.05);
    this.draw(now);
    requestAnimationFrame((t) => this.frame(t));
  }

  updateFighter(f, dt, now) {
    const k = 1 - Math.pow(0.001, dt / 260);
    f.x += (f.tx - f.x) * k;
    f.y += (f.ty - f.y) * k;
    f.ox = 0;
    f.oy = 0;
    if (f.anim) {
      const p = (now - f.anim.start) / f.anim.ms;
      if (p >= 1) f.anim = null;
      else if (f.anim.kind === "lunge") f.ox = f.anim.reach * Math.sin(Math.PI * Math.min(1, p * 1.05));
      else if (f.anim.kind === "knock") f.ox = f.anim.reach * Math.sin(Math.PI * Math.min(1, p));
      else if (f.anim.kind === "wobble") f.ox = Math.sin(p * 18) * 7 * (1 - p);
    }
    if (now >= f.poseUntil) f.pose = f.restPose;
  }

  drawFighter(f, now) {
    const art = this.assets.fighters[f.id];
    const breathe = !f.downed && f.pose === "idle" ? Math.round(Math.sin(this.time / 420 + (f.side === "a" ? 0 : 1)) * 1.5) : 0;
    const x = this.ctx;
    const px = f.x + f.ox;
    const py = f.y + f.oy;
    // Shadow.
    x.fillStyle = "rgba(0,0,0,0.42)";
    x.beginPath();
    x.ellipse(px, py + 1, f.pose === "down" || f.pose === "gguard" || f.pose === "gcover" ? 96 : 56, 8, 0, 0, Math.PI * 2);
    x.fill();
    const sprite = art?.poses?.[f.pose] || art?.poses?.[FALLBACK[f.pose]] || art?.poses?.idle;
    if (!sprite) {
      x.fillStyle = "#39415a";
      x.fillRect(px - 26, py - 150, 52, 150);
      return;
    }
    const w = sprite.w * SCALE;
    const h = sprite.h * SCALE;
    const white = now < f.whiteUntil;
    x.save();
    x.imageSmoothingEnabled = false;
    x.translate(Math.round(px), Math.round(py - h + breathe));
    if (f.flip) x.scale(-1, 1);
    x.drawImage(white ? sprite.white : sprite.img, Math.round(-sprite.anchorX * SCALE), 0, w, h);
    x.restore();
    if (f.cut > 0 && !f.downed && f.pose !== "down" && sprite.head) this.drawBlood(f, sprite, px, py - h + breathe, now);
    if (art.placeholder && !f.downed) {
      x.fillStyle = "rgba(255,255,255,0.75)";
      x.font = "700 10px -apple-system, 'PingFang TC', sans-serif";
      x.textAlign = "center";
      x.fillText("占位圖", px, py - h - 4);
    }
  }

  /** A red cut on the brow and a few drips running down the face; more of both at higher levels. */
  drawBlood(f, sprite, px, top, now) {
    const x = this.ctx;
    const dir = f.flip ? -1 : 1;
    const faceX = Math.round(px + dir * (sprite.head.x - sprite.anchorX) * SCALE);
    const faceY = Math.round(top + sprite.head.y * SCALE);
    x.fillStyle = "#d90429";
    x.fillRect(faceX - 4, faceY - 5, 8, 3); // the cut over the brow
    for (let k = 0; k < f.cut * 2; k++) {
      const t = (now / 900 + k * 0.29) % 1;
      x.globalAlpha = 1 - t * 0.6;
      x.fillRect(faceX - 5 + (k % 4) * 3, Math.round(faceY - 2 + t * (16 + f.cut * 6)), 2, 4);
    }
    x.globalAlpha = 1;
  }

  /** Radial lines rushing out from the focus point, behind the hit. */
  drawSpeedLines(x, fx, fy, now) {
    x.save();
    x.globalAlpha = 0.5 * this.lines;
    x.strokeStyle = "#ffe9a8";
    x.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + now / 900;
      const inner = 150 + ((i * 53 + now / 3) % 90);
      x.beginPath();
      x.moveTo(fx + Math.cos(a) * inner, fy + Math.sin(a) * inner * 0.7);
      x.lineTo(fx + Math.cos(a) * (inner + 160), fy + Math.sin(a) * (inner + 160) * 0.7);
      x.stroke();
    }
    x.restore();
  }

  /** A red glow along the fence the fighter is pinned against. */
  drawFence(x, now) {
    const left = this.cage === "a";
    const g = x.createLinearGradient(left ? 0 : 844, 0, left ? 150 : 694, 0);
    const pulse = 0.3 + 0.1 * Math.sin(now / 180);
    g.addColorStop(0, `rgba(255, 70, 60, ${pulse})`);
    g.addColorStop(1, "rgba(255, 70, 60, 0)");
    x.fillStyle = g;
    x.fillRect(left ? 0 : 694, 0, 150, 330);
  }

  draw(now) {
    const x = this.ctx;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.imageSmoothingEnabled = false;
    const sx = this.shakeAmp ? (Math.random() - 0.5) * this.shakeAmp : 0;
    const sy = this.shakeAmp ? (Math.random() - 0.5) * this.shakeAmp : 0;
    x.save();
    x.translate(sx, sy);
    // Close-up: scale around the fighter who is doing the signature.
    const zoom = this.cam.zoom;
    const focus = this.cam.side ? this.fighters[this.cam.side] : null;
    const fx = focus ? focus.x + focus.ox : 422;
    const fy = focus ? focus.y - 90 : 200;
    if (zoom > 1.001) {
      x.translate(fx, fy);
      x.scale(zoom, zoom);
      x.translate(-fx, -fy);
    }
    x.drawImage(this.background, 0, 0);
    if (this.cage) this.drawFence(x, now);
    if (this.dim > 0.01) {
      x.fillStyle = `rgba(2, 3, 10, ${this.dim})`;
      x.fillRect(-400, -300, 1650, 1000);
    }
    const order = Object.values(this.fighters).sort((p, q) => p.z - q.z);
    for (const f of order) this.drawFighter(f, now);
    if (this.lines > 0.01) this.drawSpeedLines(x, fx, fy, now);
    x.restore();
    x.textAlign = "center";
    this.fx = this.fx.filter((e) => now - e.born < e.life);
    for (const e of this.fx) {
      const p = (now - e.born) / e.life;
      x.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      x.font = `900 ${e.size}px -apple-system, 'PingFang TC', sans-serif`;
      x.lineWidth = 4;
      x.strokeStyle = "#000";
      const y = e.y - p * 26;
      x.strokeText(e.text, e.x, y);
      x.fillStyle = e.color;
      x.fillText(e.text, e.x, y);
      x.globalAlpha = 1;
    }
    if (this.flashAlpha > 0) {
      x.fillStyle = `rgba(255,255,255,${this.flashAlpha})`;
      x.fillRect(0, 0, 844, 390);
    }
  }
}
