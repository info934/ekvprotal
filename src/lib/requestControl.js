export const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
export const DEFAULT_FUNCTION_TIMEOUT_MS = 45_000;

export const createTimedAbortController = (timeoutMs = DEFAULT_QUERY_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  return {
    controller,
    signal: controller.signal,
    dispose: () => clearTimeout(timeoutId),
  };
};

export const isRequestAbortError = (error) => (
  error?.name === 'AbortError'
  || error?.name === 'TimeoutError'
  || /aborted|timed out|timeout/i.test(String(error?.message || ''))
);

export const combineAbortSignals = (...signals) => {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(activeSignals);

  const controller = new AbortController();
  activeSignals.forEach((signal) => {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  });
  return controller.signal;
};

export const invokeWithTimeout = async (
  client,
  functionName,
  options = {},
  timeoutMs = DEFAULT_FUNCTION_TIMEOUT_MS
) => {
  const request = createTimedAbortController(timeoutMs);
  try {
    return await client.functions.invoke(functionName, {
      ...options,
      signal: request.signal,
    });
  } finally {
    request.dispose();
  }
};
