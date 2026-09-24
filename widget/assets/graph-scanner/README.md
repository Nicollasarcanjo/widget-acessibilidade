# Bundled screen scanner

This source package is bundled with the `/widget` Codex skill. The skill invokes it locally through `widget/scripts/scan-project.mjs`; users do not need a separate npm installation or `npx` command.

The scanner analyzes source routes and controls, writes the SAM and directed graph under `.graph-scanner/`, and supports optional authenticated Chrome DOM capture through the included `extension/`. The skill wrapper always uses `--dry-run`, so scans stay in the target project and are never uploaded to the multi-project service.

## Runtime

- Node.js 20 or later
- Python 3.10 or later
- `uv` (prepared by the CLI when needed)

The engine uses Graphify's directed graph builder and canonical ID functions. See `UPSTREAM.md`, `vendor/graphify/`, and the extension's `vendor/AXE-LICENSE` for retained sources and licenses.
