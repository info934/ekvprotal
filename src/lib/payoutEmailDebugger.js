/**
 * PAYOUT EMAIL DEBUGGING UTILITIES
 * 
 * Comprehensive debugging tools for payout email workflow
 * Usage: Import in browser console or component for testing
 */

import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';
import { 
  sendPayoutCreatedEmail, 
  sendPayoutApprovedEmail, 
  sendInvoiceUploadedNotification, 
  sendPayoutPaidEmail 
} from '@/lib/payoutWorkflowEmailService';

/**
 * Log email event with full context
 */
export const logEmailEvent = (eventType, payoutId, details = {}) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    eventType,
    payoutId,
    ...details
  };
  
  console.log(`[PayoutEmailDebug] ${eventType}:`, logEntry);
  
  // Store in localStorage for persistent debugging
  const debugLogs = JSON.parse(localStorage.getItem('payoutEmailDebugLogs') || '[]');
  debugLogs.push(logEntry);
  localStorage.setItem('payoutEmailDebugLogs', JSON.stringify(debugLogs.slice(-50))); // Keep last 50
  
  return logEntry;
};

/**
 * Get all debug logs from localStorage
 */
export const getDebugLogs = () => {
  return JSON.parse(localStorage.getItem('payoutEmailDebugLogs') || '[]');
};

/**
 * Clear debug logs
 */
export const clearDebugLogs = () => {
  localStorage.removeItem('payoutEmailDebugLogs');
  console.log('[PayoutEmailDebug] Logs cleared');
};

/**
 * Test email for specific payout
 */
export const testPayoutEmail = async (emailType, payoutId) => {
  try {
    logEmailEvent('test_start', payoutId, { emailType });
    
    // Fetch payout with explicit foreign key
    const { data: payout, error } = await supabase
      .from('payouts')
      .select(`
        *,
        members:members!payouts_member_id_fkey(name, email, auth_user_id),
        approved_member:members!payouts_approved_by_fkey(name, email)
      `)
      .eq('id', payoutId)
      .single();
    
    if (error) {
      logEmailEvent('fetch_error', payoutId, { error: error.message });
      throw error;
    }
    
    logEmailEvent('payout_fetched', payoutId, { 
      memberName: payout.members?.name,
      memberEmail: payout.members?.email,
      amount: payout.amount,
      status: payout.status
    });
    
    let result;
    switch (emailType) {
      case 'created':
        result = await sendPayoutCreatedEmail(payout);
        break;
      case 'approved':
        result = await sendPayoutApprovedEmail(payout);
        break;
      case 'invoice':
        result = await sendInvoiceUploadedNotification(payout);
        break;
      case 'paid':
        result = await sendPayoutPaidEmail(payout);
        break;
      default:
        throw new Error('Invalid email type. Use: created, approved, invoice, or paid');
    }
    
    logEmailEvent('email_sent', payoutId, { 
      emailType, 
      success: result.success,
      error: result.error
    });
    
    return result;
    
  } catch (error) {
    logEmailEvent('test_error', payoutId, { 
      emailType, 
      error: error.message 
    });
    return { success: false, error: error.message };
  }
};

/**
 * Test all email types for a payout
 */
export const testAllEmails = async (payoutId) => {
  console.log('[PayoutEmailDebug] Testing all email types for payout:', payoutId);
  
  const results = {
    created: await testPayoutEmail('created', payoutId),
    approved: await testPayoutEmail('approved', payoutId),
    invoice: await testPayoutEmail('invoice', payoutId),
    paid: await testPayoutEmail('paid', payoutId)
  };
  
  console.table(results);
  return results;
};

/**
 * Get recent payouts for testing
 */
export const getRecentPayouts = async (limit = 5) => {
  try {
    const { data, error } = await supabase
      .from('payouts')
      .select(`
        id,
        amount,
        status,
        request_date,
        members:members!payouts_member_id_fkey(name, email)
      `)
      .order('request_date', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    console.table(data);
    return data;
    
  } catch (error) {
    console.error('[PayoutEmailDebug] Error fetching payouts:', error);
    return [];
  }
};

/**
 * Verify email configuration
 */
export const verifyEmailConfig = async () => {
  console.log('[PayoutEmailDebug] Verifying email configuration...');
  
  const checks = {
    supabaseClient: !!supabase,
    edgeFunctionAccess: false,
    memberEmailExists: false
  };
  
  // Test edge function access
  try {
    const { error } = await invokeWithTimeout(supabase, 'send-payout-notification', {
      body: { test: true }
    });
    checks.edgeFunctionAccess = !error;
  } catch (e) {
    console.error('[PayoutEmailDebug] Edge function test failed:', e);
  }
  
  // Check if members have emails
  try {
    const { data, error } = await supabase
      .from('members')
      .select('id, email')
      .not('email', 'is', null)
      .limit(1);
    
    checks.memberEmailExists = !error && data && data.length > 0;
  } catch (e) {
    console.error('[PayoutEmailDebug] Members check failed:', e);
  }
  
  console.log('[PayoutEmailDebug] Configuration check results:');
  console.table(checks);
  
  return checks;
};

// Expose functions globally for console access
if (typeof window !== 'undefined') {
  window.payoutEmailDebug = {
    testEmail: testPayoutEmail,
    testAll: testAllEmails,
    getRecent: getRecentPayouts,
    getLogs: getDebugLogs,
    clearLogs: clearDebugLogs,
    verify: verifyEmailConfig
  };
  
  console.log('[PayoutEmailDebug] Debug utilities loaded. Available commands:');
  console.log('  window.payoutEmailDebug.testEmail(type, payoutId) - Test single email');
  console.log('  window.payoutEmailDebug.testAll(payoutId) - Test all email types');
  console.log('  window.payoutEmailDebug.getRecent() - Get recent payouts');
  console.log('  window.payoutEmailDebug.getLogs() - View debug logs');
  console.log('  window.payoutEmailDebug.clearLogs() - Clear debug logs');
  console.log('  window.payoutEmailDebug.verify() - Verify email configuration');
}
