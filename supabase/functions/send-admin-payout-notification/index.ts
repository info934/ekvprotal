
import { corsHeaders } from "./cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const splitEmails = (value: string | null) =>
  (value || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

const getAdminRecipients = () => {
  const configured = splitEmails(Deno.env.get("PAYOUT_ADMIN_EMAILS") || Deno.env.get("ADMIN_EMAILS"));
  return configured.length > 0 ? configured : ["info@ekvproject.cz"];
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
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");

    const { subject, htmlContent } = await req.json();
    if (!subject || !htmlContent) {
      throw new Error("Missing required fields: subject, htmlContent");
    }

    const recipients = getAdminRecipients();

    const res = await fetch("https://api.resend.com/emails", {
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
      console.error("Resend admin payout notification error:", data);
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
    console.error("[send-admin-payout-notification]", error);
    return jsonResponse({ success: false, error: error.message }, 500);
  }
});
