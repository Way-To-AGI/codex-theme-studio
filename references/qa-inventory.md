# QA inventory

## Static

- Skill validation and `scripts/self-test.mjs` pass.
- Manifest ID/version match the live marker.
- CSS contains no external resources, executable CSS, `#root` rule, or native layout mutation.
- Artwork is local, decodable, and the exported package is at most 30 MB.
- Body text contrast is at least 4.5:1.

## Live functional

- A real main surface is present.
- Sidebar navigation, home suggestions, project selector, task content, and composer remain usable when present.
- At least five native interactive controls remain on an authenticated primary surface.
- No horizontal document overflow exists.
- Decorations are `aria-hidden`, pointer-inert, body siblings, and overlap zero interactive rectangles.
- Dialogs and compact windows hide decorations.
- Route changes and reloads retain the theme.
- Restore removes the marker, stylesheet, artwork URL, observer, timer, listeners, and decoration nodes.

## Visual

- Inspect home and a normal task at desktop width.
- Inspect code, diff, terminal, settings, dialog, popover, warning, error, success, disabled, hover, and focus states.
- Inspect a compact window.
- The background has a quiet reading zone and does not reduce composer legibility.
- Surface opacity is sufficient for text and code.
- Sidebar hierarchy and selected states remain obvious.
- Decorations feel intentional, remain small, and never cover native UI.
