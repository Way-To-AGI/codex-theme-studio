import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const WINDOWS_EXECUTABLES = new Set(["chatgpt.exe", "codex.exe"]);

function powershell(args, options = {}) {
  return (options.spawnSyncImpl ?? spawnSync)("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", ...args], {
    encoding: "utf8",
    windowsHide: true,
    ...options.spawnOptions,
  });
}

function assertPid(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) throw new Error(`Invalid process ID: ${pid}`);
  return Number(pid);
}

function normalizedWindowsPath(value) {
  return path.win32.normalize(String(value ?? "")).toLowerCase();
}

export function stateRootFor(platform = process.platform, environment = process.env, home = os.homedir()) {
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    return path.win32.join(localAppData, "CodexThemeStudio");
  }
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "CodexThemeStudio");
  return path.posix.join(environment.XDG_STATE_HOME || path.posix.join(home, ".local", "state"), "codex-theme-studio");
}

export function statePathFor(platform = process.platform, environment = process.env, home = os.homedir()) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.join(stateRootFor(platform, environment, home), "state.json");
}

export function parseWindowsProcessJson(output) {
  const trimmed = String(output ?? "").trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.pid ?? row.ProcessId),
    command: String(row.command ?? row.CommandLine ?? ""),
    executable: String(row.executable ?? row.ExecutablePath ?? ""),
  })).filter((row) => Number.isInteger(row.pid) && row.pid > 0);
}

export function processRows(options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.spawnSyncImpl ?? spawnSync;
  if (platform === "win32") {
    const script = "$items=Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('ChatGPT.exe','Codex.exe') } | Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='command';e={[string]$_.CommandLine}},@{n='executable';e={[string]$_.ExecutablePath}}; if($items){$items | ConvertTo-Json -Compress}";
    const result = powershell(["-Command", script], { spawnSyncImpl: run });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || "Unable to inspect Windows processes").trim());
    return parseWindowsProcessJson(result.stdout);
  }
  const result = run("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || "Unable to inspect processes").trim());
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
    .map((line) => ({ pid: Number(line.match(/^\d+/)?.[0]), command: line.replace(/^\d+\s+/, ""), executable: "" }))
    .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
}

export function commandFor(pid, options = {}) {
  const processId = assertPid(pid);
  const platform = options.platform ?? process.platform;
  const run = options.spawnSyncImpl ?? spawnSync;
  if (platform === "win32") {
    const script = `$item=Get-CimInstance Win32_Process -Filter 'ProcessId=${processId}'; if($item){[Console]::Out.Write([string]$item.CommandLine)}`;
    const result = powershell(["-Command", script], { spawnSyncImpl: run });
    if (result.error || result.status !== 0) return "";
    return String(result.stdout ?? "").trim();
  }
  return String(run("ps", ["-p", String(processId), "-o", "command="], { encoding: "utf8" }).stdout ?? "").trim();
}

export function officialAppPids(executable, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const expected = normalizedWindowsPath(executable);
    return processRows(options).filter((row) => normalizedWindowsPath(row.executable) === expected).map((row) => row.pid);
  }
  return processRows(options).filter((row) => /\/ChatGPT\.app\/Contents\/MacOS\/ChatGPT(?:\s|$)/.test(row.command)).map((row) => row.pid);
}

export function isAllowedWindowsExecutable(candidate) {
  return WINDOWS_EXECUTABLES.has(path.win32.basename(String(candidate ?? "")).toLowerCase());
}

function windowsInstallCandidates(environment = process.env) {
  const candidates = [];
  const localAppData = environment.LOCALAPPDATA;
  const programFiles = environment.ProgramFiles;
  if (localAppData) {
    candidates.push(
      path.win32.join(localAppData, "Programs", "ChatGPT", "ChatGPT.exe"),
      path.win32.join(localAppData, "Programs", "Codex", "Codex.exe"),
      path.win32.join(localAppData, "OpenAI", "ChatGPT", "ChatGPT.exe"),
      path.win32.join(localAppData, "OpenAI", "Codex", "Codex.exe"),
      path.win32.join(localAppData, "ChatGPT", "ChatGPT.exe"),
      path.win32.join(localAppData, "Codex", "Codex.exe"),
    );
  }
  if (programFiles) {
    candidates.push(path.win32.join(programFiles, "ChatGPT", "ChatGPT.exe"), path.win32.join(programFiles, "Codex", "Codex.exe"));
  }
  return candidates;
}

function appxCandidates(options = {}) {
  const script = "$packages=Get-AppxPackage | Where-Object { $_.Name -match 'OpenAI|ChatGPT|Codex' -or $_.Publisher -match 'OpenAI' }; $items=foreach($package in $packages){Get-ChildItem -LiteralPath $package.InstallLocation -File -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('ChatGPT.exe','Codex.exe') } | ForEach-Object { [pscustomobject]@{path=$_.FullName;publisher=[string]$package.Publisher} }}; if($items){$items | ConvertTo-Json -Compress}";
  const result = powershell(["-Command", script], options);
  if (result.error || result.status !== 0) return [];
  try {
    const parsed = JSON.parse(String(result.stdout ?? ""));
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({ path: String(item.path ?? ""), publisher: String(item.publisher ?? "") })).filter((item) => item.path);
  } catch { return []; }
}

function hasOfficialWindowsSignature(candidate, options = {}) {
  const script = "$signature=Get-AuthenticodeSignature -LiteralPath $args[0]; [pscustomobject]@{status=[string]$signature.Status;subject=[string]$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress";
  const result = powershell(["-Command", script, candidate], options);
  if (result.error || result.status !== 0) return false;
  try {
    const signature = JSON.parse(String(result.stdout ?? ""));
    return signature.status === "Valid" && /OpenAI/i.test(signature.subject);
  } catch { return false; }
}

export async function findOfficialApp(options = {}) {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const access = options.accessImpl ?? fs.access;
  if (platform === "darwin") {
    for (const candidate of ["/Applications/ChatGPT.app", path.join(options.home ?? os.homedir(), "Applications", "ChatGPT.app")]) {
      const executable = path.join(candidate, "Contents", "MacOS", "ChatGPT");
      try { await access(executable); return executable; } catch { /* continue */ }
    }
    throw new Error("Official Codex app was not found");
  }
  if (platform !== "win32") throw new Error(`Codex Theme Studio runtime is not supported on ${platform}`);
  const running = processRows(options).map((row) => row.executable).filter(Boolean);
  const records = [options.explicitPath, ...running, ...windowsInstallCandidates(environment)].filter(Boolean).map((candidate) => ({ path: candidate, publisher: "" }));
  records.push(...appxCandidates(options));
  const candidates = new Map();
  for (const record of records) {
    const normalized = normalizedWindowsPath(record.path);
    if (!normalized || !isAllowedWindowsExecutable(record.path)) continue;
    const previous = candidates.get(normalized);
    candidates.set(normalized, { path: record.path, publisher: record.publisher || previous?.publisher || "" });
  }
  for (const candidate of candidates.values()) {
    try { await access(candidate.path); } catch { continue; }
    const trustedPackage = /OpenAI/i.test(candidate.publisher);
    if (trustedPackage || hasOfficialWindowsSignature(candidate.path, options)) return path.win32.normalize(candidate.path);
  }
  throw new Error("Official signed Codex app was not found. Use --app-path with the installed ChatGPT.exe or Codex.exe.");
}

export function requestOfficialAppQuit(executable, options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.spawnSyncImpl ?? spawnSync;
  if (platform === "darwin") {
    return run("osascript", ["-e", "tell application id \"com.openai.codex\" to quit"], { stdio: "ignore" });
  }
  if (platform === "win32") {
    const script = "$target=[IO.Path]::GetFullPath($args[0]); Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target } | ForEach-Object { $process=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($process){$null=$process.CloseMainWindow()} }";
    return powershell(["-Command", script, executable], { spawnSyncImpl: run });
  }
  throw new Error(`Codex Theme Studio runtime is not supported on ${platform}`);
}

let cachedWindowsIdentity = null;

function windowsIdentity(options = {}) {
  if (options.identity) return options.identity;
  if (cachedWindowsIdentity) return cachedWindowsIdentity;
  const script = "[Console]::Out.Write([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)";
  const result = powershell(["-Command", script], options);
  const sid = String(result.stdout ?? "").trim();
  if (result.error) throw result.error;
  if (result.status !== 0 || !/^S-\d-(?:\d+-)+\d+$/.test(sid)) throw new Error("Unable to resolve the current Windows user SID");
  cachedWindowsIdentity = `*${sid}`;
  return cachedWindowsIdentity;
}

export async function securePrivateDirectory(directory, options = {}) {
  const platform = options.platform ?? process.platform;
  await fs.mkdir(directory, { recursive: true });
  if (platform === "win32") {
    const result = (options.spawnSyncImpl ?? spawnSync)("icacls.exe", [directory, "/inheritance:r", "/grant:r", `${windowsIdentity(options)}:(OI)(CI)F`], { encoding: "utf8", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || "Unable to secure Theme Studio state directory").trim());
  } else await fs.chmod(directory, 0o700);
}

export async function securePrivateFile(filename, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const result = (options.spawnSyncImpl ?? spawnSync)("icacls.exe", [filename, "/inheritance:r", "/grant:r", `${windowsIdentity(options)}:F`], { encoding: "utf8", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || "Unable to secure Theme Studio state file").trim());
  } else await fs.chmod(filename, 0o600);
}

export function openLoopbackUrl(value, options = {}) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Only loopback HTTP URLs may be opened");
  const platform = options.platform ?? process.platform;
  const run = options.spawnImpl ?? spawn;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "explorer.exe" : "xdg-open";
  const child = run(command, [url.href], { detached: true, stdio: "ignore", windowsHide: true });
  child.on?.("error", () => {});
  child.unref();
  return child;
}
