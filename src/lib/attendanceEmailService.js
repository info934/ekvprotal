import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const createTemplate = ({ title, lead, rows = [], note, actionLabel }) => `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f3f6fa;font-family:Arial,sans-serif;color:#172033">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px">
    <div style="background:#fff;border:1px solid #dfe5ee;border-radius:8px;overflow:hidden">
      <div style="padding:22px 24px;border-bottom:1px solid #e7ebf1">
        <div style="font-size:12px;font-weight:700;color:#3266cc;text-transform:uppercase">EKV Portal</div>
        <h1 style="font-size:21px;margin:8px 0 0">${escapeHtml(title)}</h1>
      </div>
      <div style="padding:22px 24px">
        <p style="margin:0 0 18px;line-height:1.55">${escapeHtml(lead)}</p>
        <table style="width:100%;border-collapse:collapse">
          ${rows.map(([label, value]) => `<tr><td style="padding:8px 0;color:#64748b">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(value)}</td></tr>`).join('')}
        </table>
        ${note ? `<div style="margin-top:18px;padding:12px 14px;background:#f8fafc;border-left:3px solid #3266cc;line-height:1.5">${escapeHtml(note)}</div>` : ''}
        <a href="${window.location.origin}/attendance" style="display:inline-block;margin-top:20px;padding:10px 16px;background:#3266cc;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">${escapeHtml(actionLabel)}</a>
      </div>
    </div>
  </div>
</body></html>`;

export const sendAttendanceNotification = async ({ submissionId, eventType, memberName, monthDate, totalHours, projects, reason }) => {
  const config = {
    submitted: { subject: `Docházka ke schválení: ${memberName}`, lead: `${memberName} odeslal(a) měsíční docházku ke schválení.`, actionLabel: 'Otevřít schvalování' },
    approved: { subject: 'Vaše docházka byla schválena', lead: `Docházka pracovníka ${memberName} byla schválena.`, actionLabel: 'Zobrazit docházku' },
    rejected: { subject: 'Vaše docházka byla zamítnuta', lead: `Docházka pracovníka ${memberName} byla zamítnuta.`, actionLabel: 'Otevřít docházku' },
    returned: { subject: 'Docházka byla vrácena k úpravě', lead: `Docházka pracovníka ${memberName} byla vrácena k doplnění.`, actionLabel: 'Upravit docházku' },
  }[eventType];

  if (!config || !submissionId) return { success: false, error: 'Chybí identifikace docházky nebo typ události.' };
  const htmlContent = createTemplate({
    title: config.subject,
    lead: config.lead,
    actionLabel: config.actionLabel,
    rows: [
      ['Období', monthDate || 'Neuvedeno'],
      ['Celkem hodin', `${Number(totalHours || 0).toLocaleString('cs-CZ')} h`],
      ...(projects ? [['Projekty / realizace', projects]] : []),
    ],
    note: reason,
  });

  try {
    const { data, error } = await invokeWithTimeout(supabase, 'send-attendance-notification', {
      body: { submissionId, eventType, subject: config.subject, htmlContent },
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Odeslání notifikace selhalo.');
    return { success: true, data };
  } catch (error) {
    console.error('Attendance notification failed:', error);
    return { success: false, error: error?.message || 'Odeslání notifikace selhalo.' };
  }
};
