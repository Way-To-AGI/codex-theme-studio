#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codex-theme-studio-protocol-"));

function waitForJsonLine(child, predicate) {
  return new Promise((resolve, reject) => {
    let pending = "";
    const onData = (chunk) => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const value = JSON.parse(line);
          if (predicate(value)) {
            cleanup();
            resolve(value);
          }
        } catch {
          // Ignore non-protocol output.
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Studio server exited before protocol event (${code})`));
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

async function runSession(backgroundMode, artDataUrl = null, checkSecurity = false) {
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("./studio-server.mjs", import.meta.url)),
    "--port", "0",
    "--no-open",
    "--wait-for-submit",
    "--timeout-ms", "10000",
    "--output-root", temporary,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const ready = await waitForJsonLine(child, (value) => value.ready === true);
  assert.equal(ready.agentConnected, true);
  const html = await (await fetch(ready.url)).text();
  assert.doesNotMatch(html, /__CTS_SESSION_JSON__/);
  assert.match(html, /Agent direct creation|Agent 直接创作/);
  assert.match(html, /id="studioService"/);
  const sharedStyles = await fetch(`${ready.url}assets/studio-shell.css`);
  assert.equal(sharedStyles.status, 200);
  assert.match(await sharedStyles.text(), /\.cts-service-panel/);
  const match = /const studioSession=(\{[^;]+\});/.exec(html);
  assert.ok(match, "Studio session must be injected into the HTML");
  const session = JSON.parse(match[1]);
  assert.equal(session.agentConnected, true);

  const brief = {
    id: `protocol-${backgroundMode}`,
    name: `Protocol ${backgroundMode}`,
    mode: "dark",
    direction: "aurora-glass",
    palette: { accent: "#64DDF2", support: "#A58BFA", surface: "#0D1420", ink: "#F2F7FA" },
    background: { source: backgroundMode, prompt: "wide quiet composition" },
    decorations: { density: "light", sidebarWidget: { content: "quota" } },
  };

  if (checkSecurity) {
    const rejected = await fetch(`${ready.url}api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cts-token": "invalid" },
      body: JSON.stringify({ brief }),
    });
    assert.equal(rejected.status, 403);
  }

  const submittedPromise = waitForJsonLine(child, (value) => value.status === "submitted");
  const response = await fetch(`${ready.url}api/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cts-token": session.token,
      origin: new URL(ready.url).origin,
    },
    body: JSON.stringify({ brief, artDataUrl }),
  });
  assert.equal(response.status, 200);
  const responseEvent = await response.json();
  const stdoutEvent = await submittedPromise;
  assert.deepEqual(stdoutEvent, responseEvent);
  assert.equal(responseEvent.themeId, brief.id);
  assert.equal(responseEvent.backgroundMode, backgroundMode);
  assert.equal(responseEvent.designedFor, "dark");
  assert.equal(responseEvent.qualityScore, 100);
  assert.equal(path.basename(responseEvent.briefPath), "brief.json");
  const saved = JSON.parse(await fs.readFile(responseEvent.briefPath, "utf8"));
  assert.equal(saved.id, brief.id);
  assert.equal(saved.background.source, backgroundMode);
  assert.equal(saved.appearance.designedFor, "dark");
  assert.equal(saved.quality.grade, "excellent");
  assert.equal(saved.decorations.sidebarWidget.content, "quota");
  assert.ok(saved.quality.checks.every((check) => check.pass));
  if (artDataUrl) {
    assert.ok(responseEvent.artPath);
    assert.ok((await fs.stat(responseEvent.artPath)).size > 0);
  }
  if (child.exitCode === null) {
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
  } else {
    assert.equal(child.exitCode, 0);
  }
}

try {
  await runSession("generated", null, true);
  await runSession("upload", "data:image/png;base64,iVBORw0KGgo=", false);
  console.log(JSON.stringify({ pass: true, sessions: 2, checks: 36 }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
