---
name: widget
description: Analyze a web app, scan its screens and safe navigation controls, and integrate the Skip accessibility widget into that app. Use when the user invokes /widget or asks to add the accessibility widget to the current project.
metadata:
  short-description: Scan and add the accessibility widget
---

# Widget for one application

Run this workflow in the user's current application repository. The skill repository is only a source of scanner and widget assets; never scan or modify the skill's own checkout when another project is the task target.

## Workflow

1. Identify the target root from the current workspace and confirm its framework, router, package manager, app start command, and existing global layout. Keep the changes inside that application.
2. Run the bundled static screen scanner and produce the widget's route map:

   ```bash
   node <path-to-this-skill>/scripts/scan-project.mjs <target-project>
   ```

   It runs the bundled Graphify-based scanner locally, writes reviewable evidence under `.graph-scanner/`, and creates `public/widget-screen-map.json`. It always uses dry-run mode: do not upload source code, map data, or findings to an external service. The scanner needs Node.js 20+ and Python 3.10+. It prepares its Python runtime if needed. Read `.graph-scanner/.skip-sam.json` and `public/widget-screen-map.json`; check route coverage, labels, selectors, confidence, evidence, and directed `NAVIGATES_TO` edges. Correct extraction gaps in the target code or scanner only when evidence supports the change.
3. Install the bundled widget component without overwriting an existing component:

   ```bash
   node <path-to-this-skill>/scripts/install-widget.mjs <target-project>
   ```

   Integrate `AccessibilityWidget` once in the app's persistent root layout so it is present across routes. Adapt the route subscription to the app's router, preserve the app's existing styles, and ensure the component's styles are bundled and isolated from unrelated application UI. Add only dependencies that are missing and required by the integration. Do not replace the app shell or create a marketing page.
4. Ensure the widget loads `/widget-screen-map.json` from the generated `public/` file. Keep only controls with a confirmed same-app destination as automated navigation steps. Never auto-submit forms, activate destructive controls, follow external links, or infer a destination from a button with an unknown handler.
5. Run the app's existing lint, typecheck, and build commands. Fix issues introduced by this integration. Run the scanner's Python unit tests when scanner code changed. Add or update tests for the target app's widget mount, route map, and navigation safety when its test setup supports them.
6. If a browser is available, use it to inspect the running app and capture rendered labels/content across same-origin screens; use the bundled Chrome extension only when needed for authenticated DOM/axe capture. Reuse an already authenticated browser session. Do not bypass login or click arbitrary controls. If authentication or first-time extension permission blocks capture, finish static analysis and integration, then ask only for the missing user action. Report uncaptured routes and WCAG status accurately.
7. Summarize files changed, detected screens/actions, scan coverage, checks run, and any dynamic or authenticated pages that could not be captured.

## Scanner and data rules

- The Graphify-based scanner is bundled under `assets/graph-scanner/`; invoke its local CLI through `scripts/scan-project.mjs`, without npm/npx installation or external upload.
- Keep scanner outputs in `.graph-scanner/` and the generated public route map. Do not commit secrets, cookies, form values, or user-entered data.
- Only replace `public/widget-screen-map.json` when its `generator` field is `widget-acessibilidade`. Preserve a pre-existing file owned by the application and explain the conflict.
- Source-derived and browser-observed evidence must remain distinguishable. Never claim that static analysis performed a runtime WCAG audit.
- The bundled Chrome extension visits only known same-origin routes and does not submit forms or click unknown controls. Respect the user's existing authentication and application access.

## License decision

Commercial integration is permitted. Do not block or defer installation because the host app has billing, subscriptions, paid plans, or revenue. The widget may be included as a feature in monetized apps and services without prior written authorization. Written authorization is only needed to sell, license, or charge separately for the widget or skills as independent products whose main value is the project itself. Keep `ACCESSIBILITY-WIDGET-LICENSE` with the installed component and preserve third-party notices.
