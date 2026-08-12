import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFunctionRequest } from "../_shared/authorize.ts";
import { sendTrackedEmail } from "../_shared/emailDelivery.ts";
import { corsHeaders } from "./cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalizeRecipients = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((email): email is string => typeof email === "string")
    .map((email) => email.trim())
    .filter(Boolean);

const getFromEmail = () =>
  Deno.env.get("PAYOUT_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "EKV Portal <portal@web.ekvproject.cz>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const actor = await authorizeFunctionRequest(req);
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");

    const { payoutId, payoutType = "task", eventType = "notification", to, subject, htmlContent } = await req.json();
    if (!payoutId) throw Object.assign(new Error("payoutId is required"), { status: 400 });
    if (!subject || !htmlContent) throw Object.assign(new Error("subject and htmlContent are required"), { status: 400 });
    if (!['task', 'hourly'].includes(payoutType)) throw Object.assign(new Error("Unsupported payoutType"), { status: 400 });

    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const table = payoutType === "hourly" ? "hourly_payout_requests" : "payouts";
    const relation = payoutType === "hourly"
      ? "members:members!hourly_payout_requests_member_id_fkey(email)"
      : "members:members!payouts_member_id_fkey(email)";
    const columns = payoutType === "hourly"
      ? `id, member_id, status, created_at, updated_at, approved_at, rejected_at, paid_at, ${relation}`
      : `id, member_id, status, request_date, updated_at, approved_at, paid_at, ${relation}`;
    const { data: payout, error: payoutError } = await admin
      .from(table)
      .select(columns)
      .eq("id", payoutId)
      .maybeSingle();
    if (payoutError) throw payoutError;
    if (!payout) throw Object.assign(new Error("Payout request was not found"), { status: 404 });

    if (!actor.isServiceRole && actor.role !== "admin" && actor.memberId !== payout.member_id) {
      const { data: permission } = await admin.from("role_permissions")
        .select("can_admin").eq("role", actor.role).eq("module", "payouts").maybeSingle();
      if (!permission?.can_admin) throw Object.assign(new Error("Permission denied"), { status: 403 });
    }

    const memberRecord = Array.isArray(payout.members) ? payout.members[0] : payout.members;
    const memberEmail = memberRecord?.email;
    const requestedRecipients = normalizeRecipients(to);
    if (!memberEmail || requestedRecipients.some((email) => email.toLowerCase() !== memberEmail.toLowerCase())) {
      throw Object.assign(new Error("Recipient does not match the payout owner"), { status: 403 });
    }

    const eventTimestamp = payout.updated_at || payout.paid_at || payout.rejected_at || payout.approved_at || payout.created_at || payout.request_date;
    const result = await sendTrackedEmail({
      admin,
      resendApiKey,
      from: getFromEmail(),
      to: [memberEmail],
      subject,
      html: htmlContent,
      idempotencyKey: `${payoutType}:${payoutId}:${eventType}:${eventTimestamp || payout.status}`,
      workflowType: "payout",
      entityType: table,
      entityId: payoutId,
      eventType,
      requestedBy: actor.userId,
      metadata: { payoutType, status: payout.status },
    });

    return jsonResponse(result);
  } catch (error) {
    console.error("[send-payout-email]", error);
    return jsonResponse({ success: false, error: error.message }, error.status || 500);
  }
});
