import test from 'node:test'
import assert from 'node:assert/strict'

import { startThinkingTimer, stopThinkingTimer } from './thinkingTimer.mjs'

test('startThinkingTimer keeps typing active without an auto-stop timeout by default', () => {
  const timerRef = { current: 'existing-timer' }
  const thinkingStates = []
  const cleared = []
  const scheduled = []

  startThinkingTimer(
    timerRef,
    (value) => thinkingStates.push(value),
    null,
    (callback, timeoutMs) => {
      scheduled.push({ callback, timeoutMs })
      return 'new-timer'
    },
    (timerId) => cleared.push(timerId)
  )

  assert.deepEqual(thinkingStates, [true])
  assert.deepEqual(cleared, ['existing-timer'])
  assert.equal(timerRef.current, null)
  assert.equal(scheduled.length, 0)
})

test('startThinkingTimer schedules an auto-stop when a timeout is provided', () => {
  const timerRef = { current: null }
  const thinkingStates = []
  const scheduled = []

  startThinkingTimer(
    timerRef,
    (value) => thinkingStates.push(value),
    3000,
    (callback, timeoutMs) => {
      scheduled.push({ callback, timeoutMs })
      return 'timeout-id'
    },
    () => {}
  )

  assert.deepEqual(thinkingStates, [true])
  assert.equal(timerRef.current, 'timeout-id')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].timeoutMs, 3000)

  scheduled[0].callback()

  assert.deepEqual(thinkingStates, [true, false])
  assert.equal(timerRef.current, null)
})

test('stopThinkingTimer clears the timer and turns typing off', () => {
  const timerRef = { current: 'timeout-id' }
  const thinkingStates = []
  const cleared = []

  stopThinkingTimer(timerRef, (value) => thinkingStates.push(value), (timerId) => cleared.push(timerId))

  assert.deepEqual(cleared, ['timeout-id'])
  assert.deepEqual(thinkingStates, [false])
  assert.equal(timerRef.current, null)
})
