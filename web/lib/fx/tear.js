// Tear: the agent card is opened like a card pack, at its done control. A tear runs along just above the slider from left to
// right (the way the knob went); the strip with the slider on it comes away, its left end first, and drops; in the opening
// is a card showing its back (hatched, a dashed frame and the agent gear); the pack slides up off it like a sleeve and
// fades, the card comes forward and turns over to its face (dark, a check, "done" and today's date), a sheen runs across it
// and a few glints come and go; then it fades, and only then does the agent card leave (ready), so that nothing moves in
// under it while it is still there.
// The pack and the strip are copies of the agent card cut along the tear (clip-path), each with a thin paper edge. The card
// inside is not cut: it sits behind them and within the pack, so the pack itself hides it until it moves away (a cut that
// stays put while the pack moves leaves a gap the shape of the tear). The pack's edge casts a little shade onto the card
import { layer, cloneOf, pageRect, hide, unhide, rand, clamp, wait, palette } from "./kit.js";
import { pad2 } from "../due.js";

export const meta = { id: "tear", name: "撕开" };

const SVG = "http://www.w3.org/2000/svg";
const px = (ps) => ps.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",");
const pts = (ps) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const STAR = "M0 -6 C.8 -1.4 1.4 -.8 6 0 C1.4 .8 .8 1.4 0 6 C-.8 1.4 -1.4 .8 -6 0 C-1.4 -.8 -.8 -1.4 0 -6Z";
const GEAR = `<path d="M6.37 3.27 6.57 1.25 9.43 1.25 9.63 3.27 11.28 4.23 13.13 3.38 14.56 5.87 12.91 7.05 12.91 8.95 14.56 10.13 13.13 12.62 11.28 11.77 9.63 12.73 9.43 14.75 6.57 14.75 6.37 12.73 4.72 11.77 2.87 12.62 1.44 10.13 3.09 8.95 3.09 7.05 1.44 5.87 2.87 3.38 4.72 4.23z" /><circle cx="8" cy="8" r="2" />`;

// The timeline (ms)
const LINE = 170; // the tear runs along
const STRIP = 520; // the strip comes away and drops
const SLEEVE = [340, 780]; // the pack slides up off the card and fades
const FORWARD = [560, 840]; // the card comes forward
const FLIP = [840, 1160]; // it turns over
const FADE = [1440, 1640]; // it fades
const READY = FADE[1];

/** Where to tear, in the card's own coordinates: just above its done control (the slider, the hold button, the row of buttons) */
function tearAt(target, origin, h) {
  const ctl = origin?.closest?.(".ag-done") ?? origin?.closest?.(".row") ?? target.querySelector?.(".ag-done, .row");
  const c = ctl && target.contains(ctl) ? ctl.getBoundingClientRect() : null;
  return clamp(c ? c.top - target.getBoundingClientRect().top - 7 : h - 52, h * 0.4, h - 16);
}

export function play(target, origin) {
  const L = layer(), r = pageRect(target), { ink, red } = palette();
  const w = r.w, h = r.h, y0 = tearAt(target, origin, h);
  // the tear: a zigzag, a tooth every ~7px, up and down by about 2px
  const T = [];
  for (let x = 0, k = 0; x < w; x += 7 + rand(-0.8, 0.8), k++) T.push([x, y0 + (k % 2 ? 2 : -2) + rand(-0.6, 0.6)]);
  T.push([w, y0]);

  // the card inside: centred in the pack, and shrunk to fit inside it when the pack is small (it grows as it comes forward)
  const cw = clamp(Math.min(w * 0.46, (h - 8) / 1.4), 72, 140), ch = Math.round(cw * 1.4);
  const s0 = Math.min(1, (h - 8) / ch, (w - 16) / cw), left = (w - cw) / 2, top = (h - ch) / 2;
  const d = new Date(), date = `${d.getFullYear()} · ${pad2(d.getMonth() + 1)} · ${pad2(d.getDate())}`;
  const out = document.createElement("div");
  out.className = "fx-tear-out";
  Object.assign(out.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${w}px`, height: `${h}px` });
  out.innerHTML = `
    <div class="pull" style="left:${left}px;top:${top}px;width:${cw}px;height:${ch}px">
      <div class="back"><svg viewBox="0 0 16 16" width="${Math.round(cw * 0.26)}" height="${Math.round(cw * 0.26)}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round">${GEAR}</svg></div>
      <div class="face">
        <svg class="tick" viewBox="0 0 16 16" width="${Math.round(cw * 0.34)}" height="${Math.round(cw * 0.34)}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 8.4l2.8 2.8 6-6.2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" /></svg>
        <b>做完了</b><i>${date}</i>
        <svg class="mark" viewBox="-7 -7 14 14" width="9" height="9"><path d="${STAR}" fill="${red(0.95)}" /></svg>
        <span class="sheen"></span>
      </div>
    </div>`;
  L.el.append(out);

  // the pack (above the tear) and the strip (below it), the strip in front
  const pack = cloneOf(target, L.el), strip = cloneOf(target, L.el);
  pack.firstChild.style.clipPath = `polygon(0px 0px, ${w}px 0px, ${px([...T].reverse())})`;
  strip.firstChild.style.clipPath = `polygon(${px(T)}, ${w}px ${h}px, 0px ${h}px)`;
  for (const piece of [pack, strip]) {
    const edge = document.createElementNS(SVG, "svg");
    edge.setAttribute("class", "fx-edge");
    edge.innerHTML = `<polyline points="${pts(T)}" fill="none" stroke="${ink(0.2)}" stroke-width="1" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />`;
    piece.append(edge);
  }
  const edges = [pack, strip].map((piece) => piece.querySelector(".fx-edge polyline"));
  // the shade the pack's edge casts onto the card, just below the tear and only as wide as the card; it moves with the pack
  const sw = cw * s0, sx = (w - sw) / 2, shade = document.createElement("div");
  shade.className = "fx-tear-shade";
  Object.assign(shade.style, { left: `${sx}px`, top: `${y0 - 3}px`, width: `${sw}px`,
    clipPath: `polygon(${px(T.map(([x, y]) => [x - sx, y - y0 + 3]))}, ${w}px 40px, ${-sx}px 40px)` });
  pack.append(shade);
  // the tear itself: a thin line running along it from left to right
  const line = document.createElementNS(SVG, "svg");
  line.setAttribute("class", "fx-crack");
  Object.assign(line.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${w}px`, height: `${h}px` });
  line.innerHTML = `<polyline points="${pts(T)}" fill="none" stroke="${ink(0.6)}" stroke-width="1.1" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />`;
  L.el.append(line);
  hide(target);

  const P = `perspective(${Math.round(Math.max(700, w * 2))}px)`, run = [];
  // fill both: anything that starts later stays at its first frame until then (the glints stay hidden)
  const go = (el, kf, t) => { const a = el.animate(kf, { fill: "both", ...t }); run.push(a); return a; };
  const at = (ms, total) => ms / total;
  // the paper edges of both pieces draw along with it
  for (const el of [line.firstChild, ...edges]) go(el, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: LINE, easing: "cubic-bezier(.5, 0, .7, .6)" });
  go(line, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: LINE + 120 });

  // the strip: as the tear runs its left end comes away and drops (it turns about the right end, still attached), then it
  // falls a little, swinging forward towards you, and is gone before it gets far over what is below
  strip.style.transformOrigin = `${w}px ${y0}px`;
  go(strip, [
    { transform: `${P} translate(0px, 0px) rotate(0deg) rotateX(0deg)`, opacity: 1, easing: "cubic-bezier(.45, 0, .8, .5)" },
    { transform: `${P} translate(0px, 2px) rotate(-7deg) rotateX(10deg)`, opacity: 1, offset: at(LINE + 10, STRIP), easing: "cubic-bezier(.55, 0, .9, .55)" },
    { transform: `${P} translate(${(w * 0.03).toFixed(0)}px, 14px) rotate(-11deg) rotateX(40deg)`, opacity: 0.85, offset: 0.62, easing: "cubic-bezier(.4, 0, .9, .6)" },
    { transform: `${P} translate(${(w * 0.05).toFixed(0)}px, 30px) rotate(-14deg) rotateX(66deg)`, opacity: 0 },
  ], { duration: STRIP });

  // the pack: gives a little as the strip comes away, then slides up off the card and fades
  const lift = Math.round(h * 0.3 + 18);
  go(pack, [
    { transform: "translateY(0px)", opacity: 1 },
    { transform: "translateY(2px)", opacity: 1, offset: at(140, SLEEVE[1]) },
    { transform: "translateY(0px)", opacity: 1, offset: at(SLEEVE[0], SLEEVE[1]), easing: "cubic-bezier(.4, 0, .2, 1)" },
    { transform: `translateY(${-lift * 0.55}px)`, opacity: 1, offset: at((SLEEVE[0] + SLEEVE[1]) / 2, SLEEVE[1]), easing: "cubic-bezier(.2, 0, .4, 1)" },
    { transform: `translateY(${-lift}px)`, opacity: 0 },
  ], { duration: SLEEVE[1] });
  go(shade, [{ opacity: 0 }, { opacity: 0, offset: at(110, 300) }, { opacity: 1 }], { duration: 300 });

  // the card: still while the pack comes away; comes forward; turns over with a little overshoot; stays; fades
  const pull = out.querySelector(".pull"), back = pull.querySelector(".back"), face = pull.querySelector(".face");
  const E = FADE[1], turn = (FLIP[0] + FLIP[1]) / 2;
  const card = (ty, ry, s) => `${P} translateY(${ty}px) rotateY(${ry}deg) scale(${s})`;
  go(pull, [
    { transform: card(0, 0, s0), opacity: 1 },
    { transform: card(0, 0, s0), opacity: 1, offset: at(FORWARD[0], E), easing: "cubic-bezier(.3, .7, .3, 1)" },
    { transform: card(-4, 0, 1.08), opacity: 1, offset: at(FORWARD[1], E), easing: "cubic-bezier(.5, 0, .9, .6)" },
    { transform: card(-8, 90, 1.15), opacity: 1, offset: at(turn, E), easing: "cubic-bezier(.15, .6, .3, 1)" },
    { transform: card(-4, 186, 1.09), opacity: 1, offset: at(FLIP[1] - 50, E), easing: "ease-in-out" },
    { transform: card(-4, 180, 1.08), opacity: 1, offset: at(FLIP[1] + 60, E) },
    { transform: card(-4, 180, 1.08), opacity: 1, offset: at(FADE[0], E), easing: "cubic-bezier(.4, 0, .7, .4)" },
    { transform: card(-16, 180, 1.02), opacity: 0 },
  ], { duration: E });
  // which side shows: the back until it is edge-on, then the face (turned around itself, so it reads the right way)
  const side = (show) => [{ opacity: show ? 0 : 1 }, { opacity: show ? 0 : 1, offset: at(turn, E) }, { opacity: show ? 1 : 0, offset: at(turn, E) }, { opacity: show ? 1 : 0 }];
  go(back, side(false), { duration: E });
  go(face, side(true), { duration: E });
  // the face: the check draws itself, a sheen runs across, glints come and go around it
  go(face.querySelector(".tick path"), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 300, delay: turn + 40, easing: "cubic-bezier(.5, 0, .3, 1)" });
  go(face.querySelector(".sheen"), [{ transform: "translateX(-160%) skewX(-18deg)" }, { transform: "translateX(330%) skewX(-18deg)" }], { duration: 520, delay: FLIP[1] - 20, easing: "cubic-bezier(.4, 0, .3, 1)" });
  const gx = (f) => w / 2 + (f * cw * 1.08) / 2, gy = (f) => h / 2 - 4 + (f * ch * 1.08) / 2;
  [[-1.18, -0.62, 1.1, red], [1.2, -0.12, 0.8, ink], [1.06, 0.78, 0.65, red], [-1.12, 0.5, 0.6, ink]].forEach(([fx, fy, k, c], i) => {
    const g = document.createElementNS(SVG, "svg");
    g.setAttribute("class", "fx-tear-glint");
    g.setAttribute("viewBox", "-7 -7 14 14");
    Object.assign(g.style, { left: `${gx(fx)}px`, top: `${gy(fy)}px`, width: `${14 * k}px`, height: `${14 * k}px` });
    g.innerHTML = `<path d="${STAR}" fill="${c(0.85)}" />`;
    out.append(g);
    go(g, [
      { transform: "translate(-50%, -50%) scale(0) rotate(0deg)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1) rotate(45deg)", opacity: 1, offset: 0.4 },
      { transform: "translate(-50%, -50%) scale(0) rotate(90deg)", opacity: 0 },
    ], { duration: 560, delay: FLIP[1] - 60 + i * 80, easing: "ease-out" });
  });

  let alive = true;
  const clear = () => { for (const el of [out, pack, strip, line]) el.remove(); L.release(); };
  const done = (async () => {
    await Promise.all(run.map((a) => a.finished.catch(() => {})));
    if (alive) clear();
  })();
  return {
    took: true,
    ready: wait(READY), // the card has faded: the agent card can go, and the others move up
    done,
    restore() { if (!alive) return; alive = false; for (const a of run) a.cancel(); clear(); unhide(target); },
  };
}
