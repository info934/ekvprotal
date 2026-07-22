
import { corsHeaders } from './cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    await authorizeFunctionRequest(req, { adminOnly: true });
    const { to, subject, htmlContent, attachments } = await req.json();

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set in environment variables.');
      return new Response(JSON.stringify({ error: 'Email server is not configured.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'EKV Portal <portal@web.ekvproject.cz>',
        to: to,
        subject: subject,
        html: htmlContent,
        ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      }),
    });

    if (res.ok) {
        const data = await res.json();
        return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } else {
        const errorBody = await res.text();
        console.error('Failed to send email:', res.status, errorBody);
        return new Response(JSON.stringify({ error: 'Failed to send email.', details: errorBody }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: res.status,
        });
    }

  } catch (error) {
    console.error('Error processing email request:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: error.status || 500,
    });
  }
});

