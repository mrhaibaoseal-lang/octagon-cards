// Octagon Cards — one-on-one board battler, browser front end. Rules live in engine.js / ai.js; this file draws and forwards clicks.
import * as E from "./engine.js";
import { shop as aiShop, cornerPick } from "./ai.js";

const params = new URLSearchParams(location.search);
const load = async (n) => (await fetch(`rules/bg/${n}.json`)).json();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SCHOOL = { punch: "拳", kick: "踢", grap: "摔", def: "防" };
const KW = { guard: "架擋", slip: "閃躲", flurry: "連打", sweep: "掃", sub: "降伏" };

let data, st, speed = params.has("fast") ? 0 : 1, choice = { a: null, b: null }, sel = null, runId = 0;
const frame = $("#frame");
const sleep = (ms) => new Promise((r) => setTimeout(r, speed === 0 ? 0 : ms / speed));
const scale = () => Math.min(innerWidth / 844, innerHeight / 390);
function fit() { frame.style.transform = `scale(${scale()})`; }
addEventListener("resize", fit);

async function boot() {
  const [config, skills, fighters] = await Promise.all([load("config"), load("skills"), load("fighters")]);
  data = E.prepare({ config, skills: strip(skills), fighters: strip(fighters) });
  const ids = Object.keys(data.fighters);
  choice = { a: params.get("a") || ids[0], b: params.get("b") || ids[1] };
  fit();
  pickScreen();
}

// ---------- fighters on the stage ----------
// Sprites come from assets/private (gitignored). Without them a plain coloured dummy stands in.
const POSES = ["idle", "punch", "kick", "shoot", "hit", "down"], POSE_OF = { punch: "punch", kick: "kick", grap: "shoot", def: "punch" }, K = 0.62;
const art = {}, poseT = {};
let manifest = null;
const loadImage = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
async function loadArt(ids) {
  if (!manifest) { try { const r = await fetch("assets/private/manifest.json"); manifest = r.ok ? await r.json() : {}; } catch { manifest = {}; } }
  await Promise.all(ids.map(async (id) => {
    if (art[id]) return;
    const meta = manifest.fighters?.[id], poses = {};
    if (meta) await Promise.all(POSES.map(async (p) => { const img = await loadImage(`assets/private/${id}/${p}.png`); if (img) poses[p] = { src: img.src, w: img.naturalWidth, h: img.naturalHeight, ax: meta[p]?.anchorX ?? img.naturalWidth / 2 }; }));
    art[id] = poses;
  }));
}
/** Put side s in a pose; with ms it goes back to idle afterwards. */
function pose(s, name, ms) {
  const n = $("#f" + s);
  if (!n) return;
  clearTimeout(poseT[s]);
  const set = art[st[s].id] || {}, p = set[name] || set.idle;
  n.dataset.pose = name;
  n.firstChild.innerHTML = p ? `<img src="${p.src}" style="width:${p.w * K}px;height:${p.h * K}px;left:${-p.ax * K}px">` : `<div class="dummy"><i></i></div>`;
  if (ms) poseT[s] = setTimeout(() => pose(s, "idle"), ms / (speed || 1));
}
/** A fighter does something: attack (with the card's school), hit, slip, down. */
function act(s, kind, school) {
  const n = $("#f" + s);
  if (!n) return;
  if (kind === "down") return pose(s, "down");
  if (speed === 0) return;
  const move = (frames, ms) => n.firstChild.animate(frames, { duration: ms / speed, easing: "ease-out" });
  if (kind === "attack") { pose(s, POSE_OF[school] || "punch", 380); move([{ transform: "translateX(-6px)" }, { transform: "translateX(30px)", offset: 0.4 }, { transform: "translateX(30px)", offset: 0.75 }, { transform: "none" }], 380); }
  else if (kind === "hit") { pose(s, "hit", 320); move([{ transform: "none", filter: "brightness(2.2)" }, { transform: "translateX(-14px)", filter: "brightness(1)", offset: 0.35 }, { transform: "none" }], 320); }
  else if (kind === "slip") move([{ transform: "none" }, { transform: "translateX(-20px) rotate(-10deg)", offset: 0.4 }, { transform: "none" }], 340);
}
function fighterPos(s) { return { x: s === "a" ? 366 : 478, y: 116 + 70 }; }

// ---------- cards ----------
/** One card. c = a board card / clash unit / { id } for a shop offer. o: small, cls, attr, note */
function card(c, o = {}) {
  const d = data.skills[c.id], m = c.gold ? data.config.golden : 1;
  const atk = c.atk ?? d.atk, hp = c.hp ?? d.hp, kw = c.kw ? Object.keys(c.kw) : d.kw;
  const up = (v, base) => (v > base * m ? "up" : v < base * m ? "down" : "");
  return `<div class="sk ${d.school} ${c.gold ? "gold" : ""} ${o.small ? "s" : ""} ${c.dead ? "dead" : ""} ${o.cls || ""}" ${o.attr || ""}>
    <i class="g">${SCHOOL[d.school]}</i><b class="nm">${esc(d.name)}</b><span class="tier">${"●".repeat(d.tier)}</span>
    ${kw.length ? `<div class="kws">${kw.map((k) => `<em>${KW[k]}</em>`).join("")}${c.stun ? "<em class='bad'>被壓制</em>" : ""}</div>` : c.stun ? `<div class="kws"><em class="bad">被壓制</em></div>` : ""}
    ${o.small ? "" : `<small>${esc(o.note || (d.fx.length || !kw.length ? d.text : ""))}</small>`}
    <span class="atk ${up(atk, d.atk)}">${atk}</span><span class="hp ${up(hp, d.hp)}">${Math.max(0, hp)}</span></div>`;
}
const empty = (o = {}, text = "空位") => `<div class="sk empty ${o.small ? "s" : ""}" ${o.attr || ""}><span>${text}</span></div>`;

// ---------- screens ----------
function pickScreen() {
  runId++;
  const ids = Object.keys(data.fighters);
  const btn = (s, id) => { const f = data.fighters[id]; return `<button data-s="${s}" data-id="${id}" class="${choice[s] === id ? "on" : ""}"><b>${esc(f.name)}</b><small>${esc(f.style)}｜${esc(f.power.text)}</small></button>`; };
  frame.innerHTML = `<div class="bgart"></div><div class="over solid"><div class="box">
    <h2>Octagon Cards</h2>
    <p>每一段開打前逛<b>商店</b>買招式。開打後雙方的牌<b>由左到右輪流出手</b>互打；把對方的牌打光，剩下的牌就打在<b>他本人</b>身上。耐久歸零＝KO，否則打完 ${data.config.rounds} 回合看計分。</p>
    <h3>你的選手</h3><div class="pick you">${ids.map((id) => btn("a", id)).join("")}</div>
    <h3>對手</h3><div class="pick foe">${ids.map((id) => btn("b", id)).join("")}</div>
    <button class="go" id="go">進商店</button></div></div>`;
  frame.querySelectorAll(".pick button").forEach((b) => (b.onclick = () => { choice[b.dataset.s] = b.dataset.id; pickScreen(); }));
  $("#go").onclick = async () => { await loadArt([choice.a, choice.b]); st = E.createGame(data, choice.a, choice.b, Number(params.get("seed")) || (Date.now() % 2147483647)); sel = null; shopScreen(); };
}

function hud(hp = { a: st.a.hp, b: st.b.hp }) {
  const side = (s) => `<div class="hud ${s}" id="hud${s}"><div class="hpn">${hp[s]}</div><div class="hb"><div class="who"><b>${s === "a" ? "你" : "對手"}</b><small>${esc(st[s].f.short)}・${esc(st[s].f.power.text)}</small></div>
    <div class="bar"><b style="width:${(hp[s] / st.cfg.hp) * 100}%"></b></div></div></div>`;
  const cards = st.rounds.map((r) => `${r.a}-${r.b}`).join(" ");
  return `<div id="top">${side("a")}<div id="mid"><b>第 ${st.round} 回合・第 ${st.clash} 段</b><small>這回合 你 <i class="a">${st.wins.a}</i> : <i class="b">${st.wins.b}</i> 他${cards ? "　計分 " + cards : ""}</small></div>${side("b")}</div>`;
}
function setHp(hp) {
  for (const s of ["a", "b"]) { const h = $("#hud" + s); if (!h) continue; h.querySelector(".hpn").textContent = hp[s]; h.querySelector(".bar b").style.width = (hp[s] / st.cfg.hp) * 100 + "%"; }
}

// ---------- shop ----------
function shopScreen(msg = "") {
  if (st.over) return finish();
  if (st.phase === "corner") return cornerScreen();
  const F = st.a, sh = F.shop, cfg = st.cfg.shop;
  const offers = sh.offers.map((id, i) => {
    if (!id) return empty({}, "已買");
    const p = E.place(st, "a", id), can = sh.gold >= cfg.cost && p;
    return card({ id }, { cls: (can ? "buy" : "no") + (p && p.triple ? " triple" : ""), attr: `data-offer="${i}"`, note: p && p.triple ? "第三張：合成金卡！" : !p ? "技能列滿了，先賣一張" : null });
  }).join("");
  const shown = st.b.shown.some(Boolean);
  frame.innerHTML = `<div class="bgart shopbg"></div>${hud()}
    <div id="foe"><h4>${esc(st.b.f.short)} 上一段用的牌<small>${shown ? "他這一段新買的要開打才看得到" : "還沒交手過"}</small></h4><div class="row s">${shown ? st.b.shown.map((c) => (c ? card(c, { small: true }) : empty({ small: true }, "？"))).join("") : ""}</div></div>
    <div id="store"><h4>商店<small>第 ${sh.tier} 級</small><span class="coins"><i></i>${sh.gold}</span></h4>
      <div class="row">${offers}</div>
      <div class="acts"><button id="reroll" class="${sh.gold >= cfg.reroll ? "" : "no"}">重抽<small>${cfg.reroll} 金</small></button>
      <button id="freeze" class="${sh.frozen ? "on" : ""}">${sh.frozen ? "已凍結" : "凍結"}<small>留到下一段</small></button>
      <button id="tier" class="${E.canTier(st, "a") && sh.gold >= sh.upCost ? "" : "no"}">${E.canTier(st, "a") ? `升級商店<small>${sh.upCost} 金</small>` : "商店已最高級"}</button></div></div>
    <div id="mine"><h4>你的牌<small>${sel == null ? "牌 3 金。點一張選起來，再點另一格換位置" : "再點一格換位置，或賣掉"}</small>${sel != null ? `<button id="sell">賣掉 +${cfg.sell} 金</button>` : ""}</h4>
      <div class="row">${F.board.map((c, i) => (c ? card(c, { cls: sel === i ? "sel" : "", attr: `data-slot="${i}"` }) : empty({ attr: `data-slot="${i}"` }))).join("")}</div></div>
    <div id="foot"><span class="msg">${esc(msg) || "由左到右輪流出手。左下是攻擊、右下是耐力。"}</span><button id="fight">開打</button></div>`;
  frame.querySelectorAll("[data-offer]").forEach((el) => (el.onclick = () => {
    const i = Number(el.dataset.offer), id = sh.offers[i];
    if (E.buy(st, "a", i)) { sel = null; shopScreen(`買了${data.skills[id].name}`); }
    else shopScreen(sh.gold < cfg.cost ? "金幣不夠" : "技能列滿了，先賣掉一張");
  }));
  frame.querySelectorAll("#mine .sk").forEach((el) => (el.onclick = () => {
    const i = Number(el.dataset.slot);
    if (sel == null) { if (F.board[i]) sel = i; } else { if (i !== sel) E.swap(st, "a", sel, i); sel = null; }
    shopScreen();
  }));
  if ($("#sell")) $("#sell").onclick = () => { E.sell(st, "a", sel); sel = null; shopScreen(); };
  $("#reroll").onclick = () => shopScreen(E.reroll(st, "a") ? "" : "金幣不夠");
  $("#freeze").onclick = () => { E.freeze(st, "a"); shopScreen(st.a.shop.frozen ? "商店會留到下一段" : ""); };
  $("#tier").onclick = () => shopScreen(E.tierUp(st, "a") ? "商店升級了：之後會出現更強的牌" : E.canTier(st, "a") ? "金幣不夠" : "");
  $("#fight").onclick = () => { if (!F.board.some(Boolean)) return shopScreen("至少要有一張牌"); sel = null; clash(++runId); };
  if (F.discover) discoverScreen();
}

function discoverScreen() {
  const F = st.a, d = document.createElement("div");
  d.className = "over";
  d.innerHTML = `<div class="box"><h2>選一張，免費</h2><div class="row big">${F.discover.map((id, i) => card({ id }, { cls: "buy", attr: `data-pick="${i}"`, note: E.place(st, "a", id) ? null : "技能列滿了：選了也放不下" })).join("")}</div></div>`;
  frame.appendChild(d);
  d.querySelectorAll("[data-pick]").forEach((el) => (el.onclick = () => { const id = F.discover[el.dataset.pick]; E.pick(st, "a", Number(el.dataset.pick)); shopScreen(`拿到${data.skills[id].name}`); }));
}

function cornerScreen() {
  const last = st.rounds[st.rounds.length - 1];
  frame.innerHTML = `<div class="bgart shopbg"></div>${hud()}<div class="over solid"><div class="box">
    <h2>第 ${st.round} 回合結束：${last.a > last.b ? "你拿下" : last.b > last.a ? "他拿下" : "平手"}（${last.a}-${last.b}）</h2>
    <p>這回合三段你贏 <b>${last.wins.a}</b> 段、他贏 <b>${last.wins.b}</b> 段。計分卡 ${st.rounds.map((r) => `${r.a}-${r.b}`).join("、")}。</p>
    <h3>角落時間，選一項</h3>
    <div class="pick">${Object.entries(st.cfg.corner).map(([k, o]) => `<button data-k="${k}"><b>${esc(o.name)}</b><small>${esc(o.text)}</small></button>`).join("")}</div></div></div>`;
  frame.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { E.corner(st, "b", cornerPick(st, "b")); E.corner(st, "a", b.dataset.k); shopScreen(); }));
}

// ---------- clash ----------
function rows(v) {
  const row = (s) => v[s].map((u) => (u && !u.dead ? card(u, { attr: `data-uid="${u.uid}"` }) : empty({}, u ? "被破解" : ""))).join("");
  $("#rowB").innerHTML = row("b");
  $("#rowA").innerHTML = row("a");
}
const el = (uid) => $(`[data-uid="${uid}"]`);
function pos(node) { const r = node.getBoundingClientRect(), f = frame.getBoundingClientRect(), k = scale(); return { x: (r.left - f.left + r.width / 2) / k, y: (r.top - f.top + r.height / 2) / k }; }
function float(at, text, cls) {
  if (!at) return;
  const f = document.createElement("div");
  f.className = "float " + cls;
  f.textContent = text;
  f.style.left = at.x + "px"; f.style.top = at.y + "px";
  frame.appendChild(f);
  setTimeout(() => f.remove(), 900);
}
function say(text, cls = "", small = "") { const b = $("#say"), c = $("#cap"); if (b) b.innerHTML = `<b class="${cls}">${esc(text)}</b>`; if (c) c.textContent = small; }
const unitOf = (v, uid) => { for (const s of ["a", "b"]) for (const u of v[s]) if (u && u.uid === uid) return u; return null; };
const nameOf = (v, uid) => { for (const s of ["a", "b"]) for (const u of v[s]) if (u && u.uid === uid) return data.skills[u.id].name; return ""; };
const sideOf = (v, uid) => (v.a.some((u) => u && u.uid === uid) ? "a" : "b");

/** Play one engine event on screen. Returns the time to hold it (ms). */
async function showEvent(e, prev) {
  switch (e.t) {
    case "clash": rows(e.view); say("開打！", "", `第 ${st.round} 回合・第 ${st.clash} 段`); return 500;
    case "fx": {
      const from = e.from ? el(e.from) : null;
      if (from) { from.classList.add("cast"); }
      rows(e.view);
      if (e.to) { float(el(e.to) && pos(el(e.to)), e.dmg ? `−${e.dmg}` : "閃開", "dmg"); act(sideOf(e.view, e.to), e.dmg ? "hit" : "slip"); }
      for (const uid of e.buff || []) float(el(uid) && pos(el(uid)), "強化", "buff");
      return 260;
    }
    case "attack": {
      const a = el(e.from), t = el(e.to), u = unitOf(prev, e.from);
      act(e.s, "attack", u && data.skills[u.id].school);
      if (a && t && speed !== 0) {
        const pa = pos(a), pt = pos(t);
        a.style.zIndex = 5;
        await a.animate([{ transform: "none" }, { transform: `translate(${(pt.x - pa.x) * 0.12}px,${(pt.y - pa.y) * 0.14}px) scale(1.1)`, filter: "brightness(1.5)" }, { transform: "none" }], { duration: 280 / speed, easing: "ease-in-out" }).finished;
        a.style.zIndex = "";
      }
      say(`${nameOf(prev, e.from)} → ${nameOf(prev, e.to)}`, e.s === "a" ? "good" : "bad", e.s === "a" ? "你出手" : "他出手");
      return 0;
    }
    case "dmg": { const n = el(e.uid), p = n && pos(n); rows(e.view); act(sideOf(e.view, e.uid), "hit"); float(p, `−${e.dmg}`, "dmg"); const m = el(e.uid); if (m) m.classList.add("shake"); return 150; }
    case "slip": { const n = el(e.uid), p = n && pos(n); rows(e.view); act(sideOf(e.view, e.uid), "slip"); float(p, "閃開！", "buff"); return 220; }
    case "sub": float(el(e.uid) && pos(el(e.uid)), "降伏！", "dmg"); return 200;
    case "weaken": rows(e.view); float(el(e.uid) && pos(el(e.uid)), "攻擊下降", "dmg"); return 160;
    case "stun": rows(e.view); float(el(e.uid) && pos(el(e.uid)), "被壓制", "dmg"); return 160;
    case "stunned": float(el(e.uid) && pos(el(e.uid)), "出不了手", "dmg"); rows(e.view); return 300;
    case "break": { const n = el(e.uid), p = n && pos(n); float(p, "破解", "break"); rows(e.view); return 200; }
    case "react": say(e.grade === "miss" ? "慢了" : e.grade === "perfect" ? "完美！" : "好！", e.grade === "miss" ? "bad" : "good"); return 250;
    case "clashend": {
      setHp(e.hp);
      const o = e.s ? E.other(e.s) : null;
      if (e.s) { $("#hud" + o).classList.add("hurt"); act(e.s, "attack", "punch"); act(o, e.hp[o] <= 0 ? "down" : "hit"); float(fighterPos(o), `−${e.dmg}`, "dmg"); say(e.s === "a" ? `這一段你贏了：他耐久 −${e.dmg}` : `這一段他贏了：你耐久 −${e.dmg}`, e.s === "a" ? "good" : "bad", "剩下的牌打在選手身上"); }
      else say("這一段平手", "", "雙方的牌都打光了");
      return 1300;
    }
    case "roundend": say(e.card.a > e.card.b ? "這回合你拿下" : e.card.b > e.card.a ? "這回合他拿下" : "這回合平手", e.card.a > e.card.b ? "good" : e.card.b > e.card.a ? "bad" : "", `${e.card.a}-${e.card.b}`); return 1100;
    default: return 0;
  }
}

function qte(p) {
  const q = st.cfg.react;
  if (speed === 0) return Promise.resolve("good");
  return new Promise((res) => {
    const box = $("#qte"), g0 = (1 - q.zone.good) / 2, p0 = (1 - q.zone.perfect) / 2, mine = p.s === "a", name = data.skills[p.u.id].name;
    el(p.u.uid)?.classList.add(mine ? "ace" : "warn");
    say(mine ? `你的${name}要出手！` : `他的${name}要打過來！`, mine ? "good" : "bad", mine ? "按準了傷害加成（空白鍵或點時機條）" : "按準了少吃傷害（空白鍵或點時機條）");
    box.innerHTML = `<button class="track"><i class="good" style="left:${g0 * 100}%;width:${q.zone.good * 100}%"></i><i class="perfect" style="left:${p0 * 100}%;width:${q.zone.perfect * 100}%"></i><b class="mark"></b></button>`;
    const mark = box.querySelector(".mark"), t0 = performance.now();
    let done = false, x = 0, raf = 0;
    const end = (grade) => {
      if (done) return;
      done = true; cancelAnimationFrame(raf); removeEventListener("keydown", key);
      box.querySelector(".track").classList.add(grade);
      setTimeout(() => { box.innerHTML = ""; res(grade); }, 300);
    };
    const hit = () => { const d = Math.abs(x - 0.5); end(d <= q.zone.perfect / 2 ? "perfect" : d <= q.zone.good / 2 ? "good" : "miss"); };
    const key = (e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); hit(); } };
    const tick = (now) => {
      const n = ((now - t0) / 1000) * q.speed;
      if (n >= q.sweeps) return end("miss");
      const f = n % 2;
      x = f <= 1 ? f : 2 - f;
      mark.style.left = x * 100 + "%";
      raf = requestAnimationFrame(tick);
    };
    box.querySelector(".track").onclick = hit;
    addEventListener("keydown", key);
    raf = requestAnimationFrame(tick);
  });
}

async function clash(id) {
  aiShop(st, "b");
  frame.innerHTML = `<div class="bgart"></div>${hud()}
    <div class="row" id="rowB"></div><div id="stage"><div id="say"></div><div class="fz" id="fa"><div class="in"></div></div><div class="fz" id="fb"><div class="in"></div></div></div><div class="row" id="rowA"></div>
    <div id="foot"><button id="speed"></button><div id="cue"><small id="cap"></small><div id="qte"></div></div><button id="quit">重來</button></div>`;
  pose("a", "idle"); pose("b", "idle");
  $("#quit").onclick = pickScreen;
  const sp = $("#speed"), label = () => (sp.textContent = `速度 ×${speed || 1}`);
  sp.onclick = () => { speed = speed >= 3 ? 1 : speed + 1; label(); };
  label();
  let from = st.log.length, prev = null;
  E.startClash(st);
  const flush = async () => {
    for (const e of st.log.slice(from)) {
      if (id !== runId) return;
      const ms = await showEvent(e, prev || e.view);
      if (e.view) prev = e.view;
      if (ms) await sleep(ms);
    }
    from = st.log.length;
  };
  await flush();
  while (id === runId && st.phase === "clash") {
    const p = E.needsReact(st), g = p ? await qte(p) : null;
    if (id !== runId) return;
    E.step(st, g);
    await flush();
  }
  if (id !== runId) return;
  await sleep(200);
  shopScreen(st.a.lostLast ? `上一段輸了：金幣 +${st.cfg.gold.loser}` : "");
}

function finish() {
  const o = st.over, d = document.createElement("div");
  d.className = "over";
  const title = o.winner === "a" ? "你贏了" : o.winner === "b" ? "你輸了" : "平手";
  const how = o.how === "DEC" ? `判定 ${o.total.a}-${o.total.b}` : `KO・第 ${o.round} 回合`;
  frame.innerHTML = `<div class="bgart"></div>${hud()}`;
  d.innerHTML = `<div class="box wide"><h2 class="${o.winner === "a" ? "win" : "lose"}">${title}｜${how}</h2>
    ${st.rounds.length ? `<div class="cardrow">${st.rounds.map((r, i) => `<span>第 ${i + 1} 回合 <b>${r.a}-${r.b}</b></span>`).join("")}</div>` : ""}
    <p>你贏了 <b>${st.a.stats.won}</b> 段、打掉他 <b>${st.a.stats.dmg}</b> 耐久；他贏了 <b>${st.b.stats.won}</b> 段、打掉你 <b>${st.b.stats.dmg}</b>。</p>
    <h3>你最後的牌</h3><div class="row s">${st.a.board.map((c) => (c ? card(c, { small: true }) : "")).join("")}</div>
    <h3>他最後的牌</h3><div class="row s">${st.b.board.map((c) => (c ? card(c, { small: true }) : "")).join("")}</div>
    <button class="go" id="again">再來一場</button></div>`;
  frame.appendChild(d);
  $("#again").onclick = pickScreen;
}

boot();
