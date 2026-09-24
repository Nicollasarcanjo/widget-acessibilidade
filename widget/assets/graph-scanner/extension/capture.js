(() => {
  if (window.__SKIP_GRAPH_SCANNER_CAPTURED__) return
  window.__SKIP_GRAPH_SCANNER_CAPTURED__ = true
  const expected = new Set(window.__SKIP_GRAPH_SCANNER_ROUTES__ || [])
  const labelOf = (element) => {
    const labelledBy = element.getAttribute('aria-labelledby')
    const referenced = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ') : ''
    const labels = element.labels ? [...element.labels].map((label) => label.innerText || '').join(' ') : ''
    return (element.getAttribute('aria-label') || referenced || element.getAttribute('title') || labels || element.innerText || element.getAttribute('alt') || element.getAttribute('placeholder') || element.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  }
  const selectorOf = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`
    const testId = element.getAttribute('data-testid')
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`
    const parts = []
    let current = element
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 6) {
      let part = current.tagName.toLowerCase()
      const siblings = current.parentElement ? [...current.parentElement.children].filter((node) => node.tagName === current.tagName) : []
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      parts.unshift(part)
      current = current.parentElement
    }
    return parts.join(' > ')
  }
  const controls = [...document.querySelectorAll('a,button,input:not([type="password"]),select,textarea,[role="button"],[role="link"],[role="menuitem"]')]
    .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true')
    .slice(0, 250)
    .map((element) => {
      const tag = element.tagName.toLowerCase()
      const href = tag === 'a' ? element.href : ''
      let targetRoute = ''
      if (href) {
        try {
          const url = new URL(href)
          const route = url.pathname.replace(/\/$/, '') || '/'
          if (url.origin === location.origin && expected.has(route)) targetRoute = route
        } catch {}
      }
      return { tag, label: labelOf(element), selector: selectorOf(element), anchor: element.id || element.getAttribute('data-testid') || selectorOf(element), kind: element.getAttribute('type') || element.getAttribute('role') || '', navigation: Boolean(targetRoute), targetRoute }
    }).filter((control) => control.label)
  const snapshot = { url: `${location.origin}${location.pathname}`, title: document.title, text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30000), controls, wcag: { performed: false, violations: [] } }
  const send = () => chrome.runtime.sendMessage({ type: 'SCREEN_CAPTURED', snapshot }).catch(() => {})
  if (window.axe?.run) {
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
      .then((results) => { snapshot.wcag = { performed: true, violations: results.violations }; send() })
      .catch(() => send())
  } else send()
})()
