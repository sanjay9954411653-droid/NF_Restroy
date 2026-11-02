/**
 * Prints an HTML string through a hidden iframe instead of window.open().
 *
 * Why: popups are blocked by many browsers / phones, and the old code called
 * print() (and sometimes close()) before images (UPI / review QR) and the CSS
 * had finished loading -> blank QR, squished layout, or a closed print dialog.
 * This waits for stylesheets + images first, and only removes the iframe after
 * printing is done.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0',
    })
    document.body.appendChild(iframe)

    const win = iframe.contentWindow!
    const doc = iframe.contentDocument || win.document
    doc.open()
    doc.write(html)
    doc.close()

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      iframe.remove()
      resolve()
    }

    const waitFor = (el: HTMLImageElement | HTMLLinkElement) =>
      new Promise<void>((r) => {
        const done = () => r()
        if (el instanceof HTMLImageElement && el.complete) return done()
        if (el instanceof HTMLLinkElement && el.sheet) return done()
        el.addEventListener('load', done)
        el.addEventListener('error', done)
      })

    const ready = Promise.all([
      ...Array.from(doc.images).map(waitFor),
      ...Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(waitFor),
    ])
    // Never hang forever if a QR image is slow/blocked: print after 4s anyway.
    const timeout = new Promise<void>((r) => setTimeout(r, 4000))

    Promise.race([ready, timeout]).then(() => {
      setTimeout(() => {
        win.focus()
        win.addEventListener('afterprint', () => setTimeout(finish, 300))
        win.print()
        // Mobile Chrome returns from print() immediately - keep the iframe alive.
        setTimeout(finish, 60_000)
      }, 150)
    })
  })
}
