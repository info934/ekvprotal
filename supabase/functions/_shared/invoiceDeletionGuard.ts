// A registry entry proves ownership, not that the financial document is detached.
// Use the service client so references hidden by the caller's RLS cannot be missed.
export const assertInvoiceFileDetached = async (
  admin: any,
  file: { connectionId: string; fileId: string; fileUrl?: string | null },
) => {
  for (const table of ['payouts', 'hourly_payout_requests']) {
    const byId = await admin.from(table).select('id')
      .eq('invoice_storage_connection_id', file.connectionId)
      .eq('invoice_external_file_id', file.fileId).limit(1);
    if (byId.error) throw Object.assign(new Error('Could not verify invoice references.'), { status: 503 });
    if (byId.data?.length) throw Object.assign(new Error('Detach the invoice from its payout before deleting its file.'), { status: 409 });
    if (file.fileUrl) {
      const byUrl = await admin.from(table).select('id').eq('invoice_url', file.fileUrl).limit(1);
      if (byUrl.error) throw Object.assign(new Error('Could not verify invoice references.'), { status: 503 });
      if (byUrl.data?.length) throw Object.assign(new Error('Detach the invoice from its payout before deleting its file.'), { status: 409 });
    }
  }
};
