// V3 greybox view: three.js octagon, capsule fighters, side broadcast camera, touch + keyboard input.
import * as THREE from "three";
import { createFight, step, nextRound, canUse, dist } from "./engine.js";
import { createAI, aiInput } from "./ai.js";

const cfg = await (await fetch("rules/v3/config.json")).json();
const q = new URLSearchParams(location.search);
const W = 844, H = 390, DT = 1 / 60;
const $ = (id) => document.getElementById(id);
const stage = $("stage");

// ---------- layout: scale the 844x390 stage to the window ----------
let scale = 1;
function fit() {
  scale = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `scale(${scale}) translate(-50%,-50%)`;
  stage.style.transformOrigin = "0 0";
  stage.style.left = "50%"; stage.style.top = "50%";
  stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
  stage.style.transformOrigin = "50% 50%";
  renderer.setPixelRatio(Math.min(2, devicePixelRatio * scale));
  renderer.setSize(W, H, false);
}

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080c);
scene.fog = new THREE.Fog(0x06080c, 9, 22);
const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 60);
fit();
addEventListener("resize", fit);

scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2418, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2, 9, 3);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
scene.add(key);

const R = cfg.arena.radius;
// floor outside the cage
const outside = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ color: 0x111318 }));
outside.rotation.x = -Math.PI / 2; outside.position.y = -0.3; scene.add(outside);
// apron + mat (8-sided, flat side facing each axis)
// octagon corners: same layout as three's 8-sided cylinder (x = R sin, z = R cos)
const corner = (k, r = R) => new THREE.Vector3(r * Math.sin(k * Math.PI / 4), 0, r * Math.cos(k * Math.PI / 4));
const apron = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.5, 0.3, 8, 1), new THREE.MeshStandardMaterial({ color: 0x1b1d22 }));
apron.position.y = -0.15; scene.add(apron);
const mat = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.02, 8, 1), new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.9 }));
mat.receiveShadow = true; scene.add(mat);
// fence: chain-link panels + posts + top pads; the ones on the camera side are hidden each frame
const cv = document.createElement("canvas"); cv.width = cv.height = 64;
const cx = cv.getContext("2d"); cx.strokeStyle = "#9aa3b2"; cx.lineWidth = 2;
cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(64, 64); cx.moveTo(64, 0); cx.lineTo(0, 64); cx.stroke();
const fenceTex = new THREE.CanvasTexture(cv); fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping; fenceTex.repeat.set(8, 5);
const fenceMat = new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
const padMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e }), postMat = new THREE.MeshStandardMaterial({ color: 0x15161a });
const fenceParts = []; // { obj, at: Vector3 (ground point) }
for (let k = 0; k < 8; k++) {
  const p0 = corner(k), p1 = corner(k + 1), e = p1.clone().sub(p0), m = p0.clone().add(p1).multiplyScalar(0.5);
  const rot = Math.atan2(-e.z, e.x), len = e.length();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.8), fenceMat);
  panel.position.set(m.x, 0.9, m.z); panel.rotation.y = rot; scene.add(panel);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), padMat);
  pad.position.set(m.x, 1.84, m.z); pad.rotation.y = rot; scene.add(pad);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.85, 8), postMat);
  post.position.set(p0.x, 0.92, p0.z); scene.add(post);
  fenceParts.push({ obj: panel, at: m }, { obj: pad, at: m }, { obj: post, at: p0 });
}

// range rings at the player's feet
const ringOuter = new THREE.Mesh(new THREE.RingGeometry(1, 1.04, 64), new THREE.MeshBasicMaterial({ color: 0x2f7bff, transparent: true, opacity: 0.45 }));
const ringInner = new THREE.Mesh(new THREE.RingGeometry(1, 1.03, 64), new THREE.MeshBasicMaterial({ color: 0x2f7bff, transparent: true, opacity: 0.3 }));
const ringFill = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x2f7bff, transparent: true, opacity: 0.07, depthWrite: false }));
for (const m of [ringOuter, ringInner, ringFill]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.015; scene.add(m); }

// ---------- fighter rig (spheres and capsules) ----------
const skin = [0xc69a7a, 0x8a5a3e];
function makeRig(color, glove, skinColor) {
  const g = new THREE.Group();
  const std = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: 0x000000 });
  const body = new THREE.Group(); g.add(body);
  const torsoM = std(color);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 6, 14), torsoM);
  torso.scale.set(1, 1, 0.75); torso.position.y = 1.15; body.add(torso);
  const shorts = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.08, 4, 12), std(0x1a1c22));
  shorts.position.y = 0.86; shorts.scale.set(1.05, 1, 0.8); body.add(shorts);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), std(skinColor));
  head.scale.set(0.9, 1.1, 0.95); head.position.y = 1.62; body.add(head);
  const legs = [], gloves = [], gloveM = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.11, 0.82, side * 0.08); g.add(hip);
    const legM = std(skinColor);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.6, 4, 10), legM);
    leg.position.y = -0.4; hip.add(leg);
    legs.push({ hip, mat: legM });
    const gm = std(glove);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), gm);
    gl.scale.set(1, 1, 1.2); body.add(gl);
    gloves.push(gl); gloveM.push(gm);
  }
  // shoulder->glove "arms" as stretched capsules
  const arms = gloves.map(() => { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1, 4, 8), std(skinColor)); body.add(a); return a; });
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.014; g.add(shadow);
  scene.add(g);
  // side: index 0 = lead (left, toward +x local when facing +z?) — we use: lead hand/leg = index 0
  return { g, body, torso, torsoM, head, legs, gloves, gloveM, arms };
}
const rigs = [makeRig(0x2f7bff, 0x1d3f9c, skin[0]), makeRig(0xe8383d, 0x8a1418, skin[1])];

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
function placeArm(arm, glove, shoulder) {
  tmpA.copy(shoulder); tmpB.copy(glove.position);
  const len = tmpA.distanceTo(tmpB);
  arm.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  arm.scale.set(1, Math.max(0.05, len - 0.1), 1);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpB.sub(tmpA).normalize());
}
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

function poseRig(rig, f, o, now) {
  const { g, body, gloves, gloveM, legs, torsoM } = rig;
  g.position.set(f.x, 0, f.z);
  const target = Math.atan2(o.x - f.x, o.z - f.z);
  let dr = target - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
  g.rotation.y += dr * 0.35;
  // defaults: orthodox stance, lead side = local -x (index 0)
  const bob = Math.sin(now / 180 + f.id) * 0.015;
  body.position.set(0, bob, 0); body.rotation.set(0, 0, 0);
  const guardUp = f.guard;
  const gp = [
    new THREE.Vector3(-0.12, guardUp ? 1.55 : 1.42, guardUp ? 0.2 : 0.3),
    new THREE.Vector3(0.13, guardUp ? 1.55 : 1.45, guardUp ? 0.18 : 0.16),
  ];
  legs[0].hip.rotation.set(0, 0, 0); legs[1].hip.rotation.set(0, 0, 0);
  legs[0].hip.position.z = 0.12; legs[1].hip.position.z = -0.1;
  let glow = [0, 0], glowLeg = [0, 0];
  if (f.act) {
    const m = cfg.moves[f.act.move], t = f.act.t;
    const W = f.act.windup ?? m.windup;
    const wu = t / W, ac = (t - W) / m.active, rc = (t - W - m.active) / m.recovery;
    const ext = t < W ? -0.12 * ease(wu) : t < W + m.active ? ease(ac) : 1 - ease(rc);
    const reach = Math.min(m.max, Math.max(0.6, dist(f, o))) - 0.15;
    const tele = t < W ? 0.3 + 0.7 * wu : 0;
    if (m.limb === "lead" || m.limb === "rear") {
      const i = m.limb === "lead" ? 0 : 1;
      const p = gp[i];
      if (m.arc) { p.x = lerp(p.x, -0.45, Math.sin(Math.max(0, ext) * Math.PI)); p.z = lerp(p.z, reach * 0.85, Math.max(0, ext)); }
      else p.z = lerp(p.z, reach, Math.max(0, ext)) + (ext < 0 ? ext : 0);
      p.y = lerp(p.y, 1.5, Math.max(0, ext));
      body.rotation.y = (i ? -0.35 : 0.2) * Math.max(0, ext);
      glow[i] = tele;
      if (m.lunge) { body.rotation.x = 0.35 * Math.max(0, ext); body.position.y = 0.12 * Math.max(0, ext); }
    } else {
      const high = m.limb === "kickHigh";
      const lift = Math.max(0, ext);
      legs[1].hip.rotation.x = -(high ? 1.9 : 1.15) * lift;
      legs[1].hip.rotation.z = (high ? 0.5 : 0.3) * lift;
      body.rotation.z = -(high ? 0.35 : 0.15) * lift;
      glowLeg[1] = tele;
    }
  }
  if (f.dodge) { const k = Math.sin(Math.min(1, f.dodge.t / cfg.dodge.ms) * Math.PI); body.position.y -= 0.25 * k; body.rotation.x = -0.25 * k; }
  // a badly hurt head makes him wobble
  if (f.parts.head >= cfg.parts.wobbleHead && !f.down) { const k = (f.parts.head - cfg.parts.wobbleHead) / (cfg.parts.max - cfg.parts.wobbleHead); body.rotation.z += Math.sin(now / 140 + f.id) * (0.05 + 0.1 * k); body.position.x += Math.sin(now / 230) * 0.03; }
  if (f.stun > 0) { body.rotation.x = -0.25; body.position.z = -0.05; }
  if (f.down) { g.rotation.x = lerp(g.rotation.x, -Math.PI / 2, 0.08); g.position.y = 0.2; } else g.rotation.x = 0;
  gloves.forEach((gl, i) => gl.position.copy(gp[i]));
  rig.arms.forEach((a, i) => placeArm(a, gloves[i], new THREE.Vector3(i ? 0.2 : -0.2, 1.36, 0.02)));
  gloveM.forEach((m, i) => m.emissive.setRGB(glow[i], glow[i] * 0.75, 0));
  legs.forEach((l, i) => l.mat.emissive.setRGB(glowLeg[i], glowLeg[i] * 0.75, 0));
  const flash = f.stun > 0 ? 0.35 : 0;
  torsoM.emissive.setRGB(flash, flash, flash);
}

// ---------- hit sparks ----------
const sparks = [];
function spark(pos, color, size) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  m.position.copy(pos); scene.add(m); sparks.push({ m, t: 0, size });
}
function tickSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.t += dt;
    s.m.scale.setScalar(0.6 + s.t * 6 * s.size); s.m.material.opacity = 0.8 - s.t * 4;
    if (s.t > 0.2) { scene.remove(s.m); sparks.splice(i, 1); }
  }
}

// ---------- HUD ----------
let st, ai;
const slots = cfg.player.kit;
const btnEls = [];
const KEYS = ["J", "K", "L", "I"];
function buildButtons() {
  const box = $("btns"); box.innerHTML = "";
  const gd = document.createElement("div"); gd.className = "k guard"; gd.innerHTML = "防禦<small>按住</small><kbd>空白</kbd>";
  box.appendChild(gd); hold(gd, (v) => (input.guardTouch = v));
  slots.forEach((id, i) => {
    const m = cfg.moves[id];
    const el = document.createElement("div");
    el.className = `k s${i}${m.limb.startsWith("kick") ? " kick" : ""}`;
    el.innerHTML = `${m.name}<small>${m.tag}</small><kbd>${KEYS[i]}</kbd><span class="cd"></span>`;
    box.appendChild(el); btnEls.push(el);
    hold(el, (v) => { if (v) input.atk = id; });
  });
  hold($("dodge"), (v) => { if (v) input.dodge = true; });
}
function hold(el, fn) {
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add("down"); fn(true); });
  const up = () => { el.classList.remove("down"); fn(false); };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
}
function renderKit() {
  const box = $("kit");
  box.innerHTML = "<em>對手招式</em>" + st.f[1].kit.map((id) => st.seen[1].has(id) ? `<span class="seen" data-id="${id}">${cfg.moves[id].name}</span>` : `<span data-id="${id}">?</span>`).join("");
}
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function hud() {
  for (const i of [0, 1]) {
    const f = st.f[i];
    const mx = cfg.stamina.max;
    $("st" + i).style.width = (100 * f.sta / mx) + "%";
    $("lost" + i).style.width = (100 * (mx - f.ceil) / mx) + "%";
    $("stb" + i).classList.toggle("tired", f.sta < f.ceil * cfg.stamina.tiredBelow);
    // regen speed: ▲▲▲ fast (out of his strike zone), ▲ slow (inside it, or guarding)
    $("rg" + i).textContent = f.act || f.dodge ? "" : f.guard || f.inZone ? "▲" : "▲▲▲";
    $("rg" + i).style.color = f.guard || f.inZone ? "#8b93a3" : "#7fe0a0";
  }
  $("clock").textContent = fmt(st.clock);
  $("rnd").textContent = `第 ${st.round} 回合`;
  const p = st.f[0], d = dist(p, st.f[1]);
  slots.forEach((id, i) => {
    const m = cfg.moves[id], el = btnEls[i];
    const cd = p.cds[id] > 0 ? p.cds[id] / (m.windup + m.active + m.recovery + m.cd) : 0;
    el.classList.toggle("off", p.sta < m.sta);
    el.classList.toggle("far", d > m.max + (m.lunge || 0));
    el.querySelector(".cd").style.background = cd > 0 ? `conic-gradient(#000a 0 ${cd * 100}%,transparent ${cd * 100}%)` : "none";
  });
}
const v3 = new THREE.Vector3();
function pop(text, color, worldPos, size = 16) {
  v3.copy(worldPos).project(camera);
  const el = document.createElement("div"); el.className = "pop";
  el.style.left = ((v3.x + 1) / 2 * W) + "px"; el.style.top = ((1 - v3.y) / 2 * H) + "px";
  el.style.color = color; el.style.fontSize = size + "px"; el.textContent = text;
  stage.appendChild(el); setTimeout(() => el.remove(), 800);
}
let bannerT = 0;
function banner(text, ms = 1200) { const b = $("banner"); b.textContent = text; b.classList.add("on"); bannerT = ms; }

// ---------- input ----------
const input = { atk: null, dodge: false, guardTouch: false, stickX: 0, stickY: 0 };
const keys = new Set();
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase(); keys.add(k);
  const i = KEYS.indexOf(e.key.toUpperCase());
  if (i >= 0) input.atk = slots[i];
  if (k === "shift") input.dodge = true;
  if (k === " " || k.startsWith("arrow")) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
// floating stick in the lower-left zone
const zone = $("stickzone"), stickEl = $("stick"), knob = $("knob");
let stickId = null, stickC = null;
const local = (e) => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
zone.addEventListener("pointerdown", (e) => {
  e.preventDefault(); zone.setPointerCapture(e.pointerId); stickId = e.pointerId;
  const p = local(e); stickC = p;
  stickEl.style.left = (p.x - 56) + "px"; stickEl.style.bottom = (H - p.y - 56) + "px";
});
zone.addEventListener("pointermove", (e) => {
  if (e.pointerId !== stickId) return;
  const p = local(e); let dx = p.x - stickC.x, dy = p.y - stickC.y;
  const l = Math.hypot(dx, dy), max = 40; if (l > max) { dx *= max / l; dy *= max / l; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  input.stickX = dx / max; input.stickY = -dy / max;
});
const stickUp = (e) => { if (e.pointerId !== stickId) return; stickId = null; input.stickX = input.stickY = 0; knob.style.transform = ""; stickEl.style.left = "34px"; stickEl.style.bottom = "26px"; };
zone.addEventListener("pointerup", stickUp); zone.addEventListener("pointercancel", stickUp);

function playerInput() {
  let x = input.stickX, y = input.stickY;
  if (keys.has("a") || keys.has("arrowleft")) x -= 1;
  if (keys.has("d") || keys.has("arrowright")) x += 1;
  if (keys.has("w") || keys.has("arrowup")) y += 1;
  if (keys.has("s") || keys.has("arrowdown")) y -= 1;
  // screen right = toward the opponent (camera keeps you on the left); screen up = away from camera
  const inp = { fwd: x, side: -y, guard: keys.has(" ") || input.guardTouch, dodge: input.dodge, atk: input.atk };
  // keep a pressed attack queued briefly so a press during recovery still comes out
  if (input.atk) { input.atkAge = (input.atkAge || 0) + 1; if (input.atkAge > 12 || st.f[0].act?.t === 0) { input.atk = null; input.atkAge = 0; } }
  input.dodge = false;
  return inp;
}

// ---------- events -> effects ----------
let shake = 0;
function handleEvents() {
  for (const e of st.events) {
    const t = e.target != null ? st.f[e.target] : null;
    const at = t ? new THREE.Vector3(t.x, 1.45, t.z) : null;
    // no numbers or words on screen (user 2026-11-15: like the EA UFC games); only a small impact and a shake on big shots
    if (e.type === "hit") {
      const big = e.dmg >= 9 || e.counter;
      spark(at, 0xffffff, big ? 0.9 : 0.5);
      if (big) shake = 0.12;
    } else if (e.type === "block") spark(at, 0x9fb6d8, 0.3);
    if ((e.type === "hit" || e.type === "block" || e.type === "dodged" || e.type === "miss") && e.by === 1) {
      const el = $("kit").querySelector(`[data-id="${e.move}"]`);
      if (el && !el.classList.contains("seen")) { renderKit(); $("kit").querySelector(`[data-id="${e.move}"]`).classList.add("flash"); }
    }
    if (e.type === "ko") { banner(e.target === 1 ? "KO！你贏了" : "被 KO 了", 99999); shake = 0.25; }
  }
}

// ---------- camera: broadcast side view, you on the left ----------
const camN = new THREE.Vector3(0, 0, 1);
function updateCamera(dt, snap) {
  const a = st.f[0], b = st.f[1];
  const d = dist(a, b) || 1, dx = (b.x - a.x) / d, dz = (b.z - a.z) / d;
  const want = new THREE.Vector3(-dz, 0, dx);
  if (snap) camN.copy(want); else camN.lerp(want, 1 - Math.pow(0.004, dt)).normalize();
  const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  const back = Math.max(5.2, Math.min(8, 4 + d * 1.1));
  camera.position.copy(mid).addScaledVector(camN, back); camera.position.y = 2.6;
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 0.8); }
  camera.lookAt(mid.x, 0.95, mid.z);
  // fade fence posts between the camera and the fighters
  for (const p of fenceParts) p.obj.visible = p.at.clone().sub(mid).normalize().dot(camN) < 0.35;
}

function updateRings() {
  const p = st.f[0], ranges = slots.map((id) => cfg.moves[id].max);
  const outer = Math.max(...ranges), inner = Math.min(...ranges);
  ringOuter.scale.setScalar(outer); ringInner.scale.setScalar(inner); ringFill.scale.setScalar(outer);
  for (const m of [ringOuter, ringInner, ringFill]) m.position.set(p.x, 0.015, p.z);
  const d = dist(p, st.f[1]);
  ringOuter.material.opacity = d <= outer ? 0.85 : 0.35;
  ringInner.material.opacity = d <= inner ? 0.85 : 0.25;
}

// ---------- screens ----------
function startFight() {
  const seed = Number(q.get("seed")) || (Date.now() % 100000);
  st = createFight(cfg, { seed });
  ai = createAI(cfg, st.rand, q.get("ai"));
  for (const r of rigs) r.g.rotation.x = 0;
  renderKit(); hud(); updateCamera(0, true);
  $("ov").classList.remove("on");
  banner("第 1 回合　開打！");
}
function moveRows(f, onlySeen) {
  return Object.entries(f.stats.byMove).filter(([id]) => !onlySeen || st.seen[f.id].has(id))
    .map(([id, s]) => `<tr><td>${cfg.moves[id].name}</td><td>用了 ${s.thrown} 次，中 ${s.landed}</td></tr>`).join("");
}
const PART_COLORS = ["#3fbf6a", "#e6d36a", "#ff9a3c", "#e8383d"];
const partLevel = (v) => Math.min(3, Math.floor(v / (cfg.parts.max / 4)));
const partBox = (name, v) => `<span class="part" style="background:${PART_COLORS[partLevel(v)]}">${name}</span>`;
function scoutHint(o) {
  const P = o.parts, rows = [["head", "他的頭被打得不輕，一記重拳就可能倒"], ["legs", "他的腳步開始拖了"], ["body", "他的呼吸變重了"]];
  const [k, txt] = rows.map(([k, t]) => [k, t]).sort((a, b) => P[b[0]] - P[a[0]])[0];
  return P[k] < cfg.parts.max * 0.2 ? "他還沒受到什麼傷" : txt;
}
function showBreak() {
  const o = st.f[1], hidden = o.kit.filter((id) => !st.seen[1].has(id)).length;
  $("panel").innerHTML = `<h2>第 ${st.round} 回合結束</h2>
    <p>你：出手 ${st.f[0].stats.thrown}、打中 ${st.f[0].stats.landed} · 對手：出手 ${o.stats.thrown}、打中 ${o.stats.landed}</p>
    <p style="margin-top:6px"><b>你的狀況</b>（休息後體力上限 ${Math.min(cfg.stamina.max, Math.round(st.f[0].ceil + cfg.stamina.restCeil))}／${cfg.stamina.max}）</p>
    <div class="parts">${partBox("頭", st.f[0].parts.head)}${partBox("身體", st.f[0].parts.body)}${partBox("腳", st.f[0].parts.legs)}<span class="leg">● 沒事 ● 有點 ● 不輕 ● 很糟</span></div>
    <p style="margin-top:6px;color:#ffa3a6">球探：${scoutHint(o)}</p>
    <p style="margin-top:2px;color:#ffa3a6">紅角目前露出的招式</p>
    <table>${moveRows(o, true) || "<tr><td>還沒出手</td><td></td></tr>"}${hidden ? `<tr><td>另外 ${hidden} 招</td><td>還沒露出來</td></tr>` : ""}</table>
    <p style="color:var(--dim)">（商店之後才做；休息後體力回到上限，上限 +${cfg.stamina.restCeil}）</p>
    <button class="go" id="goNext">開始第 ${st.round + 1} 回合 ▶</button>`;
  $("ov").classList.add("on");
  $("goNext").onclick = () => { nextRound(st); $("ov").classList.remove("on"); updateCamera(0, true); banner(`第 ${st.round} 回合　開打！`); };
}
function showEnd() {
  const w = st.winner, o = st.f[1];
  const title = w === -1 ? "平手" : w === 0 ? `你贏了（${st.how}）` : `你輸了（${st.how}）`;
  $("panel").innerHTML = `<h2>${title}</h2>
    <p>對手打法：<b>${ai.name}</b>　招式：${o.kit.map((id) => cfg.moves[id].name).join("、")}</p>
    <table><tr><td>你 出手／打中</td><td>${st.f[0].stats.thrown}／${st.f[0].stats.landed}</td></tr>
    <tr><td>對手 出手／打中</td><td>${o.stats.thrown}／${o.stats.landed}</td></tr>
    <tr><td>你擋下</td><td>${st.f[0].stats.blocked} 次</td></tr></table>
    <button class="go" id="again">再打一場 ▶</button>`;
  $("ov").classList.add("on");
  $("again").onclick = startFight;
}
function showIntro() {
  $("panel").innerHTML = `<h2>V3 灰盒 · 即時站立對打</h2>
    <p>美術先用膠囊和球。<b>你是藍角，鏡頭永遠把你放在左邊</b>，跟著兩人轉。</p>
    <ul>
      <li>左右：前進／後退　上下：繞圈</li>
      <li>地上藍圈：外圈＝低踢打得到、內圈＝勾拳</li>
      <li>對手出招前手腳會<b>發黃光</b>：防禦或閃</li>
      <li>刺拳最輕、勾拳和高踢最重。<b>輕的打不斷重的</b>：你刺拳時他可以一記直拳跟你換</li>
      <li>用一樣重或更重的招打中他出招的前搖＝<b>反擊</b>，打斷他、傷害更高</li>
      <li>防禦：擋大部分拳，但低踢擋不太住、會扣體力</li>
      <li>對手的 ${cfg.opponent.kitSize} 招一開始是「?」，用過才翻開</li>
    </ul>
    <p>${cfg.round.count} 回合 × ${cfg.round.seconds} 秒。鍵盤：WASD 移動、J K L I 出招、空白鍵防禦、Shift 閃。手機：左下拖曳搖桿。</p>
    <button class="go" id="start">開打 ▶</button>`;
  $("start").onclick = startFight;
}

// ---------- main loop ----------
buildButtons();
st = createFight(cfg, { seed: 1 });
ai = createAI(cfg, st.rand);
renderKit(); hud(); updateCamera(0, true);
showIntro();
let last = performance.now(), acc = 0, wasPhase = "fight";
function update(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const live = !$("ov").classList.contains("on");
  if (live && st.phase === "fight") {
    acc += dt;
    while (acc >= DT && st.phase === "fight") {
      acc -= DT;
      st.events = [];
      step(st, DT, [playerInput(), aiInput(ai, st, 1, DT)]);
      handleEvents();
    }
  } else acc = 0;
  if (st.phase !== wasPhase) {
    wasPhase = st.phase;
    if (st.phase === "break") setTimeout(showBreak, 700);
    if (st.phase === "over") setTimeout(showEnd, 1800);
  }
  poseRig(rigs[0], st.f[0], st.f[1], now); poseRig(rigs[1], st.f[1], st.f[0], now);
  tickSparks(dt); updateCamera(dt); updateRings(); hud();
  if (bannerT > 0 && (bannerT -= dt * 1000) <= 0) $("banner").classList.remove("on");
  renderer.render(scene, camera);
}
function frame(now) { update(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
// debug: __v3.tick(frames) advances the game without rAF (hidden tabs pause rAF)
window.__v3 = { get st() { return st; }, cfg, input, camera, THREE, tick(n = 60) { for (let i = 0; i < n; i++) update(last + 1000 / 60); } };
