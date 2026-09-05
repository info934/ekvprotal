import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTrackedEmail } from '../_shared/emailDelivery.ts';
import { REPORT_RECIPIENT, buildAttendanceReport, demoReportData, loadReportData, nextReportMonth, scheduledReportMonth } from '../_shared/attendancePlanReport.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const expected = Deno.env.get('ATTENDANCE_PLAN_REPORT_SECRET');
  const supplied = req.headers.get('x-cron-secret');
  if (!expected || !supplied || expected !== supplied) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await req.json();
    if (!['scheduled', 'demo'].includes(body.mode)) return json({ error: 'Invalid mode' }, 400);
    const demo = body.mode === 'demo';
    // Demo calls require a stable caller-supplied ID; retries cannot send twice.
    if (demo && !/^[a-zA-Z0-9_-]{8,80}$/.test(body.demoId || '')) return json({ error: 'Invalid demo ID' }, 400);
    const month = demo ? nextReportMonth() : scheduledReportMonth();
    if (!month) return json({ skipped: true, reason: 'Outside monthly delivery window' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const key = `attendance-plan:${demo ? 'demo:' + body.demoId : 'monthly'}:${month}`;
    // Avoid loading private report data again after confirmed monthly delivery.
    const { data: prior, error: lookupError } = await admin.from('workflow_email_deliveries').select('status,provider_message_id')
      .eq('idempotency_key', `${key}:${REPORT_RECIPIENT}`).maybeSingle();
    if (lookupError) throw new Error('Could not verify delivery history');
    if (prior?.status === 'sent') return json({ success: true, duplicate: true, emailId: prior.provider_message_id, month });
    const reportData = demo ? demoReportData(month) : await loadReportData(admin, month);
    const report = buildAttendanceReport({ month, ...reportData, demo });
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) throw new Error('Email provider is not configured');
    const result = await sendTrackedEmail({ admin, resendApiKey: apiKey,
      from: Deno.env.get('RESEND_FROM_EMAIL') || 'EKV Portal <portal@web.ekvproject.cz>',
      to: [REPORT_RECIPIENT], subject: report.subject, html: report.html,
      attachments: [{ filename: `${demo ? 'DEMO-' : ''}plan-dochazky-${month}.csv`, content: base64(report.csv) }],
      idempotencyKey: key, workflowType: 'attendance_plan_report', entityType: 'attendance_plans', eventType: demo ? 'demo' : 'monthly',
      metadata: { month, timezone: 'Europe/Prague', employee_count: report.employeeCount, plan_count: report.planCount, missing_count: report.missingCount, demo },
    });
    return json({ ...result, month, demo, employeeCount: report.employeeCount, planCount: report.planCount });
  } catch (error) {
    const failure = error as { status?: number; deliveryStatus?: string; message?: string };
    console.error('Attendance plan report failed', failure.deliveryStatus || 'error');
    return json({ error: failure.message || 'Report failed', deliveryStatus: failure.deliveryStatus }, failure.status || 500);
  }
});
