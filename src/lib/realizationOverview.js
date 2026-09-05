const localDay = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

export function realizationDate(value) {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

export function formatRealizationDate(value, fallback = 'Neuvedeno') {
  const day = realizationDate(value);
  return day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('cs-CZ', { timeZone: 'UTC' }) : fallback;
}

export function realizationAssignmentState(assignment, today = localDay()) {
  if (assignment.ended_at || (realizationDate(assignment.valid_to) && realizationDate(assignment.valid_to) < today)) return 'ended';
  if (realizationDate(assignment.valid_from) && realizationDate(assignment.valid_from) > today) return 'planned';
  return 'active';
}

export function getRealizationAttention(realization, today = localDay()) {
  const completed = ['Dokončeno', 'Předáno'].includes(realization.status);
  const deadline = realizationDate(realization.planned_end_date);
  const attention = [];
  if (!completed && !deadline) attention.push('Chybí plánovaný termín dokončení.');
  if (!completed && deadline && deadline < today) attention.push('Plánovaný termín dokončení již uplynul.');
  if (!completed && !realization.lead_person?.id && !realization.lead_person_id) attention.push('Realizace nemá přiřazeného vedoucího.');
  if (completed && !realizationDate(realization.actual_end_date)) attention.push('Chybí skutečné datum dokončení.');
  if (realization.status === 'Pozastaveno') attention.push('Realizace je pozastavená.');
  return attention;
}
