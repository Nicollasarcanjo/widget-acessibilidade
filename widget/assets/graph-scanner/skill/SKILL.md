---
name: skip-screen-graph
description: Build a local screen, control, and directed navigation graph for one application using the bundled screen scanner.
---

# Local screen graph

The parent `/widget` skill owns the complete workflow. Use `scripts/scan-project.mjs` from that skill to analyze the selected project. It invokes this scanner in local dry-run mode and converts the SAM to the widget route map.

The scanner vendors Graphify's AST graph builder and extracts UI-specific routes and controls. Review `.graph-scanner/.skip-sam.json` and `.graph-scanner/graph.json`. Never invent destinations: create `NAVIGATES_TO` only when source code or browser DOM supplies a concrete same-origin route.

Screens use `type: ROUTE`; controls use `type: COMPONENT`. Use `CONTAINS` from a route to each control and directed `NAVIGATES_TO` from a confirmed navigation control to its destination screen. Preserve evidence and confidence. Do not include source-code contents, secrets, password values, or values entered into forms.

The optional Chrome extension opens a dedicated tab and visits known same-origin routes. It does not submit forms or activate controls with unknown destinations. When browser capture is unavailable, report static coverage and WCAG status accurately; never imply that a static scan is a runtime audit.
