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

    def test_named_navigation_handlers_connect_existing_screens(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app" / "settings").mkdir(parents=True)
            (root / "app" / "page.tsx").write_text('''
                const goToSettings = () => router.push("/settings")
                export default function Home() { return <button onClick={goToSettings}>Configurações</button> }
            ''', encoding="utf-8")
            (root / "app" / "settings" / "page.tsx").write_text('export default () => <h1>Configurações</h1>', encoding="utf-8")
            result = scan_project(root)
            entities = result["sam"]["entities"]
            relationships = result["sam"]["relationships"]
            control = next(entity for entity in entities if entity["type"] == "COMPONENT" and entity["name"] == "Configurações")
            settings = next(entity for entity in entities if entity["type"] == "ROUTE" and entity["path"] == "/settings")
            self.assertEqual(settings["name"], "Configurações")
            self.assertIn("Settings", settings["semanticLabels"])
            self.assertEqual(control["metadata"]["targetRoute"], "/settings")
            self.assertTrue(any(edge["source"] == control["id"] and edge["target"] == settings["id"] and edge["type"] == "NAVIGATES_TO" for edge in relationships))

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

    def test_clickable_regions_and_confirmed_dialog_states_are_mapped(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app").mkdir()
            (root / "app" / "page.tsx").write_text('''
                export default function Home() {
                  const [open, setOpen] = useState(false)
                  return <main>
                    <div role="button" data-testid="new-record" onClick={() => setOpen(true)}>Nova ficha</div>
                    <Dialog role="dialog" aria-label="Nova ficha" open={open}>
                      <h2>Dados do cliente</h2>
                      <label>Nome<input name="customer" /></label>
                      <button type="submit">Salvar</button>
                    </Dialog>
                  </main>
                }
            ''', encoding="utf-8")
            result = scan_project(root)
            entities = result["sam"]["entities"]
            relationships = result["sam"]["relationships"]
            route = next(entity for entity in entities if entity["type"] == "ROUTE")
            state = next(entity for entity in entities if entity["type"] == "UI_STATE")
            trigger = next(entity for entity in entities if entity["name"] == "Nova ficha" and entity["type"] == "COMPONENT")
            customer = next(entity for entity in entities if entity["name"] == "customer")
            submit = next(entity for entity in entities if entity["name"] == "Salvar")
            self.assertEqual(state["name"], "Nova ficha")
            self.assertEqual(state["path"], "/")
            self.assertEqual(state["metadata"]["kind"], "dialog")
            self.assertTrue(trigger["metadata"]["dialogOpenConfirmed"])
            self.assertEqual(trigger["metadata"]["uiStateId"], "")
            self.assertEqual(customer["metadata"]["uiStateId"], state["id"])
            self.assertEqual(submit["metadata"]["intent"], "submit")
            self.assertIn({"source": route["id"], "target": state["id"], "type": "CONTAINS", "confidence": 0.9,
                           "evidence": state["evidence"], "metadata": {"origin": "source-code", "uiState": True}}, relationships)
            self.assertTrue(any(edge["source"] == trigger["id"] and edge["target"] == state["id"] and edge["type"] == "OPENS" for edge in relationships))
            self.assertTrue(any(edge["source"] == state["id"] and edge["target"] == customer["id"] and edge["type"] == "CONTAINS" for edge in relationships))
            self.assertEqual(len(result["modalOpeners"]), 1)
            self.assertTrue(result["modalOpeners"][0]["confirmed"])
            self.assertNotIn("value", json.dumps(result["sam"]))

    def test_unconfirmed_event_handler_is_not_added_to_modal_capture_queue(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "pages").mkdir()
            (root / "pages" / "index.tsx").write_text('''
                export default function Home() {
                  const [open, setOpen] = useState(false)
                  return <><div onClick={handleClick}>Abrir</div><Modal role="dialog" open={open}>Form</Modal></>
                }
            ''', encoding="utf-8")
            result = scan_project(root)
            self.assertEqual(result["modalOpeners"], [])
            self.assertEqual(result["modalCandidates"][0]["status"], "not-captured")
            self.assertEqual(result["sam"]["metadata"]["uncapturedDialogCandidates"][0]["name"], "Abrir")
            self.assertTrue(any(entity["type"] == "UI_STATE" for entity in result["sam"]["entities"]))


if __name__ == "__main__":
    unittest.main()
