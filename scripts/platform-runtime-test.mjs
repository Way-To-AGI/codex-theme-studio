#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandFor, findOfficialApp, isAllowedWindowsExecutable, officialAppPids, openLoopbackUrl, parseWindowsProcessJson, processRows, requestOfficialAppQuit, securePrivateDirectory, securePrivateFile, statePathFor, stateRootFor } from "./platform-runtime.mjs";

let checks = 0;
const check = (condition) => { assert.ok(condition); checks += 1; };

assert.equal(stateRootFor("darwin", {}, "/Users/test"), "/Users/test/Library/Application Support/CodexThemeStudio"); checks += 1;
assert.equal(stateRootFor("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "C:\\Users\\test"), "C:\\Users\\test\\AppData\\Local\\CodexThemeStudio"); checks += 1;
assert.equal(statePathFor("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "C:\\Users\\test"), "C:\\Users\\test\\AppData\\Local\\CodexThemeStudio\\state.json"); checks += 1;
assert.equal(stateRootFor("linux", { XDG_STATE_HOME: "/var/state" }, "/home/test"), "/var/state/codex-theme-studio"); checks += 1;

const one = parseWindowsProcessJson('{"pid":42,"command":"ChatGPT.exe --flag","executable":"C:\\\\Apps\\\\ChatGPT.exe"}');
assert.equal(one.length, 1); checks += 1;
assert.equal(one[0].pid, 42); checks += 1;
const many = parseWindowsProcessJson('[{"ProcessId":7,"CommandLine":"Codex.exe","ExecutablePath":"C:\\\\Codex.exe"},{"ProcessId":0}]');
assert.equal(many.length, 1); checks += 1;
assert.equal(parseWindowsProcessJson("").length, 0); checks += 1;
check(isAllowedWindowsExecutable("C:\\Program Files\\ChatGPT\\ChatGPT.exe"));
check(isAllowedWindowsExecutable("C:\\Program Files\\Codex\\CODEX.EXE"));
assert.equal(isAllowedWindowsExecutable("C:\\Temp\\other.exe"), false); checks += 1;

const windowsProcessMock = () => ({ status: 0, stdout: '[{"pid":11,"command":"ChatGPT.exe","executable":"C:\\\\Apps\\\\ChatGPT.exe"}]', stderr: "" });
assert.equal(processRows({ platform: "win32", spawnSyncImpl: windowsProcessMock })[0].pid, 11); checks += 1;
assert.deepEqual(officialAppPids("c:\\apps\\CHATGPT.EXE", { platform: "win32", spawnSyncImpl: windowsProcessMock }), [11]); checks += 1;
assert.equal(commandFor(11, { platform: "win32", spawnSyncImpl: () => ({ status: 0, stdout: "node runtime.mjs --watch" }) }), "node runtime.mjs --watch"); checks += 1;

let opened = null;
openLoopbackUrl("http://127.0.0.1:9335/#token", {
  platform: "win32",
  spawnImpl: (command, args) => { opened = { command, args }; return { unref() {} }; },
});
assert.equal(opened.command, "explorer.exe"); checks += 1;
assert.equal(opened.args[0], "http://127.0.0.1:9335/#token"); checks += 1;
assert.throws(() => openLoopbackUrl("https://example.com", { spawnImpl: () => ({ unref() {} }) })); checks += 1;

let quitCommand = null;
requestOfficialAppQuit("C:\\Apps\\ChatGPT.exe", { platform: "win32", spawnSyncImpl: (command, args) => { quitCommand = { command, args }; return { status: 0 }; } });
assert.equal(quitCommand.command, "powershell.exe"); checks += 1;
check(quitCommand.args.includes("C:\\Apps\\ChatGPT.exe"));

let discoveryCall = 0;
const signedExecutable = await findOfficialApp({
  platform: "win32",
  explicitPath: "C:\\Apps\\ChatGPT.exe",
  environment: {},
  accessImpl: async (candidate) => { if (candidate !== "C:\\Apps\\ChatGPT.exe") throw new Error("missing"); },
  spawnSyncImpl: () => {
    discoveryCall += 1;
    if (discoveryCall <= 2) return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: '{"status":"Valid","subject":"CN=OpenAI, L.L.C."}', stderr: "" };
  },
});
assert.equal(signedExecutable, "C:\\Apps\\ChatGPT.exe"); checks += 1;

discoveryCall = 0;
const packagedExecutable = await findOfficialApp({
  platform: "win32",
  environment: {},
  accessImpl: async (candidate) => { if (candidate !== "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe") throw new Error("missing"); },
  spawnSyncImpl: () => {
    discoveryCall += 1;
    if (discoveryCall === 1) return { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: '{"path":"C:\\\\Program Files\\\\WindowsApps\\\\OpenAI.ChatGPT\\\\ChatGPT.exe","publisher":"CN=OpenAI, L.L.C."}', stderr: "" };
  },
});
assert.equal(packagedExecutable, "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\ChatGPT.exe"); checks += 1;
await assert.rejects(findOfficialApp({
  platform: "win32",
  explicitPath: "C:\\Apps\\ChatGPT.exe",
  environment: {},
  accessImpl: async (candidate) => { if (candidate !== "C:\\Apps\\ChatGPT.exe") throw new Error("missing"); },
  spawnSyncImpl: (() => {
    let call = 0;
    return () => ({ status: 0, stdout: ++call <= 2 ? "" : '{"status":"NotSigned","subject":""}', stderr: "" });
  })(),
}), /Official signed Codex app was not found/); checks += 1;

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codex-theme-platform-test-"));
try {
  const directory = path.join(temporary, "state");
  if (process.platform !== "win32") {
    await securePrivateDirectory(directory, { platform: "darwin" });
    const filename = path.join(directory, "state.json");
    await fs.writeFile(filename, "{}\n");
    await securePrivateFile(filename, { platform: "darwin" });
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700); checks += 1;
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600); checks += 1;
  }
  const aclCalls = [];
  const aclRun = (command, args) => { aclCalls.push({ command, args }); return { status: 0, stdout: "" }; };
  const windowsDirectory = path.join(temporary, "windows-state");
  await securePrivateDirectory(windowsDirectory, { platform: "win32", identity: "*S-1-5-21-1000", spawnSyncImpl: aclRun });
  const windowsFile = path.join(windowsDirectory, "state.json");
  await fs.writeFile(windowsFile, "{}\n");
  await securePrivateFile(windowsFile, { platform: "win32", identity: "*S-1-5-21-1000", spawnSyncImpl: aclRun });
  assert.equal(aclCalls.length, 2); checks += 1;
  assert.equal(aclCalls[0].command, "icacls.exe"); checks += 1;
  check(aclCalls[0].args.includes("*S-1-5-21-1000:(OI)(CI)F"));
  check(aclCalls[1].args.includes("*S-1-5-21-1000:F"));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }

console.log(JSON.stringify({ pass: true, checks }, null, 2));
