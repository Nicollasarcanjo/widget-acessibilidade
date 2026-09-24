import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.resolve(scriptDir, '..')
const source = path.join(skillDir, 'assets', 'AssistiveWidget.tsx')
const project = path.resolve(process.argv[2] || process.cwd())
if (!fs.statSync(project).isDirectory()) throw new Error(`Projeto não encontrado: ${project}`)
if (!fs.existsSync(source)) throw new Error(`Componente do widget ausente: ${source}`)

const preferred = ['src/components', 'app/components', 'components']
const componentDir = preferred.map((folder) => path.join(project, folder)).find((folder) => fs.existsSync(folder)) || path.join(project, 'src', 'components')
const destination = path.join(componentDir, 'AccessibilityWidget.tsx')
const content = fs.readFileSync(source)
fs.mkdirSync(componentDir, { recursive: true })

if (fs.existsSync(destination)) {
  const existing = fs.readFileSync(destination)
  if (existing.equals(content)) {
    console.log(`O componente já está instalado em ${path.relative(project, destination)}.`)
    process.exit(0)
  }
  throw new Error(`${path.relative(project, destination)} já existe com conteúdo diferente; preservei o arquivo. Integre o widget existente ou escolha outro caminho.`)
}

fs.writeFileSync(destination, content)
console.log(`Widget copiado para ${path.relative(project, destination)}. Conecte AssistiveWidget ao layout raiz do aplicativo.`)
