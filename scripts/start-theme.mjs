#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadTheme } from "./theme-core.mjs";
import { commandFor, findOfficialApp, officialAppPids, requestOfficialAppQuit, securePrivateDirectory, securePrivateFile, statePathFor, stateRootFor } from "./platform-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.join(here, "runtime.mjs");
const stateRoot = stateRootFor();
const statePath = statePathFor();

function parseArgs(argv) {
  const options = { theme: null, port: 9335, profilePath: null, appPath: null, restartExisting: false, foreground: false, screenshot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--theme") options.theme = argv[++index];
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--profile-path") options.profilePath = path.resolve(argv[++index]);
    else if (arg === "--app-path") options.appPath = path.resolve(argv[++index]);
    else if (arg === "--restart-existing") options.restartExisting = true;
    else if (arg === "--foreground") options.foreground = true;
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.theme) throw new Error("--theme is required");
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("Invalid port");
  return options;
}

async function cdpReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return false;
    return (await response.json()).some((item) => item.type === "page" && String(item.url).startsWith("app://"));
  } catch { return false; }
}

function stopPreviousWatcher(state) {
  if (!state?.watcherPid) return;
  const command = commandFor(state.watcherPid);
  if (command.includes(runtimePath) && command.includes("--watch")) {
    try { process.kill(state.watcherPid, "SIGTERM"); } catch { /* stale */ }
  }
}

async function waitReady(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpReady(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Codex did not expose CDP on port ${port}`);
}

function runRuntime(args, options = {}) {
  return spawn(process.execPath, [runtimePath, ...args], { stdio: options.stdio ?? "inherit", detached: options.detached ?? false });
}

async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function assertLoopbackPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => reject(error.code === "EADDRINUSE"
      ? new Error(`Port ${port} is already in use by a non-Codex service`)
      : error));
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

const options = parseArgs(process.argv.slice(2));
const theme = await loadTheme(options.theme);
const appearance = theme.manifest.appearance ?? {
  designedFor: theme.manifest.design?.mode ?? theme.manifest.baseTheme?.mode ?? "light",
  switchPolicy: "prompt",
};
console.log(JSON.stringify({
  status: "appearance-reminder",
  themeId: theme.manifest.id,
  designedFor: appearance.designedFor,
  message: appearance.designedFor === "dark"
    ? "This theme is designed for dark appearance. Keep Codex in dark mode to avoid mixed native surfaces."
    : "This theme is designed for light appearance. Keep Codex in light mode to avoid mixed native surfaces.",
}));
await securePrivateDirectory(stateRoot);
let previousState = null;
try { previousState = JSON.parse(await fs.readFile(statePath, "utf8")); } catch { /* first run */ }
stopPreviousWatcher(previousState);

if (!(await cdpReady(options.port))) {
  await assertLoopbackPortAvailable(options.port);
  const executable = await findOfficialApp({ explicitPath: options.appPath ?? process.env.CODEX_THEME_STUDIO_APP_PATH });
  if (officialAppPids(executable).length && !options.profilePath && !options.restartExisting) {
    throw new Error("Codex is already running without Theme Studio CDP. Close it or rerun with --restart-existing after explicit authorization.");
  }
  if (options.restartExisting && !options.profilePath && officialAppPids(executable).length) {
    requestOfficialAppQuit(executable);
    const deadline = Date.now() + 10000;
    while (officialAppPids(executable).length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    if (officialAppPids(executable).length) throw new Error("Codex did not quit cleanly; refusing to force terminate it");
  }
  const appArgs = [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${options.port}`];
  if (options.profilePath) {
    await fs.mkdir(options.profilePath, { recursive: true });
    appArgs.push(`--user-data-dir=${options.profilePath}`);
  }
  const log = await fs.open(path.join(stateRoot, "app.log"), "a");
  const child = spawn(executable, appArgs, { detached: true, stdio: ["ignore", log.fd, log.fd] });
  child.unref();
  await waitReady(options.port);
}

const controlPort = await freeLoopbackPort();
const controlToken = crypto.randomBytes(32).toString("hex");
const controlArgs = ["--control-port", String(controlPort), "--control-token", controlToken, "--state-path", statePath];

if (options.foreground) {
  const child = runRuntime(["--watch", "--port", String(options.port), "--theme", theme.manifestPath, ...controlArgs]);
  await new Promise((resolve) => child.on("exit", resolve));
  process.exit(0);
}

const out = await fs.open(path.join(stateRoot, "watcher.log"), "a");
const err = await fs.open(path.join(stateRoot, "watcher-error.log"), "a");
const watcher = runRuntime(["--watch", "--port", String(options.port), "--theme", theme.manifestPath, ...controlArgs], { detached: true, stdio: ["ignore", out.fd, err.fd] });
watcher.unref();
await fs.writeFile(statePath, `${JSON.stringify({
  port: options.port,
  watcherPid: watcher.pid,
  theme: theme.manifestPath,
  activeTheme: theme.manifest.id,
  controlPort,
  controlToken,
  managerUrl: `http://127.0.0.1:${controlPort}/#${controlToken}`,
  profilePath: options.profilePath,
  startedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
await securePrivateFile(statePath);

let verified = false;
const verifyMode = options.profilePath ? "--smoke" : "--verify";
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const args = [runtimePath, verifyMode, "--port", String(options.port), "--theme", theme.manifestPath, "--timeout-ms", "5000"];
  const check = spawnSync(process.execPath, args, { stdio: "ignore", timeout: 7000 });
  if (check.status === 0) { verified = true; break; }
}
if (!verified) {
  stopPreviousWatcher({ watcherPid: watcher.pid });
  await fs.rm(statePath, { force: true });
  throw new Error(`Theme was injected but live verification failed. See ${path.join(stateRoot, "watcher-error.log")}`);
}
if (options.screenshot) {
  let captured = false;
  for (let attempt = 0; attempt < 3 && !captured; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
    const capture = spawnSync(process.execPath, [runtimePath, verifyMode, "--port", String(options.port), "--theme", theme.manifestPath, "--timeout-ms", "15000", "--screenshot", options.screenshot], { stdio: "inherit", timeout: 20000 });
    captured = capture.status === 0;
  }
  if (!captured) console.warn(`Theme is active, but screenshot capture did not complete: ${options.screenshot}`);
}
console.log(JSON.stringify({ active: true, theme: theme.manifest.id, designedFor: appearance.designedFor, quality: theme.manifest.quality ?? null, port: options.port, watcherPid: watcher.pid, controlPort, webCommand: "node scripts/theme.mjs web", screenshot: options.screenshot }, null, 2));
