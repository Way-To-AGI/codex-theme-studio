# Theme schema

The studio accepts a constrained JSON brief and compiles it into a manifest, CSS, and optional local artwork.

## Brief

```json
{
  "id": "aurora-focus",
  "name": "Aurora Focus",
  "mode": "dark",
  "direction": "aurora-glass",
  "palette": {
    "accent": "#72E6FF",
    "support": "#B78CFF",
    "surface": "#0D1420",
    "ink": "#F2F7FA"
  },
  "background": {
    "source": "builtin",
    "position": "center right",
    "veil": 0.72,
    "prompt": "quiet aurora over a glass observatory"
  },
  "shape": { "radius": 18, "shadow": "soft" },
  "decorations": {
    "density": "light",
    "sidebarWidget": { "enabled": true, "content": "quota", "title": "Focus mode", "caption": "System ready", "icon": "✦" },
    "cornerCard": { "enabled": true, "title": "Create calmly", "caption": "Ideas in motion", "icon": "A" }
  },
  "copy": { "tagline": "Build with clarity" }
}
```

Only `light` and `dark` modes are accepted. IDs use letters, digits, hyphens, and underscores. Colors use six-digit hex notation. Text fields are length-clamped and treated as plain text.

The compiler treats `mode` as the intended official Codex appearance. It may adjust an incompatible surface, ink, accent, or support color and records every change in `corrections`. Normalized briefs also include `appearance` and a `quality` report containing semantic contrast checks. These fields are optional when importing older schema-version-1 packages and are derived from `design.mode` when absent.

`background.source` is `builtin`, `upload`, `generated`, or `none`. Generated artwork is produced by the agent outside the HTML server and then supplied with `--art`. PNG, JPEG, and WebP are accepted. Artwork remains local and is copied into the theme directory.

`decorations.density` is `none`, `light`, or `standard`. The only supported templates are `sidebarWidget` and `cornerCard`; manifests cannot provide HTML, selectors, scripts, handlers, or arbitrary coordinates. `sidebarWidget.content` is `static` by default or `quota` for the trusted read-only remaining-quota view. Dynamic usage values are runtime state and are never serialized into the manifest or portable package.

## Compiled manifest

```json
{
  "schemaVersion": 1,
  "engine": "codex-theme-studio",
  "id": "aurora-focus",
  "displayName": "Aurora Focus",
  "version": "1.0.0",
  "css": "theme.css",
  "art": "background.webp",
  "design": {},
  "background": {},
  "decorations": {},
  "copy": {},
  "appearance": { "designedFor": "dark", "switchPolicy": "prompt" },
  "quality": { "score": 100, "grade": "excellent", "checks": [] },
  "corrections": [],
  "baseTheme": {}
}
```

The portable `.codex-theme` format is UTF-8 JSON with `format: "codex-theme"`, schema version 1, normalized manifest, full CSS, and optional Base64 artwork. Maximum serialized size is 30 MB.

Reject CSS containing `@import`, non-data `url(...)`, `javascript:`, `expression(`, `behavior:`, `-moz-binding`, or a `#root` rule. Reject artwork outside the theme directory during package loading.
