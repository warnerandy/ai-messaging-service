export function startThinkingTimer(timerRef, setThinking, timeoutMs = null, scheduler = setTimeout, cancel = clearTimeout) {
  setThinking(true)
  cancel(timerRef.current)

  if (timeoutMs != null) {
    timerRef.current = scheduler(() => {
      timerRef.current = null
      setThinking(false)
    }, timeoutMs)
  } else {
    timerRef.current = null
  }
}

export function stopThinkingTimer(timerRef, setThinking, cancel = clearTimeout) {
  cancel(timerRef.current)
  timerRef.current = null
  setThinking(false)
}
