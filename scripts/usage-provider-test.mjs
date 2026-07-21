#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { CodexUsageProvider, mergeRateLimitSnapshot, normalizeRateLimits } from "./usage-provider.mjs";

let checks = 0;
const snapshot = normalizeRateLimits({
  rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null },
  rateLimitsByLimitId: {
    codex: {
      limitId: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 2_000_000_000 },
      secondary: { usedPercent: 61, windowDurationMins: 10_080, resetsAt: 2_000_500_000 },
      credits: { hasCredits: true, unlimited: false, balance: "12.50" },
    },
  },
}, 1_700_000_000_000);
assert.equal(snapshot.status, "ready"); checks += 1;
assert.equal(snapshot.limitId, "codex"); checks += 1;
assert.equal(snapshot.primary.remainingPercent, 72); checks += 1;
assert.equal(snapshot.secondary.remainingPercent, 39); checks += 1;
assert.equal(snapshot.primary.resetsAt, 2_000_000_000_000); checks += 1;
assert.deepEqual(snapshot.credits, { hasCredits: true, unlimited: false }); checks += 1;
assert.equal(JSON.stringify(snapshot).includes("12.50"), false); checks += 1;

const merged = mergeRateLimitSnapshot({ limitId: "codex", primary: { usedPercent: 10, windowDurationMins: 300 } }, {
  limitId: null,
  primary: { usedPercent: 20, windowDurationMins: null },
});
assert.equal(merged.limitId, "codex"); checks += 1;
assert.deepEqual(merged.primary, { usedPercent: 20, windowDurationMins: 300 }); checks += 1;

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  let pending = "";
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.method === "initialize") queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`));
        if (message.method === "account/rateLimits/read") queueMicrotask(() => child.stdout.write(`${JSON.stringify({
          id: message.id,
          result: { rateLimits: { limitId: "codex", primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null } },
        })}\n`));
      }
      callback();
    },
  });
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit("exit", 0)); return true; };
  return child;
}

const updates = [];
const provider = new CodexUsageProvider({ executable: "/trusted/codex", spawnImpl: fakeSpawn, refreshMs: 60_000, onUpdate: (value) => updates.push(value) });
await provider.start();
assert.equal(provider.getSnapshot().primary.remainingPercent, 65); checks += 1;
provider.child.stdout.write(`${JSON.stringify({
  method: "account/rateLimits/updated",
  params: { rateLimits: { limitId: null, primary: { usedPercent: 42, windowDurationMins: null, resetsAt: null } } },
})}\n`);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(provider.getSnapshot().primary.remainingPercent, 58); checks += 1;
assert.equal(provider.getSnapshot().primary.windowDurationMins, 300); checks += 1;
assert.ok(updates.length >= 2); checks += 1;
provider.stop();
assert.equal(provider.child, null); checks += 1;

console.log(JSON.stringify({ pass: true, checks }, null, 2));
