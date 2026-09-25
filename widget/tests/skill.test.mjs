import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildWidgetMap } from '../scripts/sam-to-widget-map.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('turns scanner entities and directed navigation edges into the widget map', () => {
  const sam = {
    entities: [
      { id: 'home', type: 'ROUTE', name: 'Início', path: '/', description: 'Página inicial' },
      { id: 'settings', type: 'ROUTE', name: 'Configurações', path: '/settings' },
      { id: 'link', type: 'COMPONENT', name: 'Configurações', route: '/', selector: '#settings-link', metadata: { kind: 'navigation', intent: 'navigate', targetRoute: '/settings' } },
      { id: 'save', type: 'COMPONENT', name: 'Salvar', route: '/settings', selector: '#save', metadata: { kind: 'action', intent: 'submit' } },
    ],
    relationships: [
      { source: 'home', target: 'link', type: 'CONTAINS' },
      { source: 'link', target: 'settings', type: 'NAVIGATES_TO' },
      { sourceId: 'settings', targetId: 'save', type: 'CONTAINS' },
    ],
  }
  const result = buildWidgetMap(sam)
  assert.equal(result.generator, 'widget-acessibilidade')
  assert.deepEqual(result.screens['/'].actions, [{ name: 'Configurações', targetRoute: '/settings', selector: '#settings-link' }])
  assert.deepEqual(result.screens['/settings'].actions, [])
})

test('the install command adds the component and preserves existing user files', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-skill-install-'))
  const installer = path.join(repoRoot, 'widget', 'scripts', 'install-widget.mjs')
  const target = path.join(project, 'src', 'components', 'AccessibilityWidget.tsx')
  try {
    const first = spawnSync(process.execPath, [installer, project], { encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(fs.readFileSync(target, 'utf8'), fs.readFileSync(path.join(repoRoot, 'widget', 'assets', 'AssistiveWidget.tsx'), 'utf8'))
    assert.equal(fs.readFileSync(path.join(project, 'ACCESSIBILITY-WIDGET-LICENSE'), 'utf8'), fs.readFileSync(path.join(repoRoot, 'widget', 'LICENSE'), 'utf8'))

    fs.writeFileSync(path.join(project, 'ACCESSIBILITY-WIDGET-LICENSE'), 'PolyForm Noncommercial License 1.0.0\n\nRequired Notice: Copyright (c) 2026 nicollasarcanjo (https://nicollas.heso.com.br)\n\nOld widget terms')
    const migration = spawnSync(process.execPath, [installer, project], { encoding: 'utf8' })
    assert.equal(migration.status, 0, migration.stderr)
    assert.equal(fs.readFileSync(path.join(project, 'ACCESSIBILITY-WIDGET-LICENSE'), 'utf8'), fs.readFileSync(path.join(repoRoot, 'widget', 'LICENSE'), 'utf8'))

    const second = spawnSync(process.execPath, [installer, project], { encoding: 'utf8' })
    assert.equal(second.status, 0, second.stderr)
    fs.writeFileSync(target, 'user-owned component')
    const conflict = spawnSync(process.execPath, [installer, project], { encoding: 'utf8' })
    assert.notEqual(conflict.status, 0)
    assert.equal(fs.readFileSync(target, 'utf8'), 'user-owned component')
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
})

test('license permits paid host apps but prohibits selling the project as an independent product', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'widget', 'SKILL.md'), 'utf8')
  const license = fs.readFileSync(path.join(repoRoot, 'widget', 'LICENSE'), 'utf8')
  assert.match(skill, /Do not block or defer installation because the host app has billing/)
  assert.match(license, /O uso comercial integrado é permitido sem autorização escrita prévia/)
  assert.match(license, /plano pago ou receita no produto hospedeiro/)
  assert.match(license, /vender, licenciar ou cobrar separadamente/)
  assert.doesNotMatch(license, /PolyForm Noncommercial/)
})

test('the package includes Graphify and axe-core attribution', () => {
  const scanner = path.join(repoRoot, 'widget', 'assets', 'graph-scanner')
  assert.ok(fs.existsSync(path.join(scanner, 'vendor', 'graphify', 'LICENSE')))
  assert.ok(fs.existsSync(path.join(scanner, 'vendor', 'graphify', 'LICENSE-MIT')))
  assert.ok(fs.existsSync(path.join(scanner, 'vendor', 'graphify', 'NOTICE')))
  assert.ok(fs.existsSync(path.join(scanner, 'extension', 'vendor', 'AXE-LICENSE')))
})

test('the bundled scan command writes the local SAM and static widget map without upload', { timeout: 300_000 }, async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-skill-scan-'))
  const scanner = path.join(repoRoot, 'widget', 'scripts', 'scan-project.mjs')
  try {
    fs.mkdirSync(path.join(project, 'app', 'account'), { recursive: true })
    fs.writeFileSync(path.join(project, 'app', 'page.tsx'), 'import Link from "next/link"; export default () => <Link href="/account" id="account-link">Conta</Link>')
    fs.writeFileSync(path.join(project, 'app', 'account', 'page.tsx'), 'export default () => <h1>Minha conta</h1>')
    const result = spawnSync(process.execPath, [scanner, project], { encoding: 'utf8', timeout: 240_000 })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /Bundle salvo em/)
    const sam = JSON.parse(fs.readFileSync(path.join(project, '.graph-scanner', '.skip-sam.json'), 'utf8'))
    assert.ok(sam.entities.some((entity) => entity.type === 'ROUTE' && entity.path === '/account'))
    const map = JSON.parse(fs.readFileSync(path.join(project, 'public', 'widget-screen-map.json'), 'utf8'))
    assert.equal(map.generator, 'widget-acessibilidade')
    assert.equal(map.screens['/'].actions[0].targetRoute, '/account')
    assert.equal(fs.existsSync(path.join(project, '.graph-scanner', 'upload-manifest.json')), false)
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
})
