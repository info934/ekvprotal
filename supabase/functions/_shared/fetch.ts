export const fetchWithTimeout = async (
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 20_000,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Upstream request timed out', 'TimeoutError'));
  }, timeoutMs);
  const sourceSignal = init.signal;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  sourceSignal?.addEventListener('abort', abortFromSource, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    sourceSignal?.removeEventListener('abort', abortFromSource);
  }
};
