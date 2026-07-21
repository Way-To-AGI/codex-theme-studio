# QA inventory

## Static

- Skill validation and `scripts/self-test.mjs` pass.
- `scripts/platform-runtime-test.mjs` passes, including Windows path, process, browser-open, and private-state contracts.
- `scripts/runtime-lifecycle-test.mjs` passes, including exact watcher matching, duplicate locks, graceful exit, validated escalation, and stale-lock recovery.
- Manifest ID/version match the live marker.
- CSS contains no external resources, executable CSS, `#root` rule, or native layout mutation.
- Artwork is local, decodable, and the exported package is at most 30 MB.
- Body text contrast is at least 4.5:1.
- Quota normalization clamps percentages, converts reset timestamps, preserves prior values across sparse null updates, and omits credit balances.

## Live functional

- A real main surface is present.
- Sidebar navigation, home suggestions, project selector, task content, and composer remain usable when present.
- At least five native interactive controls remain on an authenticated primary surface.
- No horizontal document overflow exists.
- Decorations are `aria-hidden`, pointer-inert, body siblings, and overlap zero interactive rectangles.
- Dialogs and compact windows hide decorations.
- Route changes and reloads retain the theme.
- Restore removes the marker, stylesheet, artwork URL, observer, timer, listeners, and decoration nodes.
- Web, in-app, and CLI clients report the same active theme and can hot-switch twice without restarting Codex.
- The in-app switcher is a body sibling with an accessible label, overlaps zero native controls, and hides in dialogs and compact windows.
- Native mode keeps only the trusted manager control; full restore removes both the theme and manager.
- Full restore waits for every exact matching watcher to exit, releases the control port and watcher lock, and never terminates the Codex process.
- A failed or unknown theme switch leaves the previous verified theme active.
- A quota-enabled theme shows primary and secondary remaining percentages when available, updates without reinjection, marks stale data, and renders an explicit unavailable state instead of fabricated values.
- The quota provider starts only for an active quota card, stops on static/native mode, and uses only read and update protocol methods.
- On Windows, app discovery rejects unsigned executables, state is under `%LOCALAPPDATA%` with private ACLs, and an unauthorized or failed graceful close never force-terminates Codex.

## Visual

- Inspect home and a normal task at desktop width.
- Inspect code, diff, terminal, settings, dialog, popover, warning, error, success, disabled, hover, and focus states.
- Inspect a compact window.
- The background has a quiet reading zone and does not reduce composer legibility.
- Surface opacity is sufficient for text and code.
- Sidebar hierarchy and selected states remain obvious.
- Decorations feel intentional, remain small, and never cover native UI.
