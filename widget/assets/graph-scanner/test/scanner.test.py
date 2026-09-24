import json
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "vendor" / "graphify"))
from skip_screen_scanner.scanner import scan_project  # noqa: E402


class ScannerTests(unittest.TestCase):
    def test_next_routes_and_navigation_controls_are_extracted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app" / "settings").mkdir(parents=True)
            (root / "app" / "layout.tsx").write_text('export default function Layout({children}) { return <><a href="/settings">Menu</a>{children}</> }', encoding="utf-8")
            (root / "app" / "page.tsx").write_text('''import Link from "next/link";\nexport default function Home() { return <main><Link href="/settings" aria-label="Configurações">Config</Link><button onClick={() => router.push("/settings")}>Abrir</button></main> }''', encoding="utf-8")
            (root / "app" / "settings" / "page.tsx").write_text('export default function Settings() { return <button id="save">Salvar</button> }', encoding="utf-8")
            result = scan_project(root)
            entities = result["sam"]["entities"]
            relations = result["sam"]["relationships"]
            routes = {entity["path"]: entity for entity in entities if entity["type"] == "ROUTE"}
            self.assertIn("/", routes)
            self.assertIn("/settings", routes)
            controls = [entity for entity in entities if entity["type"] == "COMPONENT"]
            self.assertTrue(any(control["name"] == "Configurações" and control["selector"] == "" for control in controls))
            nav_edges = [edge for edge in relations if edge["type"] == "NAVIGATES_TO"]
            self.assertGreaterEqual(len(nav_edges), 1)
            layout_controls = [control for control in controls if control["name"] == "Menu"]
            self.assertEqual({control["route"] for control in layout_controls}, {"/", "/settings"})
            graph_edges = result["graph"].get("edges", [])
            self.assertTrue(graph_edges)

    def test_app_router_pages_router_and_password_values_are_not_scanned(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src" / "pages").mkdir(parents=True)
            (root / "src" / "pages" / "api").mkdir(parents=True)
            (root / "src" / "pages" / "index.tsx").write_text('export default () => <><a href="/reports">Reports</a><input type="password" value="secret" /></>', encoding="utf-8")
            (root / "src" / "pages" / "_app.tsx").write_text('export default () => <main><a href="/">Home</a></main>', encoding="utf-8")
            (root / "src" / "pages" / "api" / "health.tsx").write_text('export default function handler() { return { ok: true } }', encoding="utf-8")
            (root / "src" / "App.tsx").write_text('export default () => <Routes><Route path="/billing" element={<Billing />} /></Routes>', encoding="utf-8")
            (root / "src" / "app" / "users" / "[id]").mkdir(parents=True)
            (root / "src" / "app" / "users" / "[id]" / "page.tsx").write_text('export default () => <h1>User</h1>', encoding="utf-8")
            result = scan_project(root)
            self.assertIn("/", result["routePaths"])
            self.assertIn("/billing", result["routePaths"])
            self.assertIn("/users/:id", result["routePaths"])
            self.assertNotIn("/api/health", result["routePaths"])
            self.assertNotIn("/_app", result["routePaths"])
            self.assertFalse(any(entity["name"] == "secret" for entity in result["sam"]["entities"]))


if __name__ == "__main__":
    unittest.main()
