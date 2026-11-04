// The ToDo board: a small HTTP server that listens on 127.0.0.1 only (port 4404 by default).
// In production it runs on a server with nginx in front, which serves the public host over HTTPS (see deploy/). To try it
// locally, start one directly:
//   TODO_DIR=<temp dir> TODO_PORT=<port> node server.mjs
// Environment variables:
//   TODO_DIR          data directory (todo.json, todo.md, todo-log.jsonl); defaults to data/ next to server.mjs (core/store.mjs)
//   TODO_PORT         port
//   TODO_PUBLIC_HOST  the public host name (e.g. todo.example.com): the Host and Origin checks accept it
//   TODO_PASSWORD     a password is required only when this is set (see server/auth.mjs); TODO_SECRET signs the login cookie
//   CANVAS_HOST       Canvas host and access token: with both set, the server reads Canvas directly and syncs it every
//   CANVAS_TOKEN      three hours (see canvas-sync.mjs)
//
// A request passes these stages in order: Host / Origin → login (server/auth.mjs) → fonts and frontend files (web/) → API
// (server/routes.mjs).
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load, mutate, normalize } from "./lib.mjs";
import { scheduleSync } from "./canvas-sync.mjs";
import { createAuth, handleAuth } from "./server/auth.mjs";
import { send, readBody, serveDir } from "./server/http.mjs";
import { HANDLERS, EDITS, match } from "./server/routes.mjs";

const PORT = Number(process.env.TODO_PORT ?? 4404);
const HOST = "127.0.0.1";
const PUBLIC_HOST = process.env.TODO_PUBLIC_HOST ?? "";
// Accept only our own addresses: other web pages cannot use the browser to change the board (Origin check), and a domain
// someone points at this server cannot read it (Host check)
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(PUBLIC_HOST ? [PUBLIC_HOST] : [])]);
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, ...(PUBLIC_HOST ? [`https://${PUBLIC_HOST}`] : [])]);
const AUTH = createAuth({ title: async () => (await load()).theme?.title || "ToDo" }); // null when no password is set: no login
// Who made a change: the actor in the log. Programs calling the API name themselves in X-Actor; everything else counts as the board
const ACTORS = new Set(["pi", "canvas-sync", "assistant"]);
// Frontend: Preact + htm as plain ES modules, no build step. The fonts are files in web/fonts/ and are served from there too
const serveWeb = serveDir(join(dirname(fileURLToPath(import.meta.url)), "web"));

const server = createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host ?? "")) return send(res, 403, { error: "只接受本机地址的请求" });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin && !ORIGINS.has(req.headers.origin)) {
      return send(res, 403, { error: "不接受别的网页发来的修改" });
    }
    const url = new URL(req.url, `http://${HOST}:${PORT}`), path = url.pathname;
    if (AUTH && (await handleAuth(AUTH, req, res, url))) return;
    if (req.method === "GET" && !path.startsWith("/api/")) return serveWeb(res, path, path.startsWith("/fonts/") ? "max-age=86400" : undefined);

    const h = match(HANDLERS, req.method, path);
    if (h) return send(res, 200, await h.fn());
    const e = match(EDITS, req.method, path);
    if (!e) return send(res, 404, { error: "not found" });
    const body = await readBody(req);
    const actor = ACTORS.has(req.headers["x-actor"]) ? req.headers["x-actor"] : "board";
    const doc = await mutate((d) => e.fn(d, body, e.id), actor);
    return send(res, 200, normalize(doc)); // re-sort, in case sections or cards were moved
  } catch (err) {
    send(res, typeof err.code === "number" ? err.code : 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ToDo board on http://${HOST}:${PORT}${PUBLIC_HOST ? ` (public: https://${PUBLIC_HOST})` : ""}${AUTH ? ", password required" : ""}`);
  if (process.env.CANVAS_TOKEN && process.env.CANVAS_HOST) scheduleSync().then((ms) => console.log(`Canvas: first sync in ${Math.round(ms / 60000)} min, then every 3 hours`));
});
