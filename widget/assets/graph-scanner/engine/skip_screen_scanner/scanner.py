"""Extract a deterministic screen/action map and build it with Graphify."""

from __future__ import annotations

import json
import hashlib
import re
import unicodedata
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
INTERACTION_EVENTS = {"onClick", "onDoubleClick", "onKeyDown", "onKeyUp"}
DIALOG_TRIGGERS = {"dialogtrigger", "modaltrigger", "drawertrigger", "sheettrigger"}


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
    text = " ".join(_text(node, source) for node in _walk(element) if node.type == "jsx_text")
    text = " ".join(text.split())
    return text[:160] or attrs.get("id") or attrs.get("data-testid") or "Controle sem rótulo"


def _route_heading_label(root: Path, route_source: Path | None, owner_files: set[Path], source_cache: dict[Path, bytes]) -> str:
    """Use a page's literal heading as its display label and search alias."""
    ordered: list[Path] = []
    if route_source and route_source in source_cache:
        ordered.append(route_source)
        ordered.extend(sorted(_component_files(root, route_source, source_cache) - {route_source}))
    ordered.extend(sorted(owner_files - set(ordered)))
    for file in ordered:
        source = source_cache.get(file)
        if source is None:
            continue
        parser = Parser(_language(file))
        tree = parser.parse(source)
        for node in _walk(tree.root_node):
            if node.type not in {"jsx_element", "jsx_self_closing_element"}:
                continue
            opening = node if node.type == "jsx_self_closing_element" else node.child_by_field_name("open_tag")
            if opening is None:
                continue
            if _element_name(opening, source).split(".")[-1].lower() not in {"h1", "h2"}:
                continue
            label = _element_label(node, opening, _attribute_map(opening, source), source)
            if label and label != "Controle sem rótulo" and "{" not in label:
                return label[:160]
    return ""


def _literal_dest(attrs: dict[str, str], element_text: str, handler_targets: dict[str, str] | None = None) -> str | None:
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
    handler = attrs.get("onClick", attrs.get("onclick", ""))
    for handler_name in re.findall(r"\b([A-Za-z_$][\w$]*)\b", handler):
        if handler_name in (handler_targets or {}):
            return handler_targets[handler_name]
    return None


def _navigation_handler_targets(source: bytes) -> dict[str, str]:
    """Resolve named JSX handlers when their body contains a literal router target.

    This covers common ``onClick={goToSettings}`` patterns that a per-element
    scan cannot resolve from JSX alone. Only literal same-app paths are kept.
    """
    text = source.decode("utf-8", "replace")
    handlers: dict[str, str] = {}
    definitions = (
        re.finditer(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|([^;\n]+))", text),
        re.finditer(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}", text),
    )
    for matches in definitions:
        for match in matches:
            body = match.group(2) or match.group(3) or ""
            destination = _literal_dest({}, body)
            if destination:
                handlers[match.group(1)] = destination
    return handlers


def _dialog_binding(attrs: dict[str, str]) -> str:
    for key in ("open", "isOpen", "visible", "show"):
        value = attrs.get(key, "").strip()
        match = re.fullmatch(r"\{\s*([A-Za-z_$][\w$]*)\s*\}", value)
        if match:
            return match.group(1)
    return ""


def _is_dialog(tag_name: str, attrs: dict[str, str]) -> bool:
    short_tag = tag_name.split(".")[-1].lower()
    return (
        short_tag == "dialog"
        or attrs.get("role", "").lower() in {"dialog", "alertdialog"}
        or attrs.get("aria-modal", "").lower() == "true"
        or bool(re.search(r"(?:dialog(?:content)?|modal(?:content)?|drawer(?:content)?|sheetcontent)$", short_tag))
    )


def _dialog_label(element: Any, attrs: dict[str, str], source: bytes, fallback: str) -> str:
    for key in ("aria-label", "title"):
        if attrs.get(key) and attrs[key] != "true":
            return attrs[key][:160]
    for child in _walk(element):
        if child is element or child.type not in {"jsx_element", "jsx_self_closing_element"}:
            continue
        opening = child.child_by_field_name("open_tag") or child.child_by_field_name("self_closing_tag")
        if opening is None:
            continue
        tag = _element_name(opening, source).split(".")[-1].lower()
        if tag in {"h1", "h2", "legend", "dialogtitle", "modaltitle", "headertitle"}:
            label = _element_label(child, opening, _attribute_map(opening, source), source)
            if label and label != "Controle sem rótulo":
                return label[:160]
    return fallback


def _open_state_reference(attrs: dict[str, str], tag_name: str) -> str:
    tag = tag_name.split(".")[-1].lower()
    explicit_target = attrs.get("data-opens-dialog") or attrs.get("aria-controls")
    if tag in DIALOG_TRIGGERS or attrs.get("aria-haspopup", "").lower() in {"dialog", "true"}:
        return explicit_target or "*"
    handler = attrs.get("onClick", "").strip()
    if handler.startswith("{") and handler.endswith("}"):
        handler = handler[1:-1].strip()
    # Only trust a direct state setter with no additional calls or side effects.
    match = re.fullmatch(
        r"\(?\s*(?:\(\s*\)|[A-Za-z_$][\w$]*)\s*=>\s*([A-Za-z_$][\w$]*)\(\s*true\s*\)\s*\)?",
        handler.strip(),
    )
    if not match:
        return ""
    setter = match.group(1)
    if not setter.startswith("set") or len(setter) < 4:
        return ""
    return setter[3:4].lower() + setter[4:]


def _confirmed_open_state(attrs: dict[str, str], tag_name: str, state_variables: set[str]) -> bool:
    reference = _open_state_reference(attrs, tag_name)
    return reference == "*" or reference in state_variables


def _stable_key(*parts: str) -> str:
    value = "\x1f".join(unicodedata.normalize("NFKD", str(part or "")).encode("ascii", "ignore").decode().lower() for part in parts)
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


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
        path_title = route.strip("/").split("/")[-1].replace("-", " ").replace("_", " ").title() if route != "/" else "Início"
        heading = _route_heading_label(root, source_path, owners, source_cache)
        title = heading or path_title
        aliases = list(dict.fromkeys([route, path_title, heading] if heading else [route, path_title]))
        evidence = [{"source": "source-code", "filePath": str(source_path.relative_to(root)) if source_path else "", "line": 1}]
        entity_id = make_id("route", route)
        route_ids[route] = entity_id
        entity = {"id": entity_id, "type": "ROUTE", "name": title, "slug": make_id(title), "path": route,
                  "pageTitle": title, "aliases": aliases, "semanticLabels": aliases, "description": f"Tela mapeada para a rota {route}",
                  "confidence": 0.94 if heading else (0.9 if source_path else 0.45), "evidence": evidence,
                  "metadata": {"origin": "source-code", "routePattern": route}}
        entities.append(entity)
        graph_nodes.append({"id": entity_id, "label": title, "type": "ROUTE", "path": route,
                            "source_file": str(source_path.relative_to(root)) if source_path else ""})

    seen_controls: set[str] = set()
    modal_openers: list[dict[str, str]] = []
    modal_candidates: list[dict[str, Any]] = []
    for route, owner_files in sorted(route_files.items()):
        component_files: set[Path] = set()
        for file in owner_files:
            component_files |= _component_files(root, file, source_cache)
        handler_targets: dict[str, str] = {}
        for file in component_files:
            handler_targets.update(_navigation_handler_targets(source_cache[file]))
        for file in sorted(component_files):
            source = source_cache[file]
            parser = Parser(_language(file))
            tree = parser.parse(source)
            parsed_elements: list[dict[str, Any]] = []
            for element in _walk(tree.root_node):
                if element.type not in {"jsx_element", "jsx_self_closing_element"}:
                    continue
                opening = element if element.type == "jsx_self_closing_element" else (element.child_by_field_name("open_tag") or element.child_by_field_name("self_closing_tag"))
                if opening is None:
                    opening = next((child for child in element.named_children if child.type in {"jsx_opening_element", "jsx_self_closing_element"}), None)
                if opening is None:
                    continue
                tag_name = _element_name(opening, source)
                attrs = _attribute_map(opening, source)
                parsed_elements.append({
                    "node": element, "opening": opening, "tag": tag_name,
                    "attrs": attrs, "line": int(element.start_point.row) + 1,
                })

            dialogs: list[dict[str, Any]] = []
            for item in parsed_elements:
                if not _is_dialog(item["tag"], item["attrs"]):
                    continue
                attrs = item["attrs"]
                fallback = f"Diálogo em {route}"
                label = _dialog_label(item["node"], attrs, source, fallback)
                raw_id = attrs.get("id") or attrs.get("data-testid") or f"{file.relative_to(root)}:{item['line']}:{item['tag']}:{label}"
                state_id = make_id("ui-state", route, raw_id)
                selector = f"#{attrs['id']}" if attrs.get("id") else (f"[data-testid='{attrs['data-testid']}']" if attrs.get("data-testid") else "[role='dialog']")
                evidence = [{"source": "source-code", "filePath": str(file.relative_to(root)), "line": item["line"]}]
                state = {
                    "id": state_id, "type": "UI_STATE", "name": label, "slug": make_id(label), "path": route,
                    "route": route, "pageTitle": label, "description": f"Diálogo aberto sobre {route}",
                    "confidence": 0.88, "evidence": evidence,
                    "selector": selector, "cssSelector": selector,
                    "metadata": {"kind": "dialog", "route": route, "stateKey": raw_id, "cssSelector": selector,
                                 "openBinding": _dialog_binding(attrs), "componentType": item["tag"],
                                 "sourceFile": str(file.relative_to(root)), "line": item["line"], "origin": "source-code"},
                }
                entities.append(state)
                dialogs.append({**item, "id": state_id, "name": label, "binding": _dialog_binding(attrs), "stateKey": raw_id, "selector": selector})
                relationships.append({"source": route_ids[route], "target": state_id, "type": "CONTAINS", "confidence": 0.9,
                                      "evidence": evidence, "metadata": {"origin": "source-code", "uiState": True}})
                graph_nodes.append({"id": state_id, "label": label, "type": "UI_STATE", "path": route,
                                    "source_file": str(file.relative_to(root)), "source_location": f"L{item['line']}"})
                graph_edges.append({"source": route_ids[route], "target": state_id, "type": "CONTAINS", "confidence": 0.9,
                                    "source_file": str(file.relative_to(root))})

            for item in parsed_elements:
                element, tag_name, attrs = item["node"], item["tag"], item["attrs"]
                short_tag = tag_name.split(".")[-1].lower()
                role = attrs.get("role", "").lower()
                has_event = any(event in attrs for event in INTERACTION_EVENTS)
                has_focus = "tabIndex" in attrs or "tabindex" in attrs
                if short_tag not in CONTROL_TAGS and role not in {"button", "link", "menuitem"} and not has_event and not has_focus:
                    continue
                if short_tag == "input" and attrs.get("type", "").lower() == "password":
                    continue
                line = item["line"]
                control_label = _element_label(element, item["opening"], attrs, source)
                full_text = _text(element, source)
                target_route = _literal_dest(attrs, full_text, handler_targets)
                if target_route:
                    target_route = target_route.rstrip("/") or "/"
                containing_dialogs = [dialog for dialog in dialogs if element is not dialog["node"]
                                     and dialog["node"].start_byte <= element.start_byte
                                     and element.end_byte <= dialog["node"].end_byte]
                owner_state = min(containing_dialogs, key=lambda dialog: dialog["node"].end_byte - dialog["node"].start_byte) if containing_dialogs else None
                raw_id = attrs.get("id") or attrs.get("data-testid") or f"{file.relative_to(root)}:{line}:{tag_name}:{control_label}"
                control_id = make_id("control", route, raw_id)
                if control_id in seen_controls:
                    continue
                seen_controls.add(control_id)
                is_submit = short_tag == "button" and attrs.get("type", "").lower() == "submit"
                kind = "navigation" if target_route else ("submit" if is_submit else ("fill" if short_tag in {"input", "select", "textarea"} else "action"))
                selector = f"#{attrs['id']}" if attrs.get("id") else (f"[data-testid='{attrs['data-testid']}']" if attrs.get("data-testid") else "")
                evidence = [{"source": "source-code", "filePath": str(file.relative_to(root)), "line": line}]
                open_reference = _open_state_reference(attrs, tag_name)
                matching_dialogs = []
                if open_reference == "*":
                    if len(dialogs) == 1:
                        matching_dialogs = dialogs
                elif open_reference:
                    matching_dialogs = [dialog for dialog in dialogs if open_reference in {dialog["binding"], dialog["stateKey"], dialog["id"]}]
                confirmed_open = bool(matching_dialogs)
                if confirmed_open:
                    kind = "open-state"
                elif dialogs and owner_state is None and has_event and short_tag not in {"a", "link"} and not is_submit:
                    modal_candidates.append({"route": route, "name": control_label, "selector": selector, "sourceFile": str(file.relative_to(root)),
                                             "line": line, "status": "not-captured", "reason": "No direct source binding to a dialog open state was confirmed."})
                feature_target = target_route or (matching_dialogs[0]["id"] if confirmed_open else "")
                feature_key = _stable_key(kind, feature_target or control_label.casefold(), feature_target)
                confidence = 0.98 if target_route else (0.92 if confirmed_open else 0.78)
                control = {"id": control_id, "type": "COMPONENT", "name": control_label, "slug": make_id(control_label),
                           "route": route, "selector": selector, "cssSelector": selector, "accessibleName": control_label,
                           "confidence": confidence, "evidence": evidence,
                           "metadata": {"kind": kind, "componentType": tag_name, "route": route, "targetRoute": target_route or "",
                                        "intent": "navigate" if target_route else ("open-state" if confirmed_open else kind), "sourceFile": str(file.relative_to(root)),
                                        "line": line, "origin": "source-code", "featureKey": feature_key,
                                        "navigationConfirmed": bool(target_route), "dialogOpenConfirmed": confirmed_open,
                                        "cssSelector": selector, "uiStateId": owner_state["id"] if owner_state else ""}}
                entities.append(control)
                owner_id = owner_state["id"] if owner_state else route_ids[route]
                relationships.append({"source": owner_id, "target": control_id, "type": "CONTAINS", "confidence": 0.95,
                                      "evidence": evidence, "metadata": {"origin": "source-code"}})
                graph_nodes.append({"id": control_id, "label": control_label, "type": "COMPONENT", "source_file": str(file.relative_to(root)), "source_location": f"L{line}"})
                graph_edges.append({"source": owner_id, "target": control_id, "type": "CONTAINS", "confidence": 0.95,
                                    "source_file": str(file.relative_to(root))})
                for dialog in matching_dialogs:
                    relationships.append({"source": control_id, "target": dialog["id"], "type": "OPENS", "confidence": 0.95,
                                          "evidence": evidence, "metadata": {"origin": "source-code", "confirmed": True}})
                    graph_edges.append({"source": control_id, "target": dialog["id"], "type": "OPENS", "confidence": 0.95,
                                        "source_file": str(file.relative_to(root))})
                    modal_openers.append({"route": route, "targetStateId": dialog["id"], "stateName": dialog["name"],
                                          "stateSelector": dialog["selector"], "name": control_label, "tag": short_tag, "selector": selector,
                                          "sourceFile": str(file.relative_to(root)), "line": line, "confirmed": True})
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
                        "sourceFiles": [str(path.relative_to(root)) for path in files], "routeCount": len(route_files),
                        "uncapturedDialogCandidates": modal_candidates}}
    result = {"sam": sam, "graph": graphify_graph, "sourceFiles": [str(path.relative_to(root)) for path in files],
              "routePaths": sorted(route_ids), "modalOpeners": modal_openers, "modalCandidates": modal_candidates, "scannerVersion": "0.1.0"}
    if output_dir:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / ".skip-sam.json").write_text(json.dumps(sam, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "graph.json").write_text(json.dumps(graphify_graph, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "scan-source-files.json").write_text(json.dumps(result["sourceFiles"], ensure_ascii=False, indent=2), encoding="utf-8")
    return result
