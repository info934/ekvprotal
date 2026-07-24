import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';

const extractFunctionErrorMessage = async (error) => {
  let message = error?.message || '';
  const response = error?.context;

  if (response && typeof response.clone === 'function') {
    try {
      const details = await response.clone().json();
      message = details?.error || details?.message || message;
    } catch {
      try {
        message = (await response.clone().text()) || message;
      } catch {
        // Keep the SDK error when the response body is unavailable.
      }
    }
  } else if (response && typeof response === 'object') {
    message = response.error || response.message || message;
  }

  if (!message || /non-2xx status code/i.test(message)) {
    return 'Služba Google Drive nevrátila podrobnost chyby. Zkuste akci znovu nebo ověřte připojení v Nastavení úložiště.';
  }
  return message;
};

const invoke = async (action, payload = {}) => {
  const { data, error } = await invokeWithTimeout(supabase, 'google-drive-esign', {
    body: { action, ...payload },
  }, 60_000);
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error));
  }
  if (!data?.success) {
    throw new Error(data?.error || 'Google Drive nevrátilo platnou odpověď pro požadovanou akci.');
  }
  return data;
};

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error('PDF could not be read.'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.readAsDataURL(blob);
});

export const getGoogleDriveEsignStatus = () => invoke('status');

export const getGoogleDriveAuthorizationUrl = (redirectAfter = `${window.location.origin}/settings/storage`) => (
  invoke('getAuthorizationUrl', { redirectAfter })
);

export const listProtocolSignatureRequests = async (protocolId) => {
  if (!protocolId) return [];
  const data = await invoke('listRequests', { protocolId });
  return data.requests || [];
};

export const prepareProtocolForGoogleDrive = async ({ protocol, template, signers }) => {
  const { createHandoverProtocolPdfBlob } = await import('@/lib/documentGenerationService');
  const generated = await createHandoverProtocolPdfBlob({ protocol, template });
  return invoke('uploadForSignature', {
    protocolId: protocol.id,
    templateId: template?.id || null,
    fileName: generated.fileName,
    pdfBase64: await blobToBase64(generated.blob),
    signers,
  });
};

export const setGoogleDriveSignatureStatus = (requestId, status, extra = {}) => (
  invoke('setRequestStatus', { requestId, status, ...extra })
);

export const googleSignatureStatusLabels = {
  prepared: 'Připraveno v Drive',
  sent: 'Odesláno k podpisu',
  signed: 'Podepsáno',
  rejected: 'Odmítnuto',
  cancelled: 'Zrušeno',
  error: 'Chyba',
};
