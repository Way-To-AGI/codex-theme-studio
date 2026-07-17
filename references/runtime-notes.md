# Runtime notes

- The official macOS bundle is normally `/Applications/ChatGPT.app` with bundle identifier `com.openai.codex`.
- The runtime launches the official executable with `--remote-debugging-address=127.0.0.1` and a loopback port. It never changes the app bundle.
- Default CDP port is 9335. Use a separate port and `--profile-path` for isolated QA without disturbing the primary Codex process.
- Persistent state and logs live under `~/Library/Application Support/CodexThemeStudio`.
- A running primary Codex without CDP is never restarted unless `--restart-existing` is present.
- The watch injector reapplies after renderer reloads and route changes. Only one Theme Studio watcher may own a port. Its loopback manager owns the mutable active-theme payload so theme changes do not restart the watcher or Codex.
- The web library, in-app `◐` control, and CLI use the same random-token control API. The control port binds only to `127.0.0.1`, accepts only themes returned by the validated theme scanner, and serializes switch operations.
- `native` removes theme CSS, artwork, and decorations while keeping the manager available. Full restore also removes the in-app control, stops the watcher, and deletes manager state.
- Restore validates the stored PID command before terminating the watcher, removes live CSS/DOM, and leaves accounts, threads, and app data unchanged.
- Only `app://` page targets are eligible. Exclude DevTools, external web pages, and diagnostic targets.
- If required anchors disappear, token CSS can remain usable but structural decoration must hide.
