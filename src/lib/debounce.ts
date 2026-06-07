export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  waitMs: number
): T & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  const run = () => {
    timer = null
    if (lastArgs) fn(...lastArgs)
    lastArgs = null
  }

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, waitMs)
  }) as T & { flush: () => void; cancel: () => void }

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer)
      run()
    }
  }

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }

  return debounced
}
