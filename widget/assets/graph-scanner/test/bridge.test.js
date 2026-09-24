import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const post = (port, route, code, body) => fetch(`http://127.0.0.1:${port}${route}`, {
  method: 'POST', headers: { 'X-Scan-Code': code, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

test('the local pairing bridge merges authenticated DOM and WCAG capture before upload', { timeout: 300_000 }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-scanner-bridge-'))
  const safeRoot = path.resolve(tempRoot)
  assert.ok(safeRoot.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()))
  let uploaded = new Map()
  const api = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    const boundary = req.headers['content-type'].match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean)
    uploaded = new Map()
    for (const part of raw.toString('latin1').split(`--${boundary}`)) {
      const filename = part.match(/filename="([^"]+)"/)?.[1]
      const separator = part.indexOf('\r\n\r\n')
      if (!filename || separator < 0) continue
      uploaded.set(filename, JSON.parse(Buffer.from(part.slice(separator + 4).replace(/\r\n$/, ''), 'latin1').toString('utf8')))
    }
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ scanId: 'bridge-integration', status: 'complete', warnings: [] }))
  })
  await listen(api)
  const apiPort = api.address().port
  let child
  let stdout = ''
  try {
    fs.mkdirSync(path.join(safeRoot, 'app', 'settings'), { recursive: true })
    fs.writeFileSync(path.join(safeRoot, 'app', 'page.tsx'), 'import Link from "next/link"; export default () => <Link id="settings" href="/settings">Configurações</Link>')
    fs.writeFileSync(path.join(safeRoot, 'app', 'settings', 'page.tsx'), 'export default () => <h1>Configurações</h1>')
    child = spawn(process.execPath, [path.join(packageRoot, 'bin', 'graph-scanner.js'), 'scan', safeRoot, '--token=bridge-test', `--url=http://127.0.0.1:${apiPort}/backend/v1`, '--app-url=https://app.example/dashboard?session=do-not-retain'], { cwd: safeRoot })
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    const processExit = new Promise((resolve) => child.once('close', resolve))
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI did not open bridge. ${stdout} ${stderr}`)), 120_000)
      const poll = setInterval(() => {
        const found = stdout.match(/código ([A-Za-z0-9_-]+)/)?.[1]
        if (found) { clearTimeout(timer); clearInterval(poll); resolve(found) }
      }, 50)
      child.once('close', (status) => reject(new Error(stderr || stdout || `CLI exited ${status} before opening the bridge`)))
    })
    const info = await fetch(`http://127.0.0.1:43127/api/info`, { headers: { 'X-Scan-Code': code } }).then((response) => response.json())
    assert.equal(info.appUrl, 'https://app.example/dashboard')
    const start = await post(43127, '/api/start', code, { appUrl: 'https://app.example/dashboard?session=do-not-retain' }).then((response) => response.json())
    assert.equal(start.appOrigin, 'https://app.example')
    assert.ok(start.routes.includes('/settings'))
    for (const route of ['/', '/settings']) {
      await post(43127, '/api/capture', code, {
        url: `https://app.example${route}`,
        title: route === '/' ? 'Início' : 'Configurações',
        text: `Conteúdo visível de ${route}`,
        controls: route === '/' ? [{ tag: 'a', label: 'Configurações', selector: '#settings', navigation: true, targetRoute: '/settings' }] : [],
        wcag: { performed: true, violations: route === '/' ? [{ id: 'color-contrast', impact: 'serious', description: 'Texto com contraste baixo', nodes: [{ target: ['#low'] }] }] : [] },
      })
    }
    await post(43127, '/api/complete', code, { captures: 2 })
    const status = await processExit
    if (status !== 0) throw new Error(stderr || stdout)
    assert.equal(status, 0)
    const sam = uploaded.get('.skip-sam.json')
    assert.ok(sam.entities.some((entity) => entity.type === 'ROUTE' && entity.path === '/'))
    assert.ok(sam.entities.some((entity) => entity.type === 'COMPONENT' && entity.selector === '#settings'))
    assert.ok(sam.relationships.some((edge) => edge.type === 'NAVIGATES_TO'))
    assert.equal(sam.entities.find((entity) => entity.type === 'ROUTE' && entity.path === '/').description, 'Conteúdo visível de /')
    const audit = uploaded.get('.skip-wcag-audit.json')
    assert.equal(audit.status, 'complete')
    assert.equal(audit.violations[0].severity, 'serious')
    assert.equal(JSON.stringify([...uploaded.values()]).includes('do-not-retain'), false)
  } finally {
    child?.kill()
    await new Promise((resolve) => api.close(resolve))
    fs.rmSync(safeRoot, { recursive: true, force: true })
  }
})
