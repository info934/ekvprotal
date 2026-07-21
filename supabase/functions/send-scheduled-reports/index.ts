import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface AppSettings {
  [key: string]: string;
}

// Function to create a professional, email-client-safe HTML email template
const createEmailTemplate = (subject: string, greeting: string, content: string, cta: { url: string; text: string } | null, salutation: string): string => {
  return `
    <!DOCTYPE html>
    <html lang="cs" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <!--[if mso]>
      <style>
        table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        td, div, a { font-family: Arial, sans-serif; }
      </style>
      <![endif]-->
      <style>
        @media screen and (max-width: 600px) {
          .container {
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f2f5f7;">
      <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f2f5f7;" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding: 20px 0;">
            <!--[if mso]>
            <table role="presentation" class="container" style="width: 600px;" cellpadding="0" cellspacing="0" border="0">
            <tr>
            <td>
            <![endif]-->
            <table role="presentation" class="container" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
              <tr>
                <td style="background-color: #0d1a2e; padding: 20px 30px;">
                  <h1 style="color: #ffffff; margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; text-align: center;">${subject}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.6; color: #333333;">
                  <p style="margin: 0 0 1em 0;">${greeting}</p>
                  ${content}
                  ${cta && cta.url && cta.text ? `
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 20px 0;">
                    <tr>
                      <td align="left" bgcolor="#3b82f6" style="border-radius: 6px;">
                        <a href="${cta.url}" target="_blank" style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: bold; color: #ffffff; text-decoration: none; display: inline-block; padding: 12px 24px; border-radius: 6px; border: 1px solid #3b82f6;">${cta.text}</a>
                      </td>
                    </tr>
                  </table>
                  ` : ''}
                  <div style="margin-top: 25px;">
                    <p style="margin: 0;">${salutation}</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="background-color: #e5e7eb; padding: 20px 30px; text-align: center;">
                  <p style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #6b7280; margin: 0 0 5px 0;">Toto je automaticky generovaný email. Prosím, neodpovídejte na něj.</p>
                  <p style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #6b7280; margin: 0;">&copy; ${new Date().getFullYear()} EKV Group. Všechna práva vyhrazena.</p>
                </td>
              </tr>
            </table>
            <!--[if mso]>
            </td>
            </tr>
            </table>
            <![endif]-->
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

// Helper to send email via another Edge Function
const sendEmail = async (supabaseClient: SupabaseClient, to: string, subject: string, htmlContent: string) => {
  const { error } = await supabaseClient.functions.invoke('send-email', {
    body: { to, subject, htmlContent },
  });
  if (error) {
    console.error(`Error sending email to ${to}:`, error);
  } else {
    console.log(`Email sent successfully to ${to}.`);
  }
};

const getOperationalReportContent = async (supabaseClient: SupabaseClient): Promise<string> => {
  const today = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(today.getDate() + 7);

  const { data: overdue, error: overdueError } = await supabaseClient
    .from('engineering_activities')
    .select('subject, end_date, projects(name)')
    .lt('end_date', today.toISOString().split('T')[0])
    .neq('status', 'done');

  const { data: dueSoon, error: dueSoonError } = await supabaseClient
    .from('engineering_activities')
    .select('subject, end_date, projects(name)')
    .gte('end_date', today.toISOString().split('T')[0])
    .lte('end_date', nextWeek.toISOString().split('T')[0])
    .neq('status', 'done');

  if (overdueError || dueSoonError) {
    console.error('Error fetching operational data:', overdueError || dueSoonError);
    return '<p>Došlo k chybě při generování reportu.</p>';
  }

  let content = '';

  if (overdue && overdue.length > 0) {
    content += `<h2 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #dc2626;">🚨 Aktivity po termínu</h2>`;
    overdue.forEach((item: any) => {
      content += `
        <div style="border-radius: 8px; padding: 12px; background-color: #fef2f2; border: 1px solid #fecaca; margin-bottom: 10px;">
            <p style="font-weight: bold; margin: 0;">${item.projects?.name || 'N/A'} - ${item.subject}</p>
            <p style="font-size: 12px; margin: 0;">Termín: ${new Date(item.end_date).toLocaleDateString('cs-CZ')}</p>
        </div>`;
    });
  }

  if (dueSoon && dueSoon.length > 0) {
    content += `<h2 style="font-size: 18px; font-weight: 600; margin-top: 24px; margin-bottom: 8px; color: #ea580c;">🔔 Aktivity končící tento týden</h2>`;
    dueSoon.forEach((item: any) => {
      content += `
        <div style="border-radius: 8px; padding: 12px; background-color: #fff7ed; border: 1px solid #fed7aa; margin-bottom: 10px;">
            <p style="font-weight: bold; margin: 0;">${item.projects?.name || 'N/A'} - ${item.subject}</p>
            <p style="font-size: 12px; margin: 0;">Termín: ${new Date(item.end_date).toLocaleDateString('cs-CZ')}</p>
        </div>`;
    });
  }
  
  if (!content) {
    return '<p>Všechny aktivity jsou v pořádku. Žádné aktivity nejsou po termínu ani nekončí tento týden.</p>';
  }

  return content;
};

const getFinancialReportContent = async (supabaseClient: SupabaseClient): Promise<string> => {
    const { data: financials, error: financialsError } = await supabaseClient.rpc('get_company_financials').single();

    if (financialsError) {
        console.error('Error fetching company financials:', financialsError);
        return '<p>Došlo k chybě při generování finančního reportu.</p>';
    }
    
    const { data: payouts, error: payoutsError } = await supabaseClient.from('payouts').select('amount').in('status', ['pending', 'approved', 'invoice_uploaded']);
    
    if (payoutsError) {
        console.error('Error fetching payouts data:', payoutsError);
        return '<p>Došlo k chybě při generování finančního reportu.</p>';
    }
    
    const totalPayouts = payouts.reduce((sum, p) => sum + (p.amount || 0), 0);

    const formatCurrency = (value: number) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value || 0);

    return `
        <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #16a34a;">💰 Přehled ziskovosti a výplat</h2>
        <div style="padding: 12px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; margin-bottom: 10px;">
            <p style="font-weight: bold; font-size: 18px; margin: 0;">${formatCurrency(financials.realized_profit)}</p>
            <p style="font-size: 12px; margin: 0;">Realizovaný zisk</p>
        </div>
        <div style="padding: 12px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; margin-bottom: 10px;">
            <p style="font-weight: bold; font-size: 18px; margin: 0;">${formatCurrency(financials.potential_profit)}</p>
            <p style="font-size: 12px; margin: 0;">Potenciální zisk</p>
        </div>
        <div style="padding: 12px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 10px;">
            <p style="font-weight: bold; font-size: 18px; margin: 0;">${formatCurrency(totalPayouts)}</p>
            <p style="font-size: 12px; margin: 0;">Celkem odměny k vyplacení</p>
        </div>
    `;
};


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const expectedSecret = Deno.env.get('SCHEDULED_REPORT_SECRET');
    const suppliedSecret = req.headers.get('x-cron-secret');
    if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized scheduled report request.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settingsData, error } = await supabaseClient.from('app_settings').select('key, value');
    if (error) throw error;

    const settings: AppSettings = settingsData.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {});

    const today = new Date();
    const dayOfWeek = today.getDay(); // Sunday - 0, Monday - 1
    const dayOfMonth = today.getDate();

    // Process Operational Report
    const opReportFreq = settings.report_frequency || 'disabled';
    const opReportEmail = settings.report_email;
    let sendOperational = false;
    if (opReportFreq === 'daily') sendOperational = true;
    if (opReportFreq === 'weekly' && dayOfWeek === 1) sendOperational = true; // Monday
    if (opReportFreq === 'monthly' && dayOfMonth === 1) sendOperational = true;

    if (sendOperational && opReportEmail) {
      console.log("Sending operational report...");
      const content = await getOperationalReportContent(supabaseClient);
      const subject = 'Týdenní provozní report';
      const html = createEmailTemplate(
        subject,
        'Dobrý den,',
        content,
        { url: Deno.env.get('SUPABASE_URL')?.replace('/supabase', ''), text: 'Přejít do portálu' },
        'S pozdravem,<br>Váš EKV Portál'
      );
      await sendEmail(supabaseClient, opReportEmail, subject, html);
    }

    // Process Financial Report
    const finReportFreq = settings.financial_report_frequency || 'disabled';
    const finReportEmail = settings.financial_report_email;
    let sendFinancial = false;
    if (finReportFreq === 'daily') sendFinancial = true; // For testing mostly
    if (finReportFreq === 'weekly' && dayOfWeek === 1) sendFinancial = true; // Monday
    if (finReportFreq === 'monthly' && dayOfMonth === 1) sendFinancial = true;

    if (sendFinancial && finReportEmail) {
        console.log("Sending financial report...");
        const content = await getFinancialReportContent(supabaseClient);
        const subject = 'Měsíční finanční report';
        const html = createEmailTemplate(
            subject,
            'Dobrý den,',
            content,
            { url: Deno.env.get('SUPABASE_URL')?.replace('/supabase', ''), text: 'Přejít do portálu' },
            'S pozdravem,<br>Váš EKV Portál'
        );
        await sendEmail(supabaseClient, finReportEmail, subject, html);
    }

    return new Response(JSON.stringify({ message: "Scheduled reports checked." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    console.error("Error in scheduled reports function:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
