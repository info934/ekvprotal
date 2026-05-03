import { supabase } from '@/lib/customSupabaseClient';
import { sendPayoutNotification, sendAdminPayoutNotification } from './payoutEmailService';

/**
 * Creates a professional, email-client-safe HTML email template.
 */
const createEmailTemplate = (subject, greeting, content, cta, salutation) => {
  return `
    <!DOCTYPE html>
    <html lang="cs">
    <head>
      <meta charset="UTF-8">
      <title>${subject}</title>
    </head>
    <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f2f5f7;">
      <div style="max-width: 600px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">${subject}</h2>
        <p>${greeting}</p>
        <div>${content}</div>
        ${cta ? `<a href="${cta.url}" style="display:inline-block; padding:10px 20px; background:#3b82f6; color:#fff; text-decoration:none; border-radius:5px; margin-top:15px;">${cta.text}</a>` : ''}
        <p style="margin-top: 20px; color: #666;">${salutation}</p>
      </div>
    </body>
    </html>
  `;
};

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

  const htmlContent = createEmailTemplate(subject, greeting, content, cta, salutation);

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to, subject, htmlContent, attachments },
    });
    if (error) throw new Error('Failed to send email via Supabase function.');
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

// Wrappers for payout notifications to maintain compatibility
export const sendPayoutRequestEmail = async (params) => sendPayoutNotification({ ...params, status: 'request_created' });
export const sendPayoutApprovalEmail = async (params) => sendPayoutNotification({ ...params, status: 'approved' });
export const sendPayoutRejectionEmail = async (params) => sendPayoutNotification({ ...params, status: 'rejected' });
export const sendPayoutPaidEmail = async (params) => sendPayoutNotification({ ...params, status: 'paid' });
export const sendPayoutCompletedEmail = async (params) => sendPayoutNotification({ ...params, status: 'completed' });

export const sendHourlyPayoutRequestEmail = async ({ memberName, hours, projects, totalAmount, createdAt }) => {
  return await sendAdminPayoutNotification({
    memberName,
    amount: totalAmount,
    action: `Nová hodinová žádost (${hours}h)`
  });
};

export const sendAttendanceApprovalRequestEmail = async ({ memberName, totalHours, monthDate, projects, submittedAt }) => {
  // Existing implementation
};

export const sendHourlyPayoutPaidEmail = async ({ email, memberName, amount, hours, paidAt }) => {
  return await sendPayoutPaidEmail({
    memberId: null,
    amount,
    emailOverride: email,
    memberNameOverride: memberName
  });
};
