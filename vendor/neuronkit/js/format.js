// NeuronKit — saying numbers the same way everywhere.
//
//   import { bytes, duration, ago, percent, unit } from "neuronkit/js/format.js";
//   bytes(212e9)             → "197 GB"
//   duration(192000)         → "3 min 12 s"
//   ago(Date.now() - 18e4)   → "3 min ago"
//   percent(0.412)           → "41%"
//   unit(318, "W")           → "318 W"
//   unit(null, "W")          → "—"          (unknown is never zero)
//
// The rules behind it (rules.html): say the specific fact, unknown is never
// zero, time only moves forward. Every function answers "—" for a value it
// wasn't given (null, undefined, NaN) and a real 0 for a real zero. Figures
// come out ready for tabular mono; units are separated by a space, except %
// and ° which sit on the number.

export const UNKNOWN = "—";
const known = (v) => typeof v === "number" ? Number.isFinite(v) : v != null && v !== "" && Number.isFinite(Number(v));
const N = (v) => Number(v);
const groups = new Map();
const grouped = (v, digits) => {
  const key = digits;
  if (!groups.has(key)) groups.set(key, new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return groups.get(key).format(v);
};
// Fewer decimals as a number grows: 3.42 · 34.2 · 342
const auto = (v) => { const a = Math.abs(v); return a === 0 || a >= 100 ? 0 : a >= 10 ? 1 : 2; };
const trim = (s) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** A plain number: 1,204 · 3.14. digits = decimals (default: fewer as it grows). */
export function num(v, { digits } = {}) {
  if (!known(v)) return UNKNOWN;
  v = N(v);
  return digits == null ? trim(grouped(v, auto(v))) : grouped(v, digits);
}

/** A number and its unit: unit(318, "W") → "318 W"; %, ° and °C attach to the number. */
export function unit(v, u = "", opts) {
  if (!known(v)) return UNKNOWN;
  const s = num(v, opts);
  if (!u) return s;
  return /^(%|°)/.test(u) ? `${s}${u}` : `${s} ${u}`;
}

/** A fraction of 1 as a percentage: percent(0.412) → "41%". of: the whole, when v isn't a fraction. */
export function percent(v, { of, digits = 0 } = {}) {
  if (!known(v) || (of != null && !known(of))) return UNKNOWN;
  const f = of != null ? (N(of) === 0 ? NaN : N(v) / N(of)) : N(v);
  if (!Number.isFinite(f)) return UNKNOWN;
  return `${grouped(f * 100, digits)}%`;
}

const BIN = ["B", "KB", "MB", "GB", "TB", "PB"];
/** Bytes, in powers of 1024 (si: powers of 1000): bytes(212e9) → "197 GB". */
export function bytes(v, { si = false, digits } = {}) {
  if (!known(v)) return UNKNOWN;
  v = N(v);
  const k = si ? 1000 : 1024;
  let i = 0;
  while (Math.abs(v) >= k && i < BIN.length - 1) { v /= k; i++; }
  return `${digits == null ? num(v) : num(v, { digits })} ${BIN[i]}`;
}

/** A rate: rate(1.3e7, "B") → "12.4 MB/s"; rate(68, "tok") → "68 tok/s". per defaults to "s". */
export function rate(v, what = "", { per = "s", ...opts } = {}) {
  if (!known(v)) return UNKNOWN;
  return `${what === "B" ? bytes(v, opts) : unit(v, what, opts)}/${per}`;
}

/** Temperature in °C: temp(92) → "92°C". */
export const temp = (v, opts) => unit(v, "°C", { digits: 0, ...opts });

const SPANS = [["d", 86400000], ["h", 3600000], ["min", 60000], ["s", 1000]];
/** A length of time in ms, two largest units: duration(192000) → "3 min 12 s"; under a second → "820 ms". */
export function duration(ms, { parts = 2 } = {}) {
  if (!known(ms)) return UNKNOWN;
  ms = Math.max(0, N(ms));
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const out = [];
  let left = ms;
  for (const [name, size] of SPANS) {
    const n = Math.floor(left / size);
    if (n || out.length) { if (n) out.push(`${n} ${name}`); left -= n * size; }
    if (out.length >= parts) break;
  }
  return out.join(" ") || "0 s";
}

const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === "string" ? Date.parse(t) : t);
/** How long ago: "just now" · "3 min ago" · "2 h ago" · "yesterday" · "4 days ago", then the date.
 *  Time only moves forward: a time in the future reads "just now", never "in 3 min". */
export function ago(t, now = Date.now()) {
  const ms = toMs(t);
  if (!known(ms)) return UNKNOWN;
  const d = Math.max(0, toMs(now) - ms);
  if (d < 45000) return "just now";
  if (d < 3600000) return `${Math.round(d / 60000)} min ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)} h ago`;
  if (d < 172800000) return "yesterday";
  if (d < 604800000) return `${Math.floor(d / 86400000)} days ago`;
  return date(ms);
}

const pad = (n) => String(n).padStart(2, "0");
/** A wall-clock time, 24-hour: clock(t) → "14:02" (seconds: "14:02:09"). utc for server logs. */
export function clock(t, { seconds = false, utc = false } = {}) {
  const ms = toMs(t);
  if (!known(ms)) return UNKNOWN;
  const d = new Date(ms);
  const [h, m, s] = utc ? [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()] : [d.getHours(), d.getMinutes(), d.getSeconds()];
  return `${pad(h)}:${pad(m)}${seconds ? `:${pad(s)}` : ""}`;
}

/** A calendar date, ISO order so it's never ambiguous: date(t) → "2026-09-28". */
export function date(t, { utc = false } = {}) {
  const ms = toMs(t);
  if (!known(ms)) return UNKNOWN;
  const d = new Date(ms);
  return utc ? d.toISOString().slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A count with its noun: plural(1, "container") → "1 container"; plural(14, "container") → "14 containers". */
export function plural(n, word, many = `${word}s`) {
  if (!known(n)) return `${UNKNOWN} ${many}`;
  return `${num(n)} ${N(n) === 1 ? word : many}`;
}

/** Part of a whole: fraction(12, 14) → "12/14"; an unknown side stays unknown: "—/14". */
export function fraction(a, b) {
  return `${known(a) ? num(a) : UNKNOWN}/${known(b) ? num(b) : UNKNOWN}`;
}
