---
name: skip-screen-graph
description: Build and review a screen, control, and navigation graph with @acessibility/graph-scanner. Use when mapping application screens, buttons, links, or navigation paths.
---

# Skip Screen Graph

Use the deterministic scanner before manually inferring routes or controls:

```bash
npx @acessibility/graph-scanner scan . --token "$SKIP_PROJECT_TOKEN" --url "$SKIP_API_URL" --dry-run
```

The scanner vendors Graphify's AST graph builder and adds UI-specific route and control extraction. Review `.graph-scanner/.skip-sam.json` and `.graph-scanner/graph.json` after the dry run. Also review `public/widget-screen-map.json` when running through the `/widget` skill. Never invent a destination: only emit `NAVIGATES_TO` when source code or browser DOM provides a concrete destination.

## Entity and relation rules

- Screens use `type: ROUTE`, a stable `path`, a human-readable name, aliases, provenance, and confidence.
- Controls use `type: COMPONENT` and preserve their accessible label, CSS selector, control kind, owning route, source location, and provenance.
- Catalog every discovered screen, dialog, menu item, button, link, field, and submit control. Preserve control kind and owner even when there is no safe navigation edge, so the widget can offer it as a selectable action without treating it as a route.
- Use `CONTAINS` from a screen to each control it renders.
- Use directed `NAVIGATES_TO` from a navigation control to a known destination screen. A generic button with an unknown handler is not a navigation edge.
- Resolve named navigation handlers such as `onClick={goToSettings}` when their source definition contains a literal same-origin route. If static resolution is not conclusive, leave the edge absent and collect authenticated browser evidence instead.
- When a screen exists but has no incoming navigation edge, report a missing connection separately from a missing screen. Check the route declaration and visible navigation controls before concluding that no path exists.
- Record `source-code` or `browser-dom` in evidence and metadata. Keep observed and inferred confidence distinct.
- Do not include password values, input values, source code contents, or secrets in the graph or upload bundle.

## Authenticated browser capture

When DOM evidence is needed, ask the user to run the CLI with `--app-url`, load `extension/` as an unpacked Chrome extension, and pair it with the one-time code printed by the CLI. The extension opens a dedicated tab and visits known same-origin route paths. It does not click arbitrary page controls or submit forms. It records accessible labels and selectors, page text, and axe-core findings; it never reads values entered into form fields.

If a route is behind authentication, confirm the same Chrome profile is already signed in. If a page requires a workflow step rather than a direct route, report it as uncaptured instead of trying unknown actions.

## Review checklist

- Every relationship points to an entity present in the SAM.
- Dynamic route patterns are not treated as concrete URLs for browser crawling.
- Each control's route and selector match the screen where it was observed.
- Browser-only evidence updates source-derived entities without deleting source evidence.
- When no browser audit ran, report WCAG status as `not-run`; do not imply that zero findings means the page passed.
