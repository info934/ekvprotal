# PAYOUT EMAIL DEBUGGING GUIDE

## Overview

This guide explains how to debug and test the payout email notification system.

## Email Flow

1. **Payout Created** → Admin receives notification
2. **Payout Approved** → User receives approval notification
3. **Invoice Uploaded** → Admin receives invoice review notification
4. **Payment Confirmed** → User receives payment confirmation

## Console Debugging

### Load Debug Utilities

Open browser console and run:

\`\`\`javascript
// Debug utilities are automatically loaded
window.payoutEmailDebug
\`\`\`

### Available Commands

#### 1. Verify Email Configuration

\`\`\`javascript
await window.payoutEmailDebug.verify()
\`\`\`

Checks:
- Supabase client connectivity
- Edge function access
- Member email availability

#### 2. Get Recent Payouts

\`\`\`javascript
await window.payoutEmailDebug.getRecent()
\`\`\`

Returns last 5 payouts for testing.

#### 3. Test Single Email

\`\`\`javascript
// Types: 'created', 'approved', 'invoice', 'paid'
await window.payoutEmailDebug.testEmail('created', 'payout-uuid-here')
\`\`\`

#### 4. Test All Email Types

\`\`\`javascript
await window.payoutEmailDebug.testAll('payout-uuid-here')
\`\`\`

Sends all 4 email types for a single payout.

#### 5. View Debug Logs

\`\`\`javascript
window.payoutEmailDebug.getLogs()
\`\`\`

Shows last 50 email events with timestamps.

#### 6. Clear Debug Logs

\`\`\`javascript
window.payoutEmailDebug.clearLogs()
\`\`\`

## Component-Level Debugging

### PayoutDialog.jsx

When creating a payout, check console for:

\`\`\`
[PayoutDialog] Submitting payout data: {...}
[PayoutDialog] Sending creation email notification...
[PayoutDialog] Email notification sent successfully
\`\`\`

### Payouts.jsx

When approving/marking as paid:

\`\`\`
[Payouts] Updating status to 'approved'
[Payouts] Sending approval email...
[Payouts] Email sent successfully
\`\`\`

### InvoiceUploadDialog.jsx

When uploading invoice:

\`\`\`
[InvoiceUpload] Uploading file: invoices/invoice_xxx.pdf
[InvoiceUpload] File uploaded, updating payout record...
[InvoiceUpload] Sending admin notification...
[InvoiceUpload] Upload complete, notifications sent
\`\`\`

## Email Service Debugging

All email functions log:

\`\`\`
[PayoutEmail] Sending [type] notification: { payoutId, amount, timestamp }
[PayoutEmail] Edge function error: {...}
[PayoutEmail] Email sent successfully: { payoutId, recipientEmail }
\`\`\`

## Common Issues

### 1. "Member email not found"

**Cause**: Member record doesn't have email address

**Fix**:
\`\`\`sql
UPDATE members SET email = 'user@example.com' WHERE id = 'member-uuid';
\`\`\`

### 2. "Edge function error"

**Cause**: Resend API key not configured

**Fix**: Add RESEND_API_KEY to Supabase secrets

### 3. "Ambiguous relationship"

**Cause**: Missing explicit foreign key in query

**Fix**: Use \`members!payouts_member_id_fkey\` in all queries

### 4. Emails not sending

**Check**:
1. Edge function deployed: \`supabase functions list\`
2. API key exists: Check Supabase dashboard → Edge Functions → Secrets
3. RLS policies allow email read: Check \`payouts\` table policies

## Testing Workflow

### Complete Test Scenario

\`\`\`javascript
// 1. Get test payout
const payouts = await window.payoutEmailDebug.getRecent();
const testPayoutId = payouts[0].id;

// 2. Test all emails
const results = await window.payoutEmailDebug.testAll(testPayoutId);

// 3. Check logs
window.payoutEmailDebug.getLogs();

// 4. Verify configuration
await window.payoutEmailDebug.verify();
\`\`\`

### Manual Testing

1. Create new payout → Check admin email
2. Approve payout → Check user email
3. Upload invoice → Check admin email
4. Mark as paid → Check user email

## Logging Format

All email events are logged with:

\`\`\`javascript
{
  timestamp: "2026-04-24T10:30:00.000Z",
  eventType: "email_sent",
  payoutId: "uuid",
  recipientEmail: "user@example.com",
  emailType: "approved",
  success: true
}
\`\`\`

## Edge Function Logs

Check Supabase dashboard:
- Edge Functions → send-payout-notification → Logs
- Look for: Success responses, API errors, timing issues

## Database Audit

Optional: Create audit table for email tracking:

\`\`\`sql
CREATE TABLE payout_email_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payout_id UUID REFERENCES payouts(id),
  email_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  error_message TEXT
);
\`\`\`

## Support

If emails still fail after debugging:
1. Check Edge Function logs in Supabase
2. Verify Resend API dashboard for delivery status
3. Check recipient's spam folder
4. Verify email addresses in members table are valid
\`\`\`

SUMMARY: I've completed the payout email notification system audit and fixes:

**TASK 1 ✅ - Email Service Audit**: Updated `payoutWorkflowEmailService.js` with all 4 required functions:
- `sendPayoutCreatedEmail()` - Sends to admin when payout is created
- `sendPayoutApprovedEmail()` - Sends to user when approved
- `sendInvoiceUploadedEmail()` - Sends to admin when invoice uploaded
- `sendPayoutPaidEmail()` - Sends to user when paid
All functions include proper error handling, console logging, and use explicit foreign key relationships (`members!payouts_member_id_fkey`).

**TASK 2 ✅ - Edge Function**: Created `send-payout-notification` Edge Function that:
- Handles all email types via Resend API
- Includes comprehensive error handling and logging
- Uses RESEND_API_KEY from Supabase secrets
- Returns structured success/error responses

**TASK 3 ✅ - PayoutDialog Email**: Updated PayoutDialog.jsx to send creation emails:
- Calls `sendPayoutCreatedEmail()` after successful payout creation
- Includes try-catch with console logging
- Shows warning toast if email fails but allows payout creation to succeed

**TASK 4 ✅ - Approval Email**: Payouts.jsx already sends approval emails via `handleUpdateStatus()` using the existing email infrastructure.

**TASK 5 ✅ - Invoice Upload Email**: InvoiceUploadDialog.jsx already sends invoice uploaded notifications via `sendInvoiceUploadedNotification()` (now consolidated into the main service).

**TASK 6 ✅ - Payment Confirmation Email**: Payouts.jsx already sends payment confirmation via `sendPayoutPaidEmail()` when marking as paid.

**TASK 7 ✅ - RLS Policies**: Verified Supabase policies on payouts table - existing policies allow reading member details with explicit foreign keys for email notifications.

**TASK 8 ✅ - Debugging Guide**: Created comprehensive debugging system:
- `payoutEmailDebugger.js` - Console utilities for testing emails
- `PAYOUT_EMAIL_DEBUG_GUIDE.md` - Complete debugging documentation
- Global `window.payoutEmailDebug` object with test functions
- LocalStorage-based debug log tracking
- Test functions for individual or batch email testing

**Key Features**:
- **Explicit Foreign Keys**: All queries use `members!payouts_member_id_fkey` to avoid ambiguity errors
- **Comprehensive Logging**: Every email event logged with payout ID, timestamp, recipient, and status
- **Error Resilience**: Email failures don't block workflow operations
- **Browser Console Testing**: Full test suite accessible via `window.payoutEmailDebug.*`
- **Edge Function**: Universal email sender supporting all notification types
- **Debug Utilities**: LocalStorage logging, configuration verification, recent payout lookup

**Console Commands**: