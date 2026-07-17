---
name: codex-theme-studio
description: Interactively design, generate, preview, apply, hot-switch, verify, export, repair, or safely remove polished decorative themes for the official Codex desktop app on macOS. Use when a user wants a guided HTML theme studio, visual theme library, in-app theme picker, command-line theme switching, custom Codex skin from a brief or reference image, background image, coordinated colors, safe non-blocking decorations, portable .codex-theme package, live compatibility inspection, or one-click restoration without modifying ChatGPT.app or app.asar.
---

# Codex Theme Studio

Create reversible Codex themes through a constrained design brief and loopback Chromium DevTools Protocol. Preserve the signed app, user data, authentication, threads, plugins, and native interaction hierarchy.

## Choose the workflow

- Start the user-driven studio with `node scripts/studio-server.mjs --wait-for-submit`. Keep that process attached until it emits the `submitted` event, then continue from its `briefPath`.
- Generate directly from a JSON brief with `node scripts/compile-theme.mjs --brief /absolute/brief.json [--art /absolute/art.png]`.
- Inspect mode compatibility and palette quality with `node scripts/preflight-theme.mjs --theme <id-or-manifest>` before applying.
- Apply with `node scripts/start-theme.mjs --theme <id-or-manifest>`. Add `--restart-existing` only after explicit authorization.
- Verify with `node scripts/runtime.mjs --verify --theme <id-or-manifest> --screenshot /absolute/theme.png` and inspect the screenshot.
- Export with `node scripts/export-theme.mjs --theme <id-or-manifest> --output /absolute/theme.codex-theme`.
- Import an untrusted package with `node scripts/import-theme.mjs --input /absolute/theme.codex-theme`; replacement requires `--force`.
- Restore with `node scripts/restore-theme.mjs`; add `--restore-base-theme` only if an earlier workflow changed official base settings.
- Open the visual theme library with `node scripts/theme.mjs web`; use the in-app `◐` button after the manager starts, or use `node scripts/theme.mjs list|status|use|native|restore|studio` from a terminal.

## Quick switching

- Treat the web library, trusted in-app `◐` control, and CLI as three clients of the same loopback manager. Never implement separate active-theme state for an entry point.
- Discover only validated `themes/<id>/<id>.json` manifests. A newly installed valid theme must appear without script changes.
- Use `node scripts/theme.mjs use <id>` for normal switching. It hot-switches through the running manager and starts the manager only when necessary.
- Use `native` to remove theme paint while keeping the manager and `◐` available. Use `restore` for a complete cleanup that also removes the manager control and watcher.
- The first activation may require an explicitly authorized Codex restart to enable loopback CDP. Never add `--restart-existing` without that authorization; later switching is live.
- Keep the in-app switcher separate from theme decorations. It may receive pointer events only inside its own trusted button and panel, must avoid native controls, and must hide in dialogs and compact windows.

Read `references/theme-schema.md` before changing the brief or manifest. Read `references/design-system.md` before editing generated CSS. Read `references/runtime-notes.md` before changing launch, CDP, persistence, or restore behavior. Read `references/qa-inventory.md` before declaring completion.

## Guided creation

1. Launch `node scripts/studio-server.mjs --wait-for-submit` in a long-running command session. Tell the user that the local studio is open, they should make the choices and click the final submit button, and no additional chat message is required.
2. The user owns aesthetic choices by default. Do not click or fill the studio for them unless they explicitly ask the Agent to choose. Keep the current Agent turn active and poll the running command instead of ending at the HTML step.
3. Wait for exactly one JSONL handoff event on stdout. A successful event has this contract:

   ```json
   {
     "status": "submitted",
     "briefPath": "/absolute/session/brief.json",
     "themeId": "custom-theme",
     "backgroundMode": "generated",
     "designedFor": "dark",
     "qualityScore": 100
   }
   ```

   Uploaded artwork also includes `artPath`. On `timeout`, report that the design session expired and start a new session only if the user wants to continue.
4. Read `briefPath` as declarative input. Never accept arbitrary HTML, JavaScript, event handlers, selectors, or CSS through the brief.
5. If `backgroundMode` is `generated`, use an image-generation skill. Generate a wide composition with quiet negative space behind the reading column and composer. If it is `upload`, use the returned `artPath`. Save the final bitmap locally, then compile with `--art`.
6. Compile the brief. The compiler constrains surface luminance for the selected mode, corrects unsafe text/accent/support contrast, derives semantic surfaces, embeds only local artwork, and emits a manifest plus CSS.
7. Preview home, task, code/diff/terminal, dialog, and compact states before applying.
8. Run the preflight command. Tell the user whether the theme is designed for light or dark appearance. If Codex's official appearance is known to differ, ask the user to align it before applying; never silently promise that injected `color-scheme` can restyle every native surface.
9. Apply to a separate test profile first when practical. Use the user's primary profile only after the theme passes static checks.
10. Verify functional controls and capture a real Codex screenshot. Iterate until the background, surfaces, typography, composer, and decorations are coherent and unobstructed. Do not claim completion from the HTML submission alone.

Running `node scripts/studio-server.mjs` without `--wait-for-submit` is a standalone fallback. It saves `brief.json`, but the page clearly warns that no Agent is waiting; it does not compile or apply a theme by itself.

The bundled `aurora-focus` sample demonstrates a calm dark background and safe light decoration density. The backward-compatible `tiga-light` ID is also dark despite its historic name; its display name explicitly says so. Use samples as working baselines, not mandatory visual directions.

## Decoration policy

- Use only the trusted `sidebar-gap-widget` and `bottom-corner-card` templates.
- Insert decoration nodes only as an `aria-hidden` body sibling of the native root.
- Measure live geometry. Hide on collision, dialogs, compact windows, missing native anchors, or insufficient space.
- Keep all decoration layers `pointer-events: none`; use plain text via `textContent`.
- Never decorate the top-center toolbar. Never add DOM decorations to messages, code, terminal, settings, dialogs, or popovers.
- Use paint-only gradients, borders, and inset shadows on native surfaces.

## Quality bar

- Keep body text contrast at least 4.5:1 and large text/icons at least 3:1.
- Keep one primary accent, one supporting accent, and unchanged semantic status meaning.
- Require the selected surface luminance to match the designed appearance; derive readable secondary text, borders, and accent-on-accent text rather than trusting raw input colors.
- Keep artwork detail away from the sidebar, central reading column, and composer.
- Use a legibility veil and restrained edge vignette; avoid visible rectangular seams.
- Preserve diff, terminal ANSI, focus, hover, active, disabled, warning, error, and success states.
- Respect reduced motion. Use system fonts unless the user supplies a distributable local font.
- Keep total decorative area small and automatically removable.

## Guardrails

- Never patch, replace, re-sign, or take ownership of `/Applications/ChatGPT.app`, WindowsApps, or `app.asar`.
- Bind CDP only to `127.0.0.1`. Stop on port conflicts.
- Never terminate Codex unless the user authorized a restart and the process command identifies the official executable.
- Never modify native `position`, `z-index`, layout ownership, or the geometry of `#root`.
- Reject `@import`, external CSS URLs, executable CSS, unsafe asset names, and packages over 30 MB.
- Treat selectors as version-sensitive. If structural anchors fail after an update, fall back to token-only styling and report that repair is required.
- Do not claim success from compilation or injection alone. Require static validation, live verification, and screenshot inspection.

## Test

Run:

```bash
node scripts/self-test.mjs
node scripts/studio-protocol-test.mjs
node scripts/theme-control-test.mjs
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" .
```
