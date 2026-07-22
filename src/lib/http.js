/**
 * Executes a fetch request with a timeout using AbortController.
 * Prioritizes existing signal if provided in init options.
 * 
 * @param {string|Request} input 
 * @param {RequestInit} [init={}] 
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=8000] - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
export const fetchWithTimeout = async (input, init = {}, { timeoutMs = 8000 } = {}) => {
  const { signal: initSignal, ...restInit } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Request timeout', 'TimeoutError'));
  }, timeoutMs);
  const abortFromInit = () => controller.abort(initSignal?.reason);
  initSignal?.addEventListener('abort', abortFromInit, { once: true });

  try {
    return await fetch(input, { ...restInit, signal: controller.signal });
  } catch (error) {
    if (error.name === 'TimeoutError' || (error.name === 'AbortError' && controller.signal.aborted && !initSignal?.aborted)) {
      throw new Error('Request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    initSignal?.removeEventListener('abort', abortFromInit);
  }
};

/**
 * Executes a fetch request, checks for response.ok, and parses JSON.
 * safely reads error body (max 2KB) if response is not ok.
 * 
 * @param {string|Request} input 
 * @param {RequestInit} [init] 
 * @param {Object} [opts]
 * @returns {Promise<any>}
 */
export const fetchJsonWithTimeout = async (input, init, opts) => {
  const response = await fetchWithTimeout(input, init, opts);

  if (!response.ok) {
    let bodyText = '';
    try {
      // Safely read up to 2KB
      const text = await response.text();
      bodyText = text.slice(0, 2048);
      if (text.length > 2048) bodyText += '...';
    } catch (e) {
      bodyText = '(failed to read body)';
    }

    const error = new Error(`Request failed: ${response.status} ${response.statusText} - ${bodyText}`);
    error.status = response.status;
    error.body = bodyText;
    throw error;
  }

  try {
    return await response.json();
  } catch (e) {
    throw new Error('Invalid JSON response');
  }
};
