import fs from "node:fs/promises";
import path from "node:path";
import { commandFor, processRows, securePrivateFile } from "./platform-runtime.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function watcherLockPath(statePath, port) {
  return path.join(path.dirname(statePath), `watcher-${port}.lock`);
}

export function isThemeWatcherCommand(command, runtimePath, port) {
  const source = String(command ?? "");
  const runtimePattern = new RegExp(`(?:^|[\\s\"'])${escaped(runtimePath)}(?:[\\s\"']|$)`, "i");
  const portPattern = new RegExp(`(?:^|\\s)--port(?:=|\\s+)${Number(port)}(?:\\s|$)`);
  return runtimePattern.test(source) && /(?:^|\s)--watch(?:\s|$)/.test(source) && portPattern.test(source);
}

export function themeWatcherPids(runtimePath, port, options = {}) {
  const rows = (options.processRowsImpl ?? processRows)(options);
  return rows.filter((row) => isThemeWatcherCommand(row.command, runtimePath, port)).map((row) => row.pid);
}

export async function waitForProcessExit(pid, options = {}) {
  const command = options.commandForImpl ?? commandFor;
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  while (Date.now() < deadline) {
    if (!command(pid, options)) return true;
    await (options.sleepImpl ?? sleep)(options.pollMs ?? 100);
  }
  return !command(pid, options);
}

export async function stopThemeWatcher(pid, runtimePath, port, options = {}) {
  const command = options.commandForImpl ?? commandFor;
  const kill = options.killImpl ?? process.kill.bind(process);
  if (!isThemeWatcherCommand(command(pid, options), runtimePath, port)) return false;
  try { kill(pid, "SIGTERM"); } catch { return true; }
  if (await waitForProcessExit(pid, { ...options, timeoutMs: options.graceMs ?? 5000 })) return true;
  if (!isThemeWatcherCommand(command(pid, options), runtimePath, port)) return true;
  try { kill(pid, "SIGKILL"); } catch { /* already stopped */ }
  if (!await waitForProcessExit(pid, { ...options, timeoutMs: options.killMs ?? 2000 })) {
    throw new Error(`Theme Studio watcher ${pid} did not stop`);
  }
  return true;
}

export async function stopThemeWatchers(runtimePath, port, options = {}) {
  const excludePid = Number(options.excludePid) || null;
  const pids = themeWatcherPids(runtimePath, port, options).filter((pid) => pid !== excludePid);
  for (const pid of pids) await stopThemeWatcher(pid, runtimePath, port, options);
  return pids;
}

export async function acquireWatcherLock(statePath, port, options = {}) {
  const filename = watcherLockPath(statePath, port);
  const runtimePath = options.runtimePath;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(filename, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() })}\n`, "utf8");
      await handle.close();
      await securePrivateFile(filename);
      return filename;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = null;
      try { owner = JSON.parse(await fs.readFile(filename, "utf8")); } catch { /* stale lock */ }
      const command = options.commandForImpl ?? commandFor;
      if (owner?.pid && isThemeWatcherCommand(command(owner.pid, options), runtimePath, port)) {
        throw new Error(`Theme Studio watcher already owns CDP port ${port} (PID ${owner.pid})`);
      }
      await fs.rm(filename, { force: true });
    }
  }
  throw new Error(`Unable to acquire Theme Studio watcher lock for port ${port}`);
}

export async function releaseWatcherLock(filename) {
  if (!filename) return;
  let owner = null;
  try { owner = JSON.parse(await fs.readFile(filename, "utf8")); } catch { return; }
  if (owner.pid === process.pid) await fs.rm(filename, { force: true });
}
