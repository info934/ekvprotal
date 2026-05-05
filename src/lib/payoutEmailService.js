import { supabase } from '@/lib/customSupabaseClient';
import { templates } from './payoutEmailTemplates';

const invokeEmailFunction = async (functionName, body) => {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || `Edge funkce ${functionName} vrátila chybu.`);
  return data;
};

export const sendPayoutNotification = async ({ memberId, status, amount, reason, approved_without_invoice, action, emailOverride, memberNameOverride }) => {
  try {
    let member = { email: emailOverride, name: memberNameOverride };

    if (!member.email && memberId) {
      const { data, error } = await supabase
        .from('members')
        .select('email, name')
        .eq('id', memberId)
        .single();

      if (error) throw error;
      member = data || member;
    }
      
    if (!member?.email) {
      console.warn(`No email found for member ${memberId}`);
      return { success: false, error: 'No email found' };
    }

    const templateData = {
      memberName: member.name,
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

    const data = await invokeEmailFunction('send-payout-email', { to: member.email, subject, htmlContent });
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};

export const sendAdminPayoutNotification = async ({ memberName, amount, action }) => {
  try {
    const htmlContent = templates.admin_notification({ memberName, amount, action });
    const subject = `[Admin] Výplaty: ${action} - ${memberName}`;

    const data = await invokeEmailFunction('send-admin-payout-notification', { subject, htmlContent });
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendAdminPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};
