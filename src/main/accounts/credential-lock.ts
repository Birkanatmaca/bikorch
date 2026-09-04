let antigravityQueue: Promise<void> = Promise.resolve()
let cursorQueue: Promise<void> = Promise.resolve()

function createLock(getQueue: () => Promise<void>, setQueue: (next: Promise<void>) => void) {
  return function withLock<T>(task: () => Promise<T>): Promise<T> {
    const result = getQueue().then(
      () => task(),
      () => task()
    )
    setQueue(
      result.then(
        () => undefined,
        () => undefined
      )
    )
    return result
  }
}

export const withAntigravityCredentialLock = createLock(
  () => antigravityQueue,
  (next) => {
    antigravityQueue = next
  }
)

export const withCursorCredentialLock = createLock(
  () => cursorQueue,
  (next) => {
    cursorQueue = next
  }
)
