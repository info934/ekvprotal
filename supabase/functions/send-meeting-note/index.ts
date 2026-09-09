import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { sendTrackedEmail } from '../_shared/emailDelivery.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type':'application/json' } });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const bytesFromBase64 = (value: string) => Uint8Array.from(atob(value.replace(/^data:application\/pdf;base64,/,'')), c=>c.charCodeAt(0));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders});
  if (req.method !== 'POST') return json({error:'Method not allowed.'},405);
  let documentId = ''; let authorizedDocument = false;
  try {
    const actor = await authorizeFunctionRequest(req);
    const url=Deno.env.get('SUPABASE_URL')||''; const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    const resendApiKey=Deno.env.get('RESEND_API_KEY')||''; const auth=req.headers.get('Authorization')||'';
    if(!url||!serviceKey||!resendApiKey) throw new Error('E-mailová služba není nakonfigurována.');
    const body=await req.json(); documentId=String(body.documentId||'');
    const recipients=Array.from(new Set((Array.isArray(body.recipients)?body.recipients:String(body.recipients||'').split(/[;,\n]/)).map((v:unknown)=>String(v).trim().toLowerCase()).filter(Boolean)));
    const subject=String(body.subject||'').trim().slice(0,180); const message=String(body.message||'').trim().slice(0,8000);
    const pdfBase64=String(body.pdfBase64||''); const idempotencyKey=String(body.idempotencyKey||'').slice(0,240);
    if(!/^[0-9a-f-]{36}$/i.test(documentId)) return json({error:'Neplatný dokument.'},400);
    if(!recipients.length||recipients.length>20||!recipients.every(v=>emailPattern.test(v))) return json({error:'Zkontrolujte adresy příjemců.'},400);
    if(!subject||!message||!pdfBase64||!idempotencyKey) return json({error:'Předmět, zpráva a PDF jsou povinné.'},400);
    const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')||'',{global:{headers:{Authorization:auth}}});
    const admin=createClient(url,serviceKey);
    const {data:document,error:docError}=await admin.from('meeting_note_documents').select('*, note:note_id(id,title,meeting_date,version)').eq('id',documentId).maybeSingle();
    if(docError||!document) return json({error:'PDF zápisu nebylo nalezeno.'},404);
    const {data:allowed,error:accessError}=await userClient.rpc('can_edit_meeting_note',{p_note_id:document.note_id});
    if(accessError||!allowed) return json({error:'Nemáte oprávnění tento zápis odeslat.'},403);
    authorizedDocument = true;
    const bytes=bytesFromBase64(pdfBase64);
    if(bytes.byteLength<100||bytes.byteLength>12*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-') return json({error:'Příloha není platné PDF.'},400);
    const html=`<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#101828"><div style="max-width:680px;margin:auto;padding:28px 16px"><div style="height:6px;border-radius:999px;background:linear-gradient(90deg,#153b82,#2459c7,#2f8f5b)"></div><div style="margin-top:10px;padding:28px;border:1px solid #d7e0ec;border-radius:14px;background:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#2459c7">EKV PROJECT · ZÁPIS Z KD</div><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p style="white-space:pre-wrap;font-size:15px;line-height:1.65;color:#344054">${escapeHtml(message)}</p><p style="color:#667085">Firemní PDF zápisu je přiloženo k e-mailu.</p></div><p style="text-align:center;color:#98a2b3;font-size:12px">EKV Project s.r.o. · Papírnická 2809/16, Plzeň · info@ekvproject.cz</p></div></body></html>`;
    const sent=await sendTrackedEmail({admin,resendApiKey,from:Deno.env.get('RESEND_FROM_EMAIL')||'EKV Project <portal@web.ekvproject.cz>',recipients,subject,html,
      attachments:[{filename:document.file_name,content:pdfBase64.replace(/^data:application\/pdf;base64,/,'')}],
      idempotencyKey,workflowType:'meeting_note',entityType:'meeting_note_document',entityId:document.id,eventType:'sent',requestedBy:actor.userId,
      metadata:{noteId:document.note_id,noteVersion:document.note_version}});
    await admin.from('meeting_note_documents').update({status:'sent',recipients,sent_at:sent.sentAt||new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',documentId);
    return json({...sent,documentId});
  } catch(error) {
    console.error('[send-meeting-note]',error);
    if(authorizedDocument&&documentId){const url=Deno.env.get('SUPABASE_URL')||'';const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';if(url&&key)await createClient(url,key).from('meeting_note_documents').update({status:'delivery_error',last_error:String(error?.message||error).slice(0,1000),updated_at:new Date().toISOString()}).eq('id',documentId);}
    return json({error:error?.message||'Odeslání se nepodařilo.'},error?.status||500);
  }
});
