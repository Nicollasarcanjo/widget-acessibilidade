import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('CLI extracts a screen graph and uploads the complete artifact bundle', { timeout: 300_000 }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-scanner-upload-'))
  const safeRoot = path.resolve(tempRoot)
  assert.ok(safeRoot.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()))
  let authorization = ''
  let names = []
  let artifacts = new Map()
  const server = http.createServer(async (req, res) => {
    authorization = req.headers.authorization || ''
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || ''
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean)
    assert.ok(boundary)
    const latin = body.toString('latin1')
    artifacts = new Map()
    for (const part of latin.split(`--${boundary}`)) {
      const filename = part.match(/filename="([^"]+)"/)?.[1]
      const separator = part.indexOf('\r\n\r\n')
      if (!filename || separator < 0) continue
      const raw = part.slice(separator + 4).replace(/\r\n$/, '')
      artifacts.set(filename, JSON.parse(Buffer.from(raw, 'latin1').toString('utf8')))
    }
    names = [...artifacts.keys()]
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ scanId: 'local-integration', status: 'complete', warnings: [] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    fs.mkdirSync(path.join(safeRoot, 'app', 'settings'), { recursive: true })
    fs.writeFileSync(path.join(safeRoot, 'app', 'page.tsx'), 'import Link from "next/link"; export default function Home(){ return <Link href="/settings">Configurações</Link> }')
    fs.writeFileSync(path.join(safeRoot, 'app', 'settings', 'page.tsx'), 'export default function Settings(){ return <button id="save">Salvar</button> }')
    const { port } = server.address()
    const cli = path.join(packageRoot, 'bin', 'graph-scanner.js')
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'scan', safeRoot, '--token=test-project-token', `--url=http://127.0.0.1:${port}/backend/v1`], { cwd: safeRoot })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
      child.once('error', reject)
      child.once('close', (status) => resolve({ status, stdout, stderr }))
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(authorization, 'Bearer test-project-token')
    assert.deepEqual(names.sort(), ['.skip-report.json', '.skip-sam.json', '.skip-wcag-audit.json', 'scan-file-manifest.json', 'scan-validation.json', 'upload-manifest.json'].sort())
    const sam = artifacts.get('.skip-sam.json')
    assert.ok(sam.entities.some((entity) => entity.type === 'ROUTE' && entity.path === '/settings'))
    assert.ok(sam.entities.some((entity) => entity.type === 'COMPONENT' && entity.name === 'Configurações'))
    assert.ok(sam.relationships.some((relation) => relation.type === 'NAVIGATES_TO'))
    assert.equal(artifacts.get('.skip-wcag-audit.json').status, 'not-run')
    assert.match(result.stdout, /"status": "complete"/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(safeRoot, { recursive: true, force: true })
  }
})
