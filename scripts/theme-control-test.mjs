#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import { startThemeControl } from "./theme-control-server.mjs";

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close((error) => error ? reject(error) : resolve(port)); });
});
const port = await freePort();
const token = crypto.randomBytes(32).toString("hex");
let activeTheme = "aurora-focus";
let stopped = false;
const themes = [{ id: "aurora-focus", displayName: "Aurora Focus", version: "1.0.0", designedFor: "dark", hasArt: false }];
const control = await startThemeControl({
  port, token, listThemes: async () => themes, currentTheme: () => activeTheme,
  runtimeReady: () => true,
  switchTheme: async (id) => { if (!themes.some((item) => item.id === id)) throw new Error("Unknown theme"); activeTheme = id; return { activeTheme, themes }; },
  nativeTheme: async () => { activeTheme = null; return { activeTheme, themes, native: true }; },
  shutdownTheme: async () => { stopped = true; return { restored: true, stopped: true }; },
  readArtwork: async () => null,
});
try {
  const root = await fetch(`http://127.0.0.1:${port}/`); assert.equal(root.status, 200); assert.match(await root.text(), /Theme library|主题库/);
  const denied = await fetch(`http://127.0.0.1:${port}/api/themes`); assert.equal(denied.status, 403);
  const headers = { "x-cts-token": token };
  const listed = await fetch(`http://127.0.0.1:${port}/api/themes`, { headers }); assert.equal(listed.status, 200); const listedBody = await listed.json(); assert.equal(listedBody.activeTheme, "aurora-focus"); assert.equal(listedBody.runtimeReady, true);
  const unknown = await fetch(`http://127.0.0.1:${port}/api/switch`, { method:"POST", headers:{...headers,"content-type":"application/json"}, body:JSON.stringify({theme:"unknown"}) }); assert.equal(unknown.status, 400);
  const native = await fetch(`http://127.0.0.1:${port}/api/native`, { method:"POST", headers:{...headers,"content-type":"application/json"}, body:"{}" }); assert.equal((await native.json()).activeTheme, null);
  const shutdown = await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method:"POST", headers:{...headers,"content-type":"application/json"}, body:"{}" }); assert.equal(shutdown.status, 200); assert.equal(stopped, true);
  console.log(JSON.stringify({ pass: true, checks: 9 }, null, 2));
} finally { control.server.close(); }
