#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = path.join(PACKAGE_ROOT, 'engine')
let OUT = path.join(process.cwd(), '.graph-scanner')
const PAIRING_PORT = 43127
const MAX_CRAWL_ROUTES = 80

function parseArgs(argv) {
  const [, , command = 'scan', directory = '.', ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i]
    if (!item.startsWith('--')) continue
    const [key, inline] = item.slice(2).split('=', 2)
    if (['dry-run', 'verbose', 'help'].includes(key)) options[key] = true
    else options[key] = inline ?? rest[++i]
  }
  return { command, directory, options }
}

function run(command, args, opts = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts })
}

function findPython() {
  const candidates = process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]]
  for (const [command, prefix] of candidates) {
    const result = run(command, [...prefix, '--version'])
    const match = `${result.stdout || ''} ${result.stderr || ''}`.match(/Python (\d+)\.(\d+)/)
    if (result.status === 0 && match && Number(match[1]) >= 3 && Number(match[2]) >= 10) return { command, prefix }
  }
  throw new Error('Este scanner precisa de Python 3.10 ou superior. Instale Python e execute o mesmo comando novamente.')
}

function findUv(python) {
  const uv = run('uv', ['--version'])
  if (uv.status === 0) return { command: 'uv', prefix: [] }
  const moduleCheck = run(python.command, [...python.prefix, '-m', 'uv', '--version'])
  if (moduleCheck.status === 0) return { command: python.command, prefix: [...python.prefix, '-m', 'uv'] }
  console.log('Preparando o runtime Python do scanner (instalando uv no perfil do usuário)…')
  const install = run(python.command, [...python.prefix, '-m', 'pip', 'install', '--user', 'uv'])
  if (install.status !== 0) throw new Error(`Não foi possível preparar uv:\n${install.stderr || install.stdout}`)
  const module = run(python.command, [...python.prefix, '-m', 'uv', '--version'])
  if (module.status !== 0) throw new Error('uv foi instalado, mas não pôde ser executado com o Python encontrado.')
  return { command: python.command, prefix: [...python.prefix, '-m', 'uv'] }
}

function scanSource(directory) {
  const python = findPython()
  const uv = findUv(python)
  fs.mkdirSync(OUT, { recursive: true })
  const script = path.join(ENGINE, 'skip_screen_scanner', '__main__.py')
  const result = run(uv.command, [...uv.prefix, 'run', '--no-project', '--with', 'networkx>=3.4,<4', '--with', 'tree-sitter>=0.23,<0.26', '--with', 'tree-sitter-typescript>=0.23,<0.25', '--with', 'tree-sitter-javascript>=0.23,<0.26', 'python', script, path.resolve(directory), OUT], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONPATH: [path.join(PACKAGE_ROOT, 'vendor', 'graphify'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'A extração estática falhou.')
  const line = result.stdout.trim().split(/\r?\n/).at(-1)
  return JSON.parse(line)
}

function normalizeRoute(route) {
  try { return new URL(route, 'http://scanner.local').pathname.replace(/\/$/, '') || '/' } catch { return '' }
}

function normalizeAppUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Informe uma URL HTTP(S) da aplicação, sem credenciais embutidas.')
  url.search = ''
  url.hash = ''
  return url.href
}

function mergeCaptures(scan, captures) {
  const entities = scan.sam.entities
  const relationships = scan.sam.relationships
  for (const snapshot of captures) {
    const routePath = normalizeRoute(snapshot.url)
    let route = entities.find((entity) => entity.type === 'ROUTE' && normalizeRoute(entity.path) === routePath)
    if (!route) {
      const id = `route_${crypto.createHash('sha1').update(routePath).digest('hex').slice(0, 12)}`
      route = { id, type: 'ROUTE', name: snapshot.title || routePath, slug: id, path: routePath, aliases: [routePath], confidence: 0.7, metadata: { origin: 'browser-dom' } }
      entities.push(route)
      scan.routePaths.push(routePath)
    }
    route.pageTitle = snapshot.title || route.pageTitle || route.name
    route.description = snapshot.text || route.description || ''
    route.confidence = Math.max(Number(route.confidence || 0), 0.99)
    route.evidence = [...(route.evidence || []), { source: 'browser-dom', observedUrl: snapshot.url }]
    route.metadata = { ...(route.metadata || {}), origin: 'source-code+browser-dom', observedUrl: snapshot.url, content: snapshot.text || '' }
    for (const control of snapshot.controls || []) {
      if (!control.label || control.password) continue
      const tagAliases = { a: new Set(['a', 'link', 'navlink', 'routerlink']), link: new Set(['a', 'link', 'navlink', 'routerlink']), navlink: new Set(['a', 'link', 'navlink', 'routerlink']), routerlink: new Set(['a', 'link', 'navlink', 'routerlink']) }
      const observedType = String(control.tag || '').toLowerCase()
      const existing = entities.find((entity) => {
        const staticType = String(entity.metadata?.componentType || '').toLowerCase()
        const sameType = staticType === observedType || tagAliases[observedType]?.has(staticType) || tagAliases[staticType]?.has(observedType)
        return entity.type === 'COMPONENT' && entity.route === routePath && entity.name === control.label && sameType
      })
      const entity = existing || {
        id: `control_${crypto.createHash('sha1').update(`${routePath}:${control.anchor}:${control.tag}:${control.label}`).digest('hex').slice(0, 16)}`,
        type: 'COMPONENT', name: control.label.slice(0, 160), slug: '', route: routePath, path: routePath,
        confidence: 0.98, evidence: [], metadata: {},
      }
      entity.slug ||= entity.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')
      entity.selector = control.selector || entity.selector || ''
      entity.cssSelector = entity.selector
      entity.accessibleName = control.label
      entity.confidence = Math.max(Number(entity.confidence || 0), 0.99)
      entity.evidence = [...(entity.evidence || []), { source: 'browser-dom', observedUrl: snapshot.url }]
      const previousMetadata = entity.metadata || {}
      entity.metadata = { ...previousMetadata, kind: control.navigation ? 'navigation' : previousMetadata.kind || control.kind || 'action', componentType: control.tag, route: routePath, cssSelector: entity.selector, origin: existing ? 'source-code+browser-dom' : 'browser-dom', navigationConfirmed: Boolean(control.targetRoute || previousMetadata.navigationConfirmed), targetRoute: control.targetRoute || previousMetadata.targetRoute || '' }
      if (!existing) {
        entities.push(entity)
        relationships.push({ source: route.id, target: entity.id, type: 'CONTAINS', confidence: 0.98, evidence: entity.evidence, metadata: { origin: 'browser-dom' } })
      }
      const target = normalizeRoute(control.targetRoute || entity.metadata.targetRoute || '')
      const targetEntity = target && entities.find((candidate) => candidate.type === 'ROUTE' && normalizeRoute(candidate.path) === target)
      if (targetEntity && !relationships.some((edge) => edge.source === entity.id && edge.target === targetEntity.id && edge.type === 'NAVIGATES_TO')) {
        relationships.push({ source: entity.id, target: targetEntity.id, type: 'NAVIGATES_TO', confidence: 0.98, evidence: entity.evidence, metadata: { origin: 'browser-dom', confirmed: true } })
      }
    }
  }
  scan.sam.metadata.browserSnapshots = captures.length
  return scan
}

function makeArtifacts(scan, captures) {
  const scanId = `scan_${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const routeCount = scan.sam.entities.filter((entity) => entity.type === 'ROUTE').length
  const controlCount = scan.sam.entities.filter((entity) => entity.type === 'COMPONENT').length
  const wcagFindings = captures.flatMap((snapshot) => (snapshot.wcag?.violations || []).map((violation) => ({
    id: `${violation.id}:${normalizeRoute(snapshot.url)}:${violation.nodes?.[0]?.target?.join(' ') || ''}`,
    ruleId: violation.id, severity: violation.impact || 'unknown', description: violation.description,
    help: violation.help, helpUrl: violation.helpUrl, screen: normalizeRoute(snapshot.url),
    selector: violation.nodes?.[0]?.target?.join(' ') || '',
    occurrenceCount: violation.nodes?.length || 1,
    nodes: violation.nodes || [],
  })))
  const auditedSnapshots = captures.filter((snapshot) => snapshot.wcag?.performed === true)
  const auditedPaths = new Set(auditedSnapshots.map((snapshot) => normalizeRoute(snapshot.url)))
  const unavailableScreens = scan.routePaths.filter((route) => !auditedPaths.has(normalizeRoute(route)))
  const auditDone = auditedSnapshots.length > 0
  const auditStatus = !auditDone ? 'not-run' : unavailableScreens.length ? 'partial' : 'complete'
  const sourceFiles = scan.sourceFiles.map((filePath) => ({ filePath }))
  const contents = [
    ['.skip-report.json', 'report', { scanId, generatedAt: now, scannerVersion: '0.1.0', project: { name: scan.sam.metadata.projectName }, stats: { files: scan.sourceFiles.length, screens: routeCount, controls: controlCount, browserSnapshots: captures.length }, scoreStatus: 'unavailable', wcag: { status: auditStatus, scoreStatus: 'unavailable' } }],
    ['.skip-sam.json', 'semantic-map', { ...scan.sam, scanId }],
    ['.skip-wcag-audit.json', 'wcag-audit', { schemaVersion: '1.0.0', scanId, auditPerformed: auditDone, status: auditStatus,
      screensAudited: auditedPaths.size, screensExpected: scan.routePaths.length, total: wcagFindings.length,
      violations: wcagFindings, unavailableScreens }],
    ['scan-file-manifest.json', 'file-manifest', { scanId, files: sourceFiles, filesCount: sourceFiles.length }],
    ['scan-validation.json', 'validation', { scanId, valid: scan.sam.entities.length > 0 && scan.sam.relationships.every((edge) => scan.sam.entities.some((entity) => entity.id === edge.source) && scan.sam.entities.some((entity) => entity.id === edge.target)), entityCount: scan.sam.entities.length, relationshipCount: scan.sam.relationships.length }],
  ]
  const files = contents.map(([filename, artifactType, content]) => ({ filename, artifactType, content, raw: Buffer.from(JSON.stringify(content, null, 2)) }))
  const manifestEntries = files.map((file) => ({ filename: file.filename, artifactType: file.artifactType, sizeBytes: file.raw.length, sha256: crypto.createHash('sha256').update(file.raw).digest('hex'), required: true }))
  manifestEntries.push({ filename: 'upload-manifest.json', artifactType: 'upload-manifest', required: true })
  const manifest = { scanId, schemaVersion: '1.0.0', bundleVersion: '1.0.0', expectedFileCount: manifestEntries.length, files: manifestEntries }
  files.push({ filename: 'upload-manifest.json', artifactType: 'upload-manifest', content: manifest, raw: Buffer.from(JSON.stringify(manifest, null, 2)) })
  return { scanId, files }
}

function startBridge(scan, initialAppUrl) {
  if (initialAppUrl) initialAppUrl = normalizeAppUrl(initialAppUrl)
  const pairingCode = crypto.randomBytes(18).toString('base64url')
  const captures = []
  let started = false
  let done = false
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Scan-Code')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const respond = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.headers['x-scan-code'] !== pairingCode) return respond(401, { error: 'Código de pareamento inválido.' })
    if (req.method === 'GET' && req.url === '/api/info') return respond(200, { appUrl: initialAppUrl || '' })
    if (req.method === 'POST' && req.url === '/api/start') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        let payload
        try { payload = JSON.parse(body) } catch { return respond(400, { error: 'JSON inválido.' }) }
        let appUrl
        try { appUrl = new URL(normalizeAppUrl(payload.appUrl || initialAppUrl)) } catch { return respond(400, { error: 'URL da aplicação inválida; use HTTP(S) sem credenciais embutidas.' }) }
        started = true
        const routes = scan.routePaths.filter((route) => !route.includes(':') && !route.includes('*')).slice(0, MAX_CRAWL_ROUTES)
        return respond(200, { appOrigin: appUrl.origin, routes, maxPages: MAX_CRAWL_ROUTES })
      })
      return
    }
    if (req.method === 'POST' && req.url === '/api/capture') {
      let body = ''
      req.on('data', (chunk) => { body += chunk; if (body.length > 2_000_000) req.destroy() })
      req.on('end', () => {
        try { captures.push(JSON.parse(body)); return respond(202, { accepted: true }) }
        catch { return respond(400, { error: 'Captura JSON inválida.' }) }
      })
      return
    }
    if (req.method === 'POST' && req.url === '/api/complete') {
      done = true
      return respond(200, { accepted: true, captures: captures.length })
    }
    return respond(404, { error: 'Rota não encontrada.' })
  })
  server.listen(PAIRING_PORT, '127.0.0.1')
  return {
    pairingCode, captures,
    async waitForStart() { return waitUntil(() => started, 120_000) },
    async waitForDone() { return waitUntil(() => done, 1_200_000) },
    close() { server.close() },
  }
}

function waitUntil(predicate, timeoutMs) {
  if (predicate()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (!predicate()) return
      clearTimeout(timeout)
      clearInterval(poll)
      resolve(true)
    }, 250)
    const timeout = setTimeout(() => { clearInterval(poll); resolve(false) }, timeoutMs)
  })
}

function writeBundle(bundle) {
  const dir = path.join(OUT, 'bundle')
  fs.mkdirSync(dir, { recursive: true })
  for (const file of bundle.files) fs.writeFileSync(path.join(dir, file.filename), file.raw)
  return dir
}

function refreshGraphifyGraph(scan) {
  const graph = scan.graph || { directed: true, multigraph: false, graph: {}, nodes: [], edges: [] }
  graph.nodes ||= []
  graph.edges ||= []
  const nodeIds = new Set(graph.nodes.map((node) => String(node.id)))
  for (const entity of scan.sam.entities) {
    if (nodeIds.has(String(entity.id))) continue
    graph.nodes.push({ id: entity.id, label: entity.name, type: entity.type, path: entity.path || entity.route || '',
      confidence: entity.confidence || 0, source_file: entity.evidence?.[0]?.filePath || '' })
    nodeIds.add(String(entity.id))
  }
  const edgeKeys = new Set(graph.edges.map((edge) => `${edge.source}\0${edge.target}\0${edge.type}`))
  for (const edge of scan.sam.relationships) {
    const key = `${edge.source}\0${edge.target}\0${edge.type}`
    if (edgeKeys.has(key)) continue
    graph.edges.push({ source: edge.source, target: edge.target, type: edge.type, confidence: edge.confidence || 0,
      source_file: edge.evidence?.[0]?.filePath || '' })
    edgeKeys.add(key)
  }
  return graph
}

async function upload(bundle, baseUrl, token) {
  if (!token) throw new Error('Informe o token do projeto com --token.')
  if (!baseUrl) throw new Error('Informe a URL do backend com --url.')
  let base = new URL(baseUrl)
  let endpoint
  if (base.pathname.endsWith('/api/scanner')) endpoint = base
  else if (base.pathname.endsWith('/backend/v1')) endpoint = new URL(`${base.pathname}/api/scanner`, base.origin)
  else endpoint = new URL('/backend/v1/api/scanner', base.origin)
  const form = new FormData()
  form.set('scanId', bundle.scanId)
  form.set('schemaVersion', '1.0.0')
  form.set('bundleVersion', '1.0.0')
  form.set('manifest', JSON.stringify(bundle.files.find((file) => file.filename === 'upload-manifest.json').content))
  for (const file of bundle.files) form.append('artifacts', new Blob([file.raw], { type: 'application/json' }), file.filename)
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(60_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`Upload falhou (${response.status}): ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

async function main() {
  const { command, directory, options } = parseArgs(process.argv)
  if (command === '--help' || options.help || command === 'help') {
    console.log('Uso: node bin/graph-scanner.js scan <diretório> [--app-url <aplicação>] [--dry-run]')
    return
  }
  if (command === 'skill' && directory === 'install') {
    const destination = path.resolve(options.dir || path.join(process.cwd(), '.agents', 'skills', 'skip-screen-graph'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.cpSync(path.join(PACKAGE_ROOT, 'skill'), destination, { recursive: true, force: true })
    console.log(`Skill instalada em ${destination}`)
    return
  }
  if (command !== 'scan') throw new Error(`Comando desconhecido: ${command}`)
  OUT = path.join(path.resolve(directory), '.graph-scanner')
  console.log(`Analisando telas e controles em ${path.resolve(directory)}…`)
  let scan = scanSource(directory)
  let captures = []
  if (options['app-url']) {
    const bridge = startBridge(scan, options['app-url'])
    console.log(`Extensão: abra extension/ no Chrome, conecte em http://127.0.0.1:${PAIRING_PORT} e informe o código ${bridge.pairingCode}`)
    console.log('Aguardando a extensão iniciar a varredura autenticada…')
    const ready = await bridge.waitForStart()
    if (ready) {
      const completed = await bridge.waitForDone()
      captures = bridge.captures
      if (!completed) console.warn('Tempo de captura expirou; enviando as telas já coletadas.')
    } else {
      console.warn('A extensão não iniciou a varredura a tempo; será enviado o mapa estático.')
    }
    bridge.close()
    scan = mergeCaptures(scan, captures)
  }
  scan.graph = refreshGraphifyGraph(scan)
  fs.writeFileSync(path.join(OUT, '.skip-sam.json'), JSON.stringify(scan.sam, null, 2))
  fs.writeFileSync(path.join(OUT, 'graph.json'), JSON.stringify(scan.graph, null, 2))
  const bundle = makeArtifacts(scan, captures)
  const bundleDir = writeBundle(bundle)
  if (options['dry-run']) {
    console.log(`Bundle salvo em ${bundleDir}. Telas: ${scan.sam.entities.filter((item) => item.type === 'ROUTE').length}; controles: ${scan.sam.entities.filter((item) => item.type === 'COMPONENT').length}; capturas: ${captures.length}.`)
    return
  }
  const result = await upload(bundle, options.url, options.token)
  console.log(JSON.stringify({ scanId: result.scanId, status: result.status, screens: scan.sam.entities.filter((item) => item.type === 'ROUTE').length, controls: scan.sam.entities.filter((item) => item.type === 'COMPONENT').length, captures: captures.length, wcagStatus: captures.some((item) => item.wcag?.performed) ? 'complete' : 'not-run', warnings: result.warnings || [] }, null, 2))
}

main().catch((error) => { console.error(`graph-scanner: ${error.message}`); process.exitCode = 1 })
