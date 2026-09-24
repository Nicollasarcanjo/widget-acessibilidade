# Graphify base

This package vendors Graphify from `Graphify-Labs/graphify` at version `0.9.67`
(commit `4c735618f3d56fd622c2049771584621c31ba9ff`).
The original source, Apache-2.0 license, retained MIT license, and upstream
notice are preserved under `vendor/graphify/`. UI route and control extraction
is implemented separately in `engine/skip_screen_scanner/` and uses Graphify's
directed graph builder and canonical node ID functions.

Upstream: https://github.com/Graphify-Labs/graphify

The Chrome extension bundles axe-core `4.13.0` under its Mozilla Public License;
the license text is kept at `extension/vendor/AXE-LICENSE`.
