import { useRef, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'

/**
 * Pointer and keyboard handling for charts with one slot per day: the pointer or the arrow keys
 * move `activeIndex` (shared by charts over the same days), and a click or Enter picks the day.
 * A tap only moves the index, so touch users can read a day before opening it.
 */
export function useDayInteraction({
  count,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  focusIndex,
}: {
  count: number
  activeIndex: number | null
  onActiveIndexChange: (index: number | null) => void
  onSelect?: (index: number) => void
  /** Where the keys start from when the chart gets keyboard focus, e.g. the latest value. */
  focusIndex: number
}) {
  const pointerType = useRef('mouse')
  const last = count - 1

  const container = {
    tabIndex: 0,
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      let next: number | null
      switch (event.key) {
        case 'ArrowLeft':
          next = activeIndex === null ? last : Math.max(0, activeIndex - 1)
          break
        case 'ArrowRight':
          next = activeIndex === null ? last : Math.min(last, activeIndex + 1)
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = last
          break
        case 'Escape':
          next = null
          break
        case 'Enter':
          if (activeIndex !== null) onSelect?.(activeIndex)
          return
        default:
          return
      }
      event.preventDefault()
      onActiveIndexChange(next)
    },
    onFocus(event: FocusEvent<HTMLElement>) {
      // Show where the keys start from. A click shows the day under the pointer instead.
      if (activeIndex === null && event.currentTarget.matches(':focus-visible')) {
        onActiveIndexChange(focusIndex)
      }
    },
    onBlur: () => onActiveIndexChange(null),
  }

  /** Handlers for the plot, whose day slots start `left` pixels in and are `slot` wide. */
  function plot(left: number, slot: number) {
    const indexAt = (event: MouseEvent<SVGSVGElement>) => {
      const plotLeft = event.currentTarget.getBoundingClientRect().left + left
      return Math.min(last, Math.max(0, Math.floor((event.clientX - plotLeft) / slot)))
    }
    return {
      onPointerDown(event: PointerEvent<SVGSVGElement>) {
        pointerType.current = event.pointerType
        onActiveIndexChange(indexAt(event))
      },
      onPointerMove: (event: PointerEvent<SVGSVGElement>) => onActiveIndexChange(indexAt(event)),
      onPointerLeave: () => onActiveIndexChange(null),
      onClick(event: MouseEvent<SVGSVGElement>) {
        if (pointerType.current === 'mouse') onSelect?.(indexAt(event))
      },
    }
  }

  return { container, plot }
}
