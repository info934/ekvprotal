const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const COMPLEXITY_OPTIONS = [
  { value: 'simple', label: 'Jednoduchá' },
  { value: 'standard', label: 'Běžná' },
  { value: 'complex', label: 'Náročná' },
  { value: 'custom', label: 'Vlastní' },
];

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Nízká' },
  { value: 'normal', label: 'Běžná' },
  { value: 'high', label: 'Vysoká' },
  { value: 'critical', label: 'Kritická' },
];

export const ESTIMATE_PRESETS = [
  { label: '1 h', hours: 1 },
  { label: '2 h', hours: 2 },
  { label: '4 h', hours: 4 },
  { label: '1 den', hours: 8 },
  { label: '2 dny', hours: 16 },
];

const parseLocalDate = (value) => {
  if (!DATE_PATTERN.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const result = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(result.getTime()) ? null : result;
};

const formatLocalDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

export const addWorkingDays = (startDate, workDays) => {
  const date = parseLocalDate(startDate);
  const days = Math.floor(Number(workDays));
  if (!date || !Number.isFinite(days) || days <= 0) return '';

  let remaining = days - 1;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1;
  }
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return formatLocalDate(date);
};

export const templateWorkDays = (tasks = []) => {
  const rows = Array.isArray(tasks) ? tasks : [];
  const maximum = rows.reduce((value, task) => {
    const offset = Number(task.start_day_offset ?? task.startOffset ?? 0);
    const duration = Number(task.duration_days ?? task.duration ?? 1);
    return Math.max(value, Math.max(0, offset) + Math.max(1, duration));
  }, 0);
  return maximum || null;
};

export const sumPlannedHours = (assignments = []) => assignments.reduce(
  (sum, assignment) => sum + (Number(assignment.planned_hours) || 0),
  0,
);

export const estimateMismatch = (estimatedHours, assignments = []) => {
  const estimate = Number(estimatedHours) || 0;
  const assigned = sumPlannedHours(assignments);
  return estimate > 0 && Math.abs(estimate - assigned) > 0.01
    ? { estimate, assigned, difference: assigned - estimate }
    : null;
};
