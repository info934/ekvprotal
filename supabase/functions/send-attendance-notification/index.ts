import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeFunctionRequest } from "../_shared/authorize.ts";
import { sendTrackedEmail } from "../_shared/emailDelivery.ts";
import { corsHeaders } from "./cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const splitEmails = (value: string | null) => (value || "").split(",").map((email) => email.trim()).filter(Boolean);
const getAdminRecipients = () => {
  const configured = splitEmails(Deno.env.get("ATTENDANCE_ADMIN_EMAILS") || Deno.env.get("ADMIN_EMAILS"));
  return configured.length ? configured : ["info@ekvproject.cz"];
};
const getFromEmail = () =>
  Deno.env.get("ATTENDANCE_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "EKV Portal <portal@web.ekvproject.cz>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const actor = await authorizeFunctionRequest(req);
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");
    const { submissionId, eventType, subject, htmlContent } = await req.json();
    if (!submissionId || !eventType || !subject || !htmlContent) {
      throw Object.assign(new Error("submissionId, eventType, subject and htmlContent are required"), { status: 400 });
    }
    if (!["submitted", "approved", "rejected", "returned"].includes(eventType)) {
      throw Object.assign(new Error("Unsupported attendance eventType"), { status: 400 });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const { data: submission, error } = await admin.from("attendance_submissions")
      .select("id, member_id, status, submitted_at, approved_at, rejected_at, month_date, member:members!attendance_submissions_member_id_fkey(email)")
      .eq("id", submissionId).maybeSingle();
    if (error) throw error;
    if (!submission) throw Object.assign(new Error("Attendance submission was not found"), { status: 404 });

    const isOwnerSubmit = eventType === "submitted" && actor.memberId === submission.member_id;
    let canAdmin = actor.isServiceRole || actor.role === "admin";
    if (!canAdmin) {
      const { data: permission } = await admin.from("role_permissions")
        .select("can_admin").eq("role", actor.role).eq("module", "attendance").maybeSingle();
      canAdmin = Boolean(permission?.can_admin);
    }
    if (!isOwnerSubmit && !canAdmin) throw Object.assign(new Error("Permission denied"), { status: 403 });

    const memberRecord = Array.isArray(submission.member) ? submission.member[0] : submission.member;
    const recipients = eventType === "submitted" ? getAdminRecipients() : [memberRecord?.email].filter(Boolean);
    const eventTimestamp = eventType === "submitted"
      ? submission.submitted_at
      : eventType === "approved"
        ? submission.approved_at
        : submission.rejected_at || submission.submitted_at;

    const result = await sendTrackedEmail({
      admin,
      resendApiKey,
      from: getFromEmail(),
      to: recipients,
      subject,
      html: htmlContent,
      idempotencyKey: `attendance:${submissionId}:${eventType}:${eventTimestamp || submission.status}`,
      workflowType: "attendance",
      entityType: "attendance_submissions",
      entityId: submissionId,
      eventType,
      requestedBy: actor.userId,
      metadata: { status: submission.status, monthDate: submission.month_date },
    });
    return jsonResponse(result);
  } catch (error) {
    console.error("[send-attendance-notification]", error);
    return jsonResponse({ success: false, error: error.message }, error.status || 500);
  }
});
