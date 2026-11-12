// Items whose status just changed (done, dropped, reopened), for the board to animate:
//   done → a line is drawn across the title from left to right (STRIKE_MS); then the row slides down into the done items below
//          (MOVE_MS) and the other rows move up to fill in;
//   reopened → the line retracts from right to left, then the row slides back up;
//   the card does not keep it once closed (the "none" mode, or a dropped item in the "recent" mode) → once the line is drawn, the
//          row collapses and fades out.
// Whenever the data changes (a local click, or polling that picks up a change made elsewhere), App first compares the old and new
// documents and records what changed; components ask motionOf(id) while rendering.
// A record lasts only WINDOW_MS; after that the change no longer counts as just made. When the system has prefers-reduced-motion
// set, none of these animations play.
import { OPEN } from "./model.js";

export const STRIKE_MS = 420, ERASE_MS = 300, MOVE_MS = 520, WINDOW_MS = 1500;
const marks = new Map(); // id → { kind: "close" | "open", at }
const handoffs = new Map(); // id → when it was handed to an agent

/** Compares the old and new documents and records the items just done or dropped (close), just reopened (open) and just
 *  handed to an agent */
export function noteChanges(oldDoc, newDoc) {
  if (!oldDoc?.items || !newDoc?.items) return;
  const before = new Map(oldDoc.items.map((i) => [i.id, i.status]));
  const now = performance.now();
  for (const i of newDoc.items) {
    const s = before.get(i.id);
    if (s === undefined || s === i.status) continue;
    const was = OPEN.includes(s), is = OPEN.includes(i.status);
    if (was && !is) marks.set(i.id, { kind: "close", at: now });
    else if (!was && is) marks.set(i.id, { kind: "open", at: now });
    if (i.status === "agent") handoffs.set(i.id, now);
  }
}

/** Whether this item was handed to an agent within the last HANDOFF_MS (its pill and its agent card play an entrance) */
export const HANDOFF_MS = 1200;
export function handedOff(id) {
  const at = handoffs.get(id);
  if (at === undefined) return false;
  if (performance.now() - at > HANDOFF_MS) { handoffs.delete(id); return false; }
  return true;
}

/** What just happened to this item: "close" / "open" / null */
export function motionOf(id) {
  const m = marks.get(id);
  if (!m) return null;
  if (performance.now() - m.at > WINDOW_MS) { marks.delete(id); return null; }
  return m.kind;
}

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Expand and collapse ----
// A row (or a block) grows from zero height (in) or shrinks to zero height (out): height, vertical padding and vertical margins
// change together while it fades in or out, and whatever is below moves along smoothly. Played with Web Animations rather than
// classes, so a re-render cannot interrupt it; a collapsed element stays collapsed (fill: forwards) until it is removed
export const FOLD_IN = 320, FOLD_OUT = 240, FOLD_STAGGER = 34;

export function fold(el, dir, { delay = 0, duration = dir === "in" ? FOLD_IN : FOLD_OUT, easing } = {}) {
  if (!el || reducedMotion() || typeof el.animate !== "function") return null;
  const cs = getComputedStyle(el);
  const full = {
    height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, borderBottomColor: cs.borderBottomColor,
  };
  const flat = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0, borderBottomColor: "transparent" };
  el.style.overflow = "hidden";
  const anim = el.animate(dir === "in" ? [flat, { ...full, opacity: 0.4, offset: 0.55 }, full] : [full, flat], {
    duration, delay,
    easing: easing ?? (dir === "in" ? "cubic-bezier(.22, 1, .36, 1)" : "cubic-bezier(.4, 0, .9, .6)"),
    fill: dir === "in" ? "backwards" : "forwards",
  });
  if (dir === "in") anim.finished.then(() => { el.style.overflow = ""; }, () => {});
  return anim;
}

// ---- Agent cards changing places ----
// An agent card just recorded as checked moves to the back of the Agent block (it is sorted by when it was last checked).
// theme.agentMove chooses how (AgentBlock.js useSlide plays it; the cards that make room follow):
//   lift    it floats up where it is (scaled up a little, a deep shadow), pauses, travels to its new place still lifted,
//           and lands; the others wait for it to lift, then move aside
//   slide   everything slides straight to the new places
//   fade    it fades out where it was and fades in at its new place, the others slide in between
//   spring  everything slides with a little overshoot
//   none    no animation
export const MOVES = [["lift", "飘起来"], ["slide", "滑过去"], ["fade", "淡入淡出"], ["spring", "弹一下"], ["none", "不要"]];
export const moveOf = (t) => (MOVES.some(([id]) => id === t?.agentMove) ? t.agentMove : "lift");

const seenMarks = new Map(); // id → { at, moved }: checked from this page just now
/** Marks an agent card as just checked here, so that its move plays the chosen style (the move comes once the save returns) */
export const markSeen = (id) => seenMarks.set(id, { at: performance.now(), moved: false });
/** The mark, while it is fresh (3 s) */
export function justSeen(id) {
  const m = seenMarks.get(id);
  if (m && performance.now() - m.at > 3000) { seenMarks.delete(id); return null; }
  return m ?? null;
}

const REST = "0 0 0 0 rgb(0 0 0 / 0), 0 0 0 0 rgb(0 0 0 / 0)";
const liftShadow = () => getComputedStyle(document.documentElement).getPropertyValue("--lift-shadow").trim() || REST;

/** The animation of the card that moved (by dx, dy from its old place to the new one; 0, 0 when it stays): [keyframes, timing],
 *  and the timing of the cards that make room. Animates translate, scale and the like, never transform, so that it adds to
 *  the tilt */
export function moveAnimation(style, dx, dy) {
  const from = `${dx}px ${dy}px`;
  if (style === "lift") {
    const up = liftShadow(), still = dx === 0 && dy === 0;
    return {
      self: [[
        { translate: from, scale: 1, boxShadow: REST, easing: "cubic-bezier(.2, .7, .3, 1)" },
        { translate: `${dx}px ${dy - 8}px`, scale: 1.05, boxShadow: up, offset: still ? 0.4 : 0.24, easing: "cubic-bezier(.45, 0, .25, 1)" },
        { translate: "0px -8px", scale: 1.05, boxShadow: up, offset: still ? 0.6 : 0.78, easing: "cubic-bezier(.3, 0, .5, 1)" },
        { translate: "0px 0px", scale: 1, boxShadow: REST },
      ], { duration: still ? 700 : 1050 }],
      others: { delay: 250, duration: 560, easing: "cubic-bezier(.45, 0, .25, 1)" },
    };
  }
  if (style === "fade") return {
    self: [[
      { translate: from, opacity: 1, scale: 1 },
      { translate: from, opacity: 0, scale: 0.96, offset: 0.35 },
      { translate: "0px 0px", opacity: 0, scale: 0.96, offset: 0.55 },
      { translate: "0px 0px", opacity: 1, scale: 1 },
    ], { duration: 760, easing: "ease-in-out" }],
    others: { delay: 230, duration: 420, easing: "cubic-bezier(.45, 0, .25, 1)" },
  };
  const slide = { duration: style === "spring" ? 650 : 460, easing: style === "spring" ? "cubic-bezier(.34, 1.45, .55, 1)" : "cubic-bezier(.22, 1, .36, 1)" };
  return { self: [[{ translate: from }, { translate: "0px 0px" }], slide], others: slide };
}
