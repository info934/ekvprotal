
import { corsHeaders } from "./cors.ts";

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
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) throw new Error("Missing RESEND_API_KEY");

    const { to, subject, htmlContent } = await req.json();
    const recipients = normalizeRecipients(to);
    if (recipients.length === 0 || !subject || !htmlContent) {
      throw new Error("Missing required fields: to, subject, htmlContent");
    }

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
    return jsonResponse({ success: false, error: error.message }, 500);
  }
});
