import { useEffect } from 'react'

export function useDialogFocus(onClose: () => void) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? [])]
    focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusable(); if (!items.length) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0].focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])
}
