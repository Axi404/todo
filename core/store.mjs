// Storage: in the data directory (TODO_DIR, default ./data), todo.json is the only source of truth, todo.md is regenerated
// on every write and todo-log.jsonl gets one line per change. Every change goes through mutate(): lock, read the latest,
// change, write atomically, log. Node built-ins only.
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./errors.mjs";
import { nowIso } from "./doc.mjs";
import { normalize, emptyDoc } from "./schema.mjs";
import { toMarkdown } from "./report.mjs";

export const dataDir = () => process.env.TODO_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
export const dataFile = (name) => join(dataDir(), name);

export async function load() {
  try {
    return normalize(JSON.parse(await fs.readFile(dataFile("todo.json"), "utf8")));
  } catch (err) {
    if (err.code === "ENOENT") return emptyDoc();
    throw err;
  }
}

/** Reads the latest data, lets fn change it, and writes it back. The log entries fn returns (one, several, or null when nothing
 *  changed) are appended to todo-log.jsonl. */
export async function mutate(fn, actor = "unknown") {
  await fs.mkdir(dataDir(), { recursive: true });
  return withLock(async () => {
    const doc = await load();
    const logs = await fn(doc);
    // nothing changed: no write, and rev stays the same
    if (logs == null || (Array.isArray(logs) && !logs.length)) return doc;
    doc.rev = (doc.rev ?? 0) + 1;
    doc.updatedAt = nowIso();
    await writeAtomic(dataFile("todo.json"), JSON.stringify(doc, null, 2) + "\n");
    await writeAtomic(dataFile("todo.md"), toMarkdown(doc));
    const lines = (Array.isArray(logs) ? logs : [logs])
      .filter(Boolean)
      .map((l) => JSON.stringify({ ts: doc.updatedAt, actor, ...l }) + "\n");
    if (lines.length) await fs.appendFile(dataFile("todo-log.jsonl"), lines.join(""));
    return doc;
  });
}

/** Writes to a temporary file next to the target, then renames it over: if writing stops halfway, the original file is still
 *  intact */
export async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, path);
}

// The lock is a directory (mkdir either succeeds or fails, so two processes never both get it); a lock older than 30 seconds
// is considered stale
async function withLock(fn) {
  const lock = dataFile(".todo.lock"), deadline = Date.now() + 5000;
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const st = await fs.stat(lock);
        if (Date.now() - st.mtimeMs > 30_000) await fs.rmdir(lock).catch(() => {});
      } catch {}
      if (Date.now() > deadline) throw fail(503, "todo.json 被占用，稍后再试");
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rmdir(lock).catch(() => {});
  }
}
