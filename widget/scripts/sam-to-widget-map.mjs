import fs from 'node:fs'

function routePath(value) {
  if (!value) return ''
  try { return new URL(value, 'http://widget.local').pathname.replace(/\/$/, '') || '/' } catch { return '' }
}

export function buildWidgetMap(sam) {
  const entities = Array.isArray(sam?.entities) ? sam.entities : []
  const relationships = Array.isArray(sam?.relationships) ? sam.relationships : []
  const byId = new Map(entities.map((entity) => [String(entity.id), entity]))
  const routes = entities.filter((entity) => entity.type === 'ROUTE')
  const controls = entities.filter((entity) => entity.type === 'COMPONENT')
  const controlsByRoute = new Map()

  for (const control of controls) {
    const route = routePath(control.route || control.metadata?.route)
    if (!route) continue
    const items = controlsByRoute.get(route) || []
    items.push(control)
    controlsByRoute.set(route, items)
  }

  for (const edge of relationships) {
    if (edge.type !== 'CONTAINS') continue
    const screen = byId.get(String(edge.source ?? edge.sourceId))
    const control = byId.get(String(edge.target ?? edge.targetId))
    if (screen?.type !== 'ROUTE' || control?.type !== 'COMPONENT') continue
    const route = routePath(screen.path)
    const items = controlsByRoute.get(route) || []
    if (!items.some((item) => String(item.id) === String(control.id))) items.push(control)
    controlsByRoute.set(route, items)
  }

  const destinations = new Map()
  for (const edge of relationships) {
    if (edge.type !== 'NAVIGATES_TO') continue
    const controlId = String(edge.source ?? edge.sourceId)
    const target = byId.get(String(edge.target ?? edge.targetId))
    if (target?.type === 'ROUTE') destinations.set(controlId, routePath(target.path))
  }

  const screens = {}
  for (const route of routes) {
    const path = routePath(route.path)
    if (!path) continue
    const actions = (controlsByRoute.get(path) || []).flatMap((control) => {
      const metadata = control.metadata || {}
      const targetRoute = routePath(destinations.get(String(control.id)) || metadata.targetRoute)
      if (!targetRoute || metadata.intent === 'submit' || metadata.kind !== 'navigation') return []
      return [{ name: String(control.accessibleName || control.name || '').trim(), targetRoute, selector: control.cssSelector || control.selector || '' }]
    }).filter((action) => action.name)
    screens[path] = {
      path,
      title: String(route.pageTitle || route.name || path),
      content: String(route.description || route.metadata?.content || ''),
      actions,
    }
  }

  return { generator: 'widget-acessibilidade', schemaVersion: 1, screens }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Uso: node sam-to-widget-map.mjs <sam.json> <widget-screen-map.json>')
  const sam = JSON.parse(fs.readFileSync(input, 'utf8'))
  fs.writeFileSync(output, `${JSON.stringify(buildWidgetMap(sam), null, 2)}\n`)
}
