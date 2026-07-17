#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeBrief } from "./theme-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const indexPath = path.join(root, "assets", "studio", "index.html");

function parseArgs(argv) {
  const options = {
    port: 48761,
    open: true,
    waitForSubmit: false,
    timeoutMs: 30 * 60 * 1000,
    outputRoot: path.join(os.homedir(), ".codex", "theme-studio", "sessions"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--wait-for-submit") options.waitForSubmit = true;
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--output-root") options.outputRoot = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error("Invalid port");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error("Invalid timeout");
  return options;
}

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error("Request exceeds 32 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function decodeArt(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Uploaded artwork must be PNG, JPEG, or WebP");
  const data = Buffer.from(match[2], "base64");
  if (data.length > 24 * 1024 * 1024) throw new Error("Uploaded artwork exceeds 24 MB");
  return {
    data,
    extension: match[1].toLowerCase() === "jpeg" ? ".jpg" : `.${match[1].toLowerCase()}`,
  };
}

async function atomicWrite(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, data);
  await fs.rename(temporaryPath, filePath);
}

function tokensMatch(actual, expected) {
  const left = Buffer.from(actual || "");
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const options = parseArgs(process.argv.slice(2));
const htmlTemplate = await fs.readFile(indexPath, "utf8");
const sessionId = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
const sessionToken = crypto.randomBytes(24).toString("hex");
const sessionDirectory = path.join(options.outputRoot, sessionId);
let phase = "waiting";
let actualOrigin = "";
let timeout;

function sessionPayload() {
  return {
    sessionId,
    agentConnected: options.waitForSubmit,
    phase,
  };
}

function closeServer() {
  clearTimeout(timeout);
  server.close();
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, actualOrigin || "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/") {
      const session = { ...sessionPayload(), token: sessionToken };
      const html = htmlTemplate.replace("__CTS_SESSION_JSON__", JSON.stringify(session).replace(/</g, "\\u003c"));
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true, service: "codex-theme-studio", ...sessionPayload() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      json(response, 200, sessionPayload());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/submit") {
      const origin = request.headers.origin;
      if (origin && origin !== actualOrigin) {
        json(response, 403, { error: "Invalid request origin" });
        return;
      }
      if (!tokensMatch(request.headers["x-cts-token"], sessionToken)) {
        json(response, 403, { error: "Invalid session token" });
        return;
      }
      if (phase !== "waiting") {
        json(response, 409, { error: "This design session has already been submitted" });
        return;
      }

      const payload = await readJson(request);
      const brief = normalizeBrief(payload.brief);
      const artwork = decodeArt(payload.artDataUrl);
      const briefPath = path.join(sessionDirectory, "brief.json");
      let artPath = null;
      await atomicWrite(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
      if (artwork) {
        artPath = path.join(sessionDirectory, `uploaded-art${artwork.extension}`);
        await atomicWrite(artPath, artwork.data);
      }

      phase = "submitted";
      const event = {
        status: "submitted",
        briefPath,
        themeId: brief.id,
        backgroundMode: brief.background.source,
        designedFor: brief.appearance.designedFor,
        qualityScore: brief.quality.score,
        ...(artPath ? { artPath } : {}),
      };
      console.log(JSON.stringify(event));
      json(response, 200, event, options.waitForSubmit ? { connection: "close" } : {});
      if (options.waitForSubmit) setImmediate(closeServer);
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

server.on("error", (error) => { throw error; });
server.listen(options.port, "127.0.0.1", () => {
  const address = server.address();
  actualOrigin = `http://127.0.0.1:${address.port}`;
  const url = `${actualOrigin}/`;
  console.log(JSON.stringify({ ready: true, url, pid: process.pid, sessionId, agentConnected: options.waitForSubmit }));
  if (options.open && process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  if (options.waitForSubmit) {
    timeout = setTimeout(() => {
      phase = "timeout";
      console.log(JSON.stringify({ status: "timeout", sessionId }));
      closeServer();
    }, options.timeoutMs);
  }
});
