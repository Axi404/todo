// Starts the board server for tests: writes the data to a temporary directory, starts server.mjs on any free port, and
// afterwards stops it and deletes the temporary directory it created.
//   const srv = await startServer({ data: { sections: [...], groups: [...], items: [...] }, env: { TODO_PASSWORD: "x" } });
//   await fetch(srv.base + "/api/todo"); srv.stop();
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
export const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

/** dir: the directory to use (a new temporary one if omitted); data: written to todo.json; env: extra environment variables */
export async function startServer({ dir, data, env = {} } = {}) {
  const own = !dir;
  dir ??= mkdtempSync(join(tmpdir(), "axi-todo-test-"));
  if (data) writeFileSync(join(dir, "todo.json"), JSON.stringify(data));
  if (!existsSync(join(dir, "todo-log.jsonl"))) writeFileSync(join(dir, "todo-log.jsonl"), "");
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env, TODO_DIR: dir, TODO_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (s) => (stderr += s));
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    if (i === 49) throw new Error(`server did not start: ${stderr}`);
  }
  return {
    dir, port, base,
    get stderr() { return stderr; },
    /** Every line of the log, parsed */
    log: () => readFileSync(join(dir, "todo-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    stop: () => { proc.kill(); if (own) rmSync(dir, { recursive: true, force: true }); },
  };
}
