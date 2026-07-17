import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const switcherPath = path.join(root, "assets", "switcher", "index.html");

function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length >= 32 && crypto.timingSafeEqual(left, right);
}

function json(response, status, value, origin = "*") {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": origin,
    "access-control-allow-private-network": "true",
  });
  response.end(body);
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) throw new Error("Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

function open(url) {
  if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function startStudio() {
  const child = spawn(process.execPath, [path.join(here, "studio-server.mjs"), "--port", "0", "--no-open"], { stdio: ["ignore", "pipe", "ignore"] });
  child.unref();
  return new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(() => reject(new Error("Theme studio did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      data += chunk;
      const line = data.split("\n").find(Boolean);
      if (!line) return;
      try {
        const event = JSON.parse(line);
        if (!event.ready || !event.url) return;
        clearTimeout(timer); resolve(event.url);
      } catch { /* wait for a complete line */ }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { if (code) { clearTimeout(timer); reject(new Error(`Theme studio exited with ${code}`)); } });
  });
}

export async function startThemeControl(options) {
  const { port, token, listThemes, currentTheme, switchTheme, nativeTheme, shutdownTheme, readArtwork } = options;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid control port: ${port}`);
  if (typeof token !== "string" || token.length < 32) throw new Error("Control token must contain at least 32 characters");
  const html = await fs.readFile(switcherPath, "utf8");
  let origin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (request, response) => {
    const remote = request.socket.remoteAddress ?? "";
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) return json(response, 403, { error: "Loopback requests only" }, origin);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": request.headers.origin || "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type,x-cts-token",
        "access-control-allow-private-network": "true",
      });
      return response.end();
    }
    try {
      const url = new URL(request.url, origin);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        });
        response.end(html); return;
      }
      if (!tokenMatches(request.headers["x-cts-token"], token)) return json(response, 403, { error: "Invalid control token" }, request.headers.origin || "*");
      if (request.method === "GET" && url.pathname === "/api/themes") return json(response, 200, { activeTheme: currentTheme(), themes: await listThemes() }, request.headers.origin || "*");
      if (request.method === "GET" && url.pathname.startsWith("/api/art/")) {
        const artwork = await readArtwork(decodeURIComponent(url.pathname.slice(9)));
        if (!artwork) return json(response, 404, { error: "Artwork not found" }, request.headers.origin || "*");
        response.writeHead(200, { "content-type": artwork.mimeType, "content-length": artwork.data.length, "cache-control": "private, max-age=60", "x-content-type-options": "nosniff", "access-control-allow-origin": request.headers.origin || "*" });
        response.end(artwork.data); return;
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        if (url.pathname === "/api/switch") return json(response, 200, await switchTheme(body.theme), request.headers.origin || "*");
        if (url.pathname === "/api/native") return json(response, 200, await nativeTheme(), request.headers.origin || "*");
        if (url.pathname === "/api/open") { open(`${origin}/#${token}`); return json(response, 200, { ok: true }, request.headers.origin || "*"); }
        if (url.pathname === "/api/studio") { const studioUrl = await startStudio(); open(studioUrl); return json(response, 200, { url: studioUrl }, request.headers.origin || "*"); }
        if (url.pathname === "/api/shutdown") {
          const result = await shutdownTheme(); json(response, 200, result, request.headers.origin || "*"); setImmediate(() => server.close()); return;
        }
      }
      return json(response, 404, { error: "Not found" }, request.headers.origin || "*");
    } catch (error) { return json(response, 400, { error: error.message }, request.headers.origin || "*"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const address = server.address(); origin = `http://127.0.0.1:${address.port}`;
  return { server, port: address.port, url: `${origin}/#${token}` };
}
