# `/widget` — skill de acessibilidade para um app

Skill do Codex para analisar um projeto web específico, mapear telas e controles com o scanner Graphify incluído e integrar o widget assistivo do Skip ao layout do próprio app.

## Instalar no Codex

Clone este repositório e copie a pasta `widget` para a pasta de skills do Codex:

```powershell
git clone https://github.com/nicollasarcanjo/widget-acessibilidade.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Copy-Item -Recurse .\widget "$env:USERPROFILE\.codex\skills\widget"
```

Reinicie ou atualize o Codex. No projeto web que deseja integrar, invoque `/widget` e peça para analisar e instalar o widget. O agente executa o scanner local, gera o mapa de telas, integra o componente ao layout e roda as verificações existentes do app.

## O que a skill faz

- Analisa código de rotas, controles e destinos usando `@acessibility/graph-scanner`, empacotado no repositório com atribuição e licenças do Graphify preservadas.
- Gera `.graph-scanner/` para revisão e `public/widget-screen-map.json` para o widget consultar no app.
- Integra o widget de voz, leitura, preferências visuais e navegação guiada/automática ao layout persistente do projeto.
- Mantém a análise local em modo dry-run. Nenhum código-fonte ou mapa é enviado a um backend externo.
- Pode complementar a análise estática com observação do DOM e auditoria axe quando uma sessão autenticada de navegador estiver disponível.

## Requisitos do scanner

- Node.js 20 ou superior
- Python 3.10 ou superior
- `uv` e dependências Python são preparados pelo scanner quando necessário

O scanner pode ser executado diretamente, sem `npx`:

```bash
node widget/scripts/scan-project.mjs <caminho-do-projeto>
```

## Desenvolvimento e CI

```bash
npm test
python -m pip install "networkx>=3.4,<4" "tree-sitter>=0.23,<0.26" "tree-sitter-typescript>=0.23,<0.25" "tree-sitter-javascript>=0.23,<0.26"
python widget/assets/graph-scanner/test/scanner.test.py
```

Pull requests e pushes executam os testes de skill, extração estática do scanner e verificações da extensão Chrome.
