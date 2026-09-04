let antigravityQueue: Promise<void> = Promise.resolve()

export function withAntigravityCredentialLock<T>(task: () => Promise<T>): Promise<T> {
  const result = antigravityQueue.then(
    () => task(),
    () => task()
  )
  antigravityQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
