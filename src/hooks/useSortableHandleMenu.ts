import { useCallback, useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'

type Options = {
  listeners: DraggableSyntheticListeners | undefined
  didDragRef: React.MutableRefObject<boolean>
  onOpenMenu: (anchor: HTMLElement) => void
}

/** Tap/release on handle opens menu; movement activates dnd-kit drag (via parent didDragRef). */
export function useSortableHandleMenu({ listeners, didDragRef, onOpenMenu }: Options) {
  const openFromKeyboard = useCallback(
    (el: HTMLElement) => {
      didDragRef.current = false
      onOpenMenu(el)
    },
    [didDragRef, onOpenMenu]
  )

  const handleProps = useMemo(() => {
    if (!listeners) return {}

    const { onPointerDown, onPointerUp, ...rest } = listeners

    return {
      ...rest,
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        didDragRef.current = false
        onPointerDown?.(event)
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        onPointerUp?.(event)
        if (!didDragRef.current) {
          onOpenMenu(event.currentTarget)
        }
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openFromKeyboard(event.currentTarget)
        }
      },
    }
  }, [listeners, didDragRef, onOpenMenu, openFromKeyboard])

  return { handleProps }
}
