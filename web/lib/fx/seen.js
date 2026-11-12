// What plays when an agent card is recorded as checked (a double-click on a gesture card, or its 看过了 button):
// theme.seenFx. Small on purpose: enough to see that it registered, nothing more.
//   ripple  one thin ring spreads from that spot, about 60px across, and fades
//   eye     a small eye opens at that spot, blinks once and drifts up as it fades
//   glow    the card's "last checked" line lights up for a moment
// Plus none and random, as for the completion effects. Nothing plays with prefers-reduced-motion.
import { animate, layer, palette, pick, TAU, easeOut } from "./kit.js";
import { reducedMotion } from "../motion.js";

const EFFECTS = { ripple, eye, glow };
const NAMES = [["ripple", "涟漪"], ["eye", "眨眼"], ["glow", "高亮"]];

/** The options in the settings: [id, name], with "none" first and "random" last */
export const seenFxOptions = () => [["none", "不要"], ...NAMES, ["random", "随机"]];

export function seenFxOf(theme) {
  const v = theme?.seenFx;
  return v === "none" || v === "random" || v in EFFECTS ? v : "ripple";
}

/** Plays it for card at (x, y) in viewport coordinates (glow lights the card's .when line, or card itself) */
export function playSeen(theme, card, x, y, setting = seenFxOf(theme)) {
  if (reducedMotion() || !card?.isConnected || setting === "none") return;
  const id = setting === "random" ? pick(Object.keys(EFFECTS)) : setting;
  try { EFFECTS[id](card, x + scrollX, y + scrollY); } catch (err) { console.error("fx failed", err); }
}

function ripple(card, px, py) {
  const { ink } = palette();
  let t = 0;
  animate((dt, ctx) => {
    t += dt;
    const u = t / 0.55;
    if (u >= 1) return false;
    const fade = (1 - u) ** 1.3;
    ctx.strokeStyle = ink(0.55 * fade);
    ctx.lineWidth = 0.6 + 1.2 * fade;
    ctx.beginPath(); ctx.arc(px, py, 5 + 25 * easeOut(u), 0, TAU); ctx.stroke();
    return true;
  });
}

const EYE = `<svg viewBox="0 0 26 16" width="26" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path class="lid" d="M1.5 8C5 2.6 9 1.2 13 1.2S21 2.6 24.5 8C21 13.4 17 14.8 13 14.8S5 13.4 1.5 8z" /><circle cx="13" cy="8" r="3" fill="currentColor" stroke="none" /></svg>`;

function eye(card, px, py) {
  const L = layer(), el = document.createElement("div");
  el.className = "seen-eye";
  el.innerHTML = EYE;
  Object.assign(el.style, { left: `${px}px`, top: `${py}px` });
  L.el.append(el);
  const at = (dy, s, sy) => `translate(-50%, -50%) translateY(${dy}px) scale(${s}, ${s * sy})`;
  el.animate([
    { transform: at(0, 0.7, 0.08), opacity: 0 },
    { transform: at(0, 1, 1), opacity: 1, offset: 0.22 },
    { transform: at(-1, 1, 0.1), opacity: 1, offset: 0.45 },
    { transform: at(-2, 1, 1), opacity: 1, offset: 0.58 },
    { transform: at(-10, 1, 1), opacity: 0 },
  ], { duration: 950, easing: "cubic-bezier(.3, .7, .4, 1)" }).finished.finally(() => { el.remove(); L.release(); });
}

function glow(card) {
  const el = card.querySelector(".when") ?? card, bg = `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim()} / .09)`;
  el.animate([
    { backgroundColor: bg, boxShadow: `0 0 0 5px ${bg}`, borderRadius: "6px" },
    { backgroundColor: bg, boxShadow: `0 0 0 5px ${bg}`, borderRadius: "6px", offset: 0.35 },
    { backgroundColor: "transparent", boxShadow: "0 0 0 5px transparent", borderRadius: "6px" },
  ], { duration: 1000, easing: "ease-out" });
}
