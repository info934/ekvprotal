
import { corsHeaders } from "./cors.ts";
import { authorizeFunctionRequest } from "../_shared/authorize.ts";

/**
 * UNIVERSAL PAYOUT EMAIL NOTIFICATION EDGE FUNCTION
 *
 * Handles all payout-related emails via Resend API
 * Supports: created, approved, invoice_uploaded, paid notifications
 */

interface EmailPayload {
  type: 'created' | 'approved' | 'invoice_uploaded' | 'paid';
  to: string;
  subject: string;
  htmlContent: string;
  payoutId?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    await authorizeFunctionRequest(req, { adminOnly: true });
    console.log('[send-payout-notification] Request received');
    
    // Get Resend API key from secrets
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured in Supabase secrets');
    }

    // Parse request body
    const payload: EmailPayload = await req.json();
    console.log('[send-payout-notification] Payload:', {
      type: payload.type,
      to: payload.to,
      subject: payload.subject,
      payoutId: payload.payoutId,
      timestamp: new Date().toISOString()
    });

    // Validate payload
    if (!payload.to || !payload.subject || !payload.htmlContent) {
      throw new Error('Missing required fields: to, subject, htmlContent');
    }

    // Send email via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'EKV Group Portal <noreply@ekvgroup.cz>',
        to: [payload.to],
        subject: payload.subject,
        html: payload.htmlContent
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('[send-payout-notification] Resend API error:', resendData);
      throw new Error(`Resend API error: ${resendData.message || 'Unknown error'}`);
    }

    console.log('[send-payout-notification] Email sent successfully:', {
      emailId: resendData.id,
      payoutId: payload.payoutId,
      type: payload.type
    });

    return new Response(
      JSON.stringify({
        success: true,
        emailId: resendData.id,
        message: 'Email sent successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('[send-payout-notification] Error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.status || 500
      }
    );
  }
});
