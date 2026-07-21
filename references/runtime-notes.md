# Runtime notes

- The official macOS bundle is normally `/Applications/ChatGPT.app` with bundle identifier `com.openai.codex`.
- The official Windows app may expose `ChatGPT.exe` or `Codex.exe`. Discovery accepts only an existing executable with a valid OpenAI Authenticode signature, checking a supplied `--app-path`, running official processes, common per-user installs, and registered AppX packages in that order.
- The runtime launches the official executable with `--remote-debugging-address=127.0.0.1` and a loopback port. It never changes the app bundle.
- Default CDP port is 9335. Use a separate port and `--profile-path` for isolated QA without disturbing the primary Codex process.
- Persistent state and logs live under `~/Library/Application Support/CodexThemeStudio` on macOS or `%LOCALAPPDATA%\CodexThemeStudio` on Windows. Unix permissions are `0700`/`0600`; Windows inheritance is removed and access is granted only to the current user.
- A running primary Codex without CDP is never restarted unless `--restart-existing` is present.
- Restart authorization requests a normal app close and waits up to ten seconds. It never force-terminates Codex; failure to close stops the workflow.
- The watch injector reapplies after renderer reloads and route changes. Only one Theme Studio watcher may own a port. Its loopback manager owns the mutable active-theme payload so theme changes do not restart the watcher or Codex.
- Manager health and renderer health are separate. `status` reports `managerRunning` and treats the theme runtime as running only while at least one eligible Codex renderer is connected; switching with zero renderers fails instead of recording a false success.
- The web library, in-app `◐` control, and CLI use the same random-token control API. The control port binds only to `127.0.0.1`, accepts only themes returned by the validated theme scanner, and serializes switch operations.
- A quota-enabled sidebar card starts a separate read-only client using the official bundled `codex app-server`. It requests `account/rateLimits/read`, merges sparse `account/rateLimits/updated` notifications, and stops when quota display is no longer active. No account token, credit balance, or mutable account method reaches the renderer.
- `native` removes theme CSS, artwork, and decorations while keeping the manager available. Full restore also removes the in-app control, stops the watcher, and deletes manager state.
- Restore validates the stored PID command before terminating the watcher, removes live CSS/DOM, and leaves accounts, threads, and app data unchanged.
- Only `app://` page targets are eligible. Exclude DevTools, external web pages, and diagnostic targets.
- If required anchors disappear, token CSS can remain usable but structural decoration must hide.
- Windows platform changes require both mocked platform tests and live validation on a real Windows Codex installation; macOS success does not prove Windows renderer compatibility.
