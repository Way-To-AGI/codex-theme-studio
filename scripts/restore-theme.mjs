#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.join(here, "runtime.mjs");
const stateRoot = path.join(os.homedir(), "Library", "Application Support", "CodexThemeStudio");
const statePath = path.join(stateRoot, "state.json");
let port = 9335;
let state = null;
try { state = JSON.parse(await fs.readFile(statePath, "utf8")); port = Number(state.port) || port; } catch { /* already restored */ }
if (state?.watcherPid) {
  const command = spawnSync("ps", ["-p", String(state.watcherPid), "-o", "command="], { encoding: "utf8" }).stdout.trim();
  if (command.includes(runtimePath) && command.includes("--watch")) {
    try { process.kill(state.watcherPid, "SIGTERM"); } catch { /* stale */ }
  }
}
await new Promise((resolve) => setTimeout(resolve, 220));
spawnSync(process.execPath, [runtimePath, "--remove", "--port", String(port), "--timeout-ms", "2500"], { stdio: "ignore" });
await fs.rm(statePath, { force: true });
console.log(JSON.stringify({ restored: true, port }, null, 2));
