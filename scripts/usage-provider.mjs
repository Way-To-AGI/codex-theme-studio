import { spawn } from "node:child_process";

const READ_METHOD = "account/rateLimits/read";
const UPDATE_METHOD = "account/rateLimits/updated";
const STALE_AFTER_MS = 5 * 60 * 1000;

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function timestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function normalizeWindow(window) {
  const usedPercent = clampPercent(window?.usedPercent);
  if (usedPercent === null) return null;
  const duration = Number(window?.windowDurationMins);
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    resetsAt: timestampMs(window?.resetsAt),
  };
}

function mergePresent(previous, update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) return previous;
  const merged = { ...(previous && typeof previous === "object" ? previous : {}) };
  for (const [key, value] of Object.entries(update)) {
    if (value === null || value === undefined) continue;
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePresent(merged[key], value)
      : value;
  }
  return merged;
}

export function mergeRateLimitSnapshot(previous, update) {
  return mergePresent(previous, update);
}

function selectSnapshot(response) {
  const buckets = response?.rateLimitsByLimitId;
  if (buckets && typeof buckets === "object") {
    if (buckets.codex) return buckets.codex;
    const match = Object.entries(buckets).find(([id, value]) => /codex/i.test(id) || /codex/i.test(value?.limitId ?? ""));
    if (match) return match[1];
  }
  return response?.rateLimits ?? null;
}

export function normalizeRateLimits(response, now = Date.now()) {
  const selected = selectSnapshot(response);
  if (!selected) return { status: "unavailable", updatedAt: now, staleAt: now, reason: "rate-limits-unavailable" };
  const individualRemaining = clampPercent(selected.individualLimit?.remainingPercent);
  return {
    status: "ready",
    updatedAt: now,
    staleAt: now + STALE_AFTER_MS,
    limitId: selected.limitId ?? null,
    limitName: selected.limitName ?? null,
    primary: normalizeWindow(selected.primary),
    secondary: normalizeWindow(selected.secondary),
    individual: individualRemaining === null ? null : {
      remainingPercent: individualRemaining,
      resetsAt: timestampMs(selected.individualLimit?.resetsAt),
    },
    credits: selected.credits ? {
      hasCredits: selected.credits.hasCredits === true,
      unlimited: selected.credits.unlimited === true,
    } : null,
    reached: Boolean(selected.rateLimitReachedType || selected.spendControlReached),
  };
}

function unavailable(reason, previous = null, now = Date.now()) {
  if (previous?.status === "ready" || previous?.status === "stale") {
    return { ...previous, status: "stale", staleAt: Math.min(previous.staleAt ?? now, now), reason };
  }
  return { status: "unavailable", updatedAt: now, staleAt: now, reason };
}

export class CodexUsageProvider {
  constructor(options) {
    this.executable = options.executable;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.refreshMs = options.refreshMs ?? 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.now = options.now ?? Date.now;
    this.onUpdate = options.onUpdate ?? (() => {});
    this.snapshot = unavailable("not-started", null, this.now());
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
    this.buffer = "";
    this.rawSnapshot = null;
    this.refreshTimer = null;
    this.stopped = false;
  }

  getSnapshot() {
    if (this.snapshot.status === "ready" && this.now() >= this.snapshot.staleAt) {
      this.snapshot = { ...this.snapshot, status: "stale", reason: "refresh-overdue" };
    }
    return this.snapshot;
  }

  publish(snapshot) {
    this.snapshot = snapshot;
    this.onUpdate(this.getSnapshot());
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex usage channel is unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  handleMessage(message) {
    if (message && Object.hasOwn(message, "id")) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || "Codex usage request failed"));
      else entry.resolve(message.result);
      return;
    }
    if (message?.method === UPDATE_METHOD && message.params?.rateLimits) {
      this.rawSnapshot = mergeRateLimitSnapshot(this.rawSnapshot, message.params.rateLimits);
      this.publish(normalizeRateLimits({ rateLimits: this.rawSnapshot }, this.now()));
    }
  }

  handleData(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { this.handleMessage(JSON.parse(line)); } catch { /* Ignore non-protocol output. */ }
    }
  }

  rejectPending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  async refresh() {
    try {
      const response = await this.request(READ_METHOD);
      this.rawSnapshot = selectSnapshot(response);
      this.publish(normalizeRateLimits(response, this.now()));
      return true;
    } catch {
      this.publish(unavailable("read-failed", this.snapshot, this.now()));
      return false;
    }
  }

  async start() {
    if (this.child) return this.getSnapshot();
    this.stopped = false;
    try {
      this.child = this.spawnImpl(this.executable, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      this.child.stdout.on("data", (chunk) => this.handleData(chunk));
      this.child.once("error", () => this.publish(unavailable("provider-error", this.snapshot, this.now())));
      this.child.once("exit", () => {
        this.child = null;
        this.rejectPending(new Error("Codex usage provider exited"));
        if (!this.stopped) this.publish(unavailable("provider-exited", this.snapshot, this.now()));
      });
      await this.request("initialize", {
        clientInfo: { name: "codex-theme-studio", title: "Codex Theme Studio", version: "1.0.0" },
        capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [] },
      });
      this.write({ method: "initialized" });
      await this.refresh();
      this.refreshTimer = setInterval(() => this.refresh(), this.refreshMs);
    } catch {
      this.publish(unavailable("provider-unavailable", this.snapshot, this.now()));
      this.stop();
    }
    return this.getSnapshot();
  }

  stop() {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.rejectPending(new Error("Codex usage provider stopped"));
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill("SIGTERM");
  }
}
