#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTheme } from "./theme-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const indexPath = path.join(root, "assets", "studio", "index.html");

function parseArgs(argv) {
  const options = { port: 48761, open: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--no-open") options.open = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("Invalid port");
  return options;
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
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
  if (!dataUrl) return {};
  const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Uploaded artwork must be PNG, JPEG, or WebP");
  return { artData: Buffer.from(match[2], "base64"), artExtension: match[1].toLowerCase() === "jpeg" ? ".jpg" : `.${match[1].toLowerCase()}` };
}

const options = parseArgs(process.argv.slice(2));
const html = await fs.readFile(indexPath);
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${options.port}`);
  try {
    if (request.method === "GET" && url.pathname === "/") {
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
      json(response, 200, { ok: true, service: "codex-theme-studio" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/generate") {
      const payload = await readJson(request);
      const art = decodeArt(payload.artDataUrl);
      const result = await createTheme(payload.brief, art);
      json(response, 200, {
        created: true,
        id: result.manifest.id,
        manifestPath: result.manifestPath,
        cssPath: result.cssPath,
        artPath: result.artPath,
        contrast: result.manifest.baseTheme.contrast / 10,
        corrections: result.brief.corrections,
        pendingArtPrompt: result.brief.background.source === "generated" && !result.artPath ? result.brief.background.prompt : null,
      });
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

server.on("error", (error) => { throw error; });
server.listen(options.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${options.port}/`;
  console.log(JSON.stringify({ ready: true, url, pid: process.pid }, null, 2));
  if (options.open && process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
});
