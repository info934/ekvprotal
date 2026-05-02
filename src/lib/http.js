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
  
  let signal;

  // Use AbortSignal.any to combine user signal with timeout signal if available (Node 20+)
  if (initSignal) {
    try {
      signal = AbortSignal.any([initSignal, AbortSignal.timeout(timeoutMs)]);
    } catch (e) {
      // Fallback if .any is not supported (though Node 20 should support it)
      const controller = new AbortController();
      signal = controller.signal;
      
      const timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
      
      initSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort(initSignal.reason);
      });
      
      // We don't have a perfect way to clean up the listener here without wrapping fetch, 
      // but this branch shouldn't be hit in the specified environment.
    }
  } else {
    signal = AbortSignal.timeout(timeoutMs);
  }

  try {
    return await fetch(input, { ...restInit, signal });
  } catch (error) {
    if (error.name === 'TimeoutError' || (error.name === 'AbortError' && signal.aborted && !initSignal?.aborted)) {
      throw new Error('Request timeout');
    }
    throw error;
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