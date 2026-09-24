async function request(server, path, code, body) {
  const response = await fetch(`${server}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Scan-Code': code, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `CLI respondeu ${response.status}`)
  return result
}

chrome.tabs.onUpdated.addListener(onTabUpdated)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SCAN') {
    startScan(message).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }))
    return true
  }
  if (message.type === 'SCREEN_CAPTURED') {
    handleCapture(message.snapshot).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }))
    return true
  }
})

async function startScan(config) {
  const start = await request(config.server, '/api/start', config.code, { appUrl: config.appUrl })
  const seed = new URL(config.appUrl)
  const initialPath = seed.pathname || '/'
  const routes = [...new Set([initialPath, ...start.routes])].slice(0, start.maxPages)
  const state = { ...config, routes, appOrigin: start.appOrigin, index: 0, tabId: null, visited: [], processingUrl: '' }
  await chrome.storage.session.set({ scanState: state })
  const firstPath = routes[0] || initialPath || '/'
  const tab = await chrome.tabs.create({ url: new URL(firstPath, start.appOrigin).href, active: false })
  state.tabId = tab.id
  await chrome.storage.session.set({ scanState: state })
  if (tab.status === 'complete') await captureTab(state, tab)
  return { routes: routes.length }
}

async function onTabUpdated(tabId, changeInfo, tab) {
  const { scanState } = await chrome.storage.session.get('scanState')
  if (!scanState || tabId !== scanState.tabId || changeInfo.status !== 'complete' || !tab.url?.startsWith(scanState.appOrigin)) return
  await captureTab(scanState, tab)
}

async function captureTab(scanState, tab) {
  if (scanState.processingUrl === tab.url) return
  scanState.processingUrl = tab.url
  await chrome.storage.session.set({ scanState })
  try {
    const routePaths = scanState.routes.map((route) => new URL(route, scanState.appOrigin).pathname.replace(/\/$/, '') || '/')
    await chrome.scripting.executeScript({ target: { tabId }, func: (routes) => { window.__SKIP_GRAPH_SCANNER_ROUTES__ = routes }, args: [routePaths] })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['vendor/axe.min.js', 'capture.js'] })
  } catch (error) {
    await request(scanState.server, '/api/capture', scanState.code, { url: tab.url, title: tab.title || '', text: '', controls: [], wcag: { performed: false, error: String(error) } }).catch(() => {})
    await advance(scanState)
  }
}

async function handleCapture(snapshot) {
  const { scanState } = await chrome.storage.session.get('scanState')
  if (!scanState) throw new Error('Não há varredura ativa.')
  await request(scanState.server, '/api/capture', scanState.code, snapshot)
  await advance(scanState)
  return { captured: scanState.visited.length + 1 }
}

async function advance(state) {
  let currentTab
  try { currentTab = await chrome.tabs.get(state.tabId) } catch { currentTab = null }
  const currentPath = currentTab?.url ? new URL(currentTab.url).pathname : ''
  state.visited.push(currentPath)
  state.index += 1
  if (!currentTab || state.index >= state.routes.length) {
    await request(state.server, '/api/complete', state.code, { captures: state.visited.length })
    await chrome.storage.session.remove('scanState')
    await chrome.tabs.remove(state.tabId).catch(() => {})
    return
  }
  await chrome.storage.session.set({ scanState: state })
  const nextPath = state.routes[state.index]
  await chrome.tabs.update(state.tabId, { url: new URL(nextPath, state.appOrigin).href })
}
