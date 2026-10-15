// NeuronKit — social posts: the instrument end card.
//
//   import { drawInstrument } from "neuronkit/js/social.js";
//   drawInstrument(document.querySelector(".nk-post-instrument"), {
//     logo: "logo.svg", fill: 0.74, number: "N°01 · AI TIPS",
//     brand: "SHINYSTUDIO · LAB", signature: "SHINYLAB — BY SHINY-STUDIO",
//   });
//
// Draws into an <svg class="nk-post-instrument"> on a 1080 × 1350 post: an
// engraved 0–100 scale over a 270° sweep, a ring of lamps lit to `fill`, the
// value arc and its indicator, a recessed well and a raised, knurled cap
// carrying the logo — plus the drawing sheet around it (frame, corner
// brackets, registration marks, crosshairs, annotations). Colours come from
// the page's tokens (--accent, and the --inst-* set in css/social.css), so the
// accent follows data-accent and the card follows data-theme.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  // var() goes through style: presentation attributes don't resolve it everywhere
  const vars = [];
  for (const k in attrs) String(attrs[k]).startsWith("var(") ? vars.push(k) : e.setAttribute(k, attrs[k]);
  for (const k of vars) e.style.setProperty(k, attrs[k]);   // after any style attribute
  parent?.append(e);
  return e;
};

let uid = 0;

export function drawInstrument(svg, {
  logo = "", fill = 0.74, cx = 540, cy = 522,
  brand = "", number = "", signature = "", revision = "", spec = "Ø 770 · 45 CH · 270°",
  width = 1080, height = 1350,
} = {}) {
  const id = `nki${++uid}`;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-hidden", "true");
  svg.replaceChildren();
  const A0 = -135, A1 = 135;
  const pol = (r, deg) => { const t = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
  const arc = (r, a, b) => { const [x0, y0] = pol(r, a), [x1, y1] = pol(r, b); return `M${x0} ${y0}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1} ${y1}`; };

  // ---- paint servers
  const defs = el("defs", {}, svg);
  const grad = (kind, gid, attrs, stops) => {
    const g = el(kind, { id: `${id}-${gid}`, ...attrs }, defs);
    for (const [o, c, op = 1] of stops) el("stop", { offset: o, "stop-color": c, "stop-opacity": op }, g);
  };
  grad("radialGradient", "well", { cx: "50%", cy: "62%", r: "60%" }, [[0, "var(--inst-well-0)"], [0.78, "var(--inst-well-1)"], [0.94, "var(--inst-well-2)"], [1, "var(--inst-well-3)"]]);
  grad("linearGradient", "rim", { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, "var(--inst-rim-0)"], [0.55, "var(--inst-rim-1)"], [1, "var(--inst-rim-2)"]]);
  grad("linearGradient", "cap", { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, "var(--inst-cap-0)"], [0.5, "var(--inst-cap-1)"], [1, "var(--inst-cap-2)"]]);
  grad("linearGradient", "caprim", { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, "var(--inst-caprim-0)"], [0.5, "var(--inst-caprim-1)"], [1, "var(--inst-caprim-2)"]]);
  grad("radialGradient", "spec", { cx: "50%", cy: "0%", r: "70%" }, [[0, "var(--inst-spec)", 0.1], [1, "var(--inst-spec)", 0]]);
  grad("radialGradient", "halo", { cx: "50%", cy: "50%", r: "50%" }, [[0, "var(--accent)", 0.22], [0.6, "var(--accent)", 0.05], [1, "var(--accent)", 0]]);
  // a luminance mask: white means visible, whatever the theme
  grad("radialGradient", "fade", { cx: "50%", cy: "38%", r: "65%" }, [[0, "#fff"], [1, "#fff", 0]]);
  const blur = (fid, sd) => { const f = el("filter", { id: `${id}-${fid}`, x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs); el("feGaussianBlur", { stdDeviation: sd }, f); };
  blur("glow", 7); blur("soft", 22);
  const sh = el("filter", { id: `${id}-shadow`, x: "-30%", y: "-30%", width: "160%", height: "170%" }, defs);
  el("feDropShadow", { dx: 0, dy: 22, stdDeviation: 26, "flood-color": "var(--inst-shadow)", "flood-opacity": 0.875 }, sh);
  const pat = el("pattern", { id: `${id}-grid`, width: 40, height: 40, patternUnits: "userSpaceOnUse" }, defs);
  el("path", { d: "M40 0H0V40", fill: "none", stroke: "var(--inst-ink)", "stroke-opacity": 0.035 }, pat);
  const mask = el("mask", { id: `${id}-mask` }, defs);
  el("rect", { width, height, fill: `url(#${id}-fade)` }, mask);
  const u = (n) => `url(#${id}-${n})`;

  // ---- ground
  el("rect", { width, height, fill: "var(--inst-ground)" }, svg);
  el("rect", { width, height, fill: u("grid"), mask: u("mask") }, svg);
  const dial = el("g", {}, svg), sheet = el("g", {}, svg);

  // ---- the instrument
  el("circle", { cx, cy, r: 450, fill: u("halo") }, dial);
  for (let i = 0; i <= 100; i++) {
    const a = A0 + ((A1 - A0) * i) / 100, major = i % 10 === 0, mid = i % 5 === 0, lit = i / 100 <= fill;
    const [x0, y0] = pol(major ? 396 : mid ? 402 : 406, a), [x1, y1] = pol(416, a);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: lit ? "var(--accent)" : "var(--inst-ink)", "stroke-opacity": lit ? (major ? 0.9 : 0.45) : (major ? 0.38 : 0.16), "stroke-width": major ? 2.4 : 1.2 }, dial);
    if (major) {
      const [tx, ty] = pol(441, a);
      el("text", { x: tx, y: ty + 7, "text-anchor": "middle", fill: "var(--inst-ink)", "fill-opacity": 0.42, style: "font: 500 19px var(--font-mono); letter-spacing: .08em" }, dial).textContent = String(i).padStart(2, "0");
    }
  }
  el("path", { d: arc(422, A0, A1), fill: "none", stroke: "var(--inst-ink)", "stroke-opacity": 0.08 }, dial);
  el("circle", { cx, cy, r: 385, fill: u("rim") }, dial);
  el("circle", { cx, cy, r: 383, fill: u("well") }, dial);
  const N = 45, glow = el("g", { filter: u("glow"), opacity: 0.9 }, dial), lamps = el("g", {}, dial);
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1), a = A0 + (A1 - A0) * f, on = f <= fill, [x, y] = pol(358, a);
    const r = { x: x - 6, y: y - 11, width: 12, height: 22, rx: 3, transform: `rotate(${a} ${x} ${y})` };
    if (on) el("rect", { ...r, fill: "var(--accent)" }, glow);
    el("rect", { ...r, fill: on ? "var(--accent)" : "var(--inst-lamp-off)", stroke: "var(--inst-lamp-edge)", "stroke-opacity": 0.55 }, lamps);
  }
  const aLit = A0 + (A1 - A0) * fill;
  el("path", { d: arc(331, A0, aLit), fill: "none", stroke: "var(--accent)", "stroke-width": 10, "stroke-linecap": "round", opacity: 0.5, filter: u("soft") }, dial);
  el("path", { d: arc(331, A0, aLit), fill: "none", stroke: "var(--accent)", "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0.95 }, dial);
  const [ix, iy] = pol(331, aLit);
  el("circle", { cx: ix, cy: iy, r: 18, fill: "var(--accent)", opacity: 0.5, filter: u("glow") }, dial);
  el("circle", { cx: ix, cy: iy, r: 6.5, fill: "var(--inst-dot)" }, dial);
  el("circle", { cx, cy: cy + 6, r: 281, fill: "var(--inst-shadow)", filter: u("shadow") }, dial);
  el("circle", { cx, cy, r: 281, fill: u("caprim") }, dial);
  el("circle", { cx, cy, r: 278, fill: u("cap") }, dial);
  el("ellipse", { cx, cy: cy - 145, rx: 222, ry: 125, fill: u("spec") }, dial);
  el("path", { d: arc(275, 118, 242), fill: "none", stroke: "var(--accent)", "stroke-opacity": 0.28, "stroke-width": 2 }, dial);
  for (let i = 0; i < 180; i++) { const a = i * 2, [x0, y0] = pol(268, a), [x1, y1] = pol(274, a); el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "var(--inst-ink)", "stroke-opacity": i % 2 ? 0.05 : 0.11 }, dial); }
  if (logo) el("image", { href: logo, x: cx - 124, y: cy - 140, width: 248, height: 272 }, dial);

  // ---- the drawing sheet
  const M = 44, ink = { stroke: "var(--inst-ink)", "stroke-opacity": 0.16, "stroke-width": 1, fill: "none" };
  el("rect", { x: M, y: M, width: width - 2 * M, height: height - 2 * M, ...ink, "stroke-opacity": 0.07 }, sheet);
  for (const [x, y, sx, sy] of [[M, M, 1, 1], [width - M, M, -1, 1], [M, height - M, 1, -1], [width - M, height - M, -1, -1]])
    el("path", { d: `M${x} ${y + 34 * sy}V${y}H${x + 34 * sx}`, ...ink, "stroke-opacity": 0.5, "stroke-width": 1.6 }, sheet);
  const reg = (x, y) => { el("circle", { cx: x, cy: y, r: 9, ...ink, "stroke-opacity": 0.35 }, sheet); el("path", { d: `M${x - 15} ${y}H${x + 15}M${x} ${y - 15}V${y + 15}`, ...ink, "stroke-opacity": 0.35 }, sheet); };
  reg(M + 22, cy); reg(width - M - 22, cy);
  el("path", { d: `M${M + 44} ${cy}H${cx - 460}M${cx + 460} ${cy}H${width - M - 44}M${cx} ${M + 30}V${cy - 460}`, ...ink, "stroke-dasharray": "3 6", "stroke-opacity": 0.22 }, sheet);
  const note = (x, y, text, anchor, op) => { if (text) el("text", { x, y, "text-anchor": anchor, fill: "var(--inst-ink)", "fill-opacity": op, style: "font: 500 17px var(--font-mono); letter-spacing: .22em" }, sheet).textContent = text; };
  note(M + 24, M + 40, brand, "start", 0.75);
  note(width - M - 24, M + 40, number, "end", 0.5);
  note(M + 24, height - M - 24, signature, "start", 0.6);
  note(width - M - 24, height - M - 24, revision, "end", 0.35);
  note(cx, cy + 392, spec, "middle", 0.3);
  return svg;
}
