import { supabase } from '@/lib/customSupabaseClient';
import { templates } from './payoutEmailTemplates';

const invokeEmailFunction = async (functionName, body) => {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || `Edge funkce ${functionName} vratila chybu.`);
  return data;
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
      memberName: member.name || 'Pracovnik',
      amount: amount || 0,
      reason: reason || '',
      approved_without_invoice,
      action: action || status,
    };

    let subject = 'Aktualizace stavu vyplaty';
    let htmlContent = '';

    if (templates[status]) {
      htmlContent = templates[status](templateData);
      switch (status) {
        case 'request_created': subject = 'Nova zadost o vyplatu prijata'; break;
        case 'approved': subject = 'Vase zadost o vyplatu byla schvalena'; break;
        case 'rejected': subject = 'Vase zadost o vyplatu byla zamitnuta'; break;
        case 'invoice_uploaded': subject = 'Faktura uspesne nahrana'; break;
        case 'paid': subject = 'Vyplata odeslana na vas ucet'; break;
        case 'completed': subject = 'Vyplata uzavrena'; break;
      }
    } else {
      return { success: false, error: 'Unknown status' };
    }

    const data = await invokeEmailFunction('send-payout-email', { payoutId, to: member.email, subject, htmlContent });
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};

export const sendAdminPayoutNotification = async ({ memberName, amount, action }) => {
  try {
    const htmlContent = templates.admin_notification({ memberName, amount, action });
    const subject = `[Admin] Vyplaty: ${action} - ${memberName}`;
    const data = await invokeEmailFunction('send-admin-payout-notification', { subject, htmlContent });
    return { success: true, data };
  } catch (error) {
    console.error('Error in sendAdminPayoutNotification:', error);
    return { success: false, error: error.message };
  }
};
