import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './OptionsMenu.css'

export type OptionsMenuAction = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

type Props = {
  anchorRect: DOMRect
  items: OptionsMenuAction[]
  onClose: () => void
}

export function OptionsMenu({ anchorRect, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: anchorRect.bottom + 4, left: anchorRect.left })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const margin = 8
    const rect = menu.getBoundingClientRect()
    let top = anchorRect.bottom + 4
    let left = anchorRect.left

    if (top + rect.height > window.innerHeight - margin) {
      top = anchorRect.top - rect.height - 4
    }
    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - rect.width - margin
    }
    if (left < margin) left = margin
    if (top < margin) top = margin

    setPosition({ top, left })
  }, [anchorRect])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="options-menu"
      role="menu"
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={[
            'options-menu-item',
            item.destructive ? 'options-menu-item--destructive' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
            onClose()
          }}
          tabIndex={index === 0 ? 0 : -1}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
