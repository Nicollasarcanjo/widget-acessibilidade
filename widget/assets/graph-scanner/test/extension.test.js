import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('DOM capture records known navigation targets and never reads password values', async () => {
  const messages = []
  const makeElement = ({ tagName, label, id = '', href = '', type = '', value = 'sensitive' }) => ({
    tagName: tagName.toUpperCase(),
    id,
    href,
    value,
    disabled: false,
    innerText: label,
    labels: [],
    getAttribute(name) { return ({ 'aria-label': label, type, id })[name] || null },
  })
  const link = makeElement({ tagName: 'a', label: 'Relatórios', href: 'https://example.test/reports' })
  const button = makeElement({ tagName: 'button', label: 'Salvar', id: 'save' })
  const password = makeElement({ tagName: 'input', label: 'Senha', type: 'password' })
  const document = {
    body: { innerText: 'Área autenticada' },
    querySelectorAll() { return [link, button, password] },
    getElementById() { return null },
  }
  const context = {
    window: { __SKIP_GRAPH_SCANNER_ROUTES__: ['/reports'] },
    document,
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    Node: { ELEMENT_NODE: 1 },
    CSS: { escape: (value) => value },
    URL,
    chrome: { runtime: { sendMessage(message) { messages.push(message); return Promise.resolve() } } },
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension', 'capture.js'), 'utf8'), context)
  await new Promise((resolve) => setImmediate(resolve))
  const snapshot = messages[0].snapshot
  assert.equal(snapshot.controls.find((item) => item.label === 'Relatórios').targetRoute, '/reports')
  assert.equal(snapshot.controls.find((item) => item.label === 'Salvar').navigation, false)
  assert.equal(JSON.stringify(snapshot).includes(password.value), false)
  assert.equal(snapshot.wcag.performed, false)
})

test('the extension only requests optional permission for the entered application origin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'))
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'))
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1:43127/*'))
  assert.ok(!manifest.host_permissions.includes('https://*/*'))
})
