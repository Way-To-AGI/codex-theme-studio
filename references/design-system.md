# Codex design system

## Stable layers

Override in this order:

1. Official primitive variables such as surface, text, icon, border, focus, warning, and error colors.
2. Semantic bridge variables such as sidebar, conversation, editor, input, list, terminal, and diff tokens.
3. Small stable hooks only where variables are insufficient.

Current stable hooks include `main.main-surface`, `aside.app-shell-left-panel`, `.composer-surface-chrome`, `[role="main"]`, `[data-app-shell-tabs="true"]`, `[data-thread-scroll-footer="true"]`, and the home marker `[role="main"]:has([data-testid="home-icon"])`. Treat all hooks as version-sensitive.

## Visual rules

- Keep the reading column close to Codex's native maximum width. Do not reshape task layout.
- Apply full artwork primarily to the home main surface. Use restrained gradients on normal task surfaces.
- Keep the central 48rem reading region low-detail. Place artwork subjects toward the outer right or upper edge.
- Keep dialogs, popovers, code, diff, and terminal surfaces more opaque than the surrounding canvas.
- Use one radius scale and one shadow system. Avoid glow on every component.
- Preserve native spacing, hit targets, focus rings, selection, scrollbars, and status semantics.
- Do not hide the native home icon, title, project selector, suggestion cards, composer, or task content.

## Safe selectors

Generated CSS may style the HTML theme marker, `body`, the main surface, left panel, composer chrome, app header divider, native buttons through state attributes, code/pre elements, dialogs, popovers, and the trusted decoration classes.

Generated CSS must not set `position`, `z-index`, `display`, `visibility`, `pointer-events`, `transform`, width, or height on native controls. It must not target `#root`.

## Contrast

Use WCAG relative luminance. Body copy requires 4.5:1 against its surface. Large text and icons require 3:1. The compiler replaces an unsafe ink color with a high-contrast neutral and records the correction in its result.

Validate the complete semantic matrix: body text/surface, body text/panel, secondary text/panel, accent/panel, support/panel, accent text/accent, and border/panel. Dark themes must keep the main surface in a genuinely dark luminance range; light themes must keep it in a genuinely light range. Prefer coherent automatic correction over preserving an unsafe raw color.

`color-scheme` is not a substitute for Codex's official appearance setting. Always report the theme's designed appearance before applying because version-sensitive native surfaces may remain outside the injected token bridge.
