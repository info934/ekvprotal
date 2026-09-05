const normalizedStatus = (status) => String(status || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const isCancelledDashboardRecord = (record) => Boolean(
  record?.deleted_at || record?.archived_at || record?.cancelled_at
  || ['cancelled', 'canceled', 'archived', 'deleted', 'zruseno', 'storno', 'stornovano', 'archivovano'].includes(normalizedStatus(record?.status))
);

export const isOpenDashboardStatus = (status) => ![
  'done', 'completed', 'complete', 'finished', 'closed', 'archived', 'cancelled', 'canceled', 'paid',
  'rejected', 'hotovo', 'dokonceno', 'uzavreno', 'zruseno', 'storno', 'stornovano', 'archivovano', 'zamitnuto',
].includes(normalizedStatus(status));

export const isOpenDashboardOpportunity = (record) => (
  !isCancelledDashboardRecord(record)
  && !['won', 'lost'].includes(normalizedStatus(record.stage))
  && isOpenDashboardStatus(record.status)
);
