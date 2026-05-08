import { corsHeaders } from '../_shared/cors.ts';

type StorageAction = 'ensureFolder' | 'uploadFile' | 'downloadUrl';

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  },
);

const missingIntegrationResponse = (provider: string) => jsonResponse({
  success: false,
  error: `${provider} integration is not configured yet. Add OAuth secrets and implement the provider client in document-storage Edge Function.`,
}, 501);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action as StorageAction;
    const provider = String(body.provider || '');

    if (!action || !provider) {
      return jsonResponse({ success: false, error: 'Missing action or provider.' }, 400);
    }

    if (provider === 'supabase') {
      return jsonResponse({
        success: true,
        provider,
        action,
        message: 'Supabase Storage is handled directly by the application client.',
      });
    }

    if (!['sharepoint', 'google_drive'].includes(provider)) {
      return jsonResponse({ success: false, error: 'Unsupported storage provider.' }, 400);
    }

    return missingIntegrationResponse(provider);
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected document storage error.',
    }, 500);
  }
});
