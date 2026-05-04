
import { corsHeaders } from "./cors.ts";

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

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "EKV Group Portal <info@ekvgroup.cz>",
        to: ["info@ekvgroup.cz"], // Send to admin email
        subject: subject,
        html: htmlContent,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `Resend API error ${res.status}`);
    }

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
