import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';

const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') return respond({ success: false, error: 'Method not allowed.' }, 405);
    const body = await req.json();
    const action = String(body.action || 'view');
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');

    if (action === 'create') {
      const actor = await authorizeFunctionRequest(req, { module: 'service', level: 'edit' });
      const serviceCaseId = String(body.serviceCaseId || '');
      const { data: serviceCase } = await admin.from('service_cases').select('id, number').eq('id', serviceCaseId).maybeSingle();
      if (!serviceCase) return respond({ success: false, error: 'Servisní případ nebyl nalezen.' }, 404);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const tokenHash = await sha256(token);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await admin.from('service_public_links').update({ revoked_at: new Date().toISOString() })
        .eq('service_case_id', serviceCaseId).is('revoked_at', null);
      const { error } = await admin.from('service_public_links').insert({
        service_case_id: serviceCaseId, token_hash: tokenHash, expires_at: expiresAt, created_by_member_id: actor.memberId,
      });
      if (error) throw error;
      await admin.from('service_cases').update({ public_status_enabled: true, last_client_update_at: new Date().toISOString() }).eq('id', serviceCaseId);
      const base = (Deno.env.get('PORTAL_PUBLIC_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');
      return respond({ success: true, token, url: `${base}/service-status/${token}`, expiresAt });
    }

    const token = String(body.token || '');
    if (!/^[0-9a-f]{64}$/i.test(token)) return respond({ success: false, error: 'Odkaz není platný.' }, 400);
    const tokenHash = await sha256(token);
    const { data: link } = await admin.from('service_public_links').select('id, service_case_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash).maybeSingle();
    if (!link || link.revoked_at || new Date(link.expires_at) <= new Date()) return respond({ success: false, error: 'Odkaz vypršel nebo byl zrušen.' }, 410);
    const [{ data: serviceCase }, { data: documents }] = await Promise.all([
      admin.from('service_cases').select('number,title,status,client_name,installation_address,reported_at,scheduled_start,scheduled_end,resolved_at,resolution_summary')
        .eq('id', link.service_case_id).maybeSingle(),
      admin.from('service_documents').select('id,number,title,document_type,status,signed_at,storage_path')
        .eq('service_case_id', link.service_case_id).in('status', ['sent', 'viewed', 'signed']).order('created_at', { ascending: false }),
    ]);
    if (!serviceCase) return respond({ success: false, error: 'Servisní případ nebyl nalezen.' }, 404);
    const publicDocuments = await Promise.all((documents || []).map(async (document) => {
      let downloadUrl = null;
      if (document.storage_path) {
        const { data } = await admin.storage.from('service-documents').createSignedUrl(document.storage_path, 600);
        downloadUrl = data?.signedUrl || null;
      }
      const { storage_path: _storagePath, ...safeDocument } = document;
      return { ...safeDocument, downloadUrl };
    }));
    await admin.from('service_public_links').update({ last_viewed_at: new Date().toISOString() }).eq('id', link.id);
    return respond({ success: true, serviceCase, documents: publicDocuments, expiresAt: link.expires_at });
  } catch (error) {
    console.error('[service-public-status]', error);
    return respond({ success: false, error: error?.message || 'Servisní informace se nepodařilo načíst.' }, 500);
  }
});
