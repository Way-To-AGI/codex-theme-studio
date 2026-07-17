#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listThemes, loadTheme } from "./theme-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(os.homedir(), "Library", "Application Support", "CodexThemeStudio", "state.json");
const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const jsonOutput = argv.includes("--json");
const restartExisting = argv.includes("--restart-existing");

async function state() { try { return JSON.parse(await fs.readFile(statePath, "utf8")); } catch { return {}; } }

async function control(route, body, timeout = 20000) {
  const current = await state();
  if (!Number.isInteger(current.controlPort) || typeof current.controlToken !== "string") throw new Error("Codex Theme Studio control service is not running");
  const response = await fetch(`http://127.0.0.1:${current.controlPort}/api/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-cts-token": current.controlToken, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Theme control returned HTTP ${response.status}`);
  return result;
}

function run(script, args, capture = false) {
  const result = spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${script} failed`).trim());
  return result.stdout;
}

async function waitControl() {
  let error;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { return await control("themes", undefined, 1500); }
    catch (reason) { error = reason; await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw error ?? new Error("Theme control did not become ready");
}

function print(value) {
  if (jsonOutput || typeof value !== "string") console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  else console.log(value);
}

if (command === "list") {
  const [themes, current] = await Promise.all([listThemes(), state()]);
  if (jsonOutput) print({ activeTheme: current.activeTheme ?? null, themes });
  else for (const theme of themes) console.log(`${theme.id === current.activeTheme ? "*" : " "} ${theme.id.padEnd(20)} ${theme.displayName} [${theme.designedFor}]`);
} else if (command === "status") {
  try { print({ running: true, ...(await control("themes")) }); }
  catch { const current = await state(); print({ running: false, activeTheme: current.activeTheme ?? null }); }
} else if (command === "use") {
  const id = argv[1]; if (!id || id.startsWith("--")) throw new Error("Usage: theme.mjs use <theme-id> [--restart-existing]");
  const theme = await loadTheme(id);
  let running = false;
  try { await control("themes"); running = true; } catch { /* start below */ }
  if (running) print(await control("switch", { theme: theme.manifest.id }));
  else {
    run("start-theme.mjs", ["--theme", theme.manifest.id, ...(restartExisting ? ["--restart-existing"] : [])]);
    print(await waitControl());
  }
} else if (command === "native") {
  try { print(await control("native", {})); }
  catch { run("restore-theme.mjs", []); print({ activeTheme: null, native: true }); }
} else if (command === "restore") {
  try { print(await control("shutdown", {})); }
  catch { run("restore-theme.mjs", []); print({ restored: true, stopped: true }); }
} else if (command === "web") {
  let running = false;
  try { await control("themes"); running = true; } catch { /* start below */ }
  if (running) { await control("open", {}); print({ opened: true }); }
  else {
    const themes = await listThemes();
    if (!themes.length) throw new Error("No valid themes are installed");
    const current = await state();
    const initial = themes.some((item) => item.id === current.activeTheme) ? current.activeTheme : themes[0].id;
    run("start-theme.mjs", ["--theme", initial, ...(restartExisting ? ["--restart-existing"] : [])]);
    await waitControl(); await control("open", {}); print({ opened: true, initialTheme: initial });
  }
} else if (command === "studio") {
  const child = spawn(process.execPath, [path.join(here, "studio-server.mjs"), "--port", "0"], { detached: true, stdio: "ignore" });
  child.unref(); print({ opened: true, pid: child.pid });
} else {
  console.log(`Codex Theme Studio CLI

  list [--json]                 List trusted themes
  status [--json]               Show manager status
  use <id> [--restart-existing] Apply or hot-switch a theme
  native                        Restore native appearance, keep manager
  restore                       Restore native appearance and stop manager
  web [--restart-existing]      Open the visual theme library
  studio                        Open the theme creation studio`);
}
