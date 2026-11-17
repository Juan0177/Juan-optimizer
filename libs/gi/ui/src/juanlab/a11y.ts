// juanlab: accessibilita (WCAG 2.1). Molte icone del sito (armi, elementi, set, reazioni) sono decorative: il
// nome e gia scritto accanto. Le <img> senza attributo alt vengono segnate come decorative (alt="") cosi gli
// screen reader le saltano invece di leggere il nome del file. Vale anche per le immagini aggiunte dopo.
export function markDecorativeImages() {
  if (typeof document === 'undefined') return
  const fix = (root: ParentNode) =>
    root
      .querySelectorAll('img:not([alt])')
      .forEach((img) => img.setAttribute('alt', ''))
  fix(document)
  new MutationObserver((mutations) => {
    for (const m of mutations)
      for (const node of m.addedNodes) {
        if (node instanceof HTMLImageElement) {
          if (!node.hasAttribute('alt')) node.setAttribute('alt', '')
        } else if (node instanceof Element) fix(node)
      }
  }).observe(document.documentElement, { childList: true, subtree: true })
}
