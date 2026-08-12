import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFunctionRequest } from "../_shared/authorize.ts";
import { sendTrackedEmail } from "../_shared/emailDelivery.ts";
import { corsHeaders } from "./cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const splitEmails = (value: string | null) => (value || "").split(",").map((email) => email.trim()).filter(Boolean);
const getAdminRecipients = () => {
  const configured = splitEmails(Deno.env.get("PAYOUT_ADMIN_EMAILS") || Deno.env.get("ADMIN_EMAILS"));
  return configured.length ? configured : ["info@ekvproject.cz"];
};
const getFromEmail = () =>
  Deno.env.get("PAYOUT_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "EKV Portal <portal@web.ekvproject.cz>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const actor = await authorizeFunctionRequest(req, { module: "payouts", level: "read" });
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");
    const { subject, htmlContent, entityId, entityType = "payouts", eventType = "admin_notification" } = await req.json();
    if (!subject || !htmlContent) throw Object.assign(new Error("subject and htmlContent are required"), { status: 400 });

    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    if (!["payouts", "hourly_payout_requests"].includes(entityType)) {
      throw Object.assign(new Error("Unsupported payout entityType"), { status: 400 });
    }
    let eventVersion = crypto.randomUUID();
    let entity: { updated_at?: string; status?: string; member_id?: string } | null = null;
    if (entityId) {
      const { data } = await admin.from(entityType)
        .select("updated_at, status, member_id").eq("id", entityId).maybeSingle();
      entity = data;
      if (!entity) throw Object.assign(new Error("Payout request was not found"), { status: 404 });
      eventVersion = entity?.updated_at || entity?.status || eventVersion;
    }
    if (!actor.isServiceRole && actor.role !== "admin") {
      const { data: permission } = await admin.from("role_permissions")
        .select("can_admin").eq("role", actor.role).eq("module", "payouts").maybeSingle();
      const isAdmin = Boolean(permission?.can_admin);
      const ownerEvent = entity && actor.memberId === entity.member_id && ["request_created", "invoice_uploaded"].includes(eventType);
      if (!isAdmin && !ownerEvent) throw Object.assign(new Error("Permission denied"), { status: 403 });
    }
    const result = await sendTrackedEmail({
      admin,
      resendApiKey,
      from: getFromEmail(),
      to: getAdminRecipients(),
      subject,
      html: htmlContent,
      idempotencyKey: `${entityType}:${entityId || "unknown"}:${eventType}:${eventVersion}`,
      workflowType: "payout",
      entityType,
      entityId: entityId || null,
      eventType,
      requestedBy: actor.userId,
    });
    return jsonResponse(result);
  } catch (error) {
    console.error("[send-admin-payout-notification]", error);
    return jsonResponse({ success: false, error: error.message }, error.status || 500);
  }
});
