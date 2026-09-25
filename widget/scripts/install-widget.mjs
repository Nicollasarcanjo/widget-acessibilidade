import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.resolve(scriptDir, '..')
const source = path.join(skillDir, 'assets', 'AssistiveWidget.tsx')
const licenseSource = path.join(skillDir, 'LICENSE')
const project = path.resolve(process.argv[2] || process.cwd())
if (!fs.statSync(project).isDirectory()) throw new Error(`Projeto não encontrado: ${project}`)
if (!fs.existsSync(source)) throw new Error(`Componente do widget ausente: ${source}`)
if (!fs.existsSync(licenseSource)) throw new Error(`Licença do widget ausente: ${licenseSource}`)

const preferred = ['src/components', 'app/components', 'components']
const componentDir = preferred.map((folder) => path.join(project, folder)).find((folder) => fs.existsSync(folder)) || path.join(project, 'src', 'components')
const destination = path.join(componentDir, 'AccessibilityWidget.tsx')
const content = fs.readFileSync(source)
const licenseDestination = path.join(project, 'ACCESSIBILITY-WIDGET-LICENSE')
const licenseContent = fs.readFileSync(licenseSource)
let replaceLegacyLicense = false
fs.mkdirSync(componentDir, { recursive: true })

if (fs.existsSync(destination)) {
  const existing = fs.readFileSync(destination)
  if (!existing.equals(content)) throw new Error(`${path.relative(project, destination)} já existe com conteúdo diferente; preservei o arquivo. Integre o widget existente ou escolha outro caminho.`)
}
if (fs.existsSync(licenseDestination)) {
  const existingLicense = fs.readFileSync(licenseDestination)
  if (!existingLicense.equals(licenseContent)) {
    const legacyText = existingLicense.toString('utf8')
    const isPreviousNoncommercialNotice = legacyText.startsWith('PolyForm Noncommercial License 1.0.0') && legacyText.includes('Required Notice: Copyright (c) 2026 nicollasarcanjo')
    if (!isPreviousNoncommercialNotice) throw new Error(`${path.relative(project, licenseDestination)} já existe com conteúdo diferente; preservei o arquivo. Confira a licença manualmente.`)
    replaceLegacyLicense = true
  }
}

if (!fs.existsSync(destination)) fs.writeFileSync(destination, content)
if (!fs.existsSync(licenseDestination) || replaceLegacyLicense) fs.writeFileSync(licenseDestination, licenseContent)
console.log(`Widget copiado para ${path.relative(project, destination)} e licença para ${path.relative(project, licenseDestination)}. Conecte AssistiveWidget ao layout raiz do aplicativo.`)
