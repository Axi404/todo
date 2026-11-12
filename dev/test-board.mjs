// UI checks for the board, in one command: starts its own board server (on a copy of the data in a temporary directory, never
// the real data) and a headless Chrome, and shuts both down at the end.
//
//   node dev/test-board.mjs
//
// Checks (all by clicking, as in normal use): how done items are shown, and the done and reopen animations; no errors on the
// page, the main blocks and the table of contents on the left are there; the status menu opens and closes; picking a place
// when handing off to an agent; with an edit form open, clicking a button elsewhere keeps the half-written text, and only
// saving closes it; in the date picker, clicking a day keeps it open, the time can be changed, and Done closes it; setting a
// repeat; checking in a recurring item by clicking its status pill; move up; the settings drawer (agent columns, places);
// editing a section in layout editing; only the ✎ opens the editor, and clicking an item on the calendar only jumps to it.
// Finally it switches to a phone size with touch and clicks through what is different on a phone.
// Needs Chrome on this machine (the default macOS path; elsewhere set CHROME=...). The API and data layer tests are in test/ (node --test).
import { startBoard, sleep } from "./harness.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// ---- start the server and the browser ----
// Add a fixed block to the copied data to test how closed items are shown: two open items, two just done, three done 10 to 12
// days ago, and one just dropped
function fixtures(d) {
  const t0 = Date.now(), ago = (ms) => new Date(t0 - ms).toISOString();
  const H = 3600_000, D = 24 * H, day0 = new Date(t0).setHours(0, 0, 0, 0);
  const today = (f) => new Date(day0 + (t0 - day0) * f).toISOString();
  d.sections.push({ id: "s-fx", title: "测试做完", sub: "", order: 99990, hidden: false });
  d.groups.push({ id: "g-fx", section: "s-fx", title: "测试卡", note: "", order: 10 });
  const mk = (id, title, status, order, extra = {}) => ({ id, group: "g-fx", title, status, note: "", order, createdAt: ago(30 * D), updatedAt: ago(20 * D), ...extra });
  d.items.push(
    mk("fx-o1", "测试没做完一", "todo", 10), mk("fx-o2", "测试没做完二", "todo", 20),
    // The two just-done items must fall on "today": between midnight and now (so a run just after midnight does not put them on yesterday)
    mk("fx-d1", "测试刚做完一", "done", 5, { doneAt: today(0.8), updatedAt: today(0.8) }),
    mk("fx-d2", "测试刚做完二", "done", 15, { doneAt: today(0.4), updatedAt: today(0.4) }),
    mk("fx-old1", "测试早做完一", "done", 30, { doneAt: ago(10 * D), updatedAt: ago(10 * D) }),
    mk("fx-old2", "测试早做完二", "done", 40, { doneAt: ago(11 * D), updatedAt: ago(11 * D) }),
    mk("fx-old3", "测试早做完三", "done", 50, { doneAt: ago(12 * D), updatedAt: ago(12 * D) }),
    mk("fx-x", "测试不做了", "dropped", 60, { updatedAt: ago(H / 2) }),
  );
}
// A fixed look for the tests (independent of the settings saved in the data): hero off (saves time), closed items hidden,
// three agent columns, bars for "recently done"
// agentCard: buttons: the checks below use the older agent cards; the gesture cards (the default) have a section of their own at the end
const board = await startBoard({ data: fixtures, theme: { hero: false, closedMode: "none", agentCols: 3, layout: "stacked", doneChart: "bars", agentCard: "buttons" } });
const page = await board.tab();
const { api } = board, { send, ev, click, type, errors } = page;
const doc = () => api("GET", "/api/todo");
const waitFor = async (expr, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await ev(expr)) return true; await sleep(100); } return false; };
const reloadPage = page.reload;

const row = (title) => `[...document.querySelectorAll('.items .item')].find((r) => r.querySelector('.t')?.textContent === ${JSON.stringify(title)})`;
const opt = (text) => `[...document.querySelectorAll('.pop .opt')].find((o) => o.textContent.includes(${JSON.stringify(text)}))`;
const btn = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + " .btn")})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

// 1. page
check("the main blocks are there", await ev(`["b-overview", "b-agent", "b-calendar"].every((id) => document.getElementById(id))`));
check("table of contents on the left", (await ev(`document.querySelectorAll('.toc a').length`)) >= 4);
// Fonts: all Chinese text must render in the Chinese fonts used for body text (PingFang SC, Microsoft YaHei). Monospace fonts
// have no Chinese glyphs, so on Windows such text falls back to NSimSun, which does not match the rest of the page
// (on Windows, the "handed off ... last checked ..." line and the "where" line of an agent card once rendered in different fonts)
const cjkFonts = () => ev(`(() => {
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /[\u3400-\u9fff]/.test(n.textContent))) continue;
    const fam = getComputedStyle(el).fontFamily.split(",").map((f) => f.trim().replace(/"/g, ""));
    const cjk = fam.findIndex((f) => f === "PingFang SC" || f === "Microsoft YaHei"), generic = fam.findIndex((f) => f === "monospace" || f === "serif");
    if (cjk < 0 || (generic >= 0 && generic < cjk)) bad.push(el.tagName.toLowerCase() + "." + [...el.classList].join(".") + ": " + fam.join(", "));
  }
  return bad })()`);
let badFonts = await cjkFonts();
check("fonts: all Chinese text uses the Chinese body text fonts (it does not turn into NSimSun on Windows)", !badFonts.length, badFonts.slice(0, 3).join(" | "));
check('fonts: "挂了…上次看…" and "挂在…" on an agent card use the same font', await ev(`(() => { const c = document.querySelector('[data-agent-card]'); const f = (s) => getComputedStyle(c.querySelector(s)).fontFamily; return f('.where') === f('.when') })()`));

// 2. status menu: click to open, click again to close; it opens out of the pill with its rows coming in one after another,
// and fades out when closed
let d = await doc();
const plain = d.items.find((i) => i.status === "todo" && !i.repeat && !i.due);
const popAnims = `(document.querySelector('.pop')?.getAnimations({ subtree: true }) ?? []).map((a) => a.animationName ?? "")`;
await click(`${row(plain.title)}.querySelector('.pill')`); await sleep(30);
check("the status menu opens out of the pill, its rows one after another", await ev(`(() => { const rows = [...document.querySelectorAll('.pop > .opt')];
  return ${popAnims}.includes("pop-in") && ${popAnims}.includes("pop-row") && new Set(rows.map((r) => getComputedStyle(r).animationDelay)).size === rows.length })()`));
await sleep(500);
check("the status menu opens", (await ev(`document.querySelectorAll('.pop .opt').length`)) >= 8);
check("…and nothing is still moving once it is open", (await ev(`${popAnims}.length`)) === 0, JSON.stringify(await ev(popAnims)));
const agentOpt = await ev(`(() => { const b = ${opt("Agent 在做")}.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 } })()`);
await page.mouse("mouseMoved", agentOpt.x, agentOpt.y); await sleep(200);
check('hovering "Agent 在做" turns its gear', await ev(`document.querySelector('.pop .opt.s-agent .si').getAnimations().some((a) => a.animationName === "gear-turn")`));
await page.mouse("mouseMoved", 5, 5);
await click(`${row(plain.title)}.querySelector('.pill')`); await sleep(30);
check("a second click closes it: it fades out and cannot be clicked meanwhile", await ev(`(() => { const p = document.querySelector('.pop'); return !!p && p.classList.contains('leaving') && getComputedStyle(p).pointerEvents === "none" && ${popAnims}.includes("pop-out") })()`));
check("…then it is gone", await waitFor(`!document.querySelector('.pop')`, 1000));

// 3. hand off to an agent: click a place
const place = d.places?.[0]?.name;
await click(`${row(plain.title)}.querySelector('.pill')`); await sleep(150);
const menuW = await ev(`document.querySelector('.pop').offsetWidth`);
await click(opt("Agent 在做")); await sleep(40);
check('choosing "Agent 在做": the menu morphs into the question, from its size to the new one', await ev(`(() => { const p = document.querySelector('.pop');
  return p.classList.contains('morphing') && p.getAnimations().some((a) => a.effect.getKeyframes().some((k) => "width" in k && parseFloat(k.width) === ${menuW})) })()`));
await sleep(400);
check("handing off to an agent lists the places", (await ev(`document.querySelectorAll('.pop .place').length`)) > 0);
check("…and the morph is over: no fixed size left on the box", await ev(`(() => { const p = document.querySelector('.pop'); return !p.classList.contains('morphing') && !p.getAnimations().length })()`));
await click(`document.querySelector('.pop .place')`); await sleep(150);
const pillAnims = (id) => `[...document.querySelector('main .items .pill[data-id="${id}"]').getAnimations({ subtree: true })].map((a) => a.animationName + ":" + a.effect.getTiming().iterations)`;
check("right after the hand-off: the gear spins up, a frame whirls around, a ring spreads out", await ev(`(() => { const a = ${pillAnims(plain.id)}.join(" ");
  return document.querySelector('main .items .pill[data-id="${plain.id}"]').classList.contains('handoff') && /gear-in:1/.test(a) && /ants-in:1/.test(a) && /ping:1/.test(a) })()`), JSON.stringify(await ev(pillAnims(plain.id))));
check("…and its new agent card rises into place", await ev(`!!document.querySelector('[data-agent-card="${plain.id}"]')?.getAnimations().some((a) => a.animationName === "card-arrive")`));
await sleep(300);
d = await doc();
const hung = d.items.find((i) => i.id === plain.id);
check("clicking a place hands it off", hung.status === "agent" && !!hung.agent?.where, `${hung.status} ${hung.agent?.where}`);
check("an agent card appears", await ev(`!!document.querySelector('[data-agent-card="${plain.id}"]')`));
check("with an agent: the gear keeps turning and the dashes of the frame keep travelling around it", await ev(`(() => { const a = ${pillAnims(plain.id)}; return a.includes("gear-turn:Infinity") && a.includes("ants:Infinity") })()`), JSON.stringify(await ev(pillAnims(plain.id))));
check("the dashed frame is drawn by the SVG (the CSS border is transparent), and goes round the corners",
  await ev(`(() => { const b = document.querySelector('main .items .pill[data-id="${plain.id}"]'), r = b.querySelector('.ants rect');
    return getComputedStyle(b).borderTopColor === "rgba(0, 0, 0, 0)" && Math.abs(r.getBoundingClientRect().width - b.getBoundingClientRect().width) <= 1 && r.getAttribute('rx') === "7.5" })()`));

// with prefers-reduced-motion: the menu opens and closes at once, and pills with an agent stand still
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await sleep(100);
const still = d.items.find((i) => i.status === "todo" && !i.repeat && i.id !== plain.id);
await click(`${row(still.title)}.querySelector('.pill')`); await sleep(30);
check("with prefers-reduced-motion: the menu opens without animation", (await ev(`${popAnims}.length`)) === 0, JSON.stringify(await ev(popAnims)));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(40);
check("…closes at once", !(await ev(`!!document.querySelector('.pop')`)));
check("…and pills with an agent stand still", await ev(`(() => { const ps = [...document.querySelectorAll('main .items .pill.run')]; return ps.length > 0 && ps.every((p) => !p.getAnimations({ subtree: true }).length) })()`));
await send("Emulation.setEmulatedMedia", { features: [] }); await sleep(100);

// 4. with an edit form open, clicking a button elsewhere keeps the half-written text
const other = d.items.find((i) => i.status === "agent" && i.id !== plain.id && !i.repeat);
await click(`${btn(`[data-agent-card="${plain.id}"]`, "编辑")}`); await sleep(200);
await type(`document.querySelector('.agent-grid .form input')`, "写了一半");
await click(btn(`[data-agent-card="${other.id}"]`, "看过了")); await sleep(400);
check('clicking "看过了" elsewhere leaves the edit form open', (await ev(`document.querySelector('.agent-grid .form input')?.value`)) === "写了一半");
await type(`document.querySelector('.agent-grid .form input')`, plain.title + "（改）");
await click(`${btn(".agent-grid .form", "保存")}`); await sleep(400);
check("the edit form closes after saving", !(await ev(`!!document.querySelector('.agent-grid .form')`)));
check("the edited title is saved", (await doc()).items.find((i) => i.id === plain.id).title === plain.title + "（改）");

// 5. date picker: clicking a day keeps it open, change the time, Done closes it
d = await doc();
const nodue = d.items.find((i) => i.status === "todo" && !i.repeat && !i.due);
await click(`${row(nodue.title)}.querySelector('.pill')`); await sleep(150);
await click(opt("设截止日期")); await sleep(200);
await click(`[...document.querySelectorAll('.pk-day:not(.out)')].find((b) => b.textContent === "28")`); await sleep(400);
check("the date picker stays open after clicking a day", await ev(`!!document.querySelector('.pop .pk')`));
await type(`document.querySelector('.pop .pk-time')`, "18:30"); await sleep(400);
await click(`[...document.querySelectorAll('.pop .qbtn')].find((b) => b.textContent === "完成")`); await sleep(200);
check('clicking "完成" closes it', await waitFor(`!document.querySelector('.pop')`, 1000));
check("the due date is saved as the 28th, 18:30", /-28 18:30$/.test((await doc()).items.find((i) => i.id === nodue.id).due ?? ""), (await doc()).items.find((i) => i.id === nodue.id).due);

// 6. set a repeat, then remove it
await click(`${row(nodue.title)}.querySelector('.pill')`); await sleep(150);
await click(opt("设为重复")); await sleep(200);
await click(`[...document.querySelectorAll('.pop .pk-toggle')].find((b) => b.textContent === "工作日")`); await sleep(400);
check("set to weekdays", JSON.stringify((await doc()).items.find((i) => i.id === nodue.id).repeat?.days) === "[1,2,3,4,5]");
await click(`[...document.querySelectorAll('.pop .qbtn')].find((b) => b.textContent === "不重复")`); await sleep(400);
check("repeat removed", !(await doc()).items.find((i) => i.id === nodue.id).repeat);
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(150);

// 7. recurring item: click the status pill to check in, click again to undo
// (one that is due today: on a weekend a weekday item rests, and its pill opens the menu instead)
d = await doc();
let rep = null;
for (const i of d.items.filter((i) => i.repeat && ["todo", "agent", "doing"].includes(i.status))) {
  if (/今天要做|今天做完/.test(await ev(`${row(i.title)}?.querySelector('.pill')?.textContent ?? ""`))) { rep = i; break; }
}
check("there is a recurring item due today to check in", !!rep);
if (rep) {
  const pillSel = `${row(rep.title)}.querySelector('.pill')`;
  const before = await ev(`${pillSel}.textContent`);
  await click(pillSel); await sleep(400);
  const after = await ev(`${pillSel}.textContent`);
  check("clicking a recurring item's status pill checks it in or undoes the check-in", after !== before, `${before} → ${after}`);
  await click(pillSel); await sleep(400);
}

// 8. move up
d = await doc();
const g = d.groups.find((gr) => d.items.filter((i) => i.group === gr.id && i.status === "todo").length >= 2);
if (g) {
  const open = d.items.filter((i) => i.group === g.id && ["todo", "doing", "agent", "waiting"].includes(i.status)).sort((a, b) => a.order - b.order);
  const second = open[1];
  await ev(`(() => { const r = ${row(second.title)}; r.scrollIntoView({ block: "center" }); r.querySelector('.tool[title="上移"]').click(); return true })()`); await sleep(400);
  const now = (await doc()).items.filter((i) => i.group === g.id && ["todo", "doing", "agent", "waiting"].includes(i.status)).sort((a, b) => a.order - b.order);
  check("moves up one place (among the visible items only)", now[0].id === second.id);
}

// 9. settings
await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(600);
check("the settings drawer slides out", await ev(`document.querySelector('.drawer')?.classList.contains('on')`));
check("the list of places", (await ev(`document.querySelectorAll('.placerow').length`)) > 0);
badFonts = await cjkFonts();
check("fonts: Chinese text in the settings uses the Chinese body text fonts too", !badFonts.length, badFonts.slice(0, 3).join(" | "));
await click(`[...document.querySelectorAll('.drawer .field')].find((f) => f.textContent.startsWith("Agent 排列")).querySelectorAll('button')[1]`); await sleep(400);
check("switch to two columns in the settings", (await doc()).theme.agentCols === 2);
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);
check("Esc closes the settings", !(await ev(`!!document.querySelector('.drawer')`)));

// 10. layout editing: the form for editing a section appears in the card column on the right
await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "编辑布局")`); await sleep(200);
await click(`document.querySelector('main section.block[id^="b-s-"] .side .tool[title="改名字"]')`); await sleep(300);
check("the section form is in the card column", await ev(`!!document.querySelector('main section.block .stack > .card .form')`));
await click(`${btn("main section.block .stack .form", "取消")}`); await sleep(200);
await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "完成编辑")`); await sleep(200);

// 11. only the ✎ on the right opens the editor: clicking the title does not; clicking an item on the calendar only scrolls to
//     that item and highlights it briefly
{
  const t = (await doc()).items.find((i) => i.status === "todo" && !i.repeat);
  await click(`${row(t.title)}.querySelector('.t')`); await sleep(300);
  check("clicking the title does not open the editor", !(await ev(`!!document.querySelector('main .items .form')`)));
  await click(`${row(t.title)}.querySelector('.tool[title="编辑"]')`); await sleep(300);
  check("clicking the ✎ on the right opens the editor", (await ev(`document.querySelector('main .items .form input')?.value`)) === t.title);
  await click(`${btn("main .items .form", "取消")}`); await sleep(200);
}
if (await ev(`!!document.querySelector('.calchip')`)) {
  const chipTitle = await ev(`document.querySelector('.calchip .tt').textContent`);
  await click(`document.querySelector('.calchip')`); await sleep(700);
  check("clicking an item on the calendar: no edit form opens", !(await ev(`!!document.querySelector('.form')`)));
  check("clicking an item on the calendar: that item is highlighted and scrolled into view", await ev(`(() => { const r = document.querySelector('main .items .item.located, main .items .item.located2'); if (!r) return false; const b = r.getBoundingClientRect(); return r.querySelector('.t').textContent === ${JSON.stringify(chipTitle)} && b.top >= 0 && b.bottom <= innerHeight })()`));
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(200);
}

// 12. closed items: a card keeps only the last few days' done items and folds older ones into one line; "recently done" lists
//     them by day; clicking an entry finds it in its card
const fxRows = () => ev(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('h3')?.textContent.includes("测试卡"))?.querySelectorAll('.items .item .t') ? [...[...document.querySelectorAll('.card')].find((c) => c.querySelector('h3')?.textContent.includes("测试卡")).querySelectorAll('.items .item .t')].map((t) => t.textContent) : null`);
const fxMore = `[...document.querySelectorAll('.card')].find((c) => c.querySelector('h3')?.textContent.includes("测试卡"))?.querySelector('.closed-more')`;
await api("PATCH", "/api/theme", { closedMode: "recent", recentDays: 3 }); await reloadPage();
check('"最近": open items on top, just-done ones below them with the newest first, dropped ones not shown', JSON.stringify(await fxRows()) === JSON.stringify(["测试没做完一", "测试没做完二", "测试刚做完一", "测试刚做完二"]), JSON.stringify(await fxRows()));
check("older done items fold into one line", /之前还做完了 3 条/.test(await ev(`${fxMore}?.textContent ?? ""`)));
// Expanding and collapsing both animate the items one after another (rather than making them all appear or vanish at once)
const fxCard = `[...document.querySelectorAll('.card')].find((c) => c.querySelector('h3')?.textContent.includes("测试卡"))`;
const olds = `[...${fxCard}.querySelectorAll('.items .item')].filter((r) => r.querySelector('.t').textContent.startsWith("测试早做完"))`;
await click(fxMore); await sleep(70);
check('expanding "之前还做完了": the older done items unfold one after another (right after the click they are not full height yet and are moving)', await ev(`(() => { const rs = ${olds}; return rs.length === 3 && rs.every((r) => r.getAnimations().length > 0) && rs.some((r) => r.offsetHeight < r.scrollHeight - 2) })()`));
await sleep(700);
check("once expanded, the older done items are there too", (await fxRows()).length === 7 && (await ev(`${fxMore}.textContent`)) === "收起");
check("fully expanded: every item at full height, with no animations or inline styles left over", await ev(`${olds}.every((r) => !r.getAnimations().length && !r.style.overflow && r.offsetHeight >= r.scrollHeight - 1)`));
await click(fxMore); await sleep(70);
check('clicking "收起": those items are still there, folding back (and cannot be clicked)', await ev(`(() => { const rs = ${olds}; return rs.length === 3 && rs.every((r) => r.classList.contains('folding') && r.getAnimations().length > 0) })()`));
check('once folded they are removed, and the line says "之前还做完了 3 条" again', (await waitFor(`${olds}.length === 0`, 2000)) && /之前还做完了 3 条/.test(await ev(`${fxMore}.textContent`)));
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await click(fxMore); await sleep(70);
check("with prefers-reduced-motion: expands at once, without animation", await ev(`(() => { const rs = ${olds}; return rs.length === 3 && rs.every((r) => !r.getAnimations().length) })()`));
await send("Emulation.setEmulatedMedia", { features: [] });
check("done items have no move up / move down", !(await ev(`[...document.querySelectorAll('.items .item')].find((r) => r.querySelector('.t')?.textContent === "测试刚做完一").querySelector('.tool[title="上移"]')`)));
await api("PATCH", "/api/theme", { closedMode: "all" }); await reloadPage();
check('"全部": dropped items are shown too, and there is no fold line', (await fxRows()).includes("测试不做了") && !(await ev(`!!${fxMore}`)));
await api("PATCH", "/api/theme", { closedMode: "none" }); await reloadPage();
check('"不显示": only open items are left', JSON.stringify(await fxRows()) === JSON.stringify(["测试没做完一", "测试没做完二"]));
await api("PATCH", "/api/theme", { closedMode: "recent" }); await reloadPage();
check('the "最近做完" block and its entry in the table of contents', (await ev(`!!document.getElementById('b-done')`)) && (await ev(`[...document.querySelectorAll('.toc a')].some((a) => a.textContent === "最近做完")`)));
check("two weeks of bars", (await ev(`document.querySelectorAll('#b-done .dn-bar').length`)) === 14);
check('items done today are listed under "今天"', await ev(`(() => { const d = [...document.querySelectorAll('#b-done .dn-day')].find((x) => x.querySelector('h4').textContent.startsWith("今天")); return !!d && d.textContent.includes("测试刚做完一") && d.textContent.includes("测试刚做完二") })()`));
check("items from 10+ days ago are not listed at first", !(await ev(`document.getElementById('b-done').textContent.includes("测试早做完一")`)));
await click(`[...document.querySelectorAll('#b-done .addlink')].find((b) => b.textContent === "再往前一周")`); await sleep(60);
check('"再往前一周": the added days unfold one after another', await ev(`[...document.querySelectorAll('#b-done .dn-day')].some((d) => d.getAnimations().length > 0)`));
await sleep(600);
check('after "再往前一周" they are listed', await ev(`document.getElementById('b-done').textContent.includes("测试早做完一")`));
await click(`[...document.querySelectorAll('#b-done .dn-item')].find((r) => r.textContent.includes("测试早做完一"))`); await sleep(700);
check('clicking a folded-away item in "最近做完": it is revealed in its card and highlighted, and no edit form opens', (await ev(`!!document.querySelector('main .items .item.located .t, main .items .item.located2 .t') && [...document.querySelectorAll('main .items .item.located, main .items .item.located2')].some((r) => r.querySelector('.t').textContent === "测试早做完一")`)) && !(await ev(`!!document.querySelector('.form')`)));
await ev(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), true`);
check("clicking elsewhere: the revealed item folds away again", await waitFor(`![...document.querySelectorAll('main .items .item')].some((r) => r.querySelector('.t')?.textContent === "测试早做完一")`, 2000));
// Bar shades: the 7 on the right are dark (the last 7 days), the 7 on the left light (the 7 days before); clicking a bar or
// listing more days does not change them
const tones = () => ev(`[...document.querySelectorAll('#b-done .dn-bar')].map((b) => (b.classList.contains('prev') ? 'p' : 'c')).join('')`);
check("bars: 7 light ones on the left, 7 dark ones on the right", (await tones()) === "pppppppccccccc", await tones());
check("to the right of the title: how many were done in the previous 7 days", /前 7 天 \d+ 件/.test(await ev(`document.querySelector('#b-done .cal-head .sum')?.textContent ?? ""`)));
await click(`[...document.querySelectorAll('#b-done .addlink')].find((b) => b.textContent === "收起")`); await sleep(60);
check('"收起": the added days fold away from the bottom up', await ev(`[...document.querySelectorAll('#b-done .dn-day.folding')].some((d) => d.getAnimations().length > 0)`));
check('clicking "收起" goes back to 7 days', await waitFor(`!document.getElementById('b-done').textContent.includes("测试早做完一")`, 2000));
await click(`[...document.querySelectorAll('#b-done .dn-bar')][3]`); await sleep(500); // the 4th bar: 10 days ago
check("clicking a light bar: that day is listed and highlighted", (await ev(`document.getElementById('b-done').textContent.includes("测试早做完一")`)) && (await ev(`!!document.querySelector('#b-done .dn-day.flash')`)));
check("the bar shades do not change after clicking a bar", (await tones()) === "pppppppccccccc", await tones());
check("a day with nothing done cannot be clicked", await ev(`[...document.querySelectorAll('#b-done .dn-bar')].every((b) => b.querySelector('.b.zero') ? b.tagName === "SPAN" : b.tagName === "BUTTON")`));
// Card numbers: assigned by position (only in blocks with two or more cards); a hand-written "3. " is not shown
const nums = await ev(`(() => { const sec = [...document.querySelectorAll('main section.block')].find((b) => b.querySelectorAll('.stack > .card > h3').length > 1); return sec ? [...sec.querySelectorAll('.stack > .card > h3')].map((h) => (h.querySelector('.no')?.textContent ?? "") + "|" + h.textContent) : null })()`);
check("card numbers follow the position: 01, 02, 03, ...", !!nums && nums.every((x, k) => x.startsWith(String(k + 1).padStart(2, "0") + "|")), JSON.stringify(nums?.slice(0, 3)));
check("card titles no longer show hand-written numbers", !!nums && nums.every((x) => !/\|\d{2}\d+\.\s/.test(x)));
check("a block with only one card has no numbers", !(await ev(`!!document.querySelector('#b-s-s-fx .no')`)));
await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(600);
check('settings: "做完的" has three options, and there is "留几天"', (await ev(`[...document.querySelectorAll('.drawer .field')].find((f) => f.textContent.startsWith("做完的"))?.querySelectorAll('button').length`)) === 3 && (await ev(`[...document.querySelectorAll('.drawer .field')].some((f) => f.textContent.startsWith("留几天"))`)));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);

// 12b. The chart above "recently done": bars / heatmap, switchable in the settings and with the slider in layout editing;
//      clicking a heatmap cell jumps to that day. The small button at the top right: on the bars it knocks them over like
//      dominoes (afterwards they stand back up as they were, at their original heights); on the heatmap it plays snake (arrow
//      keys steer without scrolling the page, Esc stops)
const barHeights = () => ev(`[...document.querySelectorAll('#b-done .dn-bar .b')].map((b) => b.style.height).join(",")`);
const h0 = await barHeights();
await click(`document.querySelector('#b-done .egg')`); await sleep(700);
check("bars: clicking the small corner button makes the bars fall like dominoes", await ev(`!!document.querySelector('#b-done .dn-bars.playing') && [...document.querySelectorAll('#b-done .dn-bar .b')].some((b) => /rotate/.test(b.style.transform))`));
check("bars: clicking a bar while they fall does not jump anywhere", await ev(`getComputedStyle(document.querySelector('#b-done .dn-bars')).pointerEvents === "none"`));
check("bars: falling does not change the bars' own heights (so new data arriving midway does no harm)", (await barHeights()) === h0);
check("bars: after falling and standing back up they are as before", (await waitFor(`!document.querySelector('#b-done .dn-bars.playing')`)) && (await barHeights()) === h0
  && (await ev(`[...document.querySelectorAll('#b-done .dn-bar .b')].every((b) => !b.style.transform && !b.style.width)`)), `${await barHeights()} / ${h0}`);
await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(600);
await click(`[...[...document.querySelectorAll('.drawer .field')].find((f) => f.textContent.startsWith("最近做完的图")).querySelectorAll('button')].find((b) => b.textContent === "热力图")`); await sleep(500);
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);
check("switch to the heatmap in the settings", (await doc()).theme.doneChart === "heatmap" && (await ev(`!!document.querySelector('#b-done .hm') && !document.querySelector('#b-done .dn-bars')`)));
const hmDays = await ev(`document.querySelectorAll('#b-done .hm-cell:not(:disabled)').length`);
check("heatmap: days with done items can be clicked, the title says how many were done in how many weeks, and there is a legend next to it", hmDays >= 3 && /最近 \d+ 周做完 \d+ 件/.test(await ev(`document.querySelector('#b-done .cal-head .ttl').textContent`)) && (await ev(`document.querySelectorAll('#b-done .hm-legend i').length`)) === 5, String(hmDays));
check("heatmap: today's cell is outlined", await ev(`!!document.querySelector('#b-done .hm-cell.today')`));
const oldCell = await ev(`(() => { const today = document.querySelector('#b-done .hm-cell.today'); const cells = [...document.querySelectorAll('#b-done .hm-cell:not(:disabled)')];
  return cells.findIndex((c) => /：[1-9]\d* 件$/.test(c.title) && c !== today && +c.style.gridColumn < +today.style.gridColumn - 1) })()`);
await click(`[...document.querySelectorAll('#b-done .hm-cell:not(:disabled)')][${oldCell}]`); await sleep(500);
check("heatmap: clicking a cell (one from 10+ days ago) lists that day and highlights it", oldCell >= 0 && (await ev(`!!document.querySelector('#b-done .dn-day.flash')`)) && (await ev(`document.getElementById('b-done').textContent.includes("测试早做完")`)));
await ev(`(() => { const c = document.querySelector('#b-done .card'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 140); return true })()`); await sleep(300);
await click(`document.querySelector('#b-done .egg')`); await sleep(700);
check("snake: clicking the small corner button turns the cells into a board, and the snake starts from today", await ev(`!!document.querySelector('#b-done .hm.playing .hm-cell.head') && !!document.querySelector('#b-done .hm.playing .hm-cell.food')`));
const y0 = await ev(`scrollY`), head = () => ev(`(() => { const h = document.querySelector('#b-done .hm-cell.head'); return h ? [+h.style.gridColumn, +h.style.gridRow] : null })()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
await sleep(200); const p1 = await head(); await sleep(320); const p2 = await head();
check("snake: the arrow keys steer it (to the left), and the page does not scroll", !!p1 && !!p2 && p2[0] < p1[0] && p2[1] === p1[1] && (await ev(`scrollY`)) === y0, JSON.stringify([p1, p2]));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(400);
check("snake: Esc stops it and the heatmap is back", !(await ev(`!!document.querySelector('#b-done .hm.playing')`)) && (await ev(`document.querySelectorAll('#b-done .hm-cell:not(:disabled)').length`)) === hmDays);
await click(`document.querySelector('header .tbtn.edit-btn')`); await sleep(500);
const pk = await ev(`(() => { const c = document.querySelector('#b-done .chart-picker'); if (!c) return null; c.scrollIntoView({ block: "center" }); const b = c.getBoundingClientRect(); return { x: b.right - 30, y: b.top + b.height / 2 } })()`);
check("in layout editing there is a slider below the chart to switch it", !!pk);
if (pk) { await sleep(300); const b = await ev(`(() => { const b = document.querySelector('#b-done .chart-picker').getBoundingClientRect(); return { x: b.right - 30, y: b.top + b.height / 2 } })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 }); }
await sleep(1300);
check("one click on the right of the slider switches back to bars", (await doc()).theme.doneChart === "bars" && (await ev(`!!document.querySelector('#b-done .dn-bars')`)));
await click(`document.querySelector('header .tbtn.edit-btn')`); await sleep(400);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await sleep(200);
check("no small button with prefers-reduced-motion", await ev(`getComputedStyle(document.querySelector('#b-done .egg')).display === "none"`));
await send("Emulation.setEmulatedMedia", { features: [] });

// 13. The done animation: a line is drawn through the row, then the row slides down into the done items; reopening retracts
//     the line and slides the row back to where it was; with closed items not shown, the row folds away once the line is drawn
const fxRow = (t) => `[...document.querySelectorAll('main .items .item')].find((r) => r.querySelector('.t')?.textContent === ${JSON.stringify(t)})`;
const setStatus = async (title, label) => {
  await click(`${fxRow(title)}.querySelector('.pill')`); await sleep(200);
  await click(`[...document.querySelectorAll('.pop .opt')].find((o) => o.textContent.includes(${JSON.stringify(label)}))`);
};
await api("PATCH", "/api/theme", { closedMode: "recent", recentDays: 3 }); await reloadPage();
// Record this row on every frame: its shadow (no blurred shadow may appear while it slides or after it stops; one used to
// flash at the moment it stopped), its height, and whether its status just changed
const sampleRow = (title, ms) => ev(`(() => { window.__fx = []; const t0 = performance.now();
  const step = () => { const n = ${fxRow(title)}, cs = n && getComputedStyle(n);
    window.__fx.push({ t: Math.round(performance.now() - t0), shadow: cs ? cs.boxShadow : "none", lifted: !!n?.classList.contains("lifted"),
      h: n ? n.offsetHeight : 0, kind: n?.classList.contains("just-closed") ? "close" : n?.classList.contains("just-opened") ? "open" : "" });
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(step); };
  requestAnimationFrame(step); return true })()`);
// For how many milliseconds after the status change the row keeps the height it had before (the line of small text that is
// added or removed only expands or collapses once the row has slid into place).
// kind: which change to look for (close: done, open: reopened); the class left by the previous change is only removed on the
// next render, so it may still be there at the start and does not count
const steadyFor = (fx, kind) => { const k = fx.findIndex((s) => s.kind === kind); if (k < 1) return -1;
  const h0 = fx[k - 1].h, t0 = fx[k].t, bad = fx.slice(k).find((s) => s.h !== h0); return bad ? bad.t - t0 : Infinity; };
await sampleRow("测试没做完一", 2200);
await setStatus("测试没做完一", "做完了"); await sleep(120);
check("done: the line is drawn through the row first", await ev(`${fxRow("测试没做完一")}.classList.contains('just-closed')`));
await sleep(1200);
check("done: slides down to the top of the done items", JSON.stringify(await fxRows()) === JSON.stringify(["测试没做完二", "测试没做完一", "测试刚做完一", "测试刚做完二"]), JSON.stringify(await fxRows()));
check("no transform is left after the animation", await ev(`[...document.querySelectorAll('main .items .item')].every((r) => !r.style.transform)`));
await sleep(500);
const fx = await ev(`window.__fx`);
// Only a thin line with no blur and no spread (the divider at the top) is allowed, never a blurred shadow
const flat = (sh) => sh === "none" || sh.split(/,(?![^(]*\))/).every((x) => /\s0px\s0px$/.test(x.trim()));
check("done: while sliding it stays above the other rows, and there is no shadow at any point", fx.some((s) => s.lifted) && fx.every((s) => flat(s.shadow)),
  [...new Set(fx.filter((s) => !flat(s.shadow)).map((s) => `${s.t}ms ${s.shadow}`))].slice(0, 2).join(" | "));
check("no inline height is left after the animation", await ev(`[...document.querySelectorAll('main .items .item, main .items .item > .body')].every((r) => !r.style.height && !r.style.overflow)`));
const keepC = steadyFor(fx, "close");
check('done: the row does not grow while the line is drawn and while it slides; "刚刚做完" expands only once it is in place', keepC >= 900 && keepC !== Infinity && fx.at(-1).h > fx[0].h, `${keepC}ms`);
await sampleRow("测试没做完一", 2000);
await setStatus("测试没做完一", "还没做"); await sleep(120);
check("reopened: the line retracts", await ev(`${fxRow("测试没做完一")}.classList.contains('just-opened')`));
await sleep(1100);
check("reopened: slides back to where it was", JSON.stringify(await fxRows()) === JSON.stringify(["测试没做完一", "测试没做完二", "测试刚做完一", "测试刚做完二"]), JSON.stringify(await fxRows()));
await sleep(500);
const fxo = await ev(`window.__fx`), keepO = steadyFor(fxo, "open");
check("reopened: the row does not shrink while the line retracts and while it slides; the line of small text collapses only once it is in place", keepO >= 780 && keepO !== Infinity && fxo.at(-1).h < fxo[0].h, `${keepO}ms`);
await api("PATCH", "/api/theme", { closedMode: "none" }); await reloadPage();
await setStatus("测试没做完二", "做完了"); await sleep(150);
check('"不显示": the row folds away once the line is drawn', await ev(`${fxRow("测试没做完二")}?.classList.contains('exiting') ?? false`));
await sleep(1800);
check('"不显示": once folded it is gone', JSON.stringify(await fxRows()) === JSON.stringify(["测试没做完一"]), JSON.stringify(await fxRows()));
await api("PATCH", "/api/theme", { closedMode: "recent" });

// 13b. Completion effects: clicking done on an agent card, every effect plays to the end, the item is done, everything the
//      effect added is cleaned up, and there are no errors; the same for check-ins. With "none" chosen, or with
//      prefers-reduced-motion, nothing plays (the card leaves all the same). The settings have two rows of options: clicking
//      one selects it and tries it out right there
{
  const sec = await api("POST", "/api/sections", { title: "测试效果" });
  const gfx = sec.groups.find((x) => x.section === sec.sections.find((y) => y.title === "测试效果").id).id;
  const agentFx = ["confetti", "shatter", "dust", "stamp", "fireworks", "none", "reduce"];
  for (const id of agentFx) await api("POST", "/api/items", { group: gfx, title: `效果 ${id}`, status: "agent", agent: { where: "测试" } });
  await api("POST", "/api/items", { group: gfx, title: "效果打卡", repeat: "daily" });
  const ids = Object.fromEntries((await doc()).items.filter((i) => i.title.startsWith("效果 ")).map((i) => [i.title.slice(3), i.id]));
  const fxGone = `!document.querySelector('.fx-layer') && !document.querySelector('.fx-canvas')`;
  for (const id of agentFx) {
    if (id === "reduce") await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await api("PATCH", "/api/theme", { agentFx: id === "reduce" ? "shatter" : id }); await reloadPage();
    const doneBtn = `[...document.querySelectorAll('[data-agent-card="${ids[id]}"] .btn')].find((b) => b.textContent.includes("做完了"))`;
    await click(doneBtn); await sleep(90);
    const shown = await ev(`!!document.querySelector('.fx-layer, .fx-canvas')`);
    const finished = await waitFor(`fetch('/api/todo').then((r) => r.json()).then((d) => d.items.find((i) => i.id === "${ids[id]}").status === "done")`, 4000);
    const clean = await waitFor(`${fxGone} && !document.querySelector('[data-agent-card="${ids[id]}"]')`, 6000);
    const quiet = id === "none" || id === "reduce";
    check(`effect: agent card "${id}"${quiet ? ": nothing plays, the card leaves all the same" : ": plays, item done, cleaned up"}`, (quiet ? !shown : shown) && finished && clean
      && (await ev(`[...document.querySelectorAll('[data-agent-card]')].every((c) => !c.dataset.leaving && getComputedStyle(c).visibility === "visible" && getComputedStyle(c).opacity === "1")`)),
      `played ${shown}, done ${finished}, cleaned up ${clean}`);
    if (id === "reduce") await send("Emulation.setEmulatedMedia", { features: [] });
  }
  // Saving fails (the item is deleted behind the page's back first, so the page does not know yet): once the shards have flown,
  // the card comes back and can still be clicked
  await api("POST", "/api/items", { group: gfx, title: "效果 存不上", status: "agent", agent: { where: "测试" } });
  await api("PATCH", "/api/theme", { agentFx: "shatter" }); await reloadPage();
  const lost = (await doc()).items.find((i) => i.title === "效果 存不上").id;
  await api("DELETE", `/api/items/${lost}`);
  await click(`[...document.querySelectorAll('[data-agent-card="${lost}"] .btn')].find((b) => b.textContent.includes("做完了"))`);
  const back = await waitFor(`(() => { const c = document.querySelector('[data-agent-card="${lost}"]'); return !!c && !c.dataset.leaving && getComputedStyle(c).visibility === "visible" })()`, 4000);
  check("effect: the card comes back when saving fails", back && (await waitFor(fxGone, 5000)));
  const rep = (await doc()).items.find((i) => i.title === "效果打卡").id;
  const dotSel = `(() => { const row = [...document.querySelectorAll('#b-repeat .hab .nm')].find((n) => n.textContent.includes("效果打卡")); let e = row.nextElementSibling; while (e && !e.classList.contains('today')) e = e.nextElementSibling; return e.querySelector('.dot') })()`;
  for (const id of ["confetti", "pop", "fireworks", "ripple", "none"]) {
    await api("PATCH", "/api/theme", { checkFx: id }); await api("POST", `/api/items/${rep}/check`, { done: false }); await reloadPage();
    await click(dotSel); await sleep(90);
    const shown = await ev(`!!document.querySelector('.fx-canvas')`);
    const checked = await waitFor(`fetch('/api/todo').then((r) => r.json()).then((d) => d.items.find((i) => i.id === "${rep}").doneDates?.length === 1)`, 3000);
    const clean = await waitFor(fxGone, 6000);
    check(`effect: check-in "${id}"${id === "none" ? ": nothing plays" : ": plays, checked in, cleaned up"}`, (id === "none" ? !shown : shown) && checked && clean, `played ${shown}, checked in ${checked}, cleaned up ${clean}`);
  }
  await click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(600);
  const chips = (label) => `[...[...document.querySelectorAll('.drawer .field')].find((f) => f.firstElementChild.textContent === ${JSON.stringify(label)}).querySelectorAll('.chip')]`;
  check('settings, "效果": two rows, 7 options for "Agent 做完时" and 6 for "打卡时", with "不要" first and "随机" last',
    (await ev(`${chips("Agent 做完时")}.map((c) => c.textContent).join()`)) === "不要,彩带,碎掉,化成灰,盖章,烟花,随机" && (await ev(`${chips("打卡时")}.map((c) => c.textContent).join()`)) === "不要,彩带,火花,烟花,涟漪,随机");
  await click(`${chips("Agent 做完时")}.find((c) => c.textContent === "盖章")`); await sleep(300);
  check('clicking "盖章" in the settings: it is selected, and stamps right there on that row', (await doc()).theme.agentFx === "stamp" && (await ev(`!!document.querySelector('.fx-stamp')`)));
  check("after the try-out the row of options comes back and the effect is cleaned up", (await waitFor(`${fxGone} && [...document.querySelectorAll('.drawer .chips')].every((r) => getComputedStyle(r).visibility === "visible")`, 5000)));
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);
  await api("PATCH", "/api/theme", { agentFx: "shatter", checkFx: "confetti" });
  await reloadPage();
}

// 14. Phone (390×844, touch): nothing sticks out sideways; a one-line header bar; status pills show only the icon; popups rise
//     from the bottom and lock the page behind them, and tapping the mask closes them without hitting what is underneath;
//     agent cards have the checked, done and ⋯ buttons, with edit inside ⋯; the month calendar lists the month's items below it;
//     inputs are at least 16px (so iPhone does not zoom in when one is tapped)
for (const cols of [1, 2, 3]) {
  await api("PATCH", "/api/theme", { agentCols: cols }); await sleep(200); await reloadPage();
  check(`desktop with ${cols} agent columns: the cards have no ⋯, but have "收回来自己做" and "编辑"`, await ev(`(() => { const c = document.querySelector('[data-agent-card]'); const vis = (sel) => getComputedStyle(c.querySelector(sel)).display !== "none";
    return !vis('.b-more') && vis('.b-back') && vis('.b-edit') })()`));
}
// AoE deadlines on the calendar: on the local day they are actually due, in a few time zones (each in a tab of its own)
{
  const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await api("POST", "/api/items", { group: "g-fx", title: "测试 AoE 截止", due: `${ym}-10 AoE` });
  await api("POST", "/api/items", { group: "g-fx", title: "测试本地截止", due: `${ym}-10 23:59` });
  const has = (t) => `[...el.querySelectorAll('.tt')].some((x) => x.textContent === ${JSON.stringify(t)})`;
  const cellOf = (t) => `[...document.querySelectorAll('.cal-cell:not(.out)')].find((el) => ${has(t)})?.querySelector('.dn')?.textContent`;
  const headingOf = (t) => `[...document.querySelectorAll('.cal-agenda .ag-day')].find((el) => ${has(t)})?.querySelector('h4')?.textContent`;
  for (const [tz, day] of [["Asia/Shanghai", "11"], ["America/Los_Angeles", "11"], ["Etc/GMT+12", "10"]]) {
    const t = await board.tab(board.base);
    await t.send("Emulation.setTimezoneOverride", { timezoneId: tz }); await t.reload();
    const got = [await t.ev(cellOf("测试 AoE 截止")), await t.ev(cellOf("测试本地截止")), await t.ev(headingOf("测试 AoE 截止"))];
    check(`calendar in ${tz}: due on the 10th AoE goes on the ${day}th, 23:59 on the 10th stays there, and the phone list agrees`,
      got[0] === day && got[1] === "10" && (got[2] ?? "").includes(`月${day}日`), JSON.stringify(got));
    await t.close();
  }
  for (const i of (await doc()).items.filter((x) => ["测试 AoE 截止", "测试本地截止"].includes(x.title))) await api("DELETE", `/api/items/${i.id}`);
  await reloadPage();
}

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await reloadPage();
const { tapAt, tap } = page;
const shown = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => getComputedStyle(e).display !== "none")`;
check("phone: the page is no wider than the screen", await ev(`document.documentElement.scrollWidth <= innerWidth`), String(await ev(`document.documentElement.scrollWidth`)));
check('phone: one-line header bar, "编辑布局" moved into the settings', await ev(`(() => { const b = [...document.querySelectorAll('header .tbtn')].find((x) => x.textContent === "编辑布局"); return !!b && getComputedStyle(b).display === "none" && document.querySelector('header .bar').getBoundingClientRect().height <= 60 })()`));
check("phone: status pills show only the icon", await ev(`(() => { const p = document.querySelector('main section[id^="b-s-"] .items .item .pill'); return getComputedStyle(p.querySelector('.lbl')).display === "none" && !!p.getAttribute('aria-label') })()`));
await tap(`${fxRow("测试没做完一")}.querySelector('.pill')`);
check("phone: the status menu rises from the bottom and locks the page behind it", await ev(`!!document.querySelector('.pop.sheet') && !!document.querySelector('.pop-mask') && document.documentElement.classList.contains('lock')`));
check("phone: while locked the header bar stays where it was and the page does not jump", await ev(`scrollY > 200 && Math.abs(document.querySelector('header').getBoundingClientRect().top) < 1`), String(await ev(`[scrollY, Math.round(document.querySelector('header').getBoundingClientRect().top)]`)));
// Tap the mask at a spot that lies right over another item's status pill: it only closes, without opening that item's menu
const under = await ev(`(() => { const top = document.querySelector('.pop.sheet').getBoundingClientRect().top;
  const p = [...document.querySelectorAll('main .items .item .pill')].map((e) => e.getBoundingClientRect()).find((b) => b.top > 80 && b.bottom < top - 10);
  return p ? { x: p.left + p.width / 2, y: p.top + p.height / 2 } : null })()`);
check("phone: the mask covers other items", !!under);
if (under) await tapAt(under.x, under.y);
check("phone: tapping the mask closes it without hitting the item underneath", await ev(`!document.querySelector('.pop') && !document.querySelector('main .form') && !document.documentElement.classList.contains('lock')`));
const agId = await ev(`document.querySelector('[data-agent-card]')?.dataset.agentCard`);
const agBtns = await ev(`${shown(`[data-agent-card="${agId}"] > .row .btn`)}.map((b) => b.textContent.trim())`);
check('phone: agent cards show "看过了", "做完了" and "⋯"', agBtns.length === 3 && agBtns[0] === "看过了" && agBtns[1].includes("做完") && agBtns[2] === "⋯", JSON.stringify(agBtns));
await tap(`document.querySelector('[data-agent-card="${agId}"] .b-more')`);
check("phone: ⋯ opens that item's status menu", await ev(`!!document.querySelector('.pop.sheet') && [...document.querySelectorAll('.pop .opt')].some((o) => o.textContent.includes('编辑'))`));
await tap(opt("编辑")); await sleep(300);
check("phone: edit from ⋯ opens the edit form in the Agent block", await ev(`!!document.querySelector('.agent-grid .form') && !document.querySelector('.pop')`));
check("phone: inputs are at least 16px", await ev(`[...document.querySelectorAll('.agent-grid .form input, .agent-grid .form textarea, .agent-grid .form select')].every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16)`));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(300);
check("phone: calendar cells show only dots, and the month's items are listed below", await ev(`getComputedStyle(document.querySelector('.cal-agenda')).display !== "none" && ${shown(".cal-cell .calchip")}.length === 0`));
await tap(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(500);
check("phone: the page behind is locked while the settings are open", await ev(`!!document.querySelector('.drawer.on') && document.documentElement.classList.contains('lock')`));
const small = (scope) => ev(`[...document.querySelectorAll(${JSON.stringify(scope)})].filter((e) => !["range", "checkbox", "radio", "hidden"].includes(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => (e.placeholder || e.className) + " " + getComputedStyle(e).fontSize)`);
let tiny = await small(".drawer input, .drawer textarea, .drawer select");
check("phone: all inputs in the settings are at least 16px", tiny.length === 0, JSON.stringify(tiny));
check("phone: every label in the settings is on one line", await ev(`[...document.querySelectorAll('.drawer .field > span:first-child')].every((s) => { const r = document.createRange(); r.selectNodeContents(s); return r.getClientRects().length <= 1 })`));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);
check("phone: unlocked after the settings close", await ev(`!document.documentElement.classList.contains('lock')`));
check("phone: still no wider than the screen", await ev(`document.documentElement.scrollWidth <= innerWidth`));
// Phone in landscape (844 wide, more than 640, so the desktop layout is used): tapping an input must still not zoom the page
await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 3, mobile: true });
await reloadPage();
await tap(`${fxRow("测试没做完一")}.querySelector('.tool[title="编辑"]')`); await sleep(300);
tiny = await small("main .form input, main .form textarea, main .form select");
check("phone in landscape: the edit form's inputs are at least 16px", (await ev(`!!document.querySelector('main .form')`)) && tiny.length === 0, JSON.stringify(tiny));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(300);
await tap(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(500);
tiny = await small(".drawer input, .drawer textarea, .drawer select");
check("phone in landscape: the inputs in the settings are at least 16px", tiny.length === 0, JSON.stringify(tiny));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`); await sleep(500);
await send("Emulation.setTouchEmulationEnabled", { enabled: false }); await send("Emulation.clearDeviceMetricsOverride");

// ---- Gesture agent cards (the default layout): a tab of their own, desktop and then phone ----
{
  await api("PATCH", "/api/theme", { agentCard: "gesture", agentDone: "slide", agentFx: "none" });
  for (const n of ["一", "二", "三", "四", "五", "六"]) await api("POST", "/api/items", { group: "g-fx", title: `手势${n}`, status: "agent", agent: { where: "测试机" } });
  const gid = Object.fromEntries((await doc()).items.filter((i) => i.title.startsWith("手势")).map((i) => [i.title.slice(2), i.id]));
  const item = async (k) => (await doc()).items.find((i) => i.id === gid[k]);
  const gp = await board.tab(board.base, { width: 1440, height: 900, scale: 1 });
  const C = (k) => `document.querySelector('[data-agent-card="${gid[k]}"]')`;
  const rect = (sel) => gp.ev(`(() => { const e = ${sel}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`);
  const press = async (x, y, n = 1) => { await gp.mouse("mouseMoved", x, y); await gp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: n }); await gp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: n }); };
  const drag = async (sel, frac) => {
    const k = await rect(`${sel}.querySelector('.knob')`), t = await rect(`${sel}.querySelector('.ag-done')`);
    const x0 = k.x + k.w / 2, y0 = k.y + k.h / 2, dx = (t.w - k.w - 6) * frac;
    await gp.mouse("mouseMoved", x0, y0); await gp.mouse("mousePressed", x0, y0);
    for (let s2 = 1; s2 <= 12; s2++) { await gp.mouse("mouseMoved", x0 + (dx * s2) / 12, y0); await sleep(12); }
    await gp.mouse("mouseReleased", x0 + dx, y0);
  };
  check("gesture cards: three round buttons (locate, take back, edit) and a slide track, no row of buttons",
    await gp.ev(`(() => { const c = ${C("一")}; return [...c.querySelectorAll('.ag-tools .rnd')].map((b) => b.title).join() === "定位,收回来自己做,编辑" && !!c.querySelector('.ag-done.slide .knob') && !c.querySelector('.row') })()`));

  // tilt: the side under the pointer is pressed down, and it eases back flat when the pointer leaves
  let r = await rect(C("一"));
  await gp.mouse("mouseMoved", r.x + r.w / 2, r.y + r.h / 2); await gp.mouse("mouseMoved", r.x + r.w * 0.95, r.y + r.h * 0.08); await sleep(300);
  const tilt = await gp.ev(`(() => { const c = ${C("一")}; return { on: c.classList.contains('tilting'), ry: parseFloat(c.style.getPropertyValue('--ry')), rx: parseFloat(c.style.getPropertyValue('--rx')), t: getComputedStyle(c).transform } })()`);
  check("hover at the top right: the card tilts, the top right pressed down (rotateY > 0, rotateX > 0), at most 6°", tilt.on && tilt.ry > 2 && tilt.ry <= 6 && tilt.rx > 2 && tilt.rx <= 6 && tilt.t.startsWith("matrix3d"), JSON.stringify(tilt));
  await gp.mouse("mouseMoved", r.x + r.w * 0.05, r.y + r.h * 0.92); await sleep(300);
  check("…at the bottom left it tilts the other way", await gp.ev(`(() => { const c = ${C("一")}; return parseFloat(c.style.getPropertyValue('--ry')) < -2 && parseFloat(c.style.getPropertyValue('--rx')) < -2 })()`));
  check("…as one flat plate: nothing inside it moves on its own", await gp.ev(`(() => { const c = ${C("一")}; return getComputedStyle(c).transformStyle === "flat" && [...c.querySelectorAll('*')].every((e) => getComputedStyle(e).transform === "none" || e.classList.contains('knob')) })()`));
  await gp.mouse("mouseMoved", 3, 3); await sleep(800);
  check("…and lies flat again once the pointer has left", await gp.ev(`(() => { const c = ${C("一")}; return !c.classList.contains('tilting') && getComputedStyle(c).transform === "none" })()`));

  // double-click: checked (lastSeen), a ring where it was clicked, no word selected; not on the done control
  const seen0 = (await item("一")).agent.lastSeen;
  r = await rect(`${C("一")}.querySelector('.where')`);
  await press(r.x + 20, r.y + r.h / 2, 1); await press(r.x + 20, r.y + r.h / 2, 2); await sleep(30);
  check("double-click on the card: the checked effect plays (a small ripple) and no word is selected", await gp.ev(`!!document.querySelector('.fx-canvas') && getSelection().toString() === ""`));
  await gp.mouse("mouseMoved", 3, 3);
  // the move's own animation (not the CSS transitions of the tilt easing off): wait for it to start, then read it
  const moving = (id) => gp.ev(`(async () => {
    const own = (el) => el.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation));
    for (let k = 0; k < 100 && !own(document.querySelector('[data-agent-card="${id}"]')).length; k++) await new Promise((r) => setTimeout(r, 10));
    const c = document.querySelector('[data-agent-card="${id}"]'), a = own(c)[0]; if (!a) return null;
    const others = [...document.querySelectorAll('[data-agent-card]')].filter((x) => x !== c && own(x).length).map((x) => own(x)[0].effect.getTiming());
    return { kf: a.effect.getKeyframes().map((k) => ({ scale: k.scale, translate: k.translate, opacity: k.opacity, shadow: k.boxShadow, easing: k.easing })), t: a.effect.getTiming(), others: others.map((o) => ({ delay: o.delay, easing: o.easing })) } })()`);
  const lift = await moving(gid["一"]);
  check("…then it floats up where it is (a little bigger, a deep shadow), travels to the back still lifted and lands; the others make room once it has lifted",
    !!lift && lift.kf.length === 4 && lift.kf[1].scale === "1.05" && ((a, b) => a[0] === b[0] && Math.abs(a[1] - 8 - b[1]) < 0.01)(lift.kf[0].translate.split(" ").map(parseFloat), lift.kf[1].translate.split(" ").map(parseFloat)) && /px/.test(lift.kf[1].shadow) && /^0px( 0px)?$/.test(lift.kf[3].translate)
      && lift.others.length > 0 && lift.others.every((o) => o.delay === 250), JSON.stringify(lift).slice(0, 300));
  await sleep(1200);
  check("…the item is recorded as checked just now, and its card is the last one", (await item("一")).agent.lastSeen > seen0 && /记下了/.test(await gp.ev(`document.querySelector('.toast').textContent`))
    && (await gp.ev(`[...document.querySelectorAll('#b-agent [data-agent-card]')].at(-1).dataset.agentCard`)) === gid["一"]);
  r = await rect(`${C("一")}.querySelector('.where')`);
  await press(r.x + 20, r.y + r.h / 2, 1); await press(r.x + 20, r.y + r.h / 2, 2); await gp.mouse("mouseMoved", 3, 3);
  const still = await moving(gid["一"]);
  check("checked again while it is the last one: it floats up and lands in place", !!still && still.kf[1].scale === "1.05" && still.kf.every((k) => k.translate.startsWith("0px")) && still.t.duration === 700, JSON.stringify(still).slice(0, 200));
  await sleep(800);
  const seen1 = (await item("二")).agent.lastSeen;
  r = await rect(`${C("二")}.querySelector('.ag-done .lbl')`);
  await press(r.x + r.w / 2, r.y + r.h / 2, 1); await press(r.x + r.w / 2, r.y + r.h / 2, 2); await sleep(500);
  check("a double-click on the done control does not count", (await item("二")).agent.lastSeen === seen1);

  // slide: the fill around the knob follows it exactly; let go halfway and it slides back; all the way and the item is done
  {
    const k = await rect(`${C("二")}.querySelector('.knob')`), t = await rect(`${C("二")}.querySelector('.ag-done')`);
    await gp.mouse("mouseMoved", k.x + k.w / 2, k.y + k.h / 2); await gp.mouse("mousePressed", k.x + k.w / 2, k.y + k.h / 2);
    for (let s2 = 1; s2 <= 8; s2++) { await gp.mouse("mouseMoved", k.x + k.w / 2 + (t.w * 0.4 * s2) / 8, k.y + k.h / 2); await sleep(12); }
    const geo = await gp.ev(`(() => { const f = ${C("二")}.querySelector('.fill').getBoundingClientRect(), n = ${C("二")}.querySelector('.knob').getBoundingClientRect(), l = ${C("二")}.querySelector('.ag-done .lbl');
      return { gap: +(f.right - n.right).toFixed(1), rim: +((f.height - n.height) / 2).toFixed(1), lag: getComputedStyle(${C("二")}.querySelector('.fill')).transitionDuration, label: +getComputedStyle(l).opacity } })()`);
    check("while sliding, the fill ends 3px around the knob as the track does, follows it without lag, and the label has faded", Math.abs(geo.gap - 3) <= 1 && Math.abs(geo.rim - 3) <= 1 && geo.lag.split(",").every((d) => parseFloat(d) === 0) && geo.label === 0, JSON.stringify(geo));
    await gp.mouse("mouseMoved", k.x + k.w / 2, k.y + k.h / 2); await gp.mouse("mouseReleased", k.x + k.w / 2, k.y + k.h / 2); await sleep(600);
  }
  await drag(C("二"), 0.5); await sleep(600);
  check("slide halfway and let go: the knob slides back and nothing is saved", (await item("二")).status === "agent"
    && (await gp.ev(`(() => { const t = ${C("二")}.querySelector('.ag-done'); return t.style.getPropertyValue('--x') === "0px" && !${C("二")}.dataset.still })()`)));
  await drag(C("二"), 1);
  check("slide all the way: the card leaves and the item is done", await waitFor(`fetch('/api/todo').then((r) => r.json()).then((d) => d.items.find((i) => i.id === "${gid["二"]}").status === "done")`, 4000)
    && (await gp.ev(`(async () => { for (let k = 0; k < 40 && document.querySelector('[data-agent-card="${gid["二"]}"]'); k++) await new Promise((r) => setTimeout(r, 100)); return !document.querySelector('[data-agent-card="${gid["二"]}"]') })()`)));
  await gp.ev(`${C("三")}.querySelector('.knob').focus(), true`); await gp.key("Enter", "Enter", 13);
  check("Enter on the knob does the same", await waitFor(`fetch('/api/todo').then((r) => r.json()).then((d) => d.items.find((i) => i.id === "${gid["三"]}").status === "done")`, 4000));

  // the round buttons
  await gp.click(`${C("四")}.querySelector('.t-locate')`);
  // the page scrolls there smoothly: wait until it has stopped
  await gp.ev(`(async () => { let y = -1; for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 100)); if (k > 3 && scrollY === y) break; y = scrollY; } return true })()`);
  const found = await gp.ev(`(() => { const r = document.querySelector('main .items .item[data-id="${gid["四"]}"]'); if (!r) return { none: true }; const b = r.getBoundingClientRect(); return { cls: r.className, top: Math.round(b.top), bottom: Math.round(b.bottom), h: innerHeight } })()`);
  check("locate: the item is found in its card below and highlighted", /located/.test(found.cls ?? "") && found.top > 0 && found.bottom < found.h, JSON.stringify(found));
  await gp.click(`${C("四")}.querySelector('.t-back')`); await sleep(500);
  check("take back: the item is mine again (doing)", (await item("四")).status === "doing");
  await gp.click(`${C("五")}.querySelector('.t-edit')`); await sleep(300);
  check("edit: the edit form opens in the Agent block", (await gp.ev(`document.querySelector('.agent-grid .form input')?.value`)) === "手势五");
  await gp.esc(); await sleep(300);

  // hold: let go early and it drains back; hold long enough and the item is done
  await api("PATCH", "/api/theme", { agentDone: "hold" }); await gp.reload();
  check("hold mode: a button to hold instead of the track", await gp.ev(`!!${C("五")}.querySelector('button.ag-done.hold') && !${C("五")}.querySelector('.knob')`));
  r = await rect(`${C("五")}.querySelector('.ag-done')`);
  await gp.mouse("mouseMoved", r.x + r.w / 2, r.y + r.h / 2); await gp.mouse("mousePressed", r.x + r.w / 2, r.y + r.h / 2); await sleep(300);
  const mid = await gp.ev(`(() => { const f = ${C("五")}.querySelector('.ag-done .fill'); return new DOMMatrix(getComputedStyle(f).transform).a })()`);
  await gp.mouse("mouseReleased", r.x + r.w / 2, r.y + r.h / 2); await sleep(500);
  check("hold for 0.3 s and let go: it had filled part way, drains back, nothing is saved", mid > 0.05 && mid < 0.8 && (await item("五")).status === "agent"
    && (await gp.ev(`!${C("五")}.querySelector('.ag-done .fill').getAnimations().length && !${C("五")}.dataset.still`)), `filled ${mid}`);
  await gp.mouse("mousePressed", r.x + r.w / 2, r.y + r.h / 2); await sleep(1100); await gp.mouse("mouseReleased", r.x + r.w / 2, r.y + r.h / 2);
  check("hold for 1 s: the item is done", await waitFor(`fetch('/api/todo').then((r) => r.json()).then((d) => d.items.find((i) => i.id === "${gid["五"]}").status === "done")`, 4000));

  // the other "checked" effects and moves (each time the first card is checked and goes to the back)
  await gp.mouse("mouseMoved", 3, 3);
  for (const [fx, move] of [["eye", "slide"], ["glow", "fade"], ["none", "spring"], ["ripple", "none"]]) {
    await api("PATCH", "/api/theme", { seenFx: fx, agentMove: move }); await gp.reload();
    const id = await gp.ev(`document.querySelector('#b-agent [data-agent-card]').dataset.agentCard`);
    r = await rect(`document.querySelector('[data-agent-card="${id}"] .where')`);
    await press(r.x + 20, r.y + r.h / 2, 1); await press(r.x + 20, r.y + r.h / 2, 2); await gp.mouse("mouseMoved", 3, 3); await sleep(40);
    const fxOn = await gp.ev(`({ eye: !!document.querySelector('.fx-layer .seen-eye'), ripple: !!document.querySelector('.fx-canvas'), glow: document.querySelector('[data-agent-card="${id}"] .when').getAnimations().length > 0 })`);
    check(`checked effect "${fx}"`, fx === "none" ? !fxOn.eye && !fxOn.ripple && !fxOn.glow : fxOn[fx], JSON.stringify(fxOn));
    if (move === "none") {
      await sleep(400);
      check('move "none": the card goes to the back without any animation', (await gp.ev(`[...document.querySelectorAll('#b-agent [data-agent-card]')].at(-1).dataset.agentCard`)) === id
        && (await gp.ev(`[...document.querySelectorAll('#b-agent [data-agent-card]')].every((c) => !c.getAnimations().filter((a) => !(a instanceof CSSTransition)).length)`)));
    } else {
      const m = await moving(id);
      const ok = !!m && (move === "slide" ? m.kf.length === 2 && m.t.duration === 460 && m.others.every((o) => o.delay === 0)
        : move === "fade" ? m.kf.some((k) => k.opacity === "0") && m.others.every((o) => o.delay === 230)
        : m.t.easing.includes("1.45") && m.others.every((o) => o.easing.includes("1.45")));
      check(`move "${move}"`, ok, JSON.stringify(m).slice(0, 240));
    }
    await sleep(1200);
  }
  // settings: the two rows of options; clicking one selects it and plays it on the option
  await gp.click(`[...document.querySelectorAll('header .tbtn')].find((b) => b.textContent === "设置")`); await sleep(500);
  const chip = (label, name) => `[...[...document.querySelectorAll('.drawer .field')].find((f) => f.textContent.startsWith(${JSON.stringify(label)})).querySelectorAll('.chip')].find((c) => c.textContent === ${JSON.stringify(name)})`;
  await gp.click(chip("看过了时", "眨眼")); await sleep(60);
  check('settings: "看过了时" has 不要, 涟漪, 眨眼, 高亮, 随机; clicking 眨眼 selects it and plays it there', (await gp.ev(`!!document.querySelector('.fx-layer .seen-eye')`)) && (await doc()).theme.seenFx === "eye"
    && (await gp.ev(`[...[...document.querySelectorAll('.drawer .field')].find((f) => f.textContent.startsWith("看过了时")).querySelectorAll('.chip')].map((c) => c.textContent).join()`)) === "不要,涟漪,眨眼,高亮,随机");
  await gp.click(chip("看过以后", "淡入淡出")); await sleep(60);
  check('settings: "看过以后" has 飘起来, 滑过去, 淡入淡出, 弹一下, 不要; clicking one selects it and plays it on the option', (await doc()).theme.agentMove === "fade"
    && (await gp.ev(`${chip("看过以后", "淡入淡出")}.getAnimations().length > 0`)));
  await gp.esc(); await sleep(400);

  // prefers-reduced-motion: no tilt
  await gp.media([{ name: "prefers-reduced-motion", value: "reduce" }]); await gp.reload();
  r = await rect(C("六"));
  await gp.mouse("mouseMoved", r.x + r.w / 2, r.y + r.h / 2); await gp.mouse("mouseMoved", r.x + r.w * 0.9, r.y + r.h * 0.1); await sleep(300);
  check("with prefers-reduced-motion: no tilt", await gp.ev(`!${C("六")}.classList.contains('tilting') && getComputedStyle(${C("六")}).transform === "none"`));
  await gp.close();

  // phone: a double tap records it as checked; sliding with a finger marks it done
  await api("PATCH", "/api/theme", { agentDone: "slide" });
  const ph = await board.tab(board.base, { width: 390, height: 844, scale: 2, phone: true });
  const seen6 = (await item("六")).agent.lastSeen;
  const pr = await ph.ev(`(() => { const e = ${C("六")}.querySelector('.when'); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 } })()`);
  await ph.send("Input.synthesizeTapGesture", { x: pr.x, y: pr.y, duration: 30, tapCount: 1, gestureSourceType: "touch" }); await sleep(90);
  await ph.send("Input.synthesizeTapGesture", { x: pr.x, y: pr.y, duration: 30, tapCount: 1, gestureSourceType: "touch" }); await sleep(1400); // it floats to the back
  check("phone: a double tap records it as checked", (await item("六")).agent.lastSeen > seen6);
  check("phone: the round buttons are finger-sized (34px)", await ph.ev(`[...${C("六")}.querySelectorAll('.rnd')].every((b) => b.offsetWidth === 34)`));
  const kn = await ph.ev(`(() => { ${C("六")}.scrollIntoView({ block: "center" }); const k = ${C("六")}.querySelector('.knob').getBoundingClientRect(), t = ${C("六")}.querySelector('.ag-done').getBoundingClientRect(); return { x: k.left + k.width / 2, y: k.top + k.height / 2, d: t.width - k.width - 6 } })()`);
  const touch = (type, x) => ph.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: kn.y }] });
  await touch("touchStart", kn.x);
  for (let s2 = 1; s2 <= 12; s2++) { await touch("touchMove", kn.x + (kn.d * s2) / 12); await sleep(16); }
  await touch("touchEnd");
  check("phone: sliding the knob across with a finger marks it done", await waitFor(`fetch('/api/todo').then((r) => r.json()).then((d) => d.items.find((i) => i.id === "${gid["六"]}").status === "done")`, 4000));
  check("gesture cards: no errors", gp.errors.length === 0 && ph.errors.length === 0, [...gp.errors, ...ph.errors].slice(0, 3).join(" | "));
  await ph.close();
}

check("no errors at any point", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
