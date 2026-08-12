import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';
import { templates } from './payoutEmailTemplates';

const invokeEmailFunction = async (functionName, body) => {
  const { data, error } = await invokeWithTimeout(supabase, functionName, { body });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || `Edge funkce ${functionName} vratila chybu.`);
  return data;
};

export const sendPayoutNotification = async ({
  payoutId,
  payoutType = 'task',
  memberId,
  status,
  amount,
  reason,
  approved_without_invoice,
  action,
  emailOverride,
  memberNameOverride,
}) => {
  try {
    let member = {
      email: emailOverride,
      name: memberNameOverride,
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
        name: member.name || data?.name,
      };
    }

    if (!member?.email) {
      console.warn('No email found for payout notification', { payoutId, memberId, status });
      return { success: false, error: 'No email found' };
    }

    const templateData = {
      memberName: member.name || 'Pracovník',
      amount: amount || 0,
      reason: reason || '',
      approved_without_invoice,
      action: action || status,
    };

    let subject = 'Aktualizace stavu výplaty';
    let htmlContent = '';

    if (templates[status]) {
      htmlContent = templates[status](templateData);
      switch (status) {
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

    if (!payoutId) return { success: false, error: 'Chybí identifikace výplaty.' };
    const data = await invokeEmailFunction('send-payout-email', {
      payoutId,
      payoutType,
      eventType: status,
      to: member.email,
      subject,
      htmlContent,
    });
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};

export const sendAdminPayoutNotification = async ({ memberName, amount, action, entityId, entityType = 'payouts', eventType = 'admin_notification' }) => {
  try {
    const htmlContent = templates.admin_notification({ memberName, amount, action });
    const subject = `[Admin] Výplaty: ${action} - ${memberName}`;
    const data = await invokeEmailFunction('send-admin-payout-notification', {
      subject,
      htmlContent,
      entityId,
      entityType,
      eventType,
    });
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendAdminPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};
