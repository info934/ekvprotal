// State transition and physical cleanup are separate operations. An uncertain
// database response must never authorize deleting the referenced evidence.
export async function removeHourlyInvoice({ requestId, invoice, clearInvoice, deleteFile, logAction = () => {} }) {
  const log = (action, details) => { void Promise.resolve().then(() => logAction(action, requestId, details)).catch(() => {}); };
  log('invoice_delete_attempt', { invoicePath: invoice.filePath });
  let request;
  try {
    request = await clearInvoice(requestId);
    if (request?.id !== requestId || request.status !== 'approved' || request.invoice_url != null) {
      throw new Error('Server nepotvrdil odebrání faktury. Před opakováním obnovte přehled.');
    }
  } catch (error) {
    log('invoice_delete_failure', { error: error.message });
    throw error;
  }
  let cleanupError = null;
  try { await deleteFile(invoice); }
  catch (error) { cleanupError = error; }
  log(cleanupError ? 'invoice_cleanup_pending' : 'invoice_delete_success', {
    invoicePath: invoice.filePath, ...(cleanupError ? { error: cleanupError.message } : {}),
  });
  return { request, cleanupError };
}
