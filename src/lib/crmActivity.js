const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export const normalizeCrmAttendeeEmails = (value, limit = 50) => Array.from(new Set(String(value || '')
  .split(/[;,\n]/)
  .map((email) => email.trim().toLowerCase())
  .filter((email) => EMAIL_PATTERN.test(email))))
  .slice(0, limit);

export const buildCrmAttendees = (value) => normalizeCrmAttendeeEmails(value).map((email) => ({ email }));

export const getCrmMonthRange = (value) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('Invalid month');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('Invalid month');
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(year, month, 0);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  const next = new Date(year, month, 1);
  const nextExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to, nextExclusive };
};

export const crmGoalProgress = (value, target) => target > 0
  ? Math.min(100, Math.max(0, Math.round((Number(value || 0) / Number(target)) * 100)))
  : 0;

