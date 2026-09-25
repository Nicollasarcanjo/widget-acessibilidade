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
  const states = entities.filter((entity) => entity.type === 'UI_STATE')
  const controls = entities.filter((entity) => ['COMPONENT', 'BUTTON', 'LINK', 'INPUT', 'SELECT', 'TEXTAREA'].includes(String(entity.type).toUpperCase()))
  const owners = new Map()
  for (const edge of relationships) {
    if (edge.type !== 'CONTAINS') continue
    const ownerId = String(edge.source ?? edge.sourceId)
    const controlId = String(edge.target ?? edge.targetId)
    if (byId.has(ownerId) && byId.has(controlId)) owners.set(controlId, byId.get(ownerId))
  }

  const destinations = new Map()
  for (const edge of relationships) {
    if (!['NAVIGATES_TO', 'OPENS'].includes(edge.type)) continue
    const controlId = String(edge.source ?? edge.sourceId)
    const target = byId.get(String(edge.target ?? edge.targetId))
    if (target) destinations.set(controlId, target)
  }

  const actionEntry = (control) => {
    const metadata = control.metadata || {}
    const owner = owners.get(String(control.id))
    const destination = destinations.get(String(control.id))
    const kind = String(metadata.kind || 'action').toLowerCase()
    return {
      id: String(control.id),
      name: String(control.accessibleName || control.name || '').trim(),
      kind,
      route: routePath(owner?.path || owner?.route || control.route || metadata.route),
      ownerId: String(owner?.id || ''),
      ownerType: String(owner?.type || ''),
      ownerName: String(owner?.pageTitle || owner?.name || ''),
      selector: String(metadata.cssSelector || control.cssSelector || control.selector || ''),
      targetId: String(destination?.id || ''),
      targetName: String(destination?.pageTitle || destination?.name || ''),
      targetRoute: routePath(destination?.path || destination?.route || metadata.targetRoute),
      confirmedNavigation: Boolean(destination?.type === 'ROUTE' && (edgeFor(control, relationships, 'NAVIGATES_TO') || metadata.navigationConfirmed)),
      confirmedDialogOpener: Boolean(destination?.type === 'UI_STATE' && metadata.dialogOpenConfirmed === true && edgeFor(control, relationships, 'OPENS')),
      confirmed: Boolean(destination && ((destination.type === 'ROUTE' && (edgeFor(control, relationships, 'NAVIGATES_TO') || metadata.navigationConfirmed)) || (destination.type === 'UI_STATE' && metadata.dialogOpenConfirmed === true && edgeFor(control, relationships, 'OPENS')))),
      confidence: Number(control.confidence || 0),
      alternatives: [],
    }
  }

  const catalogActions = []
  const grouped = new Map()
  for (const control of controls) {
    const entry = actionEntry(control)
    if (!entry.name) continue
    const metadata = control.metadata || {}
    const feature = metadata.featureKey || (entry.targetId && ['navigation', 'open-state'].includes(entry.kind) ? `${entry.kind}:${entry.targetId}` : `entity:${entry.id}`)
    const current = grouped.get(feature)
    if (!current) { grouped.set(feature, entry); catalogActions.push(entry) }
    else current.alternatives.push({ id: entry.id, name: entry.name, selector: entry.selector, route: entry.route, confidence: entry.confidence })
  }

  const screens = {}
  for (const route of routes) {
    const path = routePath(route.path)
    if (!path) continue
    const routeControls = controls.filter((control) => (owners.get(String(control.id))?.id === route.id) || (!owners.has(String(control.id)) && routePath(control.route || control.metadata?.route) === path))
    const actions = routeControls.map((control) => actionEntry(control)).filter((action) => action.targetRoute && action.kind === 'navigation' && action.confirmed).map((action) => ({ name: action.name, targetRoute: action.targetRoute, selector: action.selector }))
    const overlays = states.filter((state) => routePath(state.path || state.route) === path).map((state) => ({ id: String(state.id), name: String(state.pageTitle || state.name || 'Diálogo'), selector: String(state.metadata?.cssSelector || state.cssSelector || state.selector || ''), controls: controls.filter((control) => owners.get(String(control.id))?.id === state.id).map(actionEntry) }))
    screens[path] = {
      id: String(route.id),
      path,
      title: String(route.pageTitle || route.name || path),
      content: String(route.description || route.metadata?.content || ''),
      actions,
      controls: routeControls.map(actionEntry),
      overlays,
      aliases: Array.isArray(route.semanticLabels) ? route.semanticLabels : Array.isArray(route.aliases) ? route.aliases : [],
      confidence: Number(route.confidence || 0),
    }
  }

  const catalogScreens = [...routes, ...states].map((entity) => ({
    id: String(entity.id),
    name: String(entity.pageTitle || entity.name || entity.path || ''),
    type: entity.type,
    path: routePath(entity.path || entity.route),
    selector: String(entity.metadata?.cssSelector || entity.cssSelector || entity.selector || ''),
    aliases: Array.isArray(entity.semanticLabels) ? entity.semanticLabels : Array.isArray(entity.aliases) ? entity.aliases : [],
    confidence: Number(entity.confidence || 0),
  })).filter((entry) => entry.name)

  return { generator: 'widget-acessibilidade', schemaVersion: 2, screens, catalog: { screens: catalogScreens, actions: catalogActions } }
}

function edgeFor(control, relationships, type) {
  return relationships.find((edge) => String(edge.source ?? edge.sourceId) === String(control.id) && edge.type === type)
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Uso: node sam-to-widget-map.mjs <sam.json> <widget-screen-map.json>')
  const sam = JSON.parse(fs.readFileSync(input, 'utf8'))
  fs.writeFileSync(output, `${JSON.stringify(buildWidgetMap(sam), null, 2)}\n`)
}
