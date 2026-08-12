import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';
import { sendAttendanceNotification } from './attendanceEmailService';
import { sendAdminPayoutNotification, sendPayoutNotification } from './payoutEmailService';

const createEmailTemplate = (subject, greeting, content, cta, salutation) => `
  <!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><title>${subject}</title></head>
  <body style="margin:0;padding:20px;font-family:Arial,sans-serif;background-color:#f2f5f7">
    <div style="max-width:600px;margin:0 auto;background:#fff;padding:20px;border:1px solid #dfe5ee;border-radius:8px">
      <h2 style="color:#1e3a8a">${subject}</h2><p>${greeting}</p><div>${content}</div>
      ${cta ? `<a href="${cta.url}" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:5px;margin-top:15px">${cta.text}</a>` : ''}
      <p style="margin-top:20px;color:#666">${salutation}</p>
    </div>
  </body></html>`;

export const sendEmail = async (emailDetails) => {
  let { to, subject, greeting, content, cta, salutation, placeholders, attachments } = emailDetails;
  if (placeholders) {
    Object.entries(placeholders).forEach(([key, value]) => {
      const regex = new RegExp(key, 'g');
      subject = subject.replace(regex, value);
      greeting = greeting.replace(regex, value);
      content = content.replace(regex, value);
      salutation = salutation.replace(regex, value);
    });
  }

  try {
    const { data, error } = await invokeWithTimeout(supabase, 'send-email', {
      body: { to, subject, htmlContent: createEmailTemplate(subject, greeting, content, cta, salutation), attachments },
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Odeslání e-mailu selhalo.');
    return { success: true, data, error: null };
  } catch (error) {
    return { success: false, data: null, error };
  }
};

export const sendPayoutRequestEmail = async (params) => sendPayoutNotification({ ...params, status: 'request_created' });
export const sendPayoutApprovalEmail = async (params) => sendPayoutNotification({ ...params, status: 'approved' });
export const sendPayoutRejectionEmail = async (params) => sendPayoutNotification({ ...params, status: 'rejected' });
export const sendPayoutPaidEmail = async (params) => sendPayoutNotification({ ...params, status: 'paid' });
export const sendPayoutCompletedEmail = async (params) => sendPayoutNotification({ ...params, status: 'completed' });

export const sendHourlyPayoutRequestEmail = async ({ requestId, memberName, hours, totalAmount }) =>
  sendAdminPayoutNotification({
    memberName,
    amount: totalAmount,
    action: `Nová hodinová žádost (${hours} h)`,
    entityId: requestId,
    entityType: 'hourly_payout_requests',
    eventType: 'request_created',
  });

export const sendAttendanceApprovalRequestEmail = async (params) =>
  sendAttendanceNotification({ ...params, eventType: 'submitted' });

export const sendHourlyPayoutPaidEmail = async ({ requestId, memberId, amount }) =>
  sendPayoutNotification({ payoutId: requestId, payoutType: 'hourly', memberId, amount, status: 'paid' });
