const validProjectYear = (value) => {
  if (!value) return null;
  const year = new Date(String(value)).getUTCFullYear();
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
};

export const resolveProjectWorkspaceYear = (project = {}, now = new Date()) => {
  const datedYear = [project.start_date, project.created_at]
    .map(validProjectYear)
    .find((year) => year !== null);
  if (datedYear) return String(datedYear);

  const code = String(project.code || '').trim();
  const fourDigitYear = code.match(/(?:^|[^0-9])(20[0-9]{2})(?:[^0-9]|$)/)?.[1];
  if (fourDigitYear) return fourDigitYear;

  // Only established business codes encode a two-digit year. Generic codes
  // such as IZ-12-6005242 use the middle segment for another identifier.
  const twoDigitYear = code.match(/^(?:OP|PD|NAB|OBJ)[-_/ ]([0-9]{2})(?:[-_/ ]|$)/i)?.[1];
  if (twoDigitYear) return `20${twoDigitYear}`;

  return String(now.getFullYear());
};
