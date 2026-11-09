// Due dates (web/lib/due.js): the calendar puts an item on the local day it is actually due. An AoE deadline (UTC-12) usually
// falls on the next day east of it: 23:59 AoE on November 10 is 19:59 on November 11 in UTC+8.
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueInfo, parseDue, dueKey } from "../web/lib/due.js";

// Node picks up a new TZ at once; each test file runs in a process of its own
const inZone = (tz, fn) => { const was = process.env.TZ; process.env.TZ = tz; try { fn(); } finally { process.env.TZ = was; } };
const day = (s) => dueInfo(s).key;

test("AoE: the calendar day is the local day of the actual deadline", () => {
  inZone("Asia/Shanghai", () => {
    assert.equal(day("2026-11-10 AoE"), "2026-11-11", "23:59 AoE is 19:59 the next day");
    assert.equal(day("2026-11-10 23:59 AoE"), "2026-11-11");
    assert.equal(day("2026-11-10 00:30 AoE"), "2026-11-10", "00:30 AoE is 20:30 the same day");
    assert.equal(day("2026-11-30 AoE"), "2026-12-01", "into the next month");
    assert.equal(day("2026-12-31 AoE"), "2027-01-01", "into the next year");
    assert.equal(dueInfo("2026-11-10 AoE").local, "本地时间 11月11日 19:59");
  });
  inZone("America/Los_Angeles", () => assert.equal(day("2026-11-10 AoE"), "2026-11-11", "03:59 the next day"));
  inZone("Etc/GMT+12", () => assert.equal(day("2026-11-10 AoE"), "2026-11-10", "in UTC-12 itself, the same day"));
});

test("without AoE: the day written is the calendar day, in any time zone", () => {
  for (const tz of ["Asia/Shanghai", "America/Los_Angeles", "Pacific/Kiritimati"]) inZone(tz, () => {
    assert.equal(day("2026-11-10"), "2026-11-10", tz);
    assert.equal(day("2026-11-10 23:59"), "2026-11-10", tz);
    assert.equal(day("2026-11-10 00:00"), "2026-11-10", tz);
  });
});

test("the label keeps the date as written; the date picker selects that date too", () => {
  inZone("Asia/Shanghai", () => {
    assert.equal(dueInfo("2026-11-10 AoE").date, "11月10日 周二 AoE");
    assert.equal(dueKey(parseDue("2026-11-10 AoE")), "2026-11-10");
  });
});
