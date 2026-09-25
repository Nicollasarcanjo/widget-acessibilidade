import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Command, Compass,
  Eye, Focus, Settings, Highlighter, History, Mic, MicOff, MousePointerClick,
  Pause, RotateCcw, Settings2, Sparkles, Volume2, X,
} from 'lucide-react'

type View = 'home' | 'goal' | 'voice' | 'actions' | 'shortcuts' | 'highlight' | 'guided' | 'reading' | 'settings' | 'history' | 'help'
type Item = { label: string; element: HTMLElement }
type CatalogEntry = { id: string; name: string; type?: string; kind?: string; path?: string; route?: string; ownerId?: string; ownerType?: string; ownerName?: string; targetId?: string; targetName?: string; targetPath?: string; targetRoute?: string; selector?: string; confirmed?: boolean; confirmedNavigation?: boolean; confirmedDialogOpener?: boolean; aliases?: string[]; alternatives?: Array<{ id: string; name: string }> }
type NavigationStep = { action: string; label: string; stepNumber?: number; targetPath?: string; targetStateId?: string; targetStateName?: string; targetStateSelector?: string; automaticSafe?: boolean; match?: any }
const widgetParams = new URLSearchParams(window.location.search)
const widgetToken = widgetParams.get('token') || ''
const widgetApiBase = (widgetParams.get('api') || '').replace(/\/$/, '')
const navigationSessionKey = 'skip-pending-navigation'
const widgetOpenKey = 'skip-widget-open'
function widgetEndpoint(name: string) {
  const url = new URL(`${widgetApiBase}/backend/v1/widget/${name}`, window.location.origin)
  if (widgetToken) url.searchParams.set('token', widgetToken)
  return url.toString()
}

const menus: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'goal', label: 'Navegar por objetivo', icon: <Compass /> },
  { id: 'voice', label: 'Voz', icon: <Mic /> }, { id: 'actions', label: 'Ações', icon: <MousePointerClick /> },
  { id: 'shortcuts', label: 'Atalhos', icon: <Command /> }, { id: 'guided', label: 'Guiado', icon: <Sparkles /> },
  { id: 'highlight', label: 'Destaque', icon: <Highlighter /> },
  { id: 'reading', label: 'Leitura', icon: <Volume2 /> },
  { id: 'settings', label: 'Preferências', icon: <Settings /> },
  { id: 'history', label: 'Histórico', icon: <History /> }, { id: 'help', label: 'Ajuda', icon: <CircleHelp /> },
]

export function AssistiveWidget() {
  const location = useLocation()
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(widgetOpenKey) === 'true' || Boolean(sessionStorage.getItem(navigationSessionKey)) } catch { return false }
  })
  const [view, setView] = useState<View>('home')
  const [fontScale, setFontScale] = useState(100)
  const [contrast, setContrast] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [reading, setReading] = useState(false)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState('')
  const [transcript, setTranscript] = useState('')
  const [goalQuery, setGoalQuery] = useState('')
  const [catalogScreens, setCatalogScreens] = useState<CatalogEntry[]>([])
  const [catalogActions, setCatalogActions] = useState<CatalogEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [localScreenMap, setLocalScreenMap] = useState<Record<string, any>>({})
  const [activityVersion, setActivityVersion] = useState(0)
  const [interactive, setInteractive] = useState<Item[]>([])
  const [automaticNavigating, setAutomaticNavigating] = useState(false)
  const [historyItems, setHistoryItems] = useState<string[]>([])
  const [navigationMode, setNavigationMode] = useState<'guided' | 'automatic'>(() => {
    try { return localStorage.getItem('skip-navigation-mode') === 'automatic' ? 'automatic' : 'guided' } catch { return 'guided' }
  })
  const [pendingNavigation, setPendingNavigation] = useState<NavigationStep[]>([])
  const [position, setPosition] = useState({ x: Math.max(12, window.innerWidth - 76), y: Math.max(12, window.innerHeight - 76) })
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  const recognition = useRef<any>(null)
  const voiceFinalized = useRef(false)
  const guidedClickTimer = useRef<number | null>(null)
  const advanceGuidedRef = useRef<(step: NavigationStep) => void>(() => undefined)
  const previousLocationRef = useRef(`${location.pathname}${location.search}`)
  const observedClickRef = useRef<any>(null)
  const lastObservedUiStateRef = useRef('')

  const record = (text: string) => { setHistoryItems((items) => [text, ...items].slice(0, 12)); setMessage(text) }

  useEffect(() => {
    if (!open) { setInteractive([]); return }
    let frame = 0
    const refresh = () => {
      frame = 0
      const next = collectInteractive()
      setInteractive((current) => current.length === next.length && current.every((item, index) => item.element === next[index].element && item.label === next[index].label) ? current : next)
    }
    const scheduleRefresh = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(refresh)
    }
    const observer = new MutationObserver(scheduleRefresh)
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-hidden', 'aria-label', 'class', 'disabled', 'href', 'hidden', 'open', 'style', 'tabindex'],
    })
    refresh()
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame) }
  }, [open, location.pathname, location.search])

  useEffect(() => {
    if (!open || view !== 'goal') return
    let cancelled = false
    setCatalogLoading(true)
    if (!widgetToken) {
      void loadLocalScreenMap()
        .then((map) => {
          if (cancelled) return
          setLocalScreenMap(map.screens || {})
          setCatalogScreens(Array.isArray(map.catalog?.screens) ? map.catalog.screens : Object.values(map.screens || {}).map((screen: any) => ({ id: screen.path, name: screen.title, type: 'ROUTE', path: screen.path, aliases: [] })))
          setCatalogActions(Array.isArray(map.catalog?.actions) ? map.catalog.actions : Object.values(map.screens || {}).flatMap((screen: any) => (screen.actions || []).map((action: any) => ({ ...action, id: `${screen.path}:${action.name}`, kind: 'navigation', route: screen.path, confirmed: true, confirmedNavigation: true }))))
        })
        .catch(() => { if (!cancelled) { setCatalogScreens([]); setCatalogActions([]) } })
        .finally(() => { if (!cancelled) setCatalogLoading(false) })
      return () => { cancelled = true }
    }
    void fetch(widgetEndpoint('catalog'))
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
      .then((data) => {
        if (cancelled) return
        setCatalogScreens(Array.isArray(data.screens) ? data.screens : [])
        setCatalogActions(Array.isArray(data.actions) ? data.actions : [])
      })
      .catch(() => {
        if (!cancelled) { setCatalogScreens([]); setCatalogActions([]) }
      })
      .finally(() => { if (!cancelled) setCatalogLoading(false) })
    return () => { cancelled = true }
  }, [open, view, location.pathname])

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(navigationSessionKey) || 'null')
      if (!saved) return
      sessionStorage.removeItem(navigationSessionKey)
      const expected = new URL(saved.expectedPath || '/', window.location.origin)
      if (window.location.pathname !== expected.pathname || window.location.search !== expected.search) {
        setMessage('A navegação foi interrompida porque a tela não correspondeu ao caminho previsto.')
        setOpen(false)
        return
      }
      setOpen(true)
      const remaining = Array.isArray(saved.steps) ? saved.steps as NavigationStep[] : []
      if (saved.mode === 'automatic') {
        window.setTimeout(() => {
          const expectedState: NavigationStep | null = saved.expectedStateId ? { action: 'OPEN_STATE', label: saved.expectedStateName || 'Diálogo', targetStateId: saved.expectedStateId, targetStateName: saved.expectedStateName, targetStateSelector: saved.expectedStateSelector } : null
          if (expectedState && !isTargetUiStateVisible(expectedState)) { setMessage('A navegação foi interrompida porque o diálogo esperado não apareceu.'); return }
          setAutomaticNavigating(true)
          void runAutomaticNavigation(remaining, record).finally(() => setAutomaticNavigating(false))
        }, 400)
      } else if (remaining.length) {
        setPendingNavigation(remaining)
        setMessage(`Próximo passo: ${remaining[0].label}.`)
      } else setMessage('Você chegou à tela solicitada.')
    } catch { /* session storage may be unavailable */ }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(widgetOpenKey, String(open)) } catch { /* storage may be disabled */ }
  }, [open])

  useEffect(() => {
    if (!open || listening || automaticNavigating || (navigationMode === 'automatic' && pendingNavigation.length > 0)) return
    const timeout = window.setTimeout(() => setOpen(false), 10_000)
    return () => window.clearTimeout(timeout)
  }, [open, listening, automaticNavigating, navigationMode, pendingNavigation.length, activityVersion])

  useEffect(() => {
    const current = `${location.pathname}${location.search}`
    const previous = previousLocationRef.current
    previousLocationRef.current = current
    if (!previous || previous === current || !open || navigationMode !== 'guided' || !pendingNavigation.length) return
    const step = pendingNavigation[0]
    if (step.action !== 'NAVIGATE') return
    const expected = step.targetPath || step.match?.metadata?.targetRoute || ''
    const target = expected ? new URL(expected, window.location.origin) : null
    if (target && location.pathname === target.pathname && location.search === target.search) advanceGuidedRef.current(step)
    else {
      setPendingNavigation([])
      setMessage('A navegação foi interrompida porque a tela aberta não corresponde ao passo indicado.')
      sessionStorage.removeItem(navigationSessionKey)
    }
  }, [location.pathname, location.search, open, navigationMode, pendingNavigation])

  useEffect(() => {
    if (!open || navigationMode !== 'guided' || pendingNavigation[0]?.action !== 'OPEN_STATE') return
    const observer = new MutationObserver(() => {
      if (isTargetUiStateVisible(pendingNavigation[0])) advanceGuidedRef.current(pendingNavigation[0])
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'aria-modal', 'class', 'style', 'open'] })
    return () => observer.disconnect()
  }, [open, navigationMode, pendingNavigation])

  useEffect(() => {
    if (!open || navigationMode !== 'guided' || !pendingNavigation.length) return
    const step = pendingNavigation[0]
    const element = step.action === 'OPEN_STATE' || step.action === 'NAVIGATE' || step.action === 'WAIT_INPUT' || step.action === 'HIGHLIGHT'
      ? findElementForMatch(step.match)
      : null
    if (!element) {
      setMessage(`Não encontrei o controle “${step.label}” nesta tela. Navegação interrompida.`)
      setPendingNavigation([])
      return
    }
    highlightElement(element, step.label, reducedMotion ? 'auto' : 'smooth')
    setMessage(`Passo ${step.stepNumber || 1} de ${pendingNavigation.length}: destaque em “${step.label}”. Faça essa ação para continuar.`)
    return () => clearGuidedHighlight()
  }, [open, navigationMode, pendingNavigation, reducedMotion])

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.skipInternal = 'true'
    style.textContent = `.skip-internal-highlight a[href],.skip-internal-highlight button:not([disabled]),.skip-internal-highlight input:not([type=hidden]),.skip-internal-highlight textarea,.skip-internal-highlight select,.skip-internal-highlight [role=button],.skip-internal-highlight [role=link],.skip-internal-highlight [role=combobox],.skip-internal-highlight [contenteditable=true],.skip-internal-highlight summary,.skip-internal-highlight [tabindex]:not([tabindex="-1"]){outline:3px solid #2563eb!important;outline-offset:3px!important}.skip-guided-highlight{outline:4px solid #2563eb!important;outline-offset:4px!important;box-shadow:0 0 0 7px rgba(37,99,235,.25)!important;position:relative;z-index:9998}.skip-reduced-motion *{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`
    document.head.appendChild(style)
    return () => { clearGuidedHighlight(); style.remove(); window.speechSynthesis?.cancel(); recognition.current?.stop?.() }
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
    if (!widgetToken) return
    const timer = window.setTimeout(() => {
      const actions = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[role="link"],[role="button"]'))
        .filter((element) => !element.closest('[role="dialog"]') && element.offsetParent !== null)
        .slice(0, 100)
        .map((element) => ({
          name: (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
          href: element.matches('a[href]') ? (element as HTMLAnchorElement).href : '',
          selector: element.id ? `#${CSS.escape(element.id)}` : element.getAttribute('data-skip-anchor') ? `[data-skip-anchor="${CSS.escape(element.getAttribute('data-skip-anchor')!)}"]` : '',
        }))
        .filter((action) => action.name)
      void fetch(widgetEndpoint('observe'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: window.location.pathname, title: document.title, content: (document.querySelector('main')?.textContent || document.body.innerText).slice(0, 6000), actions }),
      }).catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  useEffect(() => {
    if (!widgetToken) return
    let timer = 0
    const selectorFor = (element: HTMLElement) => element.id ? `#${CSS.escape(element.id)}` : element.getAttribute('data-testid') ? `[data-testid="${CSS.escape(element.getAttribute('data-testid')!)}"]` : element.getAttribute('aria-label') ? `[aria-label="${CSS.escape(element.getAttribute('aria-label')!)}"]` : ''
    const rememberClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('a[href],button,[role="button"],[role="link"]') : null
      if (!target || target.closest('[data-skip-widget-root]')) return
      const dialog = target.closest<HTMLElement>('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]')
      observedClickRef.current = { name: (target.getAttribute('aria-label') || target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), selector: selectorFor(target), ownerState: dialog?.getAttribute('aria-label') || '', at: Date.now() }
    }
    const captureState = () => {
      const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]')).find((item) => item.offsetParent !== null && !item.closest('[data-skip-widget-root]'))
      if (!dialog) { lastObservedUiStateRef.current = ''; return }
      const name = String(dialog.getAttribute('aria-label') || dialog.querySelector('h1,h2,h3,[role="heading"]')?.textContent || dialog.innerText || 'Diálogo').trim().replace(/\s+/g, ' ').slice(0, 160)
      const content = String(dialog.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 3000)
      const selector = selectorFor(dialog) || (dialog.id ? `#${CSS.escape(dialog.id)}` : '[role="dialog"]')
      const fields = Array.from(dialog.querySelectorAll<HTMLElement>('input:not([type="hidden"]),textarea,select,[contenteditable="true"]')).map((field, index) => ({
        name: String(field.getAttribute('aria-label') || (field as HTMLInputElement).labels?.[0]?.textContent || field.getAttribute('placeholder') || field.getAttribute('name') || `Campo ${index + 1}`).trim().replace(/\s+/g, ' ').slice(0, 120),
        selector: selectorFor(field), inputName: field.getAttribute('name') || '', inputType: field.getAttribute('type') || field.tagName.toLowerCase(), required: field.hasAttribute('required'),
      }))
      const fingerprint = `${window.location.pathname}:${name}:${selector}:${content}`
      if (fingerprint === lastObservedUiStateRef.current) return
      lastObservedUiStateRef.current = fingerprint
      const click = observedClickRef.current
      const openedBy = click && Date.now() - click.at < 4000 && click.name ? { name: click.name, selector: click.selector } : null
      if (openedBy) observedClickRef.current = null
      const actions = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[role="link"],[role="button"]')).filter((control) => !control.closest('[role="dialog"],[role="alertdialog"],[data-skip-widget-root]') && control.offsetParent !== null).slice(0, 100).map((control) => ({
        name: (control.getAttribute('aria-label') || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        href: control.matches('a[href]') ? (control as HTMLAnchorElement).href : '', selector: selectorFor(control),
      })).filter((control) => control.name)
      void fetch(widgetEndpoint('observe'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: window.location.pathname, title: document.title, content: (document.querySelector('main')?.textContent || document.body.innerText).slice(0, 6000), actions, currentState: { name, selector, content, fields }, openedBy }) }).catch(() => undefined)
    }
    const scheduleCapture = () => { window.clearTimeout(timer); timer = window.setTimeout(captureState, 180) }
    document.addEventListener('click', rememberClick, true)
    const observer = new MutationObserver(scheduleCapture)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'aria-modal', 'class', 'style', 'open'] })
    scheduleCapture()
    return () => { window.clearTimeout(timer); observer.disconnect(); document.removeEventListener('click', rememberClick, true) }
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
    const instance = new Recognition(); recognition.current = instance; instance.lang = 'pt-BR'; instance.interimResults = true; instance.continuous = false
    voiceFinalized.current = false
    instance.onstart = () => { setListening(true); setTranscript(''); setActivityVersion((value) => value + 1); setMessage('Ouvindo…') }
    instance.onend = () => setListening(false)
    instance.onerror = () => record('Não consegui ouvir. Tente novamente.')
    instance.onresult = (event: any) => {
      let finalText = ''
      let partialText = ''
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        const text = String(result?.[0]?.transcript || '')
        if (result.isFinal) finalText += text
        else partialText += text
      }
      if (partialText) setTranscript(partialText.trim())
      if (finalText.trim() && !voiceFinalized.current) {
        voiceFinalized.current = true
        setTranscript(finalText.trim())
        void executeVoice(finalText.trim())
      }
    }
    instance.start()
  }

  const executeVoice = async (command: string, source: 'voz' | 'texto' = 'voz', targetId = '') => {
    const normalized = command.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); record(`${source === 'voz' ? 'Voz' : 'Pedido'}: “${command}”`)
    // Comandos simples locais (resposta imediata).
    if (/\b(aumentar|aumente|aumenta) (a )?fonte\b/.test(normalized)) return setFontScale((v) => Math.min(140, v + 10))
    if (/\b(diminuir|diminua|diminui) (a )?fonte\b/.test(normalized)) return setFontScale((v) => Math.max(80, v - 10))
    if (/\b(ler|leia) (a )?pagina\b/.test(normalized)) return speak()
    if (normalized.includes('contraste')) return setContrast((v) => !v)
    const asksForDestination = /\b(ir|va|vai|vou|naveg\w*|abr\w*|acess\w*|cheg\w*|lev\w*|voltar|retornar|quero ir|gostaria de ir)\b/.test(normalized)
    const exactControl = asksForDestination ? null : findExactVoiceControl(command)
    if (exactControl && navigationMode === 'guided') {
      setOpen(true)
      setActivityVersion((value) => value + 1)
      highlightElement(exactControl.element, exactControl.label, reducedMotion ? 'auto' : 'smooth')
      record(`Destaque em: ${exactControl.label}. Ative o controle para continuar.`)
      return
    }
    // Demais comandos: usa o motor NLU do servidor (fonte de verdade).
    try {
      let data: any
      if (widgetToken) {
        const res = await fetch(widgetEndpoint('command'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: command, path: window.location.pathname, url: window.location.href, currentStateName: currentDialogName(), targetId }),
        })
        data = await res.json()
      } else if (asksForDestination) {
        const localMap = await loadLocalScreenMap()
        setLocalScreenMap(localMap.screens || {})
        data = findLocalNavigation(command, window.location.pathname, targetId, localMap)
      } else data = { action: 'UNKNOWN', matches: [], suggestions: [] }
      if (data.action === 'READ') { speak(); return }
      if (data.action === 'SETTINGS' && /contraste/.test(normalized)) { setContrast((v) => !v); return }
      if (data.action === 'NAVIGATE') {
        if (data.navigationFound === false) {
          if (data.navigationReason === 'current_screen_unknown') setMessage('Não consegui identificar sua tela atual. Abra uma página mapeada e tente novamente.')
          else if (data.navigationReason === 'ambiguous_destination' && data.suggestions?.length) setMessage(`Não consegui decidir qual tela você quis dizer: ${data.suggestions.map((item: any) => item.name).join(', ')}. Tente especificar melhor.`)
          else if (data.navigationReason === 'path_not_found') setMessage(`Encontrei “${data.target?.name || command}” no catálogo, mas o mapa ainda não registra uma sequência de ações saindo desta tela. A skill precisa catalogar o link ou controle que leva até lá.`)
          else if (data.navigationReason === 'target_state_unknown') setMessage(`Encontrei “${data.target?.name || command}”, mas o mapa não informa em qual tela ou diálogo esse item aparece. Atualize o catálogo com a skill /widget.`)
          else if (data.navigationReason === 'destination_not_found') setMessage(`Não encontrei “${data.target?.name || command}” no catálogo de telas e ações. Execute /widget para catalogar o projeto.`)
          else setMessage(`Não encontrei um caminho mapeado até “${data.target?.name || command}”. Tente outro nome ou peça ajuda.`)
          return
        }
        if (!data.steps?.length) { setMessage(`Você já está em ${data.target?.name || 'na tela solicitada'}.`); return }
        const numberedSteps = data.steps.map((step: NavigationStep, index: number) => ({ ...step, stepNumber: index + 1 }))
        setPendingNavigation(numberedSteps)
        setOpen(true)
        setActivityVersion((value) => value + 1)
        if (navigationMode === 'automatic') {
          setAutomaticNavigating(true)
          try { await runAutomaticNavigation(numberedSteps, record) }
          finally { setAutomaticNavigating(false); setPendingNavigation([]) }
        }
        else setMessage(`Encontrei ${numberedSteps.length} passo${numberedSteps.length === 1 ? '' : 's'}. Vou destacar o primeiro; você realiza cada ação.`)
        return
      }
      const best = (data.matches || []).sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))[0]
      if (best) {
        const el = findElementForMatch(best)
        if (el) { highlightElement(el, best.name, reducedMotion ? 'auto' : 'smooth'); record(`Destaque em: ${best.name}. Ative o controle para continuar.`); return }
      }
      // Fallback local no DOM atual.
      const target = collectInteractive().find((item) => normalized.includes(item.label.toLowerCase()) || item.label.toLowerCase().includes(normalized))
      if (target) { highlightElement(target.element, target.label, reducedMotion ? 'auto' : 'smooth'); record(`Destaque em: ${target.label}. Ative o controle para continuar.`) }
      else if ((data.suggestions || []).length) setMessage(`Não encontrei. Você quis dizer: ${(data.suggestions || []).map((s: any) => s.name).join(', ')}?`)
      else setMessage(`Não encontrei “${command}” nesta tela`)
    } catch {
      // Servidor indisponível: mantém o comportamento local.
      const target = collectInteractive().find((item) => normalized.includes(item.label.toLowerCase()) || item.label.toLowerCase().includes(normalized))
      if (target) { highlightElement(target.element, target.label, reducedMotion ? 'auto' : 'smooth'); record(`Destaque em: ${target.label}. Ative o controle para continuar.`) }
      else setMessage(`Não encontrei “${command}” nesta tela`)
    }
  }

  const advanceGuidedNavigation = useCallback((step: NavigationStep) => {
    if (pendingNavigation[0]?.label !== step.label) return
    const remaining = pendingNavigation.slice(1)
    setPendingNavigation(remaining)
    setMessage(remaining.length ? `Passo confirmado. Próximo: ${remaining[0].label}.` : 'Você chegou ao conteúdo solicitado.')
    setActivityVersion((value) => value + 1)
    sessionStorage.removeItem(navigationSessionKey)
    if (guidedClickTimer.current) window.clearTimeout(guidedClickTimer.current)
  }, [pendingNavigation])
  advanceGuidedRef.current = advanceGuidedNavigation

  const focusItem = (item: Item) => { highlightElement(item.element, item.label, reducedMotion ? 'auto' : 'smooth'); setActivityVersion((value) => value + 1); record(`Destaque em: ${item.label}. Ative o controle para continuar.`) }
  const searchGoal = () => {
    const query = goalQuery.trim()
    if (!query) return
    const directedQuery = /\b(ir|va|vai|vou|naveg\w*|abr\w*|acess\w*|cheg\w*|lev\w*|voltar|retornar|quero ir|gostaria de ir)\b/i.test(query) ? query : `Quero ir até ${query}`
    setOpen(true)
    setActivityVersion((value) => value + 1)
    void executeVoice(directedQuery, 'texto')
  }
  const selectCatalogEntry = (entry: CatalogEntry) => {
    setGoalQuery(entry.name)
    setOpen(true)
    setActivityVersion((value) => value + 1)
    const targetId = entry.confirmedNavigation || entry.confirmedDialogOpener ? entry.targetId || entry.id : entry.id
    void executeVoice(`Quero ir até ${entry.name}`, 'texto', targetId)
  }
  const reset = () => { setFontScale(100); setContrast(false); setHighlight(false); setReducedMotion(false); window.speechSynthesis.cancel(); setReading(false); record('Preferências restauradas') }

  const onPointerDown = (event: React.PointerEvent) => { drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y, moved: false }; event.currentTarget.setPointerCapture(event.pointerId) }
  const onPointerMove = (event: React.PointerEvent) => { if (!drag.current || event.buttons !== 1) return; drag.current.moved = true; setPosition({ x: Math.max(8, Math.min(event.clientX - drag.current.dx, window.innerWidth - 64)), y: Math.max(8, Math.min(event.clientY - drag.current.dy, window.innerHeight - 64)) }) }
  const onPointerUp = (event: React.PointerEvent) => { event.currentTarget.releasePointerCapture(event.pointerId); if (!drag.current?.moved) { setOpen(true); setActivityVersion((value) => value + 1) }; drag.current = null }

  const noteActivity = () => setActivityVersion((value) => value + 1)
  const closeWidget = () => { setOpen(false); setView('home'); sessionStorage.removeItem(navigationSessionKey) }
  const handleGuidedClick = useCallback((event: MouseEvent) => {
    if (!pendingNavigation.length || navigationMode !== 'guided') return
    const step = pendingNavigation[0]
    const expected = findElementForMatch(step.match)
    const clicked = event.target instanceof Element ? event.target.closest('a,button,[role="button"],[role="link"]') : null
    if (!expected || !clicked || !(clicked === expected || expected.contains(clicked) || clicked.contains(expected))) return
    setOpen(true)
    setActivityVersion((value) => value + 1)
    const remaining = pendingNavigation.slice(1)
    const expectedPath = step.targetPath || step.match?.metadata?.targetRoute || window.location.pathname
    try {
      sessionStorage.setItem(navigationSessionKey, JSON.stringify({ steps: remaining, mode: 'guided', expectedPath, targetStateId: step.targetStateId || '', targetStateSelector: step.targetStateSelector || '' }))
    } catch { /* storage may be disabled */ }
    setActivityVersion((value) => value + 1)
    if (guidedClickTimer.current) window.clearTimeout(guidedClickTimer.current)
    guidedClickTimer.current = window.setTimeout(() => {
      if (navigationMode === 'guided' && pendingNavigation[0]?.label === step.label && `${location.pathname}${location.search}` === `${window.location.pathname}${window.location.search}`) {
        setPendingNavigation([])
        sessionStorage.removeItem(navigationSessionKey)
        setMessage(`Não confirmei a mudança esperada após “${step.label}”. Navegação interrompida.`)
      }
    }, 5000)
  }, [location.pathname, location.search, navigationMode, pendingNavigation])

  useEffect(() => {
    document.addEventListener('click', handleGuidedClick, true)
    return () => document.removeEventListener('click', handleGuidedClick, true)
  }, [handleGuidedClick])

  const panelLeft = position.x > window.innerWidth / 2 ? undefined : Math.max(12, position.x)
  const panelRight = position.x > window.innerWidth / 2 ? Math.max(12, window.innerWidth - position.x - 56) : undefined

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWidget()
      if (!event.altKey) return
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); setActivityVersion((value) => value + 1); setOpen((value) => !value) }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); setActivityVersion((value) => value + 1); setOpen(true); setView('voice'); runVoice() }
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); setActivityVersion((value) => value + 1); setOpen(true); setView('reading'); speak() }
    }
    document.addEventListener('keydown', shortcuts)
    return () => document.removeEventListener('keydown', shortcuts)
  })

  return (
    <div data-skip-widget-root="true" className="pointer-events-none fixed inset-0 z-[9999]">
      {open && <section role="dialog" aria-label="Menu de acessibilidade" onPointerDown={noteActivity} onKeyDown={noteActivity} onClick={noteActivity} className="pointer-events-auto absolute flex w-[min(342px,calc(100vw-24px))] flex-col overflow-hidden rounded-[26px] border border-slate-300/80 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,.22)] backdrop-blur-2xl" style={{ left: panelLeft, right: panelRight, top: 12, maxHeight: 'calc(100dvh - 24px)' }}>
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-5 py-4"><div className="flex min-w-0 items-center gap-3">{view !== 'home' && <button aria-label="Voltar" onClick={() => { setView('home'); setMessage('') }} className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"><ArrowLeft size={16} /></button>}<div><p className="truncate text-sm font-semibold text-slate-900">{view === 'home' ? 'Acessibilidade' : menus.find((item) => item.id === view)?.label}</p><p className="text-[11px] text-slate-400">Skip Assistive</p></div></div><button aria-label="Recolher" onClick={closeWidget} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"><X size={16} /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 p-3.5">
          {view === 'home' ? <div className="grid grid-cols-3 gap-2.5">{menus.map((item) => <button key={item.id} onClick={() => { setView(item.id); setMessage('') }} className="group flex min-h-[82px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md active:scale-[.98]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span><span className="text-[11px] font-semibold">{item.label}</span></button>)}</div> : <WidgetView view={view} interactive={interactive} message={message} transcript={transcript} listening={listening} reading={reading} fontScale={fontScale} contrast={contrast} reducedMotion={reducedMotion} goalQuery={goalQuery} onGoalQuery={setGoalQuery} onGoalSearch={searchGoal} catalogScreens={catalogScreens} catalogActions={catalogActions} catalogLoading={catalogLoading} onCatalogSelect={selectCatalogEntry} historyItems={historyItems} navigationMode={navigationMode} onNavigationMode={setNavigationMode} pendingNavigation={pendingNavigation} onVoice={runVoice} onSpeak={speak} onActivate={focusItem} onFont={setFontScale} onContrast={setContrast} onHighlight={setHighlight} onMotion={setReducedMotion} onReset={reset} />}
          {pendingNavigation.length > 0 && navigationMode === 'guided' && <div className="mt-3 space-y-2"><p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">{message || `Passo ${pendingNavigation[0].stepNumber || 1}: ${pendingNavigation[0].label}. Faça a ação destacada para continuar.`}</p><ol className="space-y-1">{pendingNavigation.slice(0, 4).map((step, index) => <li key={`${step.label}-${index}`} className="text-[11px] text-slate-500">{index === 0 ? 'Agora' : `${index + 1}.`} {step.label}</li>)}</ol></div>}
        </div>
        <footer className="shrink-0 border-t border-slate-200/80 bg-white/90 px-4 py-2.5 text-center">
          <a href="https://nicollas.heso.com.br" target="_blank" rel="noopener noreferrer" aria-label="Building by nicollasarc — abrir nicollas.heso.com.br em uma nova aba" className="inline-flex min-h-8 items-center justify-center rounded-full px-3 text-[11px] font-medium text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            Building by <span className="ml-1 font-semibold">(nicollasarc)</span>
          </a>
        </footer>
      </section>}
      {!open && <button aria-label="Abrir menu de acessibilidade" className="pointer-events-auto absolute grid h-14 w-14 cursor-grab place-items-center rounded-2xl border border-blue-300/70 bg-white/95 text-blue-600 shadow-[0_12px_30px_rgba(37,99,235,.25)] backdrop-blur-xl transition hover:scale-105 active:cursor-grabbing" style={{ left: position.x, top: position.y }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}><Compass size={23} /></button>}
    </div>
  )
}

function collectInteractive(): Item[] {
  return Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="combobox"], summary')).filter((el) => !el.closest('[data-skip-widget-root],[data-skip-guidance-callout]') && el.offsetParent !== null).map((element, index) => ({ element, label: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.getAttribute('name') || `Elemento ${index + 1}`).trim().replace(/\s+/g, ' ').slice(0, 70) }))
}

function findExactVoiceControl(command: string): Item | null {
  const normalized = normalizeVoiceTarget(command)
  const directed = /\b(ir|va|vou|naveg\w*|abr\w*|acess\w*|cheg\w*|lev\w*|destac\w*|foc\w*|encontr\w*|procur\w*|localiz\w*|clic\w*|selecion\w*)\b/.test(normalized)
  const matches = collectInteractive().filter(({ label }) => {
    const target = normalizeVoiceTarget(label)
    return target.length > 1 && (normalized === target || (directed && normalized.endsWith(` ${target}`)))
  })
  const unique = Array.from(new Map(matches.map((item) => [item.element, item])).values())
  return unique.length === 1 ? unique[0] : null
}

function normalizeVoiceTarget(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function localRoutePath(value: string): string {
  try { return new URL(value || '/', window.location.origin).pathname.replace(/\/$/, '') || '/' } catch { return '/' }
}

async function loadLocalScreenMap(): Promise<any> {
  let generated: any = {}
  try {
    const response = await fetch(new URL('/widget-screen-map.json', window.location.origin))
    if (response.ok) generated = await response.json()
  } catch { /* use the map already observed in this browser */ }
  let observed: Record<string, any> = {}
  try { observed = JSON.parse(localStorage.getItem('skip-screen-map-v1') || '{}') } catch { /* storage may be disabled */ }
  const screens = { ...(generated.screens || {}), ...observed }
  try {
    localStorage.setItem('skip-screen-map-v1', JSON.stringify(screens))
    localStorage.setItem('skip-screen-catalog-v1', JSON.stringify(generated.catalog || {}))
  } catch { /* storage may be disabled */ }
  return { ...generated, screens }
}

function findLocalNavigation(command: string, currentPath: string, targetId: string, map: any): any {
  const screens = map?.screens || {}
  const catalogScreens: CatalogEntry[] = Array.isArray(map?.catalog?.screens) ? map.catalog.screens : Object.values(screens).map((screen: any) => ({ id: screen.id || screen.path, name: screen.title || screen.path, type: 'ROUTE', path: screen.path, aliases: screen.aliases || [] }))
  const catalogActions: CatalogEntry[] = Array.isArray(map?.catalog?.actions) ? map.catalog.actions : Object.values(screens).flatMap((screen: any) => (screen.actions || []).map((action: any) => ({ ...action, id: `${screen.path}:${action.name}`, kind: 'navigation', route: screen.path, confirmed: true, confirmedNavigation: true })))
  const selectedScreen = catalogScreens.find((item) => item.id === targetId)
  const selectedAction = catalogActions.find((item) => item.id === targetId)
  const selected = selectedScreen || selectedAction
  const normalizedCommand = normalizeVoiceTarget(command)
  const targetText = normalizedCommand.replace(/\b(quero|preciso|gostaria|ir|va|vai|vou|navegar|navegacao|abrir|acessar|chegar|ate|para|por|favor|me|leve|tela|pagina|dialogo|acao)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const allCandidates = [...catalogScreens, ...catalogActions]
  const score = (item: CatalogEntry) => {
    const label = normalizeVoiceTarget([item.name, item.path, item.route, item.ownerName, item.targetName, ...(item.aliases || [])].filter(Boolean).join(' '))
    if (!targetText) return 0
    if (label === targetText) return 100
    if (label.startsWith(`${targetText} `) || label.includes(` ${targetText} `)) return 90
    const words = targetText.split(' ').filter((word) => word.length > 1)
    const lexical = words.reduce((total, word) => total + (label.includes(word) ? 10 : 0), 0)
    return lexical + (item.type === 'ROUTE' ? 2 : item.confirmedNavigation ? 1 : 0)
  }
  const ranked = selected ? [{ item: selected, score: 100 }] : allCandidates.map((item) => ({ item, score: score(item) })).filter((result) => result.score > 0).sort((a, b) => b.score - a.score)
  if (!ranked.length) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'destination_not_found', suggestions: catalogScreens.slice(0, 4).map((item) => ({ name: item.name, path: item.path })) }
  const topScore = ranked[0].score
  const topMatches = ranked.filter((item) => item.score === topScore)
  if (!selected && topMatches.length > 1) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'ambiguous_destination', suggestions: topMatches.slice(0, 4).map(({ item }) => ({ name: item.name, path: item.path || item.route })) }

  const picked: CatalogEntry = ranked[0].item
  const targetAction = selectedAction || catalogActions.find((item) => item.id === picked.id)
  const isState = picked.type === 'UI_STATE'
  const actionIsNavigation = Boolean(targetAction && (targetAction.confirmedNavigation || targetAction.confirmed) && (targetAction.targetRoute || targetAction.targetPath))
  const actionIsOpener = Boolean(targetAction && targetAction.confirmedDialogOpener)
  const targetStateId = isState ? picked.id : actionIsOpener ? targetAction?.targetId : targetAction?.ownerType === 'UI_STATE' ? targetAction.ownerId : ''
  const destinationPath = localRoutePath(isState ? picked.path || '' : actionIsNavigation ? targetAction?.targetRoute || targetAction?.targetPath || '' : actionIsOpener ? targetAction?.route || '' : targetAction?.route || picked.path || '')
  const targetName = actionIsOpener ? targetAction?.targetName || picked.name : picked.name
  const current = localRoutePath(currentPath)
  if (!screens[current]) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'current_screen_unknown', target: { name: targetName, path: destinationPath } }

  const queue: Array<{ path: string; steps: NavigationStep[] }> = [{ path: current, steps: [] }]
  const visited = new Set([current])
  let routeSteps: NavigationStep[] | null = current === destinationPath ? [] : null
  while (queue.length && !routeSteps) {
    const node = queue.shift()!
    for (const action of screens[node.path]?.actions || []) {
      const nextPath = localRoutePath(action.targetRoute || '')
      if (!action.name || !action.targetRoute || visited.has(nextPath)) continue
      const match = { name: action.name, metadata: { cssSelector: action.selector || '', targetRoute: nextPath, kind: 'navigation', intent: 'navigate' } }
      const steps = [...node.steps, { action: 'NAVIGATE', label: action.name, targetPath: nextPath, automaticSafe: true, match }]
      if (nextPath === destinationPath) { routeSteps = steps; break }
      if (screens[nextPath]) { visited.add(nextPath); queue.push({ path: nextPath, steps }) }
    }
  }
  if (!routeSteps) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'path_not_found', target: { id: picked.id, name: targetName, path: destinationPath }, targetFound: true }

  const steps = [...routeSteps]
  if (targetStateId) {
    const opener = catalogActions.find((item) => item.targetId === targetStateId && item.confirmedDialogOpener)
    if (!opener) return { action: 'NAVIGATE', navigationFound: false, navigationReason: 'target_state_unknown', target: { id: targetStateId, name: targetName, path: destinationPath }, targetFound: true }
    const state = catalogScreens.find((item) => item.id === targetStateId)
    steps.push({ action: 'OPEN_STATE', label: opener.name, targetPath: destinationPath, targetStateId, targetStateName: state?.name || targetName, targetStateSelector: state?.selector || '', automaticSafe: true, match: { id: opener.id, name: opener.name, metadata: { cssSelector: opener.selector || '', kind: 'open-state', intent: 'open-state', dialogOpenConfirmed: true } } })
  }
  if (targetAction && !actionIsNavigation && !actionIsOpener) {
    steps.push({ action: 'HIGHLIGHT', label: picked.name, match: { id: picked.id, name: picked.name, metadata: { cssSelector: picked.selector || '', label: picked.name, kind: picked.kind || 'action' } } })
  }

  return { action: 'NAVIGATE', navigationFound: true, target: { id: picked.id, name: targetName, path: destinationPath }, confidence: 1, steps, matches: [], suggestions: [] }
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

let guidedHighlightedElement: HTMLElement | null = null
let guidedOriginalTabIndex: string | null = null
let guidedChangedTabIndex = false
let guidedCalloutCleanup: (() => void) | null = null

function highlightElement(el: HTMLElement, label = 'controle', behavior: ScrollBehavior = 'smooth') {
  clearGuidedHighlight()
  guidedHighlightedElement = el
  if (!el.matches('a[href],button,input,select,textarea,[tabindex],summary')) {
    guidedOriginalTabIndex = el.getAttribute('tabindex')
    guidedChangedTabIndex = true
    el.setAttribute('tabindex', '-1')
  }
  el.classList.add('skip-guided-highlight')
  try { el.scrollIntoView({ block: 'center', behavior }) } catch { /* browser may not support smooth scrolling */ }
  try { el.focus({ preventScroll: true }) } catch { el.focus() }

  const callout = document.createElement('div')
  callout.dataset.skipGuidanceCallout = 'true'
  callout.setAttribute('role', 'status')
  callout.setAttribute('aria-live', 'polite')
  callout.textContent = `Você está aqui: ${label}. Ative ou preencha este local para continuar.`
  Object.assign(callout.style, {
    position: 'fixed', zIndex: '10001', maxWidth: 'min(300px, calc(100vw - 24px))',
    padding: '10px 13px', borderRadius: '12px', background: '#1d4ed8', color: '#fff',
    font: '600 13px/1.45 system-ui, sans-serif', boxShadow: '0 8px 24px rgba(30,64,175,.35)',
    pointerEvents: 'none', overflowWrap: 'anywhere',
  })
  document.body.appendChild(callout)
  let frame = 0
  const place = () => {
    frame = 0
    if (!document.documentElement.contains(el)) { clearGuidedHighlight(); return }
    const rect = el.getBoundingClientRect()
    const note = callout.getBoundingClientRect()
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - note.width - 12))
    const above = rect.top >= note.height + 20
    const top = above ? rect.top - note.height - 8 : Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - note.height - 8))
    callout.style.left = `${left}px`
    callout.style.top = `${top}px`
  }
  const schedule = () => { if (!frame) frame = window.requestAnimationFrame(place) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  schedule()
  guidedCalloutCleanup = () => {
    observer.disconnect()
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    if (frame) window.cancelAnimationFrame(frame)
  }
}

function clearGuidedHighlight() {
  document.querySelectorAll('.skip-guided-highlight').forEach((element) => element.classList.remove('skip-guided-highlight'))
  document.querySelectorAll('[data-skip-guidance-callout]').forEach((element) => element.remove())
  guidedCalloutCleanup?.()
  guidedCalloutCleanup = null
  if (guidedHighlightedElement && guidedChangedTabIndex && guidedOriginalTabIndex !== null) guidedHighlightedElement.setAttribute('tabindex', guidedOriginalTabIndex)
  else if (guidedHighlightedElement && guidedChangedTabIndex) guidedHighlightedElement.removeAttribute('tabindex')
  guidedHighlightedElement = null
  guidedOriginalTabIndex = null
  guidedChangedTabIndex = false
}

function isTargetUiStateVisible(step: NavigationStep): boolean {
  const selector = String((step as any).targetStateSelector || '')
  if (selector) {
    try {
      const element = document.querySelector<HTMLElement>(selector)
      if (element && element.offsetParent !== null && !element.hidden && element.getAttribute('aria-hidden') !== 'true') return true
    } catch { /* invalid selector in a stale map */ }
  }
  const expected = String((step as any).targetStateName || '').trim().toLocaleLowerCase()
  if (!expected) return false
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]'))
    .some((element) => element.offsetParent !== null && (element.getAttribute('aria-label') || element.querySelector('h1,h2,h3,[role="heading"]')?.textContent || '').trim().toLocaleLowerCase() === expected)
}

function currentDialogName(): string {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]'))
    .find((element) => element.offsetParent !== null)
  return String(dialog?.getAttribute('aria-label') || dialog?.querySelector('h1,h2,h3,[role="heading"]')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160)
}

function activateElement(el: HTMLElement, allowAnchorFallback = true) {
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* noop */ }
  el.focus({ preventScroll: true })
  ;['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })) } catch { /* noop */ }
  })
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null
  const before = window.location.href
  el.click()
  if (allowAnchorFallback && anchor?.href && anchor.target !== '_blank') {
    window.setTimeout(() => { if (window.location.href === before) window.location.assign(anchor.href) }, 250)
  }
}

async function waitForPathChange(expectedPath: string, beforePath: string) {
  const expected = expectedPath ? new URL(expectedPath, window.location.origin) : null
  const matches = () => !expected || (window.location.pathname === expected.pathname && window.location.search === expected.search)
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    if (`${window.location.pathname}${window.location.search}` !== beforePath && matches()) return true
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return false
}

async function executeNavigationStep(step: NavigationStep, continuation: { steps: NavigationStep[]; mode: 'guided' | 'automatic' }) {
  const metadata = step.match?.metadata || {}
  const routeStep = step.action === 'NAVIGATE' && step.automaticSafe && metadata.targetRoute && metadata.kind === 'navigation' && metadata.intent !== 'submit'
  const confirmedDialogStep = step.action === 'OPEN_STATE' && step.automaticSafe && metadata.dialogOpenConfirmed === true && step.targetStateId && metadata.intent !== 'submit'
  if (continuation.mode !== 'automatic' || (!routeStep && !confirmedDialogStep)) {
    if (step.action === 'WAIT_INPUT') {
      const field = findElementForMatch(step.match)
      if (field) {
        highlightElement(field, step.label)
        return { ok: false, message: 'Você chegou ao campo “' + step.label + '”. Ele está destacado para você preencher; não vou inserir dados.' }
      }
      return { ok: false, message: 'Não encontrei o campo “' + step.label + '”. Navegação interrompida.' }
    }
    return { ok: false, message: 'O controle “' + step.label + '” não tem um destino de navegação confirmado. Navegação interrompida.' }
  }
  const element = findElementForMatch(step.match)
  if (!element || !(element.matches('a[href],button,[role="link"],[role="button"]'))) return { ok: false, message: 'Não encontrei o controle “' + step.label + '” na tela. Navegação interrompida.' }
  if (element instanceof HTMLButtonElement && element.type === 'submit') return { ok: false, message: 'O controle “' + step.label + '” envia um formulário e não será ativado pela navegação automática.' }
  const anchor = element.closest('a[href]') as HTMLAnchorElement | null
  if (anchor?.target === '_blank') return { ok: false, message: 'O controle “' + step.label + '” abre outra aba e não será ativado automaticamente.' }
  if (anchor && anchor.origin !== window.location.origin) return { ok: false, message: 'O controle “' + step.label + '” leva para fora deste sistema. Navegação interrompida.' }
  const beforePath = window.location.pathname + window.location.search
  const expectedPath = routeStep ? step.targetPath || metadata.targetRoute : step.targetPath || beforePath
  try {
    sessionStorage.setItem(navigationSessionKey, JSON.stringify({
      steps: continuation.steps, mode: continuation.mode, expectedPath,
      expectedStateId: confirmedDialogStep ? step.targetStateId : '',
      expectedStateName: confirmedDialogStep ? step.targetStateName : '',
      expectedStateSelector: confirmedDialogStep ? step.targetStateSelector : '',
    }))
  } catch { /* storage may be disabled */ }
  activateElement(element, Boolean(routeStep))
  const moved = confirmedDialogStep ? await waitForUiState(step, beforePath) : await waitForPathChange(expectedPath, beforePath)
  return moved ? { ok: true, message: '' } : { ok: false, message: 'Não confirmei o destino após ativar “' + step.label + '”. Navegação interrompida.' }
}

async function waitForUiState(step: NavigationStep, beforePath: string) {
  const expectedPath = step.targetPath ? new URL(step.targetPath, window.location.origin) : null
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    const currentPath = window.location.pathname + window.location.search
    if (expectedPath && (window.location.pathname !== expectedPath.pathname || window.location.search !== expectedPath.search)) return false
    if (!expectedPath && currentPath !== beforePath) return false
    if (isTargetUiStateVisible(step)) return true
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  return false
}

async function runAutomaticNavigation(steps: NavigationStep[], record: (text: string) => void) {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (step.action === 'HIGHLIGHT') {
      const element = findElementForMatch(step.match)
      if (!element) { record(`Não encontrei o controle “${step.label}” nesta tela. Navegação interrompida.`); return }
      highlightElement(element, step.label)
      continue
    }
    const result = await executeNavigationStep(step, { steps: steps.slice(index + 1), mode: 'automatic' })
    if (!result.ok) { sessionStorage.removeItem(navigationSessionKey); record(result.message); return }
    sessionStorage.removeItem(navigationSessionKey)
  }
  record('Você chegou à tela solicitada.')
}

function WidgetView(props: any) {
  const { view, interactive, message } = props
  if (view === 'goal') return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); props.onGoalSearch() }}><Info icon={<Compass />} title="Navegação por objetivo" text="Pesquise uma tela ou escolha diretamente uma tela, diálogo ou ação já catalogada. O caminho usa apenas relações confirmadas no mapa." /><label htmlFor="skip-goal-query" className="block text-xs font-semibold text-slate-700">Onde você quer chegar?</label><input id="skip-goal-query" autoComplete="off" value={props.goalQuery} onChange={(event) => props.onGoalQuery(event.target.value)} placeholder="Ex.: relatórios, minha conta…" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200" /><ActionButton type="submit" disabled={!props.goalQuery.trim()}>Encontrar caminho</ActionButton><CatalogList title="Telas e diálogos" items={filterCatalog(props.catalogScreens, props.goalQuery)} loading={props.catalogLoading} empty="Nenhuma tela catalogada. Execute /widget para mapear o projeto." onSelect={props.onCatalogSelect} /><CatalogList title="Ações catalogadas" items={filterCatalog(props.catalogActions, props.goalQuery)} loading={props.catalogLoading} empty="Nenhuma ação catalogada neste projeto." onSelect={props.onCatalogSelect} /><p className="text-[10px] leading-4 text-slate-500">No modo automático, só links de navegação e abridores de diálogo confirmados podem ser ativados.</p>{message && <Feedback>{message}</Feedback>}</form>
  if (view === 'voice') return <div className="space-y-3 text-center"><div className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${props.listening ? 'animate-pulse bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{props.listening ? <MicOff size={30} /> : <Mic size={30} />}</div><p className="text-sm font-semibold text-slate-800">{props.listening ? 'Estou ouvindo…' : 'Navegação por voz'}</p><p className="text-xs leading-5 text-slate-500">Toque uma vez e diga “quero ir até Projetos”, “aumentar fonte”, “contraste” ou “localize o botão Salvar”.</p>{props.transcript && <p aria-live="polite" className="min-h-10 rounded-xl bg-white p-3 text-xs text-slate-700">{props.transcript}</p>}<ActionButton onClick={props.onVoice}>{props.listening ? 'Concluir comando' : 'Falar'}</ActionButton>{message && <Feedback>{message}</Feedback>}</div>
  if (view === 'actions') return <div className="space-y-2"><Info icon={<MousePointerClick />} title="Ações disponíveis" text="Escolha um controle para ver onde ele fica. Você decide quando ativá-lo." /><List title="Links, botões e campos" items={interactive} onActivate={props.onActivate} empty="Nenhum elemento interativo encontrado." /></div>
  if (view === 'shortcuts') return <div className="space-y-2"><Shortcut keys="Alt + A" label="Abrir ou fechar widget" /><Shortcut keys="Alt + V" label="Ativar voz" /><Shortcut keys="Alt + L" label="Ler a página" /><Shortcut keys="Esc" label="Recolher painel" /><p className="pt-2 text-xs leading-5 text-slate-500">Os atalhos ficam disponíveis enquanto o widget está carregado.</p></div>
  if (view === 'guided') return <div className="space-y-3"><Info icon={<Focus />} title="Navegação guiada" text={props.pendingNavigation?.length ? `Passo ${props.pendingNavigation[0].stepNumber || 1}: ${props.pendingNavigation[0].label}. O widget destaca o controle; você realiza a ação.` : `Encontramos ${interactive.length} controles nesta tela. Escolha um para destacá-lo; você realiza a ação.`} /><List items={interactive.slice(0, 8)} onActivate={props.onActivate} empty="Não há controles disponíveis." /></div>
  if (view === 'highlight') return <div className="space-y-3"><Info icon={<Highlighter />} title="Destaque de controles" text="Cria contornos visíveis em links, botões e campos para facilitar a identificação dos elementos interativos." /><Toggle label="Destacar elementos" active={props.highlight} onClick={() => props.onHighlight(!props.highlight)} icon={<Highlighter />} /></div>
  if (view === 'reading') return <div className="space-y-3 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-100 text-violet-600">{props.reading ? <Pause size={27} /> : <BookOpen size={27} />}</div><p className="text-sm leading-6 text-slate-600">Leia em voz alta o conteúdo principal da página.</p><ActionButton onClick={() => props.onSpeak()}>{props.reading ? 'Pausar leitura' : 'Ler esta página'}</ActionButton>{message && <Feedback>{message}</Feedback>}</div>
  if (view === 'settings') return <div className="space-y-3"><Control label="Tamanho do texto" value={`${props.fontScale}%`}><button onClick={() => props.onFont(Math.max(80, props.fontScale - 10))}>−</button><button onClick={() => props.onFont(Math.min(140, props.fontScale + 10))}>+</button></Control><Toggle label="Alto contraste" active={props.contrast} onClick={() => props.onContrast(!props.contrast)} icon={<Eye />} /><Toggle label="Reduzir movimento" active={props.reducedMotion} onClick={() => props.onMotion(!props.reducedMotion)} icon={<Pause />} /><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-semibold text-slate-700">Como navegar</p><div className="grid grid-cols-2 gap-2"><button aria-pressed={props.navigationMode === 'guided'} onClick={() => props.onNavigationMode('guided')} className={`rounded-lg py-2 text-xs font-semibold ${props.navigationMode === 'guided' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Passo a passo</button><button aria-pressed={props.navigationMode === 'automatic'} onClick={() => props.onNavigationMode('automatic')} className={`rounded-lg py-2 text-xs font-semibold ${props.navigationMode === 'automatic' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Automática</button></div></div><button onClick={props.onReset} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw size={14} /> Restaurar preferências</button></div>
  if (view === 'history') return <div className="space-y-2">{props.historyItems.length ? props.historyItems.map((item: string, index: number) => <div key={`${item}-${index}`} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" /><p className="text-xs leading-5 text-slate-600">{item}</p></div>) : <Info icon={<History />} title="Histórico vazio" text="Os comandos do widget aparecerão aqui." />}</div>
  return <div className="space-y-3"><Info icon={<CircleHelp />} title="Como usar" text="Use Voz para falar ou escrever um pedido, Ações para localizar controles, Guiado para seguir caminhos e Leitura para ouvir o conteúdo." /><Info icon={<Settings2 />} title="Dica" text="O painel recolhe após 10 segundos sem atividade e continua disponível no botão flutuante." /></div>
}

function filterCatalog(items: CatalogEntry[], query: string): CatalogEntry[] {
  const normalized = normalizeVoiceTarget(query)
  if (!normalized) return items.slice(0, 12)
  return items.filter((item) => normalizeVoiceTarget([item.name, item.path, item.ownerName, item.targetName, ...(item.aliases || [])].filter(Boolean).join(' ')).includes(normalized)).slice(0, 12)
}

function CatalogList({ title, items, loading, empty, onSelect }: any) {
  return <section aria-label={title} className="space-y-1.5">
    <p className="text-xs font-semibold text-slate-700">{title}</p>
    {loading ? <p className="rounded-xl bg-white p-3 text-xs text-slate-500">Carregando catálogo…</p> : items.length ? <div className="max-h-48 space-y-1 overflow-y-auto">{items.map((item: CatalogEntry) => <button key={item.id} type="button" onClick={() => onSelect(item)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-blue-300 hover:bg-blue-50"><span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-800">{item.name}</span><span className="block truncate text-[10px] text-slate-500">{item.type === 'UI_STATE' ? `Diálogo · ${item.path || ''}` : item.type === 'ROUTE' ? item.path || 'Tela' : `${item.ownerName || item.path || 'Ação'}${item.targetName ? ` · ${item.targetName}` : ''}`}</span></span><ChevronRight size={14} className="shrink-0 text-slate-400" /></button>)}</div> : <p className="rounded-xl bg-white p-3 text-xs leading-5 text-slate-500">{empty}</p>}
  </section>
}

function ActionButton({ onClick, children, disabled, type = 'button' }: any) { return <button type={type} onClick={onClick} disabled={disabled} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button> }
function Feedback({ children }: any) { return <p className="rounded-xl bg-white p-3 text-xs leading-5 text-slate-600 shadow-sm">{children}</p> }
function List({ title, items, onActivate, empty }: any) { return <div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">{title}</p><span className="text-[10px] text-slate-400">{items.length} itens</span></div><div className="space-y-1.5">{items.length ? items.slice(0, 12).map((item: Item, index: number) => <button key={`${item.label}-${index}`} onClick={() => onActivate(item)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-medium text-slate-700 hover:border-blue-200 hover:bg-blue-50"><span className="truncate">{item.label}</span><ChevronRight size={14} className="shrink-0 text-slate-400" /></button>) : <p className="rounded-xl bg-white p-4 text-center text-xs text-slate-400">{empty}</p>}</div></div> }
function Shortcut({ keys, label }: any) { return <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3"><span className="text-xs text-slate-600">{label}</span><kbd className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{keys}</kbd></div> }
function Info({ icon, title, text }: any) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-blue-600">{icon}<p className="text-xs font-semibold text-slate-800">{title}</p></div><p className="mt-2 text-xs leading-5 text-slate-500">{text}</p></div> }
function Toggle({ label, active, onClick, icon }: any) { return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left"><span className="text-blue-600">{icon}</span><span className="flex-1 text-xs font-semibold text-slate-700">{label}</span><span className={`h-5 w-9 rounded-full p-0.5 transition ${active ? 'bg-blue-600' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition ${active ? 'translate-x-4' : ''}`} /></span></button> }
function Control({ label, value, children }: any) { return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-3 flex justify-between text-xs"><span className="font-semibold text-slate-700">{label}</span><span className="text-slate-400">{value}</span></div><div className="grid grid-cols-2 gap-2 [&>button]:rounded-lg [&>button]:bg-slate-100 [&>button]:py-2 [&>button]:text-lg [&>button]:font-semibold [&>button]:text-slate-700 hover:[&>button]:bg-blue-50">{children}</div></div> }
