import { html, useRef, useLayoutEffect, useEffect } from "../vendor/preact-htm.js";
import { useBoard } from "./ctx.js";
import { Block, Md } from "./ui.js";
import { ItemForm } from "./Item.js";
import { groupOf } from "../lib/model.js";
import { ago, dur, hoursSince } from "../lib/time.js";
import { repeatState, agentActive } from "../lib/repeat.js";
import { agentColsOf, agentCardOf, agentDoneOf } from "../lib/theme.js";
import { reducedMotion, handedOff } from "../lib/motion.js";
import { leaveCard } from "../lib/fx/index.js";
import { Seg } from "./controls.js";
import { StatusIcon, EditIcon, LocateIcon, BackIcon } from "./icons.js";

// Items handed off to an agent, least recently checked first. Laid out in one, two or three columns (chosen in settings;
// during layout editing it can also be switched next to the heading).
// A recurring item that is done for today (or not scheduled today) is left out until the next day it is due
export function AgentBlock() {
  const { doc, ui } = useBoard();
  const stale = doc.settings?.staleHours ?? 3, cols = agentColsOf(doc.theme);
  const list = doc.items.filter((i) => agentActive(i)).sort((a, b) => (a.agent?.lastSeen ?? "").localeCompare(b.agent?.lastSeen ?? ""));
  const grid = useSlide();
  const side = html`<h2>Agent</h2>${ui.editMode ? html`<${Seg} k="agentCols" cur=${cols} opts=${[[1, "一列"], [2, "两列"], [3, "三列"]]} />` : null}`;
  return html`<${Block} id="b-agent" toc="Agent" side=${side}>
    ${list.length ? html`<div class="agent-wrap"><div class=${`agent-grid cols-${cols}`} ref=${grid}>${list.map((i) => html`<${AgentCard} key=${i.id} item=${i} stale=${stale} />`)}</div></div>`
      : html`<div class="card"><div class="none" style="padding:0">现在没有挂在 Agent 上的事。</div></div>`}
  <//>`;
}

// When a card leaves or arrives (an item is done, a new one is handed off, the editor opens), the remaining cards slide from
// their old positions to the new ones instead of jumping
function useSlide() {
  const ref = useRef(null), last = useRef(null);
  useLayoutEffect(() => {
    const g = ref.current;
    const cards = g ? [...g.children].filter((n) => n.dataset.agentCard) : [];
    const gr = g?.getBoundingClientRect();
    const pos = new Map(cards.map((n) => { const r = n.getBoundingClientRect(); return [n.dataset.agentCard, [r.left - gr.left, r.top - gr.top]]; }));
    const prev = last.current;
    last.current = pos;
    if (!prev || reducedMotion() || [...prev.keys()].join() === [...pos.keys()].join()) return;
    for (const n of cards) {
      const a = prev.get(n.dataset.agentCard), b = pos.get(n.dataset.agentCard);
      if (!a || (a[0] === b[0] && a[1] === b[1])) continue;
      n.animate([{ translate: `${a[0] - b[0]}px ${a[1] - b[1]}px` }, { translate: "0 0" }], { duration: 460, easing: "cubic-bezier(.22, 1, .36, 1)" });
    }
  });
  return ref;
}

function AgentCard({ item: i, stale }) {
  const { doc, ui } = useBoard();
  if (ui.editing === `i:${i.id}@agent`) return html`<div class="card wide"><${ItemForm} item=${i} /></div>`;
  return agentCardOf(doc.theme) === "buttons" ? html`<${ButtonsCard} item=${i} stale=${stale} />` : html`<${GestureCard} item=${i} stale=${stale} />`;
}

// What every agent card shows under its title: where it runs and in which card, how long it has run and when it was last
// checked (flagged once that is too long ago), and the note
function Info({ i, g, stale }) {
  const a = i.agent || {};
  return html`<div class="where">挂在 <${Md} text=${a.where || "没写"} />${g ? ` · ${g.title}` : ""}</div>
    <div class="when">挂了 ${dur(a.since)}　上次看 ${ago(a.lastSeen)}${hoursSince(a.lastSeen) > stale ? html`<span class="stale">${dur(a.lastSeen)}没看了</span>` : null}</div>
    ${a.note ? html`<div class="note"><${Md} text=${a.note} /></div>` : null}`;
}

// Done, or today's check-in for a recurring item: play the completion effect chosen in settings and let the card leave the
// Agent block (in its own card the item is struck through and slides down). Resolves once saved, or once the card is back
const finish = (card, origin, doc, it, st) => leaveCard(card, origin, doc.theme, () => (st ? it.check(st.key, true, "打卡了") : it.patch({ status: "done" })));

// The older layout (theme.agentCard = buttons): a row of buttons
function ButtonsCard({ item: i, stale }) {
  const { doc, setUi, act, openPop } = useBoard();
  const ref = useRef(null);
  const g = groupOf(doc, i.group), it = act.item(i.id), st = repeatState(i);
  return html`<div class=${`card agent ${handedOff(i.id) ? "arrive" : ""}`} data-agent-card=${i.id} ref=${ref}>
    <h3><${Md} text=${i.title} /></h3>
    <${Info} i=${i} g=${g} stale=${stale} />
    <div class="row">
      <button class="btn dark" onClick=${() => it.patch({ seen: true }, "记下了")}>看过了</button>
      <button class="btn" onClick=${(e) => finish(ref.current, e.currentTarget, doc, it, st)}>${st ? "✓ 今天做完了" : "✓ 做完了"}</button>
      <button class="btn b-back" onClick=${() => it.patch({ status: "doing" })}>收回来自己做</button>
      <button class="btn b-edit" onClick=${() => setUi({ editing: `i:${i.id}@agent`, adding: null })}>编辑</button>
      <button class="btn b-more" title="更多" data-pop-anchor onClick=${(e) => openPop("status", i.id, e.currentTarget, { from: "agent" })}>⋯</button>
    </div>
  </div>`;
}

// The gesture layout (the default): with a mouse the card tilts towards the pointer like a seesaw, the side under it pressed
// down; a double-click (a double tap on phones) records that it was checked; done is given by sliding the knob across or by
// holding the button (theme.agentDone); locate, take back and edit are the round buttons at the top right
function GestureCard({ item: i, stale }) {
  const { doc, setUi, act, locate } = useBoard();
  const ref = useRef(null);
  useTilt(ref);
  const g = groupOf(doc, i.group), it = act.item(i.id), st = repeatState(i);
  const tap = useDoubleTap((x, y) => { ack(ref.current, x, y); it.patch({ seen: true }, "记下了"); });
  const done = (origin) => finish(ref.current, origin, doc, it, st);
  const label = st ? "今天做完了" : "做完了";
  return html`<div class=${`card agent g ${handedOff(i.id) ? "arrive" : ""}`} data-agent-card=${i.id} ref=${ref} ...${tap}>
    <span class="ag-acks" aria-hidden="true"></span>
    <div class="ag-head"><h3><${Md} text=${i.title} /></h3>
      <span class="ag-tools">
        <button class="rnd t-locate" title="定位" onClick=${() => locate(i.id)}><${LocateIcon} /></button>
        <button class="rnd t-back" title="收回来自己做" onClick=${() => it.patch({ status: "doing" })}><${BackIcon} /></button>
        <button class="rnd t-edit" title="编辑" onClick=${() => setUi({ editing: `i:${i.id}@agent`, adding: null })}><${EditIcon} /></button>
      </span>
    </div>
    <${Info} i=${i} g=${g} stale=${stale} />
    <div class="ag-foot">${agentDoneOf(doc.theme) === "hold" ? html`<${HoldToDone} label=${label} onDone=${done} />` : html`<${SlideToDone} label=${label} onDone=${done} />`}</div>
  </div>`;
}

// ---- Gestures ----

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SKIP = "button, a, input, textarea, select, .ag-done"; // where a double-click is not the card's

// The tilt: while a mouse is over the card it turns (perspective, at most about 6°, less on big cards so that the edges move
// about as far) so that the side under the pointer is pressed down and the opposite side rises; it eases back when the pointer
// leaves, and stays flat while the card is being marked done (data-still) or leaving
function useTilt(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let box = null, raf = 0, px = 0, py = 0;
    const paint = () => {
      raf = 0;
      if (!box) return;
      const deg = (size) => Math.min(6, (32 / size) * (180 / Math.PI)); // edges move about 16px towards or away
      el.style.setProperty("--ry", `${(px * deg(box.width)).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${(-py * deg(box.height)).toFixed(2)}deg`);
      el.style.setProperty("--pp", `${Math.round(Math.max(800, box.width * 2.4))}px`);
      el.classList.add("tilting");
    };
    const enter = (e) => { if (e.pointerType === "mouse") box = el.getBoundingClientRect(); };
    const move = (e) => {
      if (e.pointerType !== "mouse") return;
      box ??= el.getBoundingClientRect();
      px = clamp(((e.clientX - box.left) / box.width) * 2 - 1, -1, 1);
      py = clamp(((e.clientY - box.top) / box.height) * 2 - 1, -1, 1);
      raf ||= requestAnimationFrame(paint);
    };
    const leave = () => { box = null; cancelAnimationFrame(raf); raf = 0; el.classList.remove("tilting"); };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    addEventListener("scroll", leave, { passive: true });
    return () => { leave(); el.removeEventListener("pointerenter", enter); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); removeEventListener("scroll", leave); };
  }, []);
}

// Two clicks or taps close together on the card, not on its buttons, links or the done control: onDouble(x, y). A press that
// moves (selecting text) does not count, and a double-click does not select a word
function useDoubleTap(onDouble) {
  const st = useRef({ t: 0, x: 0, y: 0, down: null });
  return {
    onPointerDown: (e) => { st.current.down = e.target.closest(SKIP) ? null : { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e) => {
      const s = st.current, d = s.down;
      s.down = null;
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
      const now = performance.now();
      if (now - s.t < 350 && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 30) { s.t = 0; onDouble(e.clientX, e.clientY); }
      else Object.assign(s, { t: now, x: e.clientX, y: e.clientY });
    },
    onMouseDown: (e) => { if (e.detail > 1 && !e.target.closest(SKIP)) e.preventDefault(); },
  };
}

// Checked: a ring spreads from where the card was double-clicked
function ack(card, x, y) {
  const box = card?.querySelector(".ag-acks");
  if (!box || reducedMotion()) return;
  const r = card.getBoundingClientRect(), ring = document.createElement("i");
  ring.style.left = `${x - r.left}px`;
  ring.style.top = `${y - r.top}px`;
  box.append(ring);
  ring.animate([{ transform: "translate(-50%, -50%) scale(.15)", opacity: 0.55 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 0 }],
    { duration: 700, easing: "cubic-bezier(.2, .8, .3, 1)" }).finished.finally(() => ring.remove());
}

// Slide to mark it done: drag the knob to the far end of the track (most of the way is enough); let go earlier and it slides
// back. Enter, Space or → on the knob does the same, for the keyboard
function SlideToDone({ label, onDone }) {
  const ref = useRef(null);
  const set = (x, p) => { ref.current.style.setProperty("--x", `${x}px`); ref.current.style.setProperty("--p", p.toFixed(3)); };
  const reset = () => { const el = ref.current; if (!el?.isConnected) return; el.classList.remove("done"); set(0, 0); delete el.closest(".card").dataset.still; };
  const finishAt = (max, origin) => { set(max, 1); ref.current.classList.add("done"); onDone(origin).then(reset); };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const track = ref.current, knob = e.currentTarget, card = track.closest(".card");
    const max = track.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft, x0 = e.clientX;
    let x = 0;
    knob.setPointerCapture(e.pointerId);
    track.classList.add("dragging");
    card.dataset.still = "1";
    const move = (ev) => { x = clamp(ev.clientX - x0, 0, max); set(x, x / max); };
    const up = () => {
      knob.removeEventListener("pointermove", move); knob.removeEventListener("pointerup", up); knob.removeEventListener("pointercancel", up);
      track.classList.remove("dragging");
      if (x >= max * 0.86) finishAt(max, knob);
      else reset();
    };
    knob.addEventListener("pointermove", move); knob.addEventListener("pointerup", up); knob.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e) => {
    if (!["Enter", " ", "ArrowRight"].includes(e.key) || e.repeat) return;
    e.preventDefault();
    const knob = e.currentTarget;
    ref.current.closest(".card").dataset.still = "1";
    finishAt(ref.current.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft, knob);
  };
  return html`<div class="ag-done slide" ref=${ref}><span class="fill"></span><span class="lbl">${label}</span>
    <button class="knob" aria-label=${label} onPointerDown=${onPointerDown} onKeyDown=${onKeyDown}><${StatusIcon} s="done" /></button></div>`;
}

// Hold to mark it done: a fill grows across the button for HOLD_MS; let go earlier and it drains back, three times as fast.
// Enter or Space held down does the same
const HOLD_MS = 800;
function HoldToDone({ label, onDone }) {
  const ref = useRef(null), anim = useRef(null);
  const reset = () => { const b = ref.current; if (!b?.isConnected) return; b.classList.remove("holding", "done"); anim.current?.cancel(); anim.current = null; delete b.closest(".card").dataset.still; };
  const start = (e) => {
    if (e.button > 0) return;
    const b = ref.current, a0 = anim.current;
    if (b.classList.contains("done")) return;
    b.closest(".card").dataset.still = "1";
    b.classList.add("holding");
    if (a0) { a0.playbackRate = 1; return; } // pressed again while draining: carry on from there
    const a = b.querySelector(".fill").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: HOLD_MS, easing: reducedMotion() ? "linear" : "cubic-bezier(.45, 0, .7, 1)", fill: "forwards" });
    anim.current = a;
    a.finished.then(() => {
      if (anim.current !== a) return;
      if (a.playbackRate < 0) { a.cancel(); anim.current = null; delete b.closest(".card")?.dataset.still; return; } // drained
      b.classList.remove("holding");
      b.classList.add("done");
      onDone(b).then(reset);
    }, () => {});
  };
  const stop = () => {
    const b = ref.current, a = anim.current;
    if (!a || b.classList.contains("done")) return;
    b.classList.remove("holding");
    a.playbackRate = -3;
  };
  const key = (e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); start(e); } };
  const keyUp = (e) => { if (e.key === "Enter" || e.key === " ") stop(); };
  return html`<button class="ag-done hold" ref=${ref} onPointerDown=${start} onPointerUp=${stop} onPointerLeave=${stop} onPointerCancel=${stop}
    onContextMenu=${(e) => e.preventDefault()} onKeyDown=${key} onKeyUp=${keyUp}><span class="fill"></span><span class="lbl"><${StatusIcon} s="done" />${label}</span></button>`;
}
