// Browser page for the real-time prototype (rt.html): drawing, touch and keyboard. Rules are engine.js, the opponent is ai.js.
import { createFight, step, phaseOf, looksLike, strikeIds } from "./engine.js";
import { createAI } from "./ai.js";

const load = async (n) => (await fetch(`rules/rt/${n}.json`)).json();
const data = { config: await load("config"), moves: await load("moves"), fighters: await load("fighters") };
const IDS = Object.keys(data.fighters).filter((k) => !k.startsWith("_"));
const cfg = data.config;
const SP = data.moves._special;

const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
const $hud = document.getElementById("hud");
const $pad = document.getElementById("pad");
const $screen = document.getElementById("screen");

const ui = { me: "holloway", foe: "poirier", running: false };
let S = null;
let brain = null;
let floats = [];
let sparks = [];
let banner = null;

// ---------- sprites ----------
const art = {};
const loadImage = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
async function loadArt(ids) {
  let manifest = {};
  try {
    const res = await fetch("assets/private/manifest.json");
    if (res.ok) manifest = await res.json();
  } catch {}
  for (const id of ids) {
    if (art[id]) continue;
    art[id] = { poses: {}, h: 200 };
    const meta = manifest.fighters?.[id];
    if (!meta) continue;
    for (const pose of ["idle", "punch", "kick", "hit", "down"]) {
      const img = await loadImage(`assets/private/${id}/${pose}.png`);
      if (img) art[id].poses[pose] = { img, anchorX: meta[pose]?.anchorX ?? img.width / 2 };
    }
    art[id].h = meta.idle?.h ?? 200;
  }
}

// ---------- input ----------
const held = { left: false, right: false, guard: false };
let press = null;
const KEYS = { j: "jab", k: "cross", l: "hook", u: "body", i: "lowkick", o: "headkick", f: "feint" };
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") held.left = true;
  else if (k === "arrowright" || k === "d") held.right = true;
  else if (k === " ") held.guard = true;
  else if (k === "shift") press = "slip";
  else if (KEYS[k]) press = KEYS[k];
  else return;
  e.preventDefault();
  syncPad();
});
addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") held.left = false;
  else if (k === "arrowright" || k === "d") held.right = false;
  else if (k === " ") held.guard = false;
  syncPad();
});
addEventListener("blur", () => Object.assign(held, { left: false, right: false, guard: false }));

function padHtml() {
  const m = data.moves;
  const b = (act, label, key, cls, hold) => `<button class="btn ${cls}" data-${hold ? "hold" : "press"}="${act}">${label}<small>${key}</small></button>`;
  const strike = (id, cls) => b(id, m[id].name, m[id].key, cls);
  return `<div class="grp left">${b("left", "◀", "←", "", true)}${b("slip", SP.slip.name, "Shift", "def")}${b("right", "▶", "→", "", true)}</div>
    <div class="grp right">${strike("jab", "head")}${strike("cross", "head")}${strike("hook", "head")}${b("guard", SP.guard.name, "空白鍵 按住", "def", true)}
    ${strike("body", "body")}${strike("lowkick", "body")}${strike("headkick", "head")}${b("feint", SP.feint.name, "F", "trick")}</div>`;
}
$pad.innerHTML = padHtml();
function syncPad() {
  for (const el of $pad.querySelectorAll("[data-hold]")) el.classList.toggle("on", held[el.dataset.hold]);
}
$pad.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("button");
  if (!el) return;
  e.preventDefault();
  if (el.dataset.hold) {
    held[el.dataset.hold] = true;
    el.setPointerCapture?.(e.pointerId);
  } else press = el.dataset.press;
  syncPad();
});
for (const t of ["pointerup", "pointercancel", "lostpointercapture"])
  $pad.addEventListener(t, (e) => {
    const el = e.target.closest("button");
    if (el?.dataset.hold) held[el.dataset.hold] = false;
    syncPad();
  });

// ---------- flow ----------
async function start() {
  await loadArt([ui.me, ui.foe]);
  S = createFight(data, ui.me, ui.foe, (Math.random() * 1e9) >>> 0);
  brain = createAI(data, "b", Math.random);
  floats = [];
  sparks = [];
  banner = { text: "開打！", until: performance.now() + 900 };
  press = null;
  $screen.classList.remove("show");
  ui.running = true;
  last = performance.now();
  acc = 0;
}

function selectScreen() {
  const opt = (id, which) => {
    const f = data.fighters[id];
    return `<div class="opt ${ui[which] === id ? "sel" : ""}" data-pick="${which}" data-id="${id}"><b>${f.short}</b>・${f.style}<small>${f.summary}</small></div>`;
  };
  $screen.innerHTML = `<div class="box"><h2>Octagon Cards・即時版（原型 0.1：只有站立）</h2>
    <div class="pick"><div>你：${IDS.map((id) => opt(id, "me")).join("")}</div><div class="foe">對手（電腦）：${IDS.map((id) => opt(id, "foe")).join("")}</div></div>
    <div class="help">
      <div><b>目標</b>：3 分鐘一回合。把對手血打光，或打到倒地 3 次；時間到比總傷害。</div>
      <div><b>移動</b>：◀ ▶（鍵盤 ← →）。每招有自己的距離，刺拳、低踢、高踢比較遠，鉤拳要貼近。</div>
      <div><b>出拳要時間</b>：刺拳最快但輕；鉤拳、高踢很重但慢，對手看得到你在起手。打空了會有一段破綻。</div>
      <div><b>架高</b>（按住）：打頭的拳腳只吃一點點，但<b>打身和低踢照樣中</b>。</div>
      <div><b>閃躲</b>：時機對就躲開打頭的拳，接著出手算<b>反擊（傷害 ×1.6）</b>。躲不到踢和打身，閃空了也有破綻。</div>
      <div><b>趁他出招時打中</b>算迎擊（×1.3）。<b>假動作</b>看起來和直拳一樣，騙他閃或架，再打他的破綻。</div>
      <div><b>體力</b>（黃條）：出手會用，停手會回。沒體力時出手變慢變輕。被打身會掉體力上限。</div>
      <div><b>暈眩</b>：頭被連續打中會暈，滿了就倒地。<b>腿傷</b>：被低踢多了走路變慢。</div>
      <div><b>電腦會學你</b>：你一直用同一招，他會越來越會躲那招。</div>
    </div>
    <div class="row"><button class="go" data-go>開打</button></div></div>`;
  $screen.classList.add("show");
}

function overScreen() {
  const o = S.over;
  const how = { KO: "KO", TKO: "TKO（倒地 3 次）", decision: "判定" }[o.how];
  const who = o.winner ? `${data.fighters[S[o.winner].id].short}${o.winner === "a" ? "（你）" : ""} 贏了` : "平手";
  const row = (label, f) => `<div>${label}</div><div>${f(S.a)}</div><div>${f(S.b)}</div>`;
  const pct = (F) => (F.stats.thrown ? Math.round((F.stats.landed / F.stats.thrown) * 100) : 0);
  $screen.innerHTML = `<div class="box" style="max-width:28rem"><div class="big">${who}</div><div style="text-align:center;color:var(--dim)">${how}・${fmtTime(S.tick)}</div>
    <div class="stats"><div></div><div><b>${data.fighters[S.a.id].short}</b></div><div><b>${data.fighters[S.b.id].short}</b></div>
    ${row("出手", (F) => F.stats.thrown)}${row("命中", (F) => `${F.stats.landed}（${pct(F)}%）`)}${row("被對方擋", (F) => F.stats.blocked)}${row("閃開對方", (F) => F.stats.slipped)}${row("反擊／迎擊", (F) => F.stats.counters)}${row("打空", (F) => F.stats.whiffs)}${row("倒地", (F) => F.knockdowns)}${row("總傷害", (F) => Math.round(F.stats.dealt))}</div>
    <div class="row" style="justify-content:center"><button class="sec" data-menu>換選手</button><button class="go" data-go>再打一場</button></div></div>`;
  $screen.classList.add("show");
}

$screen.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pick]");
  if (p) {
    ui[p.dataset.pick] = p.dataset.id;
    selectScreen();
  } else if (e.target.closest("[data-go]")) start();
  else if (e.target.closest("[data-menu]")) selectScreen();
});

const fmtTime = (tick) => {
  const s = Math.max(0, Math.round(tick / cfg.tps));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ---------- loop ----------
let last = performance.now();
let acc = 0;
let hudN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (ui.running && S && !S.over) {
    acc = Math.min(acc + (now - last), 250);
    const dt = 1000 / cfg.tps;
    while (acc >= dt && !S.over) {
      acc -= dt;
      const mv = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      step(S, { a: { move: mv, guard: held.guard, press }, b: brain(S) });
      press = null;
      for (const e of S.events) react(e, now);
    }
    if (S.over) {
      ui.running = false;
      setTimeout(overScreen, 1300);
    }
  }
  last = now;
  draw(now);
  if (S && ++hudN % 4 === 0) hud();
}

function react(e, now) {
  const name = (id) => data.moves[id]?.name || "";
  if (e.t === "hit") {
    floats.push({ side: e.side, text: `${e.counter === "slip" ? "反擊 " : e.counter ? "迎擊 " : ""}−${Math.round(e.dmg)}`, color: e.counter ? "#ffd24a" : "#ff6b5e", t0: now, big: e.dmg >= 8 });
    sparks.push({ side: e.side, at: e.at, t0: now, big: e.dmg >= 8 });
  } else if (e.t === "blocked") floats.push({ side: e.side, text: "擋", color: "#6db3ff", t0: now });
  else if (e.t === "slipped") floats.push({ side: e.side, text: "閃開！", color: "#9cf0c0", t0: now, big: true });
  else if (e.t === "whiff") floats.push({ side: e.side, text: `${name(e.move)}落空`, color: "#8b93a7", t0: now });
  else if (e.t === "knockdown") banner = { text: `${data.fighters[S[e.side].id].short} 倒地！（${e.n}/${cfg.daze.maxKnockdowns}）`, until: now + 1500 };
  else if (e.t === "over") banner = { text: e.how === "decision" ? "時間到" : e.how, until: now + 1500 };
}

function hud() {
  const side = (s) => {
    const F = S[s];
    const f = data.fighters[F.id];
    const cap = Math.max(cfg.stamina.minCap, cfg.stamina.max - F.bodyLoss * cfg.stamina.bodyCapLoss);
    const chips = [];
    const dz = F.daze / (cfg.daze.limit * f.chin);
    if (dz > 0.45) chips.push(`<span class="chip ${dz > 0.75 ? "bad" : ""}">暈眩 ${Math.round(dz * 100)}%</span>`);
    if (F.legs >= cfg.legs.hurtAt) chips.push(`<span class="chip">腿傷：走路變慢</span>`);
    if (cap < cfg.stamina.max) chips.push(`<span class="chip">體力上限 ${Math.round(cap)}</span>`);
    if (F.knockdowns) chips.push(`<span class="chip bad">倒地 ${F.knockdowns}</span>`);
    return `<div class="side ${s}"><div class="nm">${s === "a" ? `${f.short}<small>你</small>` : `<small>電腦</small>${f.short}`}</div>
      <div class="bar"><i style="width:${(F.hp / cfg.hp) * 100}%"></i></div>
      <div class="bar st"><i class="${F.stamina < 25 ? "low" : ""}" style="width:${F.stamina}%"></i></div>
      <div class="chips">${chips.join("")}</div></div>`;
  };
  $hud.innerHTML = `${side("a")}<div id="clock">${fmtTime(S.end - S.tick)}<small>第 1 回合</small></div>${side("b")}`;
}

// ---------- drawing ----------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth;
  const H = innerHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W, H };
}

function drawCage(W, H, floorY) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#07080c");
  g.addColorStop(1, "#141824");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const top = H * 0.17;
  ctx.fillStyle = "rgba(120,140,170,.07)";
  ctx.fillRect(0, top, W, floorY - top);
  ctx.strokeStyle = "rgba(170,190,220,.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const h = floorY - top;
  for (let x = -h; x < W + h; x += 14) {
    ctx.moveTo(x, top);
    ctx.lineTo(x + h, floorY);
    ctx.moveTo(x + h, top);
    ctx.lineTo(x, floorY);
  }
  ctx.stroke();
  ctx.fillStyle = "#9aa5bb";
  ctx.fillRect(0, top - 2, W, 4);
  for (const x of [0.03, 0.27, 0.73, 0.97]) ctx.fillRect(W * x - 3, top - 4, 6, h + 4);
  const m = ctx.createLinearGradient(0, floorY, 0, H);
  m.addColorStop(0, "#2b3246");
  m.addColorStop(1, "#151926");
  ctx.fillStyle = m;
  ctx.fillRect(0, floorY, W, H - floorY);
  ctx.fillStyle = "#6f7a92";
  ctx.fillRect(0, floorY - 1, W, 2);
}

function poseOf(F) {
  const look = looksLike(S, F);
  if (F.act === "down") return { pose: "down", ox: 0, rot: 0 };
  if (F.act === "stun") return { pose: "hit", ox: -6, rot: 0 };
  if (F.act === "slip") return { pose: "idle", ox: -10, oy: 10, rot: -0.22 };
  if (look.act === "strike") {
    const m = data.moves[look.move];
    if (look.phase === "startup") return { pose: "idle", ox: -5, rot: -0.05, tell: m.name };
    return { pose: m.kind === "kick" ? "kick" : "punch", ox: 4, rot: 0 };
  }
  if (F.act === "feint") return { pose: "idle", ox: 2, rot: 0 };
  return { pose: "idle", ox: 0, rot: 0 };
}

function drawFighter(side, X, floorY, scale, now) {
  const F = S[side];
  const dir = side === "a" ? 1 : -1;
  const p = poseOf(F);
  const a = art[F.id];
  const sp = a?.poses[p.pose] || a?.poses.idle;
  const bob = p.pose === "idle" ? Math.sin(now / 380 + (side === "a" ? 0 : 1.7)) * 1.5 : 0;
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.beginPath();
  ctx.ellipse(X, floorY + 2, (p.pose === "down" ? 70 : 34) * scale * 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(X + dir * p.ox * scale * 2, floorY + (p.oy || 0) * scale + bob);
  if (dir < 0) ctx.scale(-1, 1);
  ctx.rotate(p.rot || 0);
  ctx.imageSmoothingEnabled = false;
  let headY = -190 * scale;
  if (sp) {
    const w = sp.img.width * scale;
    const h = sp.img.height * scale;
    ctx.drawImage(sp.img, -sp.anchorX * scale, -h, w, h);
    headY = -h + 22 * scale;
  } else {
    ctx.fillStyle = side === "a" ? "#3d6fb0" : "#b04a43";
    ctx.fillRect(-22 * scale, -190 * scale, 44 * scale, 190 * scale);
  }
  // Hands up: a blue shield in front of the face.
  if (F.guard && F.act === "idle") {
    ctx.strokeStyle = "rgba(110,180,255,.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(14 * scale, headY + 14 * scale, 26 * scale, -1.1, 1.1);
    ctx.stroke();
  }
  ctx.restore();
  // Wind-up tell: the name of the strike that is coming (a feint shows the strike it copies).
  if (p.tell) {
    ctx.font = "700 13px system-ui, 'PingFang TC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = side === "a" ? "#9cc9ff" : "#ffb3ab";
    ctx.fillText(`${p.tell}…`, X, floorY + headY - 12);
  }
  return headY;
}

function draw(now) {
  const { W, H } = resize();
  const floorY = H * 0.64;
  drawCage(W, H, floorY);
  if (!S) return;
  const span = cfg.cage.right - cfg.cage.left;
  const toX = (x) => W * 0.05 + ((x - cfg.cage.left) / span) * W * 0.9;
  const scale = (H * 0.4) / Math.max(art[S.a.id]?.h || 200, art[S.b.id]?.h || 200);
  const heads = {};
  for (const side of ["a", "b"]) heads[side] = drawFighter(side, toX(S[side].x), floorY, scale, now);
  // Sparks where a hit lands.
  sparks = sparks.filter((s) => now - s.t0 < 220);
  for (const s of sparks) {
    const p = (now - s.t0) / 220;
    const x = toX(S[s.side].x);
    const y = floorY + (s.at === "head" ? heads[s.side] + 12 * scale : s.at === "body" ? -110 * scale : -40 * scale);
    ctx.strokeStyle = `rgba(255,240,200,${1 - p})`;
    ctx.lineWidth = s.big ? 4 : 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r0 = (s.big ? 10 : 6) + p * 10;
      const r1 = r0 + (s.big ? 16 : 9);
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
    ctx.stroke();
  }
  floats = floats.filter((f) => now - f.t0 < 800);
  ctx.textAlign = "center";
  for (const f of floats) {
    const p = (now - f.t0) / 800;
    ctx.font = `800 ${f.big ? 20 : 15}px system-ui, 'PingFang TC', sans-serif`;
    const x = toX(S[f.side].x);
    const y = floorY + heads[f.side] - 30 - p * 26;
    ctx.globalAlpha = 1 - p * p;
    ctx.fillStyle = "#000";
    ctx.fillText(f.text, x + 1, y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x, y);
    ctx.globalAlpha = 1;
  }
  if (banner && now < banner.until) {
    ctx.font = "900 30px system-ui, 'PingFang TC', sans-serif";
    ctx.fillStyle = "#000";
    ctx.fillText(banner.text, W / 2 + 2, H * 0.36 + 2);
    ctx.fillStyle = "#ffd24a";
    ctx.fillText(banner.text, W / 2, H * 0.36);
  }
}

selectScreen();
requestAnimationFrame(frame);
window.__rt = { get S() { return S; }, ui, held, setPress: (p) => (press = p) };
