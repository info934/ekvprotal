const isMeaningfulBreakdownKey = (key) => {
  const normalized = String(key || '').trim().toLocaleLowerCase('cs-CZ');
  return normalized && !['ostatni', 'ostatní', 'nezarazeno', 'nezařazeno'].includes(normalized);
};

const summarizeBreakdown = (breakdown) => {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    return [];
  }

  return Object.entries(breakdown)
    .filter(([key]) => isMeaningfulBreakdownKey(key))
    .map(([key, hours]) => ({
      label: String(key).trim(),
      hours: Number(hours || 0),
    }))
    .filter((item) => item.label);
};

const summarizeSnapshot = (snapshot) => {
  if (!Array.isArray(snapshot)) {
    return { count: 0, projectIds: [], realizationIds: [] };
  }

  const projectIds = new Set();
  const realizationIds = new Set();

  snapshot.forEach((entry) => {
    if (entry?.project_id) projectIds.add(entry.project_id);
    if (entry?.realization_id) realizationIds.add(entry.realization_id);
  });

  return {
    count: snapshot.length,
    projectIds: [...projectIds],
    realizationIds: [...realizationIds],
  };
};

export const getHourlyPayoutDisplay = (request) => {
  const month = request?.payout_month;
  const year = request?.payout_year;
  const periodLabel = month && year ? `Žádost za ${month}/${year}` : 'Měsíční žádost';
  const directProject = request?.projects?.name || request?.projects?.code;
  const breakdownItems = summarizeBreakdown(request?.breakdown);
  const snapshotSummary = summarizeSnapshot(request?.attendance_snapshot);

  if (directProject) {
    return {
      periodLabel,
      assignmentLabel: directProject,
      assignmentDetail: request?.projects?.code ? `Projekt ${request.projects.code}` : 'Přímá vazba na projekt',
      projectReference: request?.projects?.code || request?.project_id,
      searchText: [periodLabel, directProject, request?.projects?.code].filter(Boolean).join(' '),
    };
  }

  if (breakdownItems.length > 0) {
    const visibleItems = breakdownItems.slice(0, 2);
    const hiddenCount = breakdownItems.length - visibleItems.length;
    const assignmentLabel = [
      ...visibleItems.map((item) => `${item.label}${item.hours ? ` (${item.hours} h)` : ''}`),
      hiddenCount > 0 ? `+${hiddenCount} další` : null,
    ].filter(Boolean).join(', ');

    return {
      periodLabel,
      assignmentLabel,
      assignmentDetail: 'Rozpad z docházky',
      projectReference: snapshotSummary.projectIds[0] || snapshotSummary.realizationIds[0] || null,
      searchText: [periodLabel, ...breakdownItems.map((item) => item.label)].join(' '),
    };
  }

  if (snapshotSummary.count > 0) {
    const linkedCount = snapshotSummary.projectIds.length + snapshotSummary.realizationIds.length;
    return {
      periodLabel,
      assignmentLabel: linkedCount > 0 ? `${linkedCount} navázaných aktivit` : `${snapshotSummary.count} záznamů docházky`,
      assignmentDetail: 'Detail je uložen ve snapshotu docházky',
      projectReference: snapshotSummary.projectIds[0] || snapshotSummary.realizationIds[0] || null,
      searchText: `${periodLabel} snapshot docházka`,
    };
  }

  return {
    periodLabel,
    assignmentLabel: 'Bez vazby na projekt',
    assignmentDetail: 'Režie nebo starší měsíční žádost',
    projectReference: request?.project_id || null,
    searchText: periodLabel,
  };
};
