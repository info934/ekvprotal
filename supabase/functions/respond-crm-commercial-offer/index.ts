import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const sha256 = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const publicSnapshot = (snapshot: any) => ({
  document: {
    number: snapshot?.document?.number || '',
    title: snapshot?.document?.title || '',
    label: snapshot?.document?.label || 'Nabídka',
    issueDate: snapshot?.document?.issueDate || null,
    validUntil: snapshot?.document?.validUntil || null,
    total: snapshot?.document?.total || 0,
    taxTotal: snapshot?.document?.taxTotal || 0,
    totalWithTax: snapshot?.document?.totalWithTax || 0,
  },
  client: { name: snapshot?.client?.name || '' },
  opportunity: {
    title: snapshot?.opportunity?.title || '',
    projectName: snapshot?.opportunity?.projectName || '',
  },
  items: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item: any) => ({
    position: item.position, code: item.code, name: item.name, description: item.description,
    quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice,
    discountPercent: item.discountPercent, vatRate: item.vatRate, lineTotal: item.lineTotal,
    sectionName: item.sectionName, itemKind: item.itemKind, includedInTotal: item.includedInTotal,
  })),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const body = await req.json();
    const token = String(body.token || '');
    const action = String(body.action || 'view');
    const signerName = String(body.signerName || '').trim().slice(0, 160);
    const note = String(body.note || '').trim().slice(0, 2000);
    if (!/^[0-9a-f]{64}$/i.test(token)) return json({ error: 'Odkaz není platný.' }, 400);
    if (!['view', 'accept', 'reject'].includes(action)) return json({ error: 'Neplatná akce.' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const tokenHash = await sha256(token);
    const { data: delivery } = await admin.from('crm_commercial_document_deliveries')
      .select('*, version:version_id(*)').eq('response_token_hash', tokenHash).maybeSingle();
    if (!delivery) return json({ error: 'Odkaz nebyl nalezen.' }, 404);
    const expired = !delivery.response_expires_at || new Date(delivery.response_expires_at).getTime() < Date.now();
    const terminal = ['accepted', 'rejected'].includes(delivery.status);
    const view = {
      status: delivery.status,
      expired,
      responded: terminal,
      responseExpiresAt: delivery.response_expires_at,
      offer: publicSnapshot(delivery.version?.snapshot || {}),
    };
    if (action === 'view') return json(view);
    if (expired) return json({ error: 'Platnost odkazu vypršela.', ...view }, 410);
    if (terminal) return json(view);
    if (!signerName) return json({ error: 'Doplňte jméno osoby, která nabídku potvrzuje.' }, 400);
    if (action === 'reject' && !note) return json({ error: 'Doplňte důvod odmítnutí nabídky.' }, 400);

    if (action === 'accept') {
      const { data, error } = await admin.rpc('accept_crm_offer', {
        p_offer_id: delivery.document_id, p_response_note: note || `Potvrdil/a: ${signerName}`, p_external: true,
      });
      if (error) throw error;
      await admin.from('crm_commercial_document_deliveries').update({ status: 'accepted' }).eq('id', delivery.id);
      await admin.from('crm_commercial_document_events').insert({
        document_id: delivery.document_id, version_id: delivery.version_id, delivery_id: delivery.id,
        event_type: 'external_acceptance', summary: `Nabídku přijal/a ${signerName}`,
        metadata: { signerName, note, orderId: data?.order?.id || null },
      });
      return json({ success: true, status: 'accepted', orderNumber: data?.order?.number || null });
    }

    const respondedAt = new Date().toISOString();
    const { data: offer } = await admin.from('crm_commercial_documents').update({
      status: 'rejected', rejected_at: respondedAt, responded_at: respondedAt,
      response_note: note || `Odmítl/a: ${signerName}`, sync_items: false,
    }).eq('id', delivery.document_id).select('opportunity_id').single();
    await admin.from('crm_commercial_document_deliveries').update({ status: 'rejected' }).eq('id', delivery.id);
    if (offer?.opportunity_id) await admin.from('crm_opportunities').update({
      stage: 'lost', status: 'lost', lost_reason: note || 'Nabídka odmítnuta klientem', lost_at: respondedAt,
    }).eq('id', offer.opportunity_id);
    await admin.from('crm_commercial_document_events').insert({
      document_id: delivery.document_id, version_id: delivery.version_id, delivery_id: delivery.id,
      event_type: 'external_rejection', summary: `Nabídku odmítl/a ${signerName}`, metadata: { signerName, note },
    });
    return json({ success: true, status: 'rejected' });
  } catch (error) {
    console.error('[respond-crm-commercial-offer]', error);
    return json({ error: error?.message || 'Odpověď se nepodařila uložit.' }, 500);
  }
});
