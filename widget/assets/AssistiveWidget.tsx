import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Command, Compass,
  Eye, Focus, Settings, Highlighter, History, Mic, MicOff, MousePointerClick,
  Navigation, Pause, RotateCcw, Settings2, Sparkles, Volume2, X,
} from 'lucide-react'

type View = 'home' | 'voice' | 'actions' | 'shortcuts' | 'highlight' | 'guided' | 'reading' | 'navigate' | 'display' | 'settings' | 'history' | 'help'
type Item = { label: string; element: HTMLElement }
type NavigationStep = { action: string; label: string; targetPath?: string; automaticSafe?: boolean; match?: any }
const widgetParams = new URLSearchParams(window.location.search)
const widgetToken = widgetParams.get('token') || ''
const widgetApiBase = (widgetParams.get('api') || '').replace(/\/$/, '')
const navigationSessionKey = 'skip-pending-navigation'
function widgetEndpoint(name: string) {
  const url = new URL(`${widgetApiBase}/backend/v1/widget/${name}`, window.location.origin)
  if (widgetToken) url.searchParams.set('token', widgetToken)
  return url.toString()
}

const menus: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'voice', label: 'Voz', icon: <Mic /> }, { id: 'actions', label: 'Ações', icon: <MousePointerClick /> },
  { id: 'shortcuts', label: 'Atalhos', icon: <Command /> }, { id: 'guided', label: 'Guiado', icon: <Sparkles /> },
  { id: 'highlight', label: 'Destaque', icon: <Highlighter /> },
  { id: 'reading', label: 'Leitura', icon: <Volume2 /> }, { id: 'navigate', label: 'Navegar', icon: <Navigation /> },
  { id: 'display', label: 'Tela', icon: <Eye /> }, { id: 'settings', label: 'Config', icon: <Settings /> },
  { id: 'history', label: 'Histórico', icon: <History /> }, { id: 'help', label: 'Ajuda', icon: <CircleHelp /> },
]

export function AssistiveWidget() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('home')
  const [fontScale, setFontScale] = useState(100)
  const [contrast, setContrast] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [reading, setReading] = useState(false)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState('')
  const [historyItems, setHistoryItems] = useState<string[]>([])
  const [navigationMode, setNavigationMode] = useState<'guided' | 'automatic'>(() => {
    try { return localStorage.getItem('skip-navigation-mode') === 'automatic' ? 'automatic' : 'guided' } catch { return 'guided' }
  })
  const [pendingNavigation, setPendingNavigation] = useState<NavigationStep[]>([])
  const [position, setPosition] = useState({ x: Math.max(12, window.innerWidth - 76), y: Math.max(12, window.innerHeight - 76) })
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  const recognition = useRef<any>(null)

  const interactive = open ? collectInteractive() : []
  const links = interactive.filter((item) => item.element.matches('a[href]'))

  const record = (text: string) => { setHistoryItems((items) => [text, ...items].slice(0, 12)); setMessage(text) }

  useEffect(() => {
    void loadLocalScreenMap()
  }, [])

  useEffect(() => {
    void fetch(new URL('/widget-screen-map.json', window.location.origin))
      .then((response) => response.ok ? response.json() : null)
      .then((map) => {
        if (!map?.screens || typeof map.screens !== 'object') return
        const existing = JSON.parse(localStorage.getItem('skip-screen-map-v1') || '{}')
        localStorage.setItem('skip-screen-map-v1', JSON.stringify({ ...map.screens, ...existing }))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(navigationSessionKey) || 'null')
      if (!saved) return
      sessionStorage.removeItem(navigationSessionKey)
      const expected = new URL(saved.expectedPath || '/', window.location.origin)
      if (window.location.pathname !== expected.pathname || window.location.search !== expected.search) {
        setMessage('A navegação foi interrompida porque a tela não correspondeu ao caminho previsto.')
        return
      }
      const remaining = Array.isArray(saved.steps) ? saved.steps as NavigationStep[] : []
      if (saved.mode === 'automatic') {
        window.setTimeout(() => { void runAutomaticNavigation(remaining, record) }, 400)
      } else if (remaining.length) {
        setPendingNavigation(remaining)
        setMessage(`Próximo passo: ${remaining[0].label}.`)
      } else setMessage('Você chegou à tela solicitada.')
    } catch { /* session storage may be unavailable */ }
  }, [])

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.skipInternal = 'true'
    style.textContent = `.skip-internal-highlight a[href],.skip-internal-highlight button:not([disabled]),.skip-internal-highlight input:not([type=hidden]),.skip-internal-highlight textarea,.skip-internal-highlight select,.skip-internal-highlight [role=button],.skip-internal-highlight [role=link],.skip-internal-highlight [role=combobox],.skip-internal-highlight [contenteditable=true],.skip-internal-highlight summary,.skip-internal-highlight [tabindex]:not([tabindex="-1"]){outline:3px solid #2563eb!important;outline-offset:3px!important}.skip-reduced-motion *{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`
    document.head.appendChild(style)
    return () => { style.remove(); window.speechSynthesis?.cancel(); recognition.current?.stop?.() }
  }, [])

  useEffect(() => { document.documentElement.style.fontSize = `${fontScale}%` }, [fontScale])
  useEffect(() => { document.documentElement.classList.toggle('skip-internal-highlight', highlight) }, [highlight])
  useEffect(() => { document.documentElement.classList.toggle('skip-reduced-motion', reducedMotion) }, [reducedMotion])
  useEffect(() => { document.documentElement.style.filter = contrast ? 'contrast(1.25) saturate(1.08)' : '' }, [contrast])
  useEffect(() => {
    const clamp = () => setPosition((p) => ({ x: Math.max(8, Math.min(p.x, window.innerWidth - 64)), y: Math.max(8, Math.min(p.y, window.innerHeight - 64)) }))
    window.addEventListener('resize', clamp); return () => window.removeEventListener('resize', clamp)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const screenPath = `${window.location.pathname}${window.location.search}`
      const actions = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[role="link"],[role="button"]'))
        .filter((element) => !element.closest('[role="dialog"]') && element.offsetParent !== null)
        .slice(0, 100)
        .map((element) => ({
          name: (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
          href: element.matches('a[href]') ? (element as HTMLAnchorElement).href : '',
          targetRoute: element.matches('a[href]') ? (() => { try { const url = new URL((element as HTMLAnchorElement).href); return url.origin === window.location.origin ? `${url.pathname}${url.search}` : '' } catch { return '' } })() : '',
          selector: element.id ? `#${CSS.escape(element.id)}` : element.getAttribute('data-skip-anchor') ? `[data-skip-anchor="${CSS.escape(element.getAttribute('data-skip-anchor')!)}"]` : '',
        }))
        .filter((action) => action.name)
      const snapshot = { path: screenPath, title: document.querySelector('main h1,main h2')?.textContent?.trim() || document.title, content: (document.querySelector('main')?.textContent || document.body.innerText).slice(0, 6000), actions: actions.filter((action) => action.targetRoute) }
      try {
        const saved = JSON.parse(localStorage.getItem('skip-screen-map-v1') || '{}')
        saved[snapshot.path] = snapshot
        localStorage.setItem('skip-screen-map-v1', JSON.stringify(saved))
      } catch { /* local storage may be disabled */ }
      if (widgetToken) void fetch(widgetEndpoint('observe'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: window.location.pathname, title: snapshot.title, content: snapshot.content, actions }),
      }).catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  useEffect(() => {
    try { localStorage.setItem('skip-navigation-mode', navigationMode) } catch { /* storage may be disabled */ }
  }, [navigationMode])

  const speak = (text?: string) => {
    if (!('speechSynthesis' in window)) return record('Leitura não disponível neste navegador')
    if (reading) { window.speechSynthesis.cancel(); setReading(false); return record('Leitura pausada') }
    const content = text || document.querySelector('main')?.textContent || document.body.innerText
    const utterance = new SpeechSynthesisUtterance(content.replace(/\s+/g, ' ').slice(0, 8000))
    utterance.lang = 'pt-BR'; utterance.rate = 0.95
    // Seleciona voz pt-BR explicitamente para evitar fallback p/ ingles.
    try {
      const voices = window.speechSynthesis.getVoices() || []
      const match = voices.find((v) => String(v.lang || '').toLowerCase().startsWith('pt'))
      if (match) utterance.voice = match
    } catch { /* noop */ }
    utterance.onend = () => setReading(false)
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setReading(true); record('Leitura da página iniciada')
  }

  const runVoice = () => {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Recognition) return record('Reconhecimento de voz não disponível')
    if (listening) { recognition.current?.stop(); setListening(false); return }
    const instance = new Recognition(); recognition.current = instance; instance.lang = 'pt-BR'; instance.interimResults = false
    instance.onstart = () => { setListening(true); setMessage('Ouvindo… diga o nome de um botão ou página') }
    instance.onend = () => setListening(false)
    instance.onerror = () => record('Não consegui ouvir. Tente novamente.')
    instance.onresult = (event: any) => executeVoice(String(event.results[0][0].transcript || ''))
    instance.start()
  }

  const executeVoice = async (command: string) => {
    const normalized = command.toLowerCase().trim(); record(`Voz: “${command}”`)
    // Comandos simples locais (resposta imediata).
    if (normalized.includes('aumentar fonte')) return setFontScale((v) => Math.min(140, v + 10))
    if (normalized.includes('diminuir fonte')) return setFontScale((v) => Math.max(80, v - 10))
    if (normalized.includes('ler página') || normalized.includes('leia a página')) return speak()
    if (normalized.includes('contraste')) return setContrast((v) => !v)
    // Demais comandos: usa o motor NLU do servidor (fonte de verdade).
    try {
      const data = widgetToken
        ? await fetch(widgetEndpoint('command'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: command, path: window.location.pathname, url: window.location.href }),
        }).then((res) => res.json())
        : (await loadLocalScreenMap(), findLocalNavigation(command, `${window.location.pathname}${window.location.search}`))
      if (data.action === 'READ') { speak(); return }
      if (data.action === 'SETTINGS' && /contraste/.test(normalized)) { setContrast((v) => !v); return }
      if (data.action === 'NAVIGATE') {
        if (data.navigationFound === false) {
          if (data.navigationReason === 'current_screen_unknown') setMessage('Não consegui identificar sua tela atual. Abra uma página mapeada e tente novamente.')
          else if (data.navigationReason === 'ambiguous_destination' && data.suggestions?.length) setMessage(`Não consegui decidir qual tela você quis dizer: ${data.suggestions.map((item: any) => item.name).join(', ')}. Tente especificar melhor.`)
          else setMessage(`Não encontrei um caminho mapeado até “${data.target?.name || command}”. Tente outro nome ou peça ajuda.`)
          return
        }
        if (!data.steps?.length) { setMessage(`Você já está em ${data.target?.name || 'na tela solicitada'}.`); return }
        setPendingNavigation(data.steps)
        if (navigationMode === 'automatic') { await runAutomaticNavigation(data.steps, record); setPendingNavigation([]) }
        else {
          const first = data.steps[0]
          const el = findElementForMatch(first.match)
          if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); setMessage(`Passo 1 de ${data.steps.length}: ${first.label}. Ative “Executar próximo passo” para continuar.`) }
          else setMessage(`Não encontrei o controle “${first.label}” nesta tela. Navegação interrompida.`)
        }
        return
      }
      const best = (data.matches || []).sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))[0]
      if (best) {
        const el = findElementForMatch(best)
        if (el) { activateElement(el); record(`Aberto: ${best.name}`) ; return }
      }
      // Fallback local no DOM atual.
      const target = collectInteractive().find((item) => normalized.includes(item.label.toLowerCase()) || item.label.toLowerCase().includes(normalized))
      if (target) { target.element.click(); target.element.focus(); record(`Aberto: ${target.label}`) }
      else if ((data.suggestions || []).length) setMessage(`Não encontrei. Você quis dizer: ${(data.suggestions || []).map((s: any) => s.name).join(', ')}?`)
      else setMessage(`Não encontrei “${command}” nesta tela`)
    } catch {
      // Servidor indisponível: mantém o comportamento local.
      const target = collectInteractive().find((item) => normalized.includes(item.label.toLowerCase()) || item.label.toLowerCase().includes(normalized))
      if (target) { target.element.click(); target.element.focus(); record(`Aberto: ${target.label}`) }
      else setMessage(`Não encontrei “${command}” nesta tela`)
    }
  }

  const executeGuidedStep = async () => {
    if (!pendingNavigation.length) return
    const [step, ...remaining] = pendingNavigation
    const result = await executeNavigationStep(step, { steps: remaining, mode: 'guided' })
    if (!result.ok) { sessionStorage.removeItem(navigationSessionKey); setPendingNavigation([]); setMessage(result.message); return }
    sessionStorage.removeItem(navigationSessionKey)
    setPendingNavigation(remaining)
    setMessage(remaining.length ? `Passo concluído. Próximo: ${remaining[0].label}.` : 'Você chegou à tela solicitada.')
  }

  const activate = (item: Item) => { item.element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }); item.element.focus(); window.setTimeout(() => activateElement(item.element), 180); record(`Ação executada: ${item.label}`) }
  const reset = () => { setFontScale(100); setContrast(false); setHighlight(false); setReducedMotion(false); window.speechSynthesis.cancel(); setReading(false); record('Preferências restauradas') }

  const onPointerDown = (event: React.PointerEvent) => { drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y, moved: false }; event.currentTarget.setPointerCapture(event.pointerId) }
  const onPointerMove = (event: React.PointerEvent) => { if (!drag.current || event.buttons !== 1) return; drag.current.moved = true; setPosition({ x: Math.max(8, Math.min(event.clientX - drag.current.dx, window.innerWidth - 64)), y: Math.max(8, Math.min(event.clientY - drag.current.dy, window.innerHeight - 64)) }) }
  const onPointerUp = (event: React.PointerEvent) => { event.currentTarget.releasePointerCapture(event.pointerId); if (!drag.current?.moved) setOpen(true); drag.current = null }

  const panelLeft = position.x > window.innerWidth / 2 ? undefined : Math.max(12, position.x)
  const panelRight = position.x > window.innerWidth / 2 ? Math.max(12, window.innerWidth - position.x - 56) : undefined

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setView('home') }
      if (!event.altKey) return
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); setOpen((value) => !value) }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); setOpen(true); setView('voice'); runVoice() }
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); setOpen(true); setView('reading'); speak() }
    }
    document.addEventListener('keydown', shortcuts)
    return () => document.removeEventListener('keydown', shortcuts)
  })

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {open && <section role="dialog" aria-label="Menu de acessibilidade" className="pointer-events-auto absolute flex w-[min(342px,calc(100vw-24px))] flex-col overflow-hidden rounded-[26px] border border-slate-300/80 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,.22)] backdrop-blur-2xl" style={{ left: panelLeft, right: panelRight, top: 12, maxHeight: 'calc(100dvh - 24px)' }}>
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-5 py-4"><div className="flex min-w-0 items-center gap-3">{view !== 'home' && <button aria-label="Voltar" onClick={() => { setView('home'); setMessage('') }} className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"><ArrowLeft size={16} /></button>}<div><p className="truncate text-sm font-semibold text-slate-900">{view === 'home' ? 'Acessibilidade' : menus.find((item) => item.id === view)?.label}</p><p className="text-[11px] text-slate-400">Skip Assistive</p></div></div><button aria-label="Fechar" onClick={() => { setOpen(false); setView('home') }} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X size={16} /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 p-3.5">
          {view === 'home' ? <div className="grid grid-cols-3 gap-2.5">{menus.map((item) => <button key={item.id} onClick={() => { setView(item.id); setMessage('') }} className="group flex min-h-[82px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md active:scale-[.98]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span><span className="text-[11px] font-semibold">{item.label}</span></button>)}</div> : <WidgetView view={view} interactive={interactive} links={links} message={message} listening={listening} reading={reading} fontScale={fontScale} contrast={contrast} highlight={highlight} reducedMotion={reducedMotion} historyItems={historyItems} navigationMode={navigationMode} onNavigationMode={setNavigationMode} onGuidedStep={executeGuidedStep} pendingNavigation={pendingNavigation} onVoice={runVoice} onSpeak={speak} onActivate={activate} onFont={setFontScale} onContrast={setContrast} onHighlight={setHighlight} onMotion={setReducedMotion} onReset={reset} />}
          {view === 'home' && pendingNavigation.length > 0 && navigationMode === 'guided' && <div className="mt-3"><ActionButton onClick={executeGuidedStep}>Executar próximo passo: {pendingNavigation[0].label}</ActionButton></div>}
        </div>
      </section>}
      {!open && <button aria-label="Abrir menu de acessibilidade" className="pointer-events-auto absolute grid h-14 w-14 cursor-grab place-items-center rounded-2xl border border-blue-300/70 bg-white/95 text-blue-600 shadow-[0_12px_30px_rgba(37,99,235,.25)] backdrop-blur-xl transition hover:scale-105 active:cursor-grabbing" style={{ left: position.x, top: position.y }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}><Compass size={23} /></button>}
    </div>
  )
}

function collectInteractive(): Item[] {
  return Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="combobox"], summary')).filter((el) => !el.closest('[role="dialog"]') && el.offsetParent !== null).map((element, index) => ({ element, label: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.getAttribute('name') || `Elemento ${index + 1}`).trim().replace(/\s+/g, ' ').slice(0, 70) }))
}

// Em uma instalação para um único app, o navegador mantém um pequeno grafo
// local das telas visitadas e dos links internos observados em cada tela.
function findLocalNavigation(command: string, currentPath: string): any {
  const normalizedCommand = normalizeNavigationText(command)
  const navigationIntent = /\b(ir|va|vou|naveg|abr|acess|cheg|leve|levar|voltar|retornar)\b/.test(normalizedCommand)
  if (!navigationIntent) return { action: 'UNKNOWN', matches: [], suggestions: [] }
  let screens: Record<string, any> = {}
  try { screens = JSON.parse(localStorage.getItem('skip-screen-map-v1') || '{}') } catch { /* storage may be disabled */ }
  if (!screens[currentPath]) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'current_screen_unknown', suggestions: [] }

  const stopWords = new Set(['quero', 'preciso', 'gostaria', 'ir', 'va', 'vou', 'ate', 'para', 'por', 'favor', 'me', 'leve', 'pagina', 'tela', 'abrir', 'acessar', 'navegar', 'chegar', 'a', 'o', 'da', 'do', 'na', 'no'])
  const terms = normalizedCommand.split(' ').filter((word) => word.length > 1 && !stopWords.has(word))
  const destinations = new Map<string, any>(Object.values(screens).map((screen: any) => [screen.path, screen]))
  for (const screen of Object.values(screens) as any[]) for (const action of screen.actions || []) {
    if (action.targetRoute && !destinations.has(action.targetRoute)) destinations.set(action.targetRoute, { path: action.targetRoute, title: action.name, content: '' })
  }
  const candidates = Array.from(destinations.values()).map((screen: any) => {
    const primary = normalizeNavigationText(`${screen.title || ''} ${screen.path || ''}`)
    const supporting = normalizeNavigationText(screen.content || '')
    const score = terms.reduce((sum, term) => sum + (primary.includes(term) ? 3 : supporting.includes(term) ? 1 : 0), 0)
    return { screen, score }
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score)
  if (!candidates.length) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'destination_not_found', suggestions: [] }
  const targets = candidates.filter((candidate) => candidate.score === candidates[0].score)
  if (targets.length > 1) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'ambiguous_destination', suggestions: targets.slice(0, 4).map(({ screen }: any) => ({ name: screen.title, path: screen.path })) }
  const targetPath = targets[0].screen.path
  if (targetPath === currentPath) return { action: 'NAVIGATE', navigationFound: true, target: { name: targets[0].screen.title }, steps: [] }

  const queue: Array<{ path: string; steps: NavigationStep[] }> = [{ path: currentPath, steps: [] }]
  const visited = new Set([currentPath])
  while (queue.length) {
    const current = queue.shift()!
    const screen = screens[current.path]
    for (const action of screen?.actions || []) {
      const nextPath = String(action.targetRoute || '')
      if (!nextPath || visited.has(nextPath)) continue
      const match = { name: action.name, metadata: { label: action.name, cssSelector: action.selector, targetRoute: nextPath, kind: 'navigation', intent: 'navigate' } }
      const steps = [...current.steps, { action: 'NAVIGATE', label: action.name, targetPath: nextPath, automaticSafe: true, match }]
      if (nextPath === targetPath) return { action: 'NAVIGATE', navigationFound: true, target: { name: targets[0].screen.title, path: targetPath }, confidence: 0.9, steps }
      if (screens[nextPath]) { visited.add(nextPath); queue.push({ path: nextPath, steps }) }
    }
  }
  return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'no_path', target: { name: targets[0].screen.title, path: targetPath }, suggestions: [] }
}

function normalizeNavigationText(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function loadLocalScreenMap() {
  try {
    const response = await fetch(new URL('/widget-screen-map.json', window.location.origin))
    if (!response.ok) return
    const map = await response.json()
    if (!map?.screens || typeof map.screens !== 'object') return
    const existing = JSON.parse(localStorage.getItem('skip-screen-map-v1') || '{}')
    localStorage.setItem('skip-screen-map-v1', JSON.stringify({ ...map.screens, ...existing }))
  } catch { /* the app can still use the map observed in the browser */ }
}

// Localiza um elemento do DOM a partir de uma entidade retornada pelo motor NLU
// (cssSelector, anchorId, inputName, targetRoute ou nome).
function findElementForMatch(match: any): HTMLElement | null {
  const meta = match?.metadata || {}
  const selectors: string[] = []
  if (meta.cssSelector) selectors.push(meta.cssSelector)
  if (meta.anchorId) selectors.push(`#${CSS.escape(meta.anchorId)}`, `[data-skip-anchor="${CSS.escape(meta.anchorId)}"]`)
  if (meta.inputName) selectors.push(`[name="${CSS.escape(meta.inputName)}"]`)
  if (meta.targetRoute) selectors.push(`a[href="${CSS.escape(meta.targetRoute)}"]`)
  for (const sel of selectors) {
    try {
      const found = document.querySelector<HTMLElement>(sel)
      if (found) return found
    } catch { /* invalid selector */ }
  }
  const label = String(meta.label || match?.name || '').toLowerCase().trim()
  if (!label) return null
  const candidates = document.querySelectorAll<HTMLElement>('button,a,[role="button"],input,textarea,select,[aria-label]')
  for (const el of Array.from(candidates)) {
    const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').toLowerCase()
    if (text === label || text.includes(label)) return el
  }
  return null
}

function activateElement(el: HTMLElement) {
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* noop */ }
  el.focus({ preventScroll: true })
  ;['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })) } catch { /* noop */ }
  })
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null
  const before = window.location.href
  el.click()
  if (anchor?.href && anchor.target !== '_blank') {
    window.setTimeout(() => { if (window.location.href === before) window.location.assign(anchor.href) }, 250)
  }
}

async function waitForPathChange(expectedPath: string, beforePath: string) {
  const expected = expectedPath ? new URL(expectedPath, window.location.origin) : null
  const matches = () => !expected || (window.location.pathname === expected.pathname && window.location.search === expected.search)
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    if (window.location.pathname !== beforePath && matches()) return true
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return false
}

async function executeNavigationStep(step: NavigationStep, continuation: { steps: NavigationStep[]; mode: 'guided' | 'automatic' }) {
  if (!step.automaticSafe || !step.match?.metadata?.targetRoute || step.match.metadata.kind !== 'navigation' || step.match.metadata.intent === 'submit') return { ok: false, message: `O controle “${step.label}” não tem destino de navegação confirmado. Navegação interrompida.` }
  const element = findElementForMatch(step.match)
  if (!element || !(element.matches('a[href],button,[role="link"],[role="button"]'))) return { ok: false, message: `Não encontrei o controle “${step.label}” na tela. Navegação interrompida.` }
  if (element instanceof HTMLButtonElement && element.type === 'submit') return { ok: false, message: `O controle “${step.label}” envia um formulário e não será ativado pela navegação automática.` }
  const anchor = element.closest('a[href]') as HTMLAnchorElement | null
  if (anchor?.target === '_blank') return { ok: false, message: `O controle “${step.label}” abre outra aba e não será ativado automaticamente.` }
  const beforePath = window.location.pathname
  try { sessionStorage.setItem(navigationSessionKey, JSON.stringify({ steps: continuation.steps, mode: continuation.mode, expectedPath: step.targetPath || step.match.metadata.targetRoute })) } catch { /* session storage may be disabled */ }
  activateElement(element)
  const moved = await waitForPathChange(step.targetPath || step.match.metadata.targetRoute, beforePath)
  return moved ? { ok: true, message: '' } : { ok: false, message: `A tela não mudou após ativar “${step.label}”. Navegação interrompida.` }
}

async function runAutomaticNavigation(steps: NavigationStep[], record: (text: string) => void) {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    const result = await executeNavigationStep(step, { steps: steps.slice(index + 1), mode: 'automatic' })
    if (!result.ok) { sessionStorage.removeItem(navigationSessionKey); record(result.message); return }
    sessionStorage.removeItem(navigationSessionKey)
  }
  record('Você chegou à tela solicitada.')
}

function WidgetView(props: any) {
  const { view, interactive, links, message } = props
  if (view === 'voice') return <div className="space-y-3 text-center"><div className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${props.listening ? 'animate-pulse bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{props.listening ? <MicOff size={30} /> : <Mic size={30} />}</div><p className="text-sm font-semibold text-slate-800">{props.listening ? 'Estou ouvindo…' : 'Navegação por voz'}</p><p className="text-xs leading-5 text-slate-500">Diga “Projetos”, “aumentar fonte”, “contraste” ou o nome de um botão.</p><ActionButton onClick={props.onVoice}>{props.listening ? 'Parar de ouvir' : 'Ativar microfone'}</ActionButton>{message && <Feedback>{message}</Feedback>}</div>
  if (view === 'actions' || view === 'navigate') { const items = view === 'navigate' ? links : interactive; return <List title={view === 'navigate' ? 'Links desta página' : 'Elementos disponíveis'} items={items} onActivate={props.onActivate} empty="Nenhum elemento interativo encontrado." /> }
  if (view === 'shortcuts') return <div className="space-y-2"><Shortcut keys="Alt + A" label="Abrir ou fechar widget" /><Shortcut keys="Alt + V" label="Ativar voz" /><Shortcut keys="Alt + L" label="Ler a página" /><Shortcut keys="Esc" label="Fechar painel" /><p className="pt-2 text-xs leading-5 text-slate-500">Os atalhos ficam disponíveis enquanto o widget está carregado.</p></div>
  if (view === 'guided') return <div className="space-y-3"><Info icon={<Focus />} title="Navegação guiada" text={`Encontramos ${interactive.length} elementos nesta tela. Escolha o primeiro passo e o Skip moverá o foco e executará a ação.`} /><List items={interactive.slice(0, 8)} onActivate={props.onActivate} empty="Não há passos disponíveis." /></div>
  if (view === 'highlight') return <div className="space-y-3"><Info icon={<Highlighter />} title="Destaque de controles" text="Cria contornos visíveis em links, botões e campos para facilitar a identificação dos elementos interativos." /><Toggle label="Destacar elementos" active={props.highlight} onClick={() => props.onHighlight(!props.highlight)} icon={<Highlighter />} /></div>
  if (view === 'reading') return <div className="space-y-3 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-100 text-violet-600">{props.reading ? <Pause size={27} /> : <BookOpen size={27} />}</div><p className="text-sm leading-6 text-slate-600">Leia em voz alta o conteúdo principal da página.</p><ActionButton onClick={() => props.onSpeak()}>{props.reading ? 'Pausar leitura' : 'Ler esta página'}</ActionButton>{message && <Feedback>{message}</Feedback>}</div>
  if (view === 'display' || view === 'settings') return <div className="space-y-3"><Control label="Tamanho do texto" value={`${props.fontScale}%`}><button onClick={() => props.onFont(Math.max(80, props.fontScale - 10))}>−</button><button onClick={() => props.onFont(Math.min(140, props.fontScale + 10))}>+</button></Control><Toggle label="Alto contraste" active={props.contrast} onClick={() => props.onContrast(!props.contrast)} icon={<Eye />} /><Toggle label="Destacar elementos" active={props.highlight} onClick={() => props.onHighlight(!props.highlight)} icon={<Highlighter />} /><Toggle label="Reduzir movimento" active={props.reducedMotion} onClick={() => props.onMotion(!props.reducedMotion)} icon={<Pause />} /><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-semibold text-slate-700">Como navegar entre telas</p><div className="grid grid-cols-2 gap-2"><button aria-pressed={props.navigationMode === 'guided'} onClick={() => props.onNavigationMode('guided')} className={`rounded-lg py-2 text-xs font-semibold ${props.navigationMode === 'guided' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Passo a passo</button><button aria-pressed={props.navigationMode === 'automatic'} onClick={() => props.onNavigationMode('automatic')} className={`rounded-lg py-2 text-xs font-semibold ${props.navigationMode === 'automatic' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Automática</button></div></div>{props.pendingNavigation?.length > 0 && <ActionButton onClick={props.onGuidedStep}>Executar próximo passo: {props.pendingNavigation[0].label}</ActionButton>}<button onClick={props.onReset} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw size={14} /> Restaurar preferências</button></div>
  if (view === 'history') return <div className="space-y-2">{props.historyItems.length ? props.historyItems.map((item: string, index: number) => <div key={`${item}-${index}`} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" /><p className="text-xs leading-5 text-slate-600">{item}</p></div>) : <Info icon={<History />} title="Histórico vazio" text="As ações executadas pelo widget aparecerão aqui." />}</div>
  return <div className="space-y-3"><Info icon={<CircleHelp />} title="Como usar" text="Escolha uma função na tela inicial. Voz encontra botões pelo nome; Ações lista controles; Leitura narra a página; Tela ajusta a visualização." /><Info icon={<Settings2 />} title="Dica" text="Você pode arrastar o botão flutuante para qualquer canto da tela. O painel sempre abrirá totalmente visível." /></div>
}

function ActionButton({ onClick, children }: any) { return <button onClick={onClick} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">{children}</button> }
function Feedback({ children }: any) { return <p className="rounded-xl bg-white p-3 text-xs leading-5 text-slate-600 shadow-sm">{children}</p> }
function List({ title, items, onActivate, empty }: any) { return <div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">{title}</p><span className="text-[10px] text-slate-400">{items.length} itens</span></div><div className="space-y-1.5">{items.length ? items.slice(0, 12).map((item: Item, index: number) => <button key={`${item.label}-${index}`} onClick={() => onActivate(item)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-medium text-slate-700 hover:border-blue-200 hover:bg-blue-50"><span className="truncate">{item.label}</span><ChevronRight size={14} className="shrink-0 text-slate-400" /></button>) : <p className="rounded-xl bg-white p-4 text-center text-xs text-slate-400">{empty}</p>}</div></div> }
function Shortcut({ keys, label }: any) { return <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3"><span className="text-xs text-slate-600">{label}</span><kbd className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{keys}</kbd></div> }
function Info({ icon, title, text }: any) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-blue-600">{icon}<p className="text-xs font-semibold text-slate-800">{title}</p></div><p className="mt-2 text-xs leading-5 text-slate-500">{text}</p></div> }
function Toggle({ label, active, onClick, icon }: any) { return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left"><span className="text-blue-600">{icon}</span><span className="flex-1 text-xs font-semibold text-slate-700">{label}</span><span className={`h-5 w-9 rounded-full p-0.5 transition ${active ? 'bg-blue-600' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition ${active ? 'translate-x-4' : ''}`} /></span></button> }
function Control({ label, value, children }: any) { return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-3 flex justify-between text-xs"><span className="font-semibold text-slate-700">{label}</span><span className="text-slate-400">{value}</span></div><div className="grid grid-cols-2 gap-2 [&>button]:rounded-lg [&>button]:bg-slate-100 [&>button]:py-2 [&>button]:text-lg [&>button]:font-semibold [&>button]:text-slate-700 hover:[&>button]:bg-blue-50">{children}</div></div> }
