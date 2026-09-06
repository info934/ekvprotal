import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrmAttendees, crmGoalProgress, getCrmMonthRange, normalizeCrmAttendeeEmails } from '../src/lib/crmActivity.js';

test('CRM attendee input keeps unique valid email addresses and normalizes case', () => {
  const emails = normalizeCrmAttendeeEmails(' Client@Example.cz;invalid\nclient@example.cz, team@ekvproject.cz ');
  assert.deepEqual(emails, ['client@example.cz', 'team@ekvproject.cz']);
  assert.deepEqual(buildCrmAttendees(emails.join(',')), [{ email: 'client@example.cz' }, { email: 'team@ekvproject.cz' }]);
});

test('CRM month range includes leap day and exposes an exclusive upper boundary', () => {
  assert.deepEqual(getCrmMonthRange('2028-02'), {
    from: '2028-02-01',
    to: '2028-02-29',
    nextExclusive: '2028-03-01',
  });
  assert.throws(() => getCrmMonthRange('2028-13'), /Invalid month/);
});

test('CRM goal progress is bounded for dashboards', () => {
  assert.equal(crmGoalProgress(3, 10), 30);
  assert.equal(crmGoalProgress(12, 10), 100);
  assert.equal(crmGoalProgress(3, 0), 0);
  assert.equal(crmGoalProgress(-1, 10), 0);
});
