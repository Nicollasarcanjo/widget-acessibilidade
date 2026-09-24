"""Extract a deterministic screen/action map and build it with Graphify."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterator

import networkx as nx
from tree_sitter import Language, Parser
import tree_sitter_javascript
import tree_sitter_typescript

from graphify.build import build_from_json
from graphify.ids import make_id

SOURCE_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
SKIP_DIRS = {".git", ".next", ".nuxt", "dist", "build", "coverage", "node_modules", "vendor"}
ROUTE_FILE_NAMES = {"page", "index"}
CONTROL_TAGS = {"a", "link", "navlink", "routerlink", "button", "input", "select", "textarea", "summary"}


def _language(path: Path) -> Language:
    if path.suffix == ".tsx":
        return Language(tree_sitter_typescript.language_tsx())
    if path.suffix == ".ts":
        return Language(tree_sitter_typescript.language_typescript())
    if path.suffix in {".jsx", ".js", ".mjs", ".cjs"}:
        return Language(tree_sitter_javascript.language())
    return Language(tree_sitter_typescript.language_tsx())


def _walk(node: Any) -> Iterator[Any]:
    yield node
    for child in node.children:
        yield from _walk(child)


def _text(node: Any, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", "replace")


def _route_from_file(root: Path, file: Path) -> str | None:
    rel = file.relative_to(root).with_suffix("")
    parts = list(rel.parts)
    if parts and parts[0] == "app":
        app_router = True
        parts = parts[1:]
    elif parts and parts[0] == "src" and len(parts) > 1 and parts[1] in {"app", "pages"}:
        app_router = parts[1] == "app"
        parts = parts[2:]
    elif parts and parts[0] == "pages":
        app_router = False
        parts = parts[1:]
    else:
        return None
    if parts and (parts[0] == "api" or parts[-1] in {"_app", "_document", "_error", "_middleware"}):
        return None
    if app_router and parts and parts[-1] in {"layout", "loading", "error", "not-found", "template", "default"}:
        return None
    if app_router and parts and parts[-1] == "route":
        return None
    if parts and parts[-1] in ROUTE_FILE_NAMES:
        parts.pop()
    parts = [part for part in parts if not (part.startswith("(") and part.endswith(")"))]
    route = "/" + "/".join(parts)
    route = re.sub(r"\[\[\.\.\.([^\]]+)\]\]", r"*\1", route)
    route = re.sub(r"\[(\.\.\.)?([^\]]+)\]", r":\2", route)
    return route.rstrip("/") or "/"


def _attribute_map(opening: Any, source: bytes) -> dict[str, str]:
    result: dict[str, str] = {}
    for child in opening.named_children:
        if child.type != "jsx_attribute" or not child.named_children:
            continue
        key = child.child_by_field_name("name") or child.named_children[0]
        value = child.child_by_field_name("value") or (child.named_children[1] if len(child.named_children) > 1 else None)
        if key is None:
            continue
        name = _text(key, source)
        if value is None:
            result[name] = "true"
            continue
        value_text = _text(value, source).strip()
        match = re.fullmatch(r"[\"'](.*?)[\"']", value_text, re.S)
        if match:
            result[name] = match.group(1)
        else:
            result[name] = value_text
    return result


def _element_name(opening: Any, source: bytes) -> str:
    name = opening.child_by_field_name("name")
    return _text(name, source) if name else ""


def _element_label(element: Any, opening: Any, attrs: dict[str, str], source: bytes) -> str:
    for key in ("aria-label", "title", "alt", "name", "placeholder"):
        if attrs.get(key) and attrs[key] != "true":
            return attrs[key][:160]
    inner = _text(element, source)
    text = re.sub(r"<[^>]*>|\{[^{}]*\}", " ", inner)
    text = " ".join(text.split())
    return text[:160] or attrs.get("id") or attrs.get("data-testid") or "Controle sem rótulo"


def _literal_dest(attrs: dict[str, str], element_text: str) -> str | None:
    destination = attrs.get("to") or attrs.get("href") or attrs.get("data-target-route")
    if destination and destination.startswith("/"):
        return destination.split("?", 1)[0].split("#", 1)[0] or "/"
    if "onClick" in attrs or "onclick" in attrs:
        handler = attrs.get("onClick", attrs.get("onclick", ""))
        for pattern in (
            r"(?:navigate|push|replace)\s*\(\s*['\"](/[^'\"]*)",
            r"(?:href|location\.pathname)\s*=\s*['\"](/[^'\"]*)",
        ):
            match = re.search(pattern, handler)
            if match:
                return match.group(1).split("?", 1)[0].split("#", 1)[0] or "/"
    for pattern in (
        r"(?:navigate|router\.push|router\.replace)\s*\(\s*['\"](/[^'\"]*)",
        r"(?:window\.location(?:\.href)?|location\.href)\s*=\s*['\"](/[^'\"]*)",
    ):
        match = re.search(pattern, element_text)
        if match:
            return match.group(1).split("?", 1)[0].split("#", 1)[0] or "/"
    return None


def _resolve_imports(root: Path, source_file: Path, source: bytes) -> set[Path]:
    related: set[Path] = set()
    text = source.decode("utf-8", "replace")
    for value in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", text):
        if not value.startswith("."):
            continue
        base = (source_file.parent / value).resolve()
        candidates = [base] if base.is_file() else []
        candidates.extend(Path(str(base) + ext) for ext in SOURCE_EXTENSIONS)
        candidates.extend(base / f"index{ext}" for ext in SOURCE_EXTENSIONS)
        for candidate in candidates:
            if candidate.is_file() and root in candidate.parents and candidate.suffix in SOURCE_EXTENSIONS:
                related.add(candidate)
                break
    return related


def _component_files(root: Path, route_file: Path, source_cache: dict[Path, bytes]) -> set[Path]:
    seen = {route_file}
    pending = [route_file]
    while pending:
        current = pending.pop()
        source = source_cache.get(current)
        if source is None:
            continue
        for imported in _resolve_imports(root, current, source):
            if imported not in seen:
                seen.add(imported)
                pending.append(imported)
    return seen


def scan_project(root_dir: str | Path, output_dir: str | Path | None = None) -> dict[str, Any]:
    root = Path(root_dir).resolve()
    if not root.is_dir():
        raise ValueError(f"Diretório de projeto não encontrado: {root}")
    files = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix in SOURCE_EXTENSIONS
        and not any(part in SKIP_DIRS for part in path.relative_to(root).parts)
    )
    source_cache = {path: path.read_bytes() for path in files}
    route_files: dict[str, set[Path]] = {}
    route_declarations: dict[str, Path] = {}
    for path in files:
        path_route = _route_from_file(root, path)
        if path_route:
            route_files.setdefault(path_route, set()).add(path)
            route_declarations.setdefault(path_route, path)

    # React Router route objects and JSX <Route path="..."> declarations.
    for path, source in source_cache.items():
        parser = Parser(_language(path))
        tree = parser.parse(source)
        for node in _walk(tree.root_node):
            if node.type not in {"jsx_opening_element", "jsx_self_closing_element"} or _element_name(node, source).split(".")[-1] != "Route":
                continue
            attrs = _attribute_map(node, source)
            route = attrs.get("path", "")
            if route.startswith("/"):
                route_files.setdefault(route.rstrip("/") or "/", set()).add(path)
                route_declarations.setdefault(route.rstrip("/") or "/", path)
        # React Router config objects are plain TS/JS objects rather than JSX elements.
        source_text = source.decode("utf-8", "replace")
        has_router_config = bool(re.search(r"\b(createBrowserRouter|createHashRouter|useRoutes|RouterProvider)\b|<Routes?\b", source_text))
        for match in (re.finditer(r"\bpath\s*:\s*(['\"])(/[^'\"]*)\1", source_text) if has_router_config else []):
            route = match.group(2).split("?", 1)[0].split("#", 1)[0]
            route_files.setdefault(route.rstrip("/") or "/", set()).add(path)
            route_declarations.setdefault(route.rstrip("/") or "/", path)

    if not route_files:
        route_files["/"] = set()

    # Next layouts and pages/_app contribute shared navigation controls to each screen.
    for owners in route_files.values():
        for page in tuple(owners):
            parts = page.relative_to(root).parts
            if parts[0] == "app":
                shell_root = root / "app"
                current = page.parent
                while current == shell_root or shell_root in current.parents:
                    for extension in SOURCE_EXTENSIONS:
                        shell = current / f"layout{extension}"
                        if shell in source_cache:
                            owners.add(shell)
                    if current == shell_root:
                        break
                    current = current.parent
            elif len(parts) > 1 and parts[0] == "src" and parts[1] == "app":
                shell_root = root / "src" / "app"
                current = page.parent
                while current == shell_root or shell_root in current.parents:
                    for extension in SOURCE_EXTENSIONS:
                        shell = current / f"layout{extension}"
                        if shell in source_cache:
                            owners.add(shell)
                    if current == shell_root:
                        break
                    current = current.parent
            elif parts[0] == "pages" or (len(parts) > 1 and parts[0] == "src" and parts[1] == "pages"):
                pages_root = root / (Path(*parts[:2]) if parts[0] == "src" else Path(parts[0]))
                for extension in SOURCE_EXTENSIONS:
                    shell = pages_root / f"_app{extension}"
                    if shell in source_cache:
                        owners.add(shell)

    entities: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []
    graph_nodes: list[dict[str, Any]] = []
    graph_edges: list[dict[str, Any]] = []
    route_ids: dict[str, str] = {}
    route_by_path = {route: route for route in route_files}

    for route, owners in sorted(route_files.items()):
        source_path = route_declarations.get(route)
        title = route.strip("/").split("/")[-1].replace("-", " ").replace("_", " ").title() if route != "/" else "Início"
        evidence = [{"source": "source-code", "filePath": str(source_path.relative_to(root)) if source_path else "", "line": 1}]
        entity_id = make_id("route", route)
        route_ids[route] = entity_id
        entity = {"id": entity_id, "type": "ROUTE", "name": title, "slug": make_id(title), "path": route,
                  "pageTitle": title, "aliases": [route], "description": f"Tela mapeada para a rota {route}",
                  "confidence": 0.9 if source_path else 0.45, "evidence": evidence,
                  "metadata": {"origin": "source-code", "routePattern": route}}
        entities.append(entity)
        graph_nodes.append({"id": entity_id, "label": title, "type": "ROUTE", "path": route,
                            "source_file": str(source_path.relative_to(root)) if source_path else ""})

    seen_controls: set[str] = set()
    for route, owner_files in sorted(route_files.items()):
        component_files: set[Path] = set()
        for file in owner_files:
            component_files |= _component_files(root, file, source_cache)
        for file in sorted(component_files):
            source = source_cache[file]
            parser = Parser(_language(file))
            tree = parser.parse(source)
            for element in _walk(tree.root_node):
                if element.type not in {"jsx_element", "jsx_self_closing_element"}:
                    continue
                opening = element.child_by_field_name("open_tag") or element.child_by_field_name("self_closing_tag")
                if opening is None:
                    opening = next((child for child in element.named_children if child.type in {"jsx_opening_element", "jsx_self_closing_element"}), None)
                if opening is None:
                    continue
                tag_name = _element_name(opening, source)
                short_tag = tag_name.split(".")[-1].lower()
                attrs = _attribute_map(opening, source)
                role = attrs.get("role", "").lower()
                if short_tag not in CONTROL_TAGS and role not in {"button", "link", "menuitem"}:
                    continue
                if short_tag == "input" and attrs.get("type", "").lower() == "password":
                    continue
                line = int(element.start_point.row) + 1
                control_label = _element_label(element, opening, attrs, source)
                full_text = _text(element, source)
                target_route = _literal_dest(attrs, full_text)
                if target_route:
                    target_route = target_route.rstrip("/") or "/"
                raw_id = attrs.get("id") or attrs.get("data-testid") or f"{file.relative_to(root)}:{line}:{tag_name}:{control_label}"
                control_id = make_id("control", route, raw_id)
                if control_id in seen_controls:
                    continue
                seen_controls.add(control_id)
                kind = "navigation" if target_route else ("input" if short_tag in {"input", "select", "textarea"} else "action")
                selector = f"#{attrs['id']}" if attrs.get("id") else (f"[data-testid='{attrs['data-testid']}']" if attrs.get("data-testid") else "")
                confidence = 0.98 if target_route else 0.78
                control = {"id": control_id, "type": "COMPONENT", "name": control_label, "slug": make_id(control_label),
                           "route": route, "selector": selector, "cssSelector": selector, "accessibleName": control_label,
                           "confidence": confidence, "evidence": [{"source": "source-code", "filePath": str(file.relative_to(root)), "line": line}],
                           "metadata": {"kind": kind, "componentType": tag_name, "route": route, "targetRoute": target_route or "",
                                        "intent": "navigate" if target_route else kind, "sourceFile": str(file.relative_to(root)),
                                        "line": line, "origin": "source-code", "navigationConfirmed": bool(target_route)}}
                entities.append(control)
                relationships.append({"source": route_ids[route], "target": control_id, "type": "CONTAINS", "confidence": 0.95,
                                      "evidence": control["evidence"], "metadata": {"origin": "source-code"}})
                graph_nodes.append({"id": control_id, "label": control_label, "type": "COMPONENT", "source_file": str(file.relative_to(root)), "source_location": f"L{line}"})
                graph_edges.append({"source": route_ids[route], "target": control_id, "type": "CONTAINS", "confidence": 0.95,
                                    "source_file": str(file.relative_to(root))})
                if target_route:
                    if target_route not in route_ids:
                        target_id = make_id("route", target_route)
                        route_ids[target_route] = target_id
                        title = target_route.strip("/").split("/")[-1].replace("-", " ").title() or "Início"
                        entities.append({"id": target_id, "type": "ROUTE", "name": title, "slug": make_id(title), "path": target_route,
                                         "aliases": [target_route], "confidence": 0.55, "evidence": control["evidence"],
                                         "metadata": {"origin": "source-code", "inferredFromControl": control_id}})
                        graph_nodes.append({"id": target_id, "label": title, "type": "ROUTE", "path": target_route,
                                            "source_file": str(file.relative_to(root))})
                    relationships.append({"source": control_id, "target": route_ids[target_route], "type": "NAVIGATES_TO", "confidence": 0.95,
                                          "evidence": control["evidence"], "metadata": {"origin": "source-code", "confirmed": True}})
                    graph_edges.append({"source": control_id, "target": route_ids[target_route], "type": "NAVIGATES_TO", "confidence": 0.95,
                                        "source_file": str(file.relative_to(root))})

    # Let Graphify construct the directed graph, then serialize that canonical graph beside the SAM.
    # build_from_json is the vendored base API; its canonical graph is exported beside the SAM.
    graph = build_from_json({"nodes": graph_nodes, "edges": graph_edges}, directed=True, root=root)
    graphify_graph = nx.node_link_data(graph, edges="edges")
    sam = {"schemaVersion": "1.0.0", "entities": entities, "relationships": relationships,
        "metadata": {"generator": "@acessibility/graph-scanner", "graphifyVersion": "0.9.67", "projectName": root.name,
                        "sourceFiles": [str(path.relative_to(root)) for path in files], "routeCount": len(route_files)}}
    result = {"sam": sam, "graph": graphify_graph, "sourceFiles": [str(path.relative_to(root)) for path in files],
              "routePaths": sorted(route_ids), "scannerVersion": "0.1.0"}
    if output_dir:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / ".skip-sam.json").write_text(json.dumps(sam, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "graph.json").write_text(json.dumps(graphify_graph, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "scan-source-files.json").write_text(json.dumps(result["sourceFiles"], ensure_ascii=False, indent=2), encoding="utf-8")
    return result
