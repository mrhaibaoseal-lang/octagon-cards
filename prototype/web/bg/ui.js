// Octagon Cards — battlegrounds-style mode, browser front end. Rules live in engine.js; this file draws and forwards clicks.
import * as E from "./engine.js";

const params = new URLSearchParams(location.search);
const load = async (n) => (await fetch(`rules/bg/${n}.json`)).json();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const REGION = { head: "頭", body: "身體", legs: "腿" };
const GLYPH = { punch: "拳", kick: "踢", knee: "膝", defence: "防", takedown: "摔", passive: "體", special: "補" };

let data, st, speed = params.has("fast") ? 0 : 1, choice = { a: null, b: null }, sel = null, runId = 0;
const frame = $("#frame");
const sleep = (ms) => new Promise((r) => setTimeout(r, speed === 0 ? 0 : ms / speed));
function fit() { frame.style.transform = `scale(${Math.min(innerWidth / 844, innerHeight / 390)})`; }
addEventListener("resize", fit);

async function boot() {
  const [config, skills, fighters] = await Promise.all([load("config"), load("skills"), load("fighters")]);
  data = E.prepare({ config, skills: strip(skills), fighters: strip(fighters) });
  const ids = Object.keys(data.fighters);
  choice = { a: params.get("a") || ids[0], b: params.get("b") || ids[1] };
  fit();
  pickScreen();
}

// ---------- cards ----------
const kindCls = (d) => (d.kind === "strike" ? d.region : { defence: "def", takedown: "grap", passive: "pas", special: "spc" }[d.kind]);
const glyph = (d) => (d.kind === "strike" ? GLYPH[d.type] : GLYPH[d.kind]);
/** One skill card. c = { id, lv }; s = whose numbers; o.small / o.price / o.slot / o.cls / o.note */
function card(c, s, o = {}) {
  const d = data.skills[c.id], v = E.view(st, s, c);
  let num = "";
  if (d.kind === "strike") num = `<span class="dmg">${Math.round(v.dmg)}${v.hits > 1 ? "<em>×" + v.hits + "</em>" : ""}</span><span class="acc">${pct(v.acc)}</span>`;
  else if (d.kind === "takedown") num = `<span class="acc">成功 ${pct(v.p)}</span>`;
  else if (v.counter) num = `<span class="acc">反擊 ${Math.round(v.counter)}</span>`;
  const gas = d.active ? `<span class="gas">${"<i></i>".repeat(d.gas || 0) || "<u>0</u>"}</span>` : "";
  const tag = d.kind === "strike" ? REGION[d.region] : { defence: "防守", takedown: "抱摔", passive: "被動", special: "特殊" }[d.kind];
  return `<div class="sk ${kindCls(d)} ${o.small ? "s" : ""} ${o.cls || ""}" ${o.slot != null ? `data-slot="${o.slot}"` : ""} ${o.attr || ""}>
    <i class="g">${glyph(d)}</i><b class="nm">${esc(d.name)}</b>${c.lv > 1 ? `<span class="lv">${"★".repeat(c.lv)}</span>` : ""}
    <div class="n">${num}<span class="tag">${tag}</span></div>${o.small ? "" : `<small>${esc(o.note || d.text || "")}</small>`}${gas}${o.price != null ? `<span class="price">${o.price}</span>` : ""}</div>`;
}
const slotEmpty = (i, o = {}) => `<div class="sk empty ${o.small ? "s" : ""}" data-slot="${i}"><span>空位</span></div>`;
const board = (s, o = {}) => st[s].board.map((c, i) => (c ? card(c, s, { ...o, slot: i, cls: (o.clsFor && o.clsFor(i)) || "" }) : slotEmpty(i, o))).join("");

// ---------- screens ----------
function pickScreen() {
  runId++;
  const ids = Object.keys(data.fighters);
  const btn = (s, id) => { const f = data.fighters[id]; return `<button data-s="${s}" data-id="${id}" class="${choice[s] === id ? "on" : ""}"><b>${esc(f.name)}</b><small>${esc(f.style)}｜${esc(f.bonus.text)}</small></button>`; };
  frame.innerHTML = `<div class="bgart"></div><div class="over solid"><div class="box">
    <h2>Octagon Cards</h2>
    <p>每回合開打前先逛<b>商店</b>：買技能、排順序、升級。開打後技能<b>由左到右</b>自己發動。打 ${data.config.rounds} 回合。</p>
    <h3>你的選手</h3><div class="pick you">${ids.map((id) => btn("a", id)).join("")}</div>
    <h3>對手</h3><div class="pick foe">${ids.map((id) => btn("b", id)).join("")}</div>
    <button class="go" id="go">進商店</button></div></div>`;
  frame.querySelectorAll(".pick button").forEach((b) => (b.onclick = () => { choice[b.dataset.s] = b.dataset.id; pickScreen(); }));
  $("#go").onclick = () => { st = E.createGame(data, choice.a, choice.b, Number(params.get("seed")) || (Date.now() % 2147483647)); shopScreen(); };
}

function hud() {
  const side = (s) => {
    const F = st[s], chin = E.chinOf(st, s), gm = E.gasMaxOf(st, s);
    return `<div class="hud ${s}" id="hud${s}"><div class="who"><b>${s === "a" ? "你" : "對手"}</b><small>${esc(F.f.short)}</small><span class="st"></span></div>
      <div class="bars"><div class="bar head"><b style="width:${Math.min(100, (F.stun / chin) * 100)}%"></b><span>頭 ${Math.round(F.stun)}/${chin}</span></div>
      <div class="pips">${Array.from({ length: gm }, (_, i) => `<i class="${i < F.gas ? "on" : ""}"></i>`).join("")}</div></div></div>`;
  };
  return `<div id="top">${side("a")}<div id="mid"></div>${side("b")}</div>`;
}
function setHud(sn) {
  for (const s of ["a", "b"]) {
    const g = sn[s], h = $("#hud" + s);
    if (!h) continue;
    h.querySelector(".bar.head b").style.width = Math.min(100, (g.stun / g.chin) * 100) + "%";
    h.querySelector(".bar.head span").textContent = `頭 ${Math.round(g.stun)}/${g.chin}`;
    h.querySelectorAll(".pips i").forEach((p, i) => p.classList.toggle("on", i < g.gas));
    h.querySelector(".st").innerHTML = (g.rocked ? `<em class="hot">被打晃</em>` : "") + (g.weak >= 0.05 ? `<em>腿傷 −${pct(g.weak)}</em>` : "");
  }
  const m = $("#mid");
  if (m) m.innerHTML = st.phase === "shop"
    ? `<b>第 ${st.round} 回合前</b><small>${st.rounds.length ? "比數 " + st.rounds.map((r) => `${r.a}-${r.b}`).join(" ") : `共 ${st.cfg.rounds} 回合`}</small>`
    : `<b>第 ${sn.round} 回合　${Math.min(sn.ex, st.cfg.exchanges)}/${st.cfg.exchanges}</b><small>這回合分數　你 <i class="a">${Math.round(sn.a.score)}</i> : <i class="b">${Math.round(sn.b.score)}</i> 他</small>`;
}
const live = () => ({ a: one("a"), b: one("b"), round: st.round, ex: st.ex });
const one = (s) => ({ stun: st[s].stun, chin: E.chinOf(st, s), gas: st[s].gas, gasMax: E.gasMaxOf(st, s), rocked: !!st[s].rocked, score: st[s].score, weak: st[s].weak });

// ---------- shop ----------
function shopScreen(msg = "") {
  const sh = st.shop, cfg = st.cfg.shop, tc = E.tierCost(st);
  const offers = sh.offers.map((id, i) => {
    if (!id) return `<div class="sk empty"><span>已買</span></div>`;
    const p = E.place(st, id), cost = E.costOf(st, id), can = cost <= sh.gold && p;
    const note = p && p.merge != null ? `買了就升到 ${"★".repeat(st.a.board[p.merge].lv + 1)}` : !p ? "技能列滿了：先賣一張" : null;
    return card({ id, lv: 1 }, "a", { price: cost, cls: (can ? "buy" : "no") + (p && p.merge != null ? " merge" : ""), attr: `data-offer="${i}"`, note });
  }).join("");
  const sp = sh.special ? card({ id: sh.special, lv: 1 }, "a", { price: E.costOf(st, sh.special), cls: E.costOf(st, sh.special) <= sh.gold ? "buy" : "no", attr: `data-special="1"` }) : `<div class="sk empty"><span>這次沒有<br>特殊選項</span></div>`;
  frame.innerHTML = `<div class="bgart shopbg"></div>${hud()}
    <div id="foe"><h4>${esc(st.b.f.short)} 這回合的技能<small>由左到右發動</small></h4><div class="row s">${board("b", { small: true })}</div></div>
    <div id="store"><h4>商店<small>第 ${sh.tier} 級${tc == null ? "（最高）" : ""}</small><span class="gold"><i></i>${sh.gold}</span></h4>
      <div class="row">${offers}<div class="sep"></div>${sp}</div>
      <div class="acts"><button id="reroll" class="${sh.gold >= cfg.reroll ? "" : "no"}">重抽<small>${cfg.reroll} 金</small></button>
      <button id="tier" class="${tc != null && sh.gold >= tc ? "" : "no"}">${tc == null ? "商店已最高級" : `升級商店<small>${tc} 金・出現更強的技能</small>`}</button></div></div>
    <div id="mine"><h4>你的技能列<small>${sel == null ? "點一張選起來，再點另一格換位置" : "再點一格換位置，或賣掉"}</small>${sel != null ? `<button id="sell">賣掉 +${cfg.sell} 金</button>` : ""}</h4>
      <div class="row">${board("a", { clsFor: (i) => (sel === i ? "sel" : "") })}</div></div>
    <div id="foot"><span class="msg">${esc(msg) || "技能由左到右發動：起手技放左邊，「接在拳後面」的放右邊。"}</span><button id="fight">開打</button></div>`;
  setHud(live());
  frame.querySelectorAll("[data-offer]").forEach((el) => (el.onclick = () => { const id = st.shop.offers[el.dataset.offer]; if (E.buy(st, Number(el.dataset.offer))) { sel = null; shopScreen(`買了${data.skills[id].name}`); } else shopScreen(E.costOf(st, id) > st.shop.gold ? "金幣不夠" : "技能列滿了，先賣掉一張"); }));
  const spEl = frame.querySelector("[data-special]");
  if (spEl) spEl.onclick = () => { const id = st.shop.special; shopScreen(E.buySpecial(st) ? `用了${data.skills[id].name}` : "金幣不夠"); };
  frame.querySelectorAll("#mine .sk").forEach((el) => (el.onclick = () => {
    const i = Number(el.dataset.slot);
    if (sel == null) { if (st.a.board[i]) sel = i; } else { if (i !== sel) E.swap(st, sel, i); sel = null; }
    shopScreen();
  }));
  const sellBtn = $("#sell");
  if (sellBtn) sellBtn.onclick = () => { E.sell(st, sel); sel = null; shopScreen(); };
  $("#reroll").onclick = () => shopScreen(E.reroll(st) ? "" : "金幣不夠");
  $("#tier").onclick = () => shopScreen(E.tierUp(st) ? "商店升級了：重抽看看新技能" : tc == null ? "" : "金幣不夠");
  $("#fight").onclick = () => { sel = null; fight(++runId); };
}

// ---------- fight ----------
function fightScreen() {
  frame.innerHTML = `<div class="bgart"></div>${hud()}
    <div class="row s" id="rowB">${board("b", { small: true })}</div>
    <div id="arena"><div id="say"></div>
      <div class="man a"><i class="hd"></i><i class="tr"></i><i class="ar"></i><i class="lg"></i></div>
      <div class="man b"><i class="hd"></i><i class="tr"></i><i class="ar"></i><i class="lg"></i></div></div>
    <div class="row" id="rowA">${board("a")}</div>
    <div id="foot"><button id="speed"></button><div id="qte"></div><button id="quit">重來</button></div>`;
  $("#quit").onclick = pickScreen;
  const sp = $("#speed"), label = () => (sp.textContent = `速度 ×${speed || 1}`);
  sp.onclick = () => { speed = speed >= 3 ? 1 : speed + 1; label(); };
  label();
  setHud(live());
}
const cardEl = (s, slot) => $(`#row${s.toUpperCase()} [data-slot="${slot}"]`);
function pulse(el, cls, ms = 420) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
function float(s, text, cls) {
  const f = document.createElement("div");
  f.className = `float ${cls} on${s}`;
  f.textContent = text;
  $("#arena").appendChild(f);
  setTimeout(() => f.remove(), 950);
}
function say(text, cls = "", small = "") { const b = $("#say"); if (b) b.innerHTML = `<small>${esc(small)}</small><b class="${cls}">${esc(text)}</b>`; }
const who = (s) => (s === "a" ? "你" : st.b.f.short);
const nm = (id) => data.skills[id].name;

/** Show one engine event. Returns how long to hold it (ms). */
function showEvent(e) {
  if (e.snap) setHud(e.snap);
  const o = e.s ? E.other(e.s) : null, mine = e.s === "a";
  switch (e.t) {
    case "round": say("開打！", "", `第 ${st.round} 回合`); return 600;
    case "exchange": document.querySelectorAll(".man").forEach((m) => m.classList.remove("down")); say(`第 ${e.snap.ex} 段`, "dim"); return 380;
    case "hit": {
      pulse(cardEl(e.s, e.slot), "fire"); pulse($(".man." + e.s), "lunge", 300); pulse($(".man." + o), e.clean ? "hit" : "graze", 300);
      const d = Math.round(e.dmg);
      float(o, `${e.clean ? "" : "擦到 "}−${d}`, e.clean ? "clean" : "graze");
      say(`${who(e.s)}的${nm(e.id)}${e.grade === "good" ? "被你卸掉大半" : e.clean ? "打實" : "擦到"}${e.combo ? "（連段）" : ""}`, e.clean ? (mine ? "good" : "bad") : "", `${REGION[e.region]} −${d}`);
      return e.clean ? 520 : 400;
    }
    case "block": pulse(cardEl(e.s, e.slot), "fire"); pulse(cardEl(o, e.from), "fizz"); float(e.s, nm(e.by) + "！", "info"); say(`${who(e.s)}${nm(e.by)}：${nm(e.id)}沒打到`, mine ? "good" : "bad"); return 520;
    case "react": float("a", "完美閃開！", "info"); pulse(cardEl("b", e.from), "fizz"); say(`你看穿了${nm(e.id)}`, "good"); return 520;
    case "counter": pulse($(".man." + o), "hit", 300); float(o, `反擊 −${Math.round(e.dmg)}`, "clean"); return 380;
    case "tired": pulse(cardEl(e.s, e.slot), "fizz"); float(e.s, "沒體力", "graze"); say(`${who(e.s)}沒體力出${nm(e.id)}`, mine ? "bad" : "good"); return 420;
    case "takedown": pulse(cardEl(e.s, e.slot), "fire"); if (e.ok) $(".man." + o).classList.add("down"); float(e.s, e.ok ? "抱摔成功" : "抱摔失敗", e.ok ? "info" : "graze"); say(`${who(e.s)}抱摔${e.ok ? "成功：對手這一段出不了招" : "失敗"}`, e.ok ? (mine ? "good" : "bad") : ""); return 620;
    case "rocked": $(".man." + e.s).classList.add("rocked"); float(e.s, "被打晃！", "clean"); say(`${who(e.s)}被打晃了！`, mine ? "bad" : "good"); return 900;
    case "roundend": document.querySelectorAll(".man").forEach((m) => m.classList.remove("down", "rocked")); say(e.card.a > e.card.b ? "這回合你拿下" : e.card.b > e.card.a ? "這回合他拿下" : "這回合平手", e.card.a > e.card.b ? "good" : e.card.b > e.card.a ? "bad" : "", `${e.card.a}-${e.card.b}`); return 1300;
    default: return 0;
  }
}

const GRADE = { perfect: "完美！", good: "好", miss: "慢了" };
function qte(u) {
  const q = st.cfg.react;
  if (speed === 0) return Promise.resolve("good");
  return new Promise((res) => {
    const box = $("#qte"), g0 = (1 - q.zone.good) / 2, p0 = (1 - q.zone.perfect) / 2;
    pulse(cardEl("b", u.slot), "warn", 4000);
    say(`他要出${u.d.name}！`, "bad", "看準時機按下去（空白鍵或點時機條）");
    box.innerHTML = `<button class="track"><i class="good" style="left:${g0 * 100}%;width:${q.zone.good * 100}%"></i><i class="perfect" style="left:${p0 * 100}%;width:${q.zone.perfect * 100}%"></i><b class="mark"></b></button>`;
    const mark = box.querySelector(".mark"), t0 = performance.now();
    let done = false, x = 0, raf = 0;
    const end = (grade) => {
      if (done) return;
      done = true; cancelAnimationFrame(raf); removeEventListener("keydown", key);
      box.querySelector(".track").classList.add(grade);
      say(GRADE[grade], grade === "miss" ? "bad" : "good");
      setTimeout(() => { box.innerHTML = ""; res(grade); }, 450);
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

async function fight(id) {
  fightScreen();
  const r = st.round;
  let from = st.log.length;
  E.startRound(st);
  const flush = async () => { for (const e of st.log.slice(from)) { if (id !== runId) return; const ms = showEvent(e); if (ms) await sleep(ms); } from = st.log.length; };
  await flush();
  while (id === runId && st.phase === "fight" && st.round === r) {
    const u = E.needsReact(st);
    const g = u ? await qte(u) : null;
    if (id !== runId) return;
    E.step(st, g);
    await flush();
  }
  if (id !== runId) return;
  await sleep(300);
  if (st.over) finish(); else shopScreen(st.wonLast ? `上一回合你拿下：金幣 +${st.cfg.gold.win}` : "");
}

function finish() {
  const o = st.over, d = document.createElement("div");
  d.className = "over";
  const title = o.winner === "a" ? "你贏了" : o.winner === "b" ? "你輸了" : "平手";
  const how = o.how === "DEC" ? `判定 ${o.total.a}-${o.total.b}` : `${o.how}・第 ${o.round} 回合`;
  d.innerHTML = `<div class="box"><h2 class="${o.winner === "a" ? "win" : "lose"}">${title}｜${how}</h2>
    ${st.rounds.length ? `<div class="cardrow">${st.rounds.map((r, i) => `<span>第 ${i + 1} 回合 <b>${r.a}-${r.b}</b></span>`).join("")}</div>` : ""}
    <p>你打出 <b>${Math.round(st.a.stats.dmg)}</b> 傷害、防下 <b>${st.a.stats.blocks}</b> 招；他打出 <b>${Math.round(st.b.stats.dmg)}</b>、防下 <b>${st.b.stats.blocks}</b> 招。</p>
    <h3>你最後的技能列</h3><div class="row s">${board("a", { small: true })}</div>
    <button class="go" id="again">再來一場</button></div>`;
  frame.appendChild(d);
  $("#again").onclick = pickScreen;
}

boot();
