
import { corsHeaders } from "./cors.ts";
import { authorizeFunctionRequest } from "../_shared/authorize.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeRecipients = (value: unknown): string[] => {
  const recipients = Array.isArray(value) ? value : [value];
  return recipients
    .filter((email): email is string => typeof email === "string")
    .map((email) => email.trim())
    .filter(Boolean);
};

const getFromEmail = () =>
  Deno.env.get("PAYOUT_FROM_EMAIL") ||
  Deno.env.get("RESEND_FROM_EMAIL") ||
  "EKV Portal <portal@web.ekvproject.cz>";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const actor = await authorizeFunctionRequest(req);
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");

    const { payoutId, to, subject, htmlContent } = await req.json();
    if (!payoutId) throw Object.assign(new Error("payoutId is required"), { status: 400 });
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    );
    const { data: payout } = await admin
      .from("payouts")
      .select("id, member_id, members:members!payouts_member_id_fkey(email)")
      .eq("id", payoutId)
      .maybeSingle();
    if (!payout) throw Object.assign(new Error("Payout request was not found"), { status: 404 });
    if (!actor.isServiceRole && actor.role !== "admin" && actor.memberId !== payout.member_id) {
      const { data: permission } = await admin
        .from("role_permissions")
        .select("can_admin")
        .eq("role", actor.role)
        .eq("module", "payouts")
        .maybeSingle();
      if (!permission?.can_admin) throw Object.assign(new Error("Permission denied"), { status: 403 });
    }
    const memberRecord = Array.isArray(payout.members) ? payout.members[0] : payout.members;
    const memberEmail = memberRecord?.email;
    const requestedRecipients = normalizeRecipients(to);
    if (!memberEmail || requestedRecipients.some((email) => email.toLowerCase() !== memberEmail.toLowerCase())) {
      throw Object.assign(new Error("Recipient does not match the payout owner"), { status: 403 });
    }
    const recipients = [memberEmail];
    if (recipients.length === 0 || !subject || !htmlContent) {
      throw new Error("Missing required fields: to, subject, htmlContent");
    }

    const res = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: getFromEmail(),
        to: recipients,
        subject: subject,
        html: htmlContent,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Resend payout email error:", data);
      return jsonResponse({
        success: false,
        error: data?.message || data?.error || `Resend API error ${res.status}`,
        data,
      }, 502);
    }

    return jsonResponse({
      success: true,
      emailId: data?.id,
      recipients,
      data,
    });
  } catch (error) {
    console.error("[send-payout-email]", error);
    return jsonResponse({ success: false, error: error.message }, error.status || 500);
  }
});
