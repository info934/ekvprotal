import test from 'node:test';
import assert from 'node:assert/strict';
import { removeHourlyInvoice } from '../src/lib/hourlyInvoiceRemoval.js';

const invoice = { filePath: 'invoices/hourly_payout/r/invoice.pdf', accessEntityId: 'r' };
const detached = { id: 'r', status: 'approved', invoice_url: null };

test('invoice cleanup starts only after a confirmed database detach', async () => {
  const order = [];
  const result = await removeHourlyInvoice({ requestId: 'r', invoice,
    clearInvoice: async id => { assert.equal(id, 'r'); order.push('database'); return detached; },
    deleteFile: async file => { assert.equal(file, invoice); order.push('storage'); },
  });
  assert.deepEqual(order, ['database', 'storage']);
  assert.equal(result.request, detached);
  assert.equal(result.cleanupError, null);
});

test('denied, uncertain and unconfirmed database outcomes never delete evidence', async () => {
  for (const clearInvoice of [
    async () => { throw new Error('Network response unavailable'); },
    async () => ({ ...detached, status: 'cancelled' }),
    async () => ({ ...detached, id: 'other' }),
    async () => ({ ...detached, invoice_url: invoice.filePath }),
    async () => null,
  ]) {
    let deletes = 0;
    await assert.rejects(removeHourlyInvoice({ requestId: 'r', invoice, clearInvoice,
      deleteFile: async () => { deletes += 1; },
    }));
    assert.equal(deletes, 0);
  }
});

test('cleanup failure is a warning after saved state, with no repeated RPC', async () => {
  let clears = 0;
  const result = await removeHourlyInvoice({ requestId: 'r', invoice,
    clearInvoice: async () => { clears += 1; return detached; },
    deleteFile: async () => { throw new Error('Storage unavailable'); },
    logAction: async () => { throw new Error('Logging unavailable'); },
  });
  assert.equal(clears, 1);
  assert.equal(result.request, detached);
  assert.match(result.cleanupError.message, /Storage/);
});

test('optional logging cannot delay or overturn the confirmed state transition', async () => {
  const result = await removeHourlyInvoice({ requestId: 'r', invoice,
    clearInvoice: async () => detached, deleteFile: async () => {},
    logAction: () => new Promise(() => {}),
  });
  assert.equal(result.request, detached);
});
