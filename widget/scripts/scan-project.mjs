import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildWidgetMap } from './sam-to-widget-map.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.resolve(scriptDir, '..')
const scanner = path.join(skillDir, 'assets', 'graph-scanner', 'bin', 'graph-scanner.js')
const args = process.argv.slice(2)
const projectArgument = args.find((arg) => !arg.startsWith('--'))
const project = path.resolve(projectArgument || process.cwd())
const appUrlIndex = args.findIndex((arg) => arg === '--app-url')
const appUrlInline = args.find((arg) => arg.startsWith('--app-url='))
const appUrl = appUrlIndex >= 0 ? args[appUrlIndex + 1] : appUrlInline?.slice('--app-url='.length)

if (!fs.statSync(project).isDirectory()) throw new Error(`Projeto não encontrado: ${project}`)
if (!fs.existsSync(scanner)) throw new Error(`Scanner ausente no pacote da skill: ${scanner}`)
if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('O scanner precisa de Node.js 20 ou superior.')

const scannerArgs = [scanner, 'scan', project, '--dry-run']
if (appUrl) scannerArgs.push(`--app-url=${appUrl}`)
const result = spawnSync(process.execPath, scannerArgs, { cwd: project, stdio: 'inherit', env: process.env })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

const samPath = path.join(project, '.graph-scanner', '.skip-sam.json')
const sam = JSON.parse(fs.readFileSync(samPath, 'utf8'))
const widgetMap = buildWidgetMap(sam)
const mapText = `${JSON.stringify(widgetMap, null, 2)}\n`
const mapDir = path.join(project, 'public')
const mapPath = path.join(mapDir, 'widget-screen-map.json')
fs.mkdirSync(mapDir, { recursive: true })

if (fs.existsSync(mapPath)) {
  let existing
  try { existing = JSON.parse(fs.readFileSync(mapPath, 'utf8')) } catch { throw new Error(`${mapPath} existe e não é JSON válido; preservei o arquivo.`) }
  if (existing.generator !== 'widget-acessibilidade') throw new Error(`${mapPath} já existe e não foi gerado por esta skill; preservei o arquivo.`)
}

fs.writeFileSync(path.join(project, '.graph-scanner', 'widget-screen-map.json'), mapText)
fs.writeFileSync(mapPath, mapText)
const screens = Object.keys(widgetMap.screens).length
const controls = Object.values(widgetMap.screens).reduce((sum, screen) => sum + screen.actions.length, 0)
console.log(`Mapa do widget atualizado em ${path.relative(project, mapPath)} (${screens} telas, ${controls} ações de navegação identificadas).`)
