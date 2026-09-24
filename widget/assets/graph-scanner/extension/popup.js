const serverInput = document.querySelector('#server')
const codeInput = document.querySelector('#code')
const appInput = document.querySelector('#app')
const status = document.querySelector('#status')

chrome.storage.local.get(['server', 'code', 'appUrl'], (saved) => {
  if (saved.server) serverInput.value = saved.server
  if (saved.code) codeInput.value = saved.code
  if (saved.appUrl) appInput.value = saved.appUrl
})

codeInput.addEventListener('change', async () => {
  const server = serverInput.value.trim().replace(/\/$/, '')
  if (!codeInput.value.trim()) return
  try {
    const response = await fetch(`${server}/api/info`, { headers: { 'X-Scan-Code': codeInput.value.trim() } })
    if (!response.ok) return
    const info = await response.json()
    if (info.appUrl && !appInput.value) appInput.value = info.appUrl
  } catch {}
})

document.querySelector('#start').addEventListener('click', async () => {
  const server = serverInput.value.trim().replace(/\/$/, '')
  const code = codeInput.value.trim()
  const appUrl = appInput.value.trim()
  if (!code || !appUrl) { status.textContent = 'Informe o código do CLI e a URL inicial.'; return }
  let origin
  let safeAppUrl
  try {
    const parsed = new URL(appUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('URL inválida')
    parsed.search = ''
    parsed.hash = ''
    origin = parsed.origin
    safeAppUrl = parsed.href
  } catch { status.textContent = 'Informe uma URL HTTP(S) válida, sem credenciais embutidas.'; return }
  status.textContent = 'Conectando ao CLI…'
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) { status.textContent = 'Permita acesso a esta origem para continuar.'; return }
  try {
    const result = await chrome.runtime.sendMessage({ type: 'START_SCAN', server, code, appUrl: safeAppUrl })
    if (!result?.ok) throw new Error(result?.error || 'Não foi possível iniciar.')
    await chrome.storage.local.set({ server, code, appUrl: safeAppUrl })
    status.textContent = `Varredura iniciada: ${result.routes} rotas.`
  } catch (error) { status.textContent = error.message }
})
