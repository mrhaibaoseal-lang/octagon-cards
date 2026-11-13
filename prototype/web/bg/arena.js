// The arena backdrop of every screen: dark hall, crowd, light truss, the cage and the canvas. Painted once into a picture (844x390 at 2x) that
// becomes the frame's background. Same drawing as sketch-fight-b.html. The fighters' own contact shadows are drawn by the page, not here.
export function paintArena() {
  const cv = document.createElement("canvas");
  cv.width = 1688; cv.height = 780;
  const g = cv.getContext("2d");
  g.scale(2, 2);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const P = [[250, 226], [594, 226], [714, 262], [784, 330], [644, 420], [200, 420], [60, 330], [130, 262]];
  const path = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };

  // darkness + far crowd
  let gr = g.createLinearGradient(0, 0, 0, 390);
  gr.addColorStop(0, "#04050a"); gr.addColorStop(.5, "#0d111c"); gr.addColorStop(1, "#06070a");
  g.fillStyle = gr; g.fillRect(0, 0, 844, 390);
  const tints = ["#ffd9a0", "#9ec5ff", "#ffffff", "#ff9d8a"];
  for (let i = 0; i < 520; i++) {
    const y = 26 + rnd() * 200;
    g.globalAlpha = .12 + rnd() * .55;
    g.fillStyle = tints[(rnd() * 4) | 0];
    g.beginPath(); g.arc(rnd() * 844, y, .5 + rnd() * 1.5, 0, 7); g.fill();
  }
  g.shadowColor = "#ffcf6b"; g.shadowBlur = 6;
  for (let x = 176; x < 668; x += 9) { g.globalAlpha = .35 + rnd() * .5; g.fillStyle = rnd() > .3 ? "#ffd98a" : "#ffffff"; g.fillRect(x, 70, 6, 1.6); }
  g.shadowBlur = 0;
  const shirts = ["#c9d3e6", "#7d2a2a", "#274b85", "#c9a24a", "#3a3f4d", "#e8e2d2"];
  for (let row = 0; row < 10; row++) {
    const k = row / 9, r = 3.2 + k * 3, step = 8 + k * 5, base = 80 + row * 15.5;
    for (let x = -6 + (row % 2) * step / 2; x < 850; x += step) {
      const y = base + rnd() * 3, xx = x + rnd() * 3, v = 18 + k * 26 + rnd() * 10;
      g.globalAlpha = 1; g.fillStyle = rnd() < .28 ? shirts[(rnd() * 6) | 0] : `rgb(${v},${v + 5},${v + 16})`;
      g.globalAlpha = .35 + k * .4; g.fillRect(xx - r * 1.25, y + r * .7, r * 2.5, r * 2.6);
      g.globalAlpha = 1; g.fillStyle = `rgb(${v + 26},${v + 22},${v + 22})`; g.beginPath(); g.arc(xx, y, r, 0, 7); g.fill();
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.arc(xx, y - r * .25, r, Math.PI, 0); g.fill();
    }
  }
  gr = g.createLinearGradient(0, 60, 0, 230); gr.addColorStop(0, "rgba(90,125,200,.16)"); gr.addColorStop(1, "rgba(90,125,200,0)");
  g.fillStyle = gr; g.fillRect(0, 60, 844, 170);
  g.shadowColor = "#fff"; g.shadowBlur = 8;
  for (let i = 0; i < 14; i++) { g.globalAlpha = .35 + rnd() * .5; g.fillStyle = "#fff"; g.beginPath(); g.arc(180 + rnd() * 484, 84 + rnd() * 130, 1.2, 0, 7); g.fill(); }
  g.shadowBlur = 0; g.globalAlpha = 1;

  // lighting truss and beams
  g.fillStyle = "#151821"; g.fillRect(190, 46, 464, 5);
  for (let x = 196; x < 654; x += 14) { g.strokeStyle = "#232734"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 46); g.lineTo(x + 7, 51); g.lineTo(x + 14, 46); g.stroke(); }
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const x = 222 + i * 66.6, tx = 422 + (x - 422) * .55;
    gr = g.createLinearGradient(x, 50, tx, 330);
    gr.addColorStop(0, "rgba(255,240,205,.20)"); gr.addColorStop(1, "rgba(255,240,205,0)");
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - 3, 50); g.lineTo(x + 3, 50); g.lineTo(tx + 62, 340); g.lineTo(tx - 62, 340); g.fill();
    g.shadowColor = "#fff2cc"; g.shadowBlur = 12; g.fillStyle = "#fffbe8"; g.beginPath(); g.arc(x, 52, 2.6, 0, 7); g.fill(); g.shadowBlur = 0;
  }
  g.globalCompositeOperation = "source-over";

  // apron under the canvas
  path([[P[3][0], P[3][1]], P[4], P[5], [P[6][0], P[6][1]], [P[6][0], P[6][1] + 14], [P[5][0], P[5][1] + 16], [P[4][0], P[4][1] + 16], [P[3][0], P[3][1] + 14]]);
  g.fillStyle = "#0c0d11"; g.fill();

  // canvas floor
  path(P);
  gr = g.createRadialGradient(422, 320, 20, 422, 320, 380);
  gr.addColorStop(0, "#d9d5c9"); gr.addColorStop(.55, "#a9a69c"); gr.addColorStop(1, "#5d5b56");
  g.fillStyle = gr; g.fill();
  g.save(); path(P); g.clip();
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = .05 + rnd() * .07; g.strokeStyle = rnd() > .5 ? "#3a332a" : "#ffffff"; g.lineWidth = .6 + rnd();
    const x = 150 + rnd() * 540, y = 230 + rnd() * 160, a = rnd() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 7); g.stroke();
  }
  g.globalAlpha = 1;
  g.save(); g.translate(422, 318); g.scale(1, .34);
  const oct = (r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); };
  oct(172); g.strokeStyle = "rgba(20,20,24,.34)"; g.lineWidth = 9; g.stroke();
  oct(146); g.strokeStyle = "rgba(20,20,24,.18)"; g.lineWidth = 2; g.stroke();
  g.fillStyle = "rgba(20,20,24,.30)"; g.font = "italic 700 92px Bahnschrift, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("OCTAGON", 0, 4);
  g.restore();
  path(P); g.strokeStyle = "rgba(12,12,14,.85)"; g.lineWidth = 9; g.stroke();
  g.lineWidth = 7; g.strokeStyle = "rgba(47,134,224,.75)"; g.beginPath(); g.moveTo(...P[5]); g.lineTo(...P[6]); g.lineTo(...P[7]); g.stroke();
  g.strokeStyle = "rgba(224,69,63,.75)"; g.beginPath(); g.moveTo(...P[4]); g.lineTo(...P[3]); g.lineTo(...P[2]); g.stroke();
  g.restore();
  path(P); g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = 1; g.stroke();

  // cage: back and side panels with chain-link mesh
  const H = [150, 150, 165, 190, 0, 0, 190, 165];
  const up = (i) => [P[i][0], P[i][1] - H[i]];
  for (const [a, b] of [[6, 7], [7, 0], [0, 1], [1, 2], [2, 3]]) {
    g.save(); path([P[a], P[b], up(b), up(a)]); g.fillStyle = "rgba(8,10,14,.14)"; g.fill(); g.clip();
    g.strokeStyle = "rgba(205,212,225,.20)"; g.lineWidth = .7;
    for (let x = -200; x < 1050; x += 7) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x + 190, 340); g.moveTo(x, 40); g.lineTo(x - 190, 340); g.stroke(); }
    g.restore();
    g.lineCap = "round";
    g.strokeStyle = "#07080b"; g.lineWidth = 7; g.beginPath(); g.moveTo(...up(a)); g.lineTo(...up(b)); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = 1; g.beginPath(); g.moveTo(up(a)[0], up(a)[1] - 3); g.lineTo(up(b)[0], up(b)[1] - 3); g.stroke();
    g.strokeStyle = "#07080b"; g.lineWidth = 5; g.beginPath(); g.moveTo(...P[a]); g.lineTo(...P[b]); g.stroke();
  }
  [6, 7, 0, 1, 2, 3].forEach((i) => {
    const [x, y] = P[i], h = H[i], c = i === 0 ? ["#1a5fae", "#58a6f2"] : i === 1 ? ["#9c2420", "#f2706a"] : ["#0a0b0f", "#3a3e49"];
    gr = g.createLinearGradient(x - 5, 0, x + 5, 0); gr.addColorStop(0, c[0]); gr.addColorStop(.45, c[1]); gr.addColorStop(1, c[0]);
    g.fillStyle = gr; g.fillRect(x - 5, y - h - 5, 10, h + 5);
    g.fillStyle = "rgba(0,0,0,.35)"; for (let yy = y - h + 18; yy < y; yy += 26) g.fillRect(x - 5, yy, 10, 1.5);
  });

  // pool of light, vignette
  g.globalCompositeOperation = "lighter";
  gr = g.createRadialGradient(422, 250, 10, 422, 250, 260); gr.addColorStop(0, "rgba(255,238,205,.16)"); gr.addColorStop(1, "rgba(255,238,205,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 844, 390);
  g.globalCompositeOperation = "source-over";
  gr = g.createRadialGradient(422, 215, 190, 422, 215, 520); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.85)");
  g.fillStyle = gr; g.fillRect(0, 0, 844, 390);
  return new Promise((res) => cv.toBlob((b) => res(b ? URL.createObjectURL(b) : null), "image/png"));
}
