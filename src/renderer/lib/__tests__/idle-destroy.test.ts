import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdleDestroyController } from '../idle-destroy'

describe('IdleDestroyController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('destroys after the idle delay when nothing reattaches', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const controller = new IdleDestroyController(() => 60_000, onIdle)
    controller.beginIdle()
    vi.advanceTimersByTime(59_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('treats a zero idle delay as disabled', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const controller = new IdleDestroyController(() => 0, onIdle)
    controller.beginIdle()
    vi.advanceTimersByTime(10_000)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('does not destroy when stayActive cancels a pending idle timer', () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const controller = new IdleDestroyController(() => 1_000, onIdle)
    controller.beginIdle()
    controller.stayActive()
    vi.advanceTimersByTime(5_000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
