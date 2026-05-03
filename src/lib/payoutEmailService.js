import { supabase } from '@/lib/customSupabaseClient';
import { templates } from './payoutEmailTemplates';

const sendPayoutEmail = async ({ to, subject, htmlContent }) => {
  if (!to) {
    return { success: false, error: 'No recipient email found' };
  }

  const { data, error } = await supabase.functions.invoke('send-payout-email', {
    body: { to, subject, htmlContent }
  });

  if (error) throw error;
  if (data && data.success === false) throw new Error(data.error || 'Payout email function failed');

  return { success: true, data };
};

export const sendPayoutNotification = async ({
  payoutId,
  memberId,
  status,
  amount,
  reason,
  approved_without_invoice,
  action,
  emailOverride,
  memberNameOverride
}) => {
  try {
    let member = {
      email: emailOverride,
      name: memberNameOverride
    };

    if (memberId && (!member.email || !member.name)) {
      const { data, error } = await supabase
        .from('members')
        .select('email, name')
        .eq('id', memberId)
        .single();

      if (error) throw error;

      member = {
        email: member.email || data?.email,
        name: member.name || data?.name
      };
    }
      
    if (!member?.email) {
      console.warn('No email found for payout notification', { payoutId, memberId, status });
      return { success: false, error: 'No email found' };
    }

    const templateData = {
      memberName: member.name || 'Pracovnik',
      amount: amount || 0,
      reason: reason || '',
      approved_without_invoice,
      action: action || status
    };

    let subject = 'Aktualizace stavu výplaty';
    let htmlContent = '';

    if (templates[status]) {
      htmlContent = templates[status](templateData);
      switch(status) {
        case 'request_created': subject = 'Nová žádost o výplatu přijata'; break;
        case 'approved': subject = 'Vaše žádost o výplatu byla schválena'; break;
        case 'rejected': subject = 'Vaše žádost o výplatu byla zamítnuta'; break;
        case 'invoice_uploaded': subject = 'Faktura úspěšně nahrána'; break;
        case 'paid': subject = 'Výplata odeslána na váš účet'; break;
        case 'completed': subject = 'Výplata uzavřena'; break;
      }
    } else {
      return { success: false, error: 'Unknown status' };
    }

    return await sendPayoutEmail({ to: member.email, subject, htmlContent });
  } catch (error) {
    console.error('Error in sendPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};

export const sendAdminPayoutNotification = async ({ memberName, amount, action }) => {
  try {
    const htmlContent = templates.admin_notification({ memberName, amount, action });
    const subject = `[Admin] Výplaty: ${action} - ${memberName}`;

    const { data, error } = await supabase.functions.invoke('send-admin-payout-notification', {
      body: { subject, htmlContent }
    });

    if (error) throw error;
    if (data && data.success === false) throw new Error(data.error || 'Admin payout notification failed');
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendAdminPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};
