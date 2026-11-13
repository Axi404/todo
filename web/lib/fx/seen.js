// What plays when an agent card is recorded as checked (a double-click on a gesture card, or its 看过了 button):
// theme.seenFx. Each plays inside the card, in a layer of its own on top of it, so it travels with the card as the card
// floats to the back, and it is over before the card lands:
//   ripple  a ripple runs across the whole card from where it was clicked: a crisp ring with a faint swell behind it,
//           and a fainter second ring after it (clipped to the card)
//   read    a dark disc pops up where it was clicked and a double check draws itself in it, read as in messages; then
//           it rises and fades
//   seal    a small red seal with 阅 on it is pressed on where it was clicked, the way a paper is marked as read
//   scan    a line runs down the card, and the "last checked" line is rewritten as it passes: the old time, and the
//           overdue flag, are wiped away, and "just now" is underneath
// Plus none and random, as for the completion effects; the older eye and glow now mean read and scan. Nothing plays with
// prefers-reduced-motion.
import { palette, pick, clamp } from "./kit.js";
import { reducedMotion } from "../motion.js";

const EFFECTS = { ripple, read, seal, scan };
const NAMES = [["ripple", "涟漪"], ["read", "已读"], ["seal", "批阅"], ["scan", "扫描"]];
const OLD = { eye: "read", glow: "scan" };

/** The options in the settings: [id, name], with "none" first and "random" last */
export const seenFxOptions = () => [["none", "不要"], ...NAMES, ["random", "随机"]];

export function seenFxOf(theme) {
  const v = OLD[theme?.seenFx] ?? theme?.seenFx;
  return v === "none" || v === "random" || v in EFFECTS ? v : "ripple";
}

/** Plays it on el (an agent card, or the row of options in the settings) for a click at (x, y) in viewport coordinates */
export function playSeen(theme, el, x, y, setting = seenFxOf(theme)) {
  if (reducedMotion() || !el?.isConnected || setting === "none") return;
  const id = setting === "random" ? pick(Object.keys(EFFECTS)) : setting;
  try { EFFECTS[id](el, at(el, x, y)); } catch (err) { console.error("fx failed", err); }
}

// The click in the element's own coordinates (a tilted card is a little larger or smaller on screen than it is)
function at(el, x, y) {
  const r = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  return { x: clamp(((x - r.left) * w) / r.width, 0, w), y: clamp(((y - r.top) * h) / r.height, 0, h), w, h };
}

// A layer inside el, over all of it (clipped to its corners when clip is set); gone() removes it
function layer(el, clip) {
  const statik = getComputedStyle(el).position === "static";
  if (statik) el.style.position = "relative";
  const L = document.createElement("div");
  L.className = `seen-fx${clip ? " clip" : ""}`;
  el.append(L);
  return { el: L, gone: () => { L.remove(); if (statik) el.style.position = ""; } };
}
const settle = (anims, gone) => Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(gone);

function ripple(el, p) {
  const L = layer(el, true), { ink } = palette(), dpr = devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(p.w * dpr); cv.height = Math.ceil(p.h * dpr);
  L.el.append(cv);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  const R = Math.hypot(Math.max(p.x, p.w - p.x), Math.max(p.y, p.h - p.y)) + 6, T = 900, t0 = performance.now();
  const out = (t) => 1 - (1 - clamp(t, 0, 1)) ** 2; // gentler than ease-out cubic: it crosses the card at an even pace, not all at once
  const ring = (r, width, a) => { if (r <= 0 || a <= 0) return; ctx.strokeStyle = ink(a); ctx.lineWidth = width; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); };
  const frame = (now) => {
    const t = (now - t0) / T;
    ctx.clearRect(0, 0, p.w, p.h);
    if (t >= 1 || !cv.isConnected) return L.gone();
    // the swell: a soft band just inside the ring, the water rising before the crest
    const r = R * out(t), fade = (1 - t) ** 1.1;
    if (r > 2) {
      const g = ctx.createRadialGradient(p.x, p.y, Math.max(0, r - 34), p.x, p.y, r);
      g.addColorStop(0, ink(0)); g.addColorStop(0.75, ink(0.09 * fade)); g.addColorStop(1, ink(0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ring(r, 1.7, 0.5 * fade);
    const t2 = (t - 0.14) / 0.86; // the second ring, a little behind and fainter
    if (t2 > 0) ring(R * 0.86 * out(t2), 1, 0.26 * (1 - t2) ** 1.1);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function read(el, p) {
  const L = layer(el, false), d = document.createElement("div");
  d.className = "seen-read";
  Object.assign(d.style, { left: `${p.x}px`, top: `${p.y}px` });
  d.innerHTML = `<i></i><svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1.6 8.7l3 3 6.1-6.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
    <path d="M7.9 11.1l.6.6 6.1-6.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" /></svg>`;
  L.el.append(d);
  const [a, b] = d.querySelectorAll("path"), ring = d.querySelector("i");
  const pos = (s, dy = 0) => `translate(-50%, -50%) translateY(${dy}px) scale(${s})`;
  settle([
    d.animate([
      { transform: pos(0.35), opacity: 0, easing: "cubic-bezier(.2, .8, .3, 1.3)" },
      { transform: pos(1), opacity: 1, offset: 0.26 },
      { transform: pos(1), opacity: 1, offset: 0.68, easing: "cubic-bezier(.4, 0, .7, .4)" },
      { transform: pos(0.94, -12), opacity: 0 },
    ], { duration: 1000, fill: "both" }),
    ring.animate([{ transform: "scale(1)", opacity: 0.5 }, { transform: "scale(1.9)", opacity: 0 }], { duration: 480, delay: 120, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "both" }),
    a.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 170, delay: 120, easing: "cubic-bezier(.5, 0, .3, 1)", fill: "both" }),
    b.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 170, delay: 250, easing: "cubic-bezier(.5, 0, .3, 1)", fill: "both" }),
  ], L.gone);
}

let inks = 0;
function seal(el, p) {
  const L = layer(el, false), { red } = palette(), id = `seen-ink-${++inks}`, tilt = -6 - Math.random() * 6;
  const d = document.createElement("div");
  d.className = "seen-seal";
  Object.assign(d.style, { left: `${p.x}px`, top: `${p.y}px` });
  // white characters cut into red, the way a seal prints; the ink is a little uneven and the edge not quite straight
  d.innerHTML = `<svg viewBox="0 0 40 40" width="34" height="34">
    <defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${inks}" result="n" />
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 2.25" result="speck" />
      <feComposite in="SourceGraphic" in2="speck" operator="in" result="inked" />
      <feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="1" seed="${inks + 5}" result="warp" />
      <feDisplacementMap in="inked" in2="warp" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
    </filter></defs>
    <g filter="url(#${id})"><rect x="2" y="2" width="36" height="36" rx="5" fill="${red(0.94)}" />
    <text x="20" y="28.6" text-anchor="middle" font-size="25" font-weight="700" fill="#fff">阅</text></g></svg>`;
  L.el.append(d);
  const pos = (s, r) => `translate(-50%, -50%) rotate(${r}deg) scale(${s})`;
  settle([
    d.animate([
      { transform: pos(1.9, tilt - 10), opacity: 0, easing: "cubic-bezier(.55, 0, .9, .45)" },
      { transform: pos(0.93, tilt), opacity: 1, offset: 0.15, easing: "cubic-bezier(.2, .7, .4, 1)" },
      { transform: pos(1, tilt), opacity: 1, offset: 0.24 },
      { transform: pos(1, tilt), opacity: 0.92, offset: 0.68, easing: "ease-in" },
      { transform: pos(1, tilt), opacity: 0 },
    ], { duration: 1000, fill: "both" }),
  ], L.gone);
}

function scan(el, p) {
  const L = layer(el, true), when = el.querySelector(".when");
  const line = document.createElement("i");
  line.className = "seen-scan";
  // the "last checked" line as it is now, over the real one, which is about to change: wiped away from the top as the line passes
  let old = null, top = 0, h = 0;
  if (when && when.offsetParent === el) {
    old = when.cloneNode(true);
    old.className = "when seen-old";
    top = when.offsetTop; h = when.offsetHeight;
    Object.assign(old.style, { left: `${when.offsetLeft}px`, top: `${top}px`, width: `${when.offsetWidth}px`, height: `${h}px`, margin: "0" });
    L.el.append(old);
  }
  L.el.append(line);
  const T = 620, t0 = performance.now(), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / T), y = -8 + ease(t) * (p.h + 16);
    line.style.transform = `translateY(${y.toFixed(1)}px)`;
    line.style.opacity = String(Math.min(1, (1 - t) * 4));
    if (old) old.style.clipPath = `inset(${clamp(y - top, 0, h).toFixed(1)}px 0 0 0)`;
    if (t < 1 && line.isConnected) requestAnimationFrame(frame);
    else L.gone();
  };
  requestAnimationFrame(frame);
}
