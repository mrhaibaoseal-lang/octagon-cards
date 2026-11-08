// Arena view for the deck-builder prototype: an octagon cage seen from the side, the two fighters, and short hit reactions.
// Draws only. It reads the engine state and its event log, never changes them. Sprites live in assets/private (gitignored); without them a plain silhouette is drawn.

const POSES = ["idle", "punch", "kick", "hit", "shoot", "down", "gkneel", "gpass", "gpunch", "gpunch_hit", "gguard", "gcover", "gsub", "gchoke", "gup", "gsweep"];
const STEP_MS = 380;
const HOLD_MS = 420;
// Centre-to-centre gap at each distance (far, mid, close, clinch), as a share of the arena width.
const GAP = [0.5, 0.36, 0.25, 0.14];

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

export function createArena(data) {
  const canvas = document.createElement("canvas");
  canvas.id = "arena";
  const ctx = canvas.getContext("2d");
  const art = {}; // id -> { poses: {pose: {img, anchorX}}, h }
  let manifest = null;
  let state = null;
  let gap = GAP[1];
  const fx = { a: { pose: null, until: 0, ox: 0 }, b: { pose: null, until: 0, ox: 0 } };
  let floats = [];
  let queue = [];
  let nextAt = 0;
  let logRef = null;
  let seen = 0;
  let raf = 0;

  async function load(ids) {
    if (manifest === null) {
      try {
        const res = await fetch("assets/private/manifest.json");
        manifest = res.ok ? await res.json() : {};
      } catch {
        manifest = {};
      }
    }
    for (const id of ids) {
      if (art[id]) continue;
      art[id] = { poses: {}, h: 200 };
      const meta = manifest.fighters?.[id];
      if (!meta) continue;
      for (const pose of POSES) {
        const img = await loadImage(`assets/private/${id}/${pose}.png`);
        if (img) art[id].poses[pose] = { img, anchorX: meta[pose]?.anchorX ?? img.width / 2 };
      }
      art[id].h = meta.idle?.h ?? 200;
    }
    draw();
  }

  function poseFor(card, effectTypes) {
    if (effectTypes.includes("takedown") || effectTypes.includes("pull")) return "shoot";
    const hit = card.effects.find((e) => e.t === "hit");
    if (hit) return hit.at === "legs" ? "kick" : "punch";
    return null;
  }

  function addFloat(side, text, color) {
    floats.push({ side, text, color, t0: performance.now() });
    kick();
  }

  function play(e) {
    const now = performance.now();
    const S = state;
    const ground = S.pos === "ground";
    if (e.t === "play") {
      const card = S.data.cards[e.id];
      const pose = ground ? (card.effects.some((x) => x.t === "hit") ? "gpunch" : card.effects.some((x) => x.t === "lock") ? "gsub" : null) : poseFor(card, card.effects.map((x) => x.t));
      if (pose) Object.assign(fx[e.side], { pose, until: now + HOLD_MS, ox: ground ? 0 : 16 });
    } else if (e.t === "dmg") {
      if (e.amt > 0) {
        Object.assign(fx[e.to], { pose: ground ? "gpunch_hit" : "hit", until: now + HOLD_MS, ox: -8 });
        addFloat(e.to, `−${e.amt}`, "#ff6b5e");
      } else if (e.abs) addFloat(e.to, `擋 ${e.abs}`, "#6db3ff");
    } else if (e.t === "slipped") addFloat(e.side, "閃開", "#9cf0c0");
    else if (e.t === "sprawled") addFloat(e.side, "防摔", "#9cf0c0");
    else if (e.t === "countered") addFloat(e.side, "反擊", "#ffd24a");
    else if (e.t === "stun") addFloat(e.side, "暈眩", "#ffb547");
    else if (e.t === "lock") addFloat(e.side, "鎖技", "#d9b3ff");
    else if (e.t === "ground") addFloat(e.top, "壓制", "#ffd9a1");
    else if (e.t === "standup") addFloat("a", "站起", "#ffffff");
    kick();
  }

  /** Call after every render: picks up new log events and plays them one after another. */
  function sync(S) {
    state = S;
    if (S.log !== logRef) {
      logRef = S.log;
      seen = 0;
      queue = [];
    }
    while (seen < S.log.length) queue.push(S.log[seen++]);
    kick();
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!state) return;
    if (queue.length && now >= nextAt) {
      const e = queue.shift();
      play(e);
      nextAt = now + (e.t === "play" || e.t === "dmg" ? STEP_MS : 40);
    }
    // Ease the gap and the lunge offsets; drop expired poses and floats.
    const target = GAP[state.dist] ?? GAP[1];
    gap += (target - gap) * 0.22;
    let busy = Math.abs(target - gap) > 0.002 || queue.length > 0;
    for (const side of ["a", "b"]) {
      const f = fx[side];
      if (f.pose && now >= f.until) f.pose = null;
      f.ox *= 0.86;
      if (f.pose || Math.abs(f.ox) > 0.5) busy = true;
    }
    floats = floats.filter((f) => now - f.t0 < 900);
    if (floats.length) busy = true;
    draw(now);
    if (busy) raf = requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { W: r.width, H: r.height, dpr };
  }

  function drawCage(W, H) {
    const floorY = H * 0.55;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b0d12");
    g.addColorStop(1, "#171b25");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Mat.
    const m = ctx.createLinearGradient(0, floorY, 0, H);
    m.addColorStop(0, "#2a3042");
    m.addColorStop(1, "#1c2130");
    ctx.fillStyle = m;
    ctx.fillRect(0, floorY, W, H - floorY);
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W * 0.04, H);
    ctx.lineTo(W * 0.2, floorY);
    ctx.moveTo(W * 0.96, H);
    ctx.lineTo(W * 0.8, floorY);
    ctx.stroke();
    // Fence: three panels of the octagon, the side ones leaning in.
    const top = H * 0.1;
    const panels = [
      [0, 0.2, 0.0, 0.05],
      [0.2, 0.8, 0.05, 0.05],
      [0.8, 1, 0.05, 0.0],
    ];
    ctx.save();
    for (const [x0, x1] of panels) {
      ctx.beginPath();
      ctx.rect(W * x0, top, W * (x1 - x0), floorY - top);
      ctx.clip();
      ctx.fillStyle = "rgba(120,140,170,.10)";
      ctx.fillRect(W * x0, top, W * (x1 - x0), floorY - top);
      ctx.strokeStyle = "rgba(170,190,220,.22)";
      ctx.lineWidth = 1;
      const step = 11;
      const slant = x0 === 0 ? 0.5 : x0 === 0.8 ? -0.5 : 1;
      ctx.beginPath();
      for (let x = W * x0 - (floorY - top); x < W * x1 + (floorY - top); x += step) {
        ctx.moveTo(x, top);
        ctx.lineTo(x + (floorY - top) * slant, floorY);
        ctx.moveTo(x + (floorY - top) * slant, top);
        ctx.lineTo(x, floorY);
      }
      ctx.stroke();
      ctx.restore();
      ctx.save();
    }
    ctx.restore();
    // Rails and posts.
    ctx.fillStyle = "#aab4c8";
    ctx.fillRect(0, top - 2, W, 4);
    ctx.fillStyle = "#6f7a92";
    ctx.fillRect(0, floorY - 2, W, 3);
    for (const x of [0, 0.2, 0.8, 1]) {
      ctx.fillStyle = "#8d98b0";
      ctx.fillRect(W * x - (x === 1 ? 5 : x === 0 ? 0 : 2.5), top - 4, 5, floorY - top + 6);
    }
  }

  function sprite(id, pose) {
    const a = art[id];
    return a?.poses[pose] || a?.poses.idle || null;
  }

  function drawFighter(side, x, footY, dir, pose, scale, id, lying) {
    const sp = sprite(id, pose);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.beginPath();
    ctx.ellipse(x, footY + 1, lying ? 46 * scale * 2 : 28 * scale * 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(Math.round(x), Math.round(footY));
    if (dir < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    if (sp) ctx.drawImage(sp.img, Math.round(-sp.anchorX * scale), Math.round(-sp.img.height * scale), Math.round(sp.img.width * scale), Math.round(sp.img.height * scale));
    else {
      ctx.fillStyle = side === "a" ? "#3d6fb0" : "#b04a43";
      ctx.fillRect(-12 * scale * 2, -80 * scale * 2, 24 * scale * 2, 80 * scale * 2);
    }
    ctx.restore();
  }

  function draw(now = performance.now()) {
    if (!state) return;
    const { W, H, dpr } = resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCage(W, H);
    const S = state;
    const footY = H * 0.93;
    const idH = Math.max(art[S.a.id]?.h ?? 200, art[S.b.id]?.h ?? 200);
    const scale = (H * 0.8) / idH;
    const cx = W / 2;
    const ground = S.pos === "ground";
    const lose = S.over?.winner;
    const idleBob = (side) => Math.round(Math.sin(now / 420 + (side === "a" ? 0 : 1)) * 1);
    for (const side of ["a", "b"]) {
      const dir = side === "a" ? 1 : -1;
      const f = fx[side];
      let pose = f.pose;
      let x;
      let y = footY;
      let lying = false;
      if (ground) {
        const top = S.top === side;
        pose = pose || (top ? "gkneel" : "gguard");
        if (!top && !f.pose) lying = true;
        x = cx + dir * (top ? 6 : -6) * scale + (top ? 0 : -dir * 18 * scale);
      } else {
        pose = pose || "idle";
        x = cx + dir * (-gap * W) / 2 + dir * f.ox;
        y += idleBob(side);
      }
      if (S.over && S.over.winner && S.over.winner !== side && S.over.how === "KO") {
        pose = "down";
        lying = true;
      }
      drawFighter(side, x, y, dir, pose, scale, S[side].id, lying);
    }
    // Floating numbers.
    ctx.font = "700 14px system-ui, 'PingFang TC', sans-serif";
    ctx.textAlign = "center";
    for (const f of floats) {
      const p = (now - f.t0) / 900;
      const side = f.side;
      const x = ground ? cx + (side === "a" ? -1 : 1) * 30 : cx + (side === "a" ? -1 : 1) * (gap * W) / 2;
      ctx.globalAlpha = 1 - p * p;
      ctx.fillStyle = "#000";
      ctx.fillText(f.text, x + 1, H * 0.3 - p * 22 + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, H * 0.3 - p * 22);
      ctx.globalAlpha = 1;
    }
  }

  return { canvas, load, sync, draw: () => draw() };
}
