import { useEffect, useMemo, useRef } from 'react';
import { addDays, differenceInMinutes, format, parseISO } from 'date-fns';
import { cs } from 'date-fns/locale';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';

const LINK_TO_DB = { 0: 'fs', 1: 'ss', 2: 'ff', 3: 'sf' };
const LINK_FROM_DB = { fs: '0', ss: '1', ff: '2', sf: '3' };

const toDate = (value) => value instanceof Date ? value : parseISO(value);
const toIso = (value) => value.toISOString();
const formatAccessibleDate = (value) => format(value, 'd. M. yyyy HH:mm', { locale: cs });

const toGanttTask = (item) => {
  const start = toDate(item.start_at || item.start_date);
  const actualEnd = item.item_type === 'milestone' ? start : toDate(item.end_at || item.end_date);
  const ganttEnd = item.end_at ? actualEnd : addDays(actualEnd, 1);
  const durationMinutes = Math.max(0, differenceInMinutes(actualEnd, start));
  const assignmentNames = (item.assignments || []).map((assignment) => assignment.member?.name).filter(Boolean);
  const subcontractorNames = (item.subcontractor_assignments || [])
    .map((assignment) => assignment.subcontractor?.name)
    .filter(Boolean);
  const resourceNames = [...assignmentNames, ...subcontractorNames];

  return {
    id: item.id,
    parent: item.parent_id || 0,
    text: item.name,
    start_date: start,
    end_date: item.item_type === 'milestone' ? start : ganttEnd,
    duration: item.item_type === 'milestone' ? 0 : Math.max(1, durationMinutes / 60),
    type: item.item_type === 'milestone' ? gantt.config.types.milestone : gantt.config.types.task,
    progress: Number(item.progress) || 0,
    member_name: resourceNames.join(', ') || item.member?.name || 'Nepřiřazeno',
    resource_names: resourceNames,
    actual_end: actualEnd,
    duration_label: item.item_type === 'milestone'
      ? 'Milník'
      : durationMinutes < 1440
        ? `${Math.max(1, Math.round((durationMinutes / 60) * 10) / 10)} h`
        : `${Math.max(1, Math.ceil(durationMinutes / 1440))} d`,
    item_type: item.item_type,
    status: item.status,
    open: true,
  };
};

const toGanttLink = (dependency) => ({
  id: dependency.id,
  source: dependency.predecessor_id,
  target: dependency.successor_id,
  type: LINK_FROM_DB[dependency.dependency_type] || '0',
});

const configureScale = (scale) => {
  if (scale === 'month') {
    gantt.config.scale_height = 48;
    gantt.config.scales = [
      { unit: 'month', step: 1, format: '%F %Y' },
      { unit: 'week', step: 1, format: 'Týden %W' },
    ];
    gantt.config.min_column_width = 54;
    return;
  }

  if (scale === 'week') {
    gantt.config.scale_height = 48;
    gantt.config.scales = [
      { unit: 'week', step: 1, format: 'Týden %W' },
      { unit: 'day', step: 1, format: '%D %j.%n.' },
    ];
    gantt.config.min_column_width = 42;
    return;
  }

  gantt.config.scale_height = 48;
  gantt.config.scales = [
    { unit: 'day', step: 1, format: '%l %j. %F' },
    { unit: 'hour', step: 6, format: '%H:%i' },
  ];
  gantt.config.min_column_width = 58;
};

const PlanningGantt = ({
  items,
  dependencies,
  canEdit,
  scale = 'week',
  onItemEdit,
  onItemDatesChange,
  onDependencyCreate,
  onDependencyDelete,
}) => {
  const containerRef = useRef(null);
  const data = useMemo(() => ({
    data: items.map(toGanttTask),
    links: dependencies.map(toGanttLink),
  }), [dependencies, items]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    gantt.clearAll();
    gantt.config.date_format = '%Y-%m-%d';
    gantt.config.duration_unit = 'hour';
    gantt.config.time_step = 15;
    gantt.config.round_dnd_dates = false;
    gantt.config.wai_aria_attributes = true;
    gantt.config.readonly = !canEdit;
    gantt.config.drag_move = canEdit;
    gantt.config.drag_resize = canEdit;
    gantt.config.drag_progress = canEdit;
    gantt.config.drag_links = canEdit;
    gantt.config.row_height = 36;
    gantt.config.bar_height = 20;
    gantt.config.grid_width = 430;
    gantt.config.open_tree_initially = true;
    gantt.config.show_unscheduled = true;
    gantt.config.columns = [
      { name: 'text', label: 'Aktivita', tree: true, width: '*', min_width: 180 },
      { name: 'start_date', label: 'Začátek', align: 'center', width: 112, template: (task) => format(task.start_date, 'd. M. HH:mm') },
      { name: 'duration_label', label: 'Trvání', align: 'center', width: 62 },
      { name: 'member_name', label: 'Zdroje', align: 'left', width: 140 },
    ];
    configureScale(scale);

    gantt.templates.timeline_cell_class = (_task, date) => {
      const day = date.getDay();
      return day === 0 || day === 6 ? 'planning-weekend' : '';
    };
    gantt.templates.task_class = (_start, end, task) => {
      const classes = [`planning-task-${task.item_type}`, `planning-status-${task.status}`];
      if (!['done', 'cancelled'].includes(task.status) && end < new Date()) classes.push('planning-task-late');
      return classes.join(' ');
    };
    gantt.templates.grid_row_class = (_start, _end, task) => `planning-grid-${task.item_type}`;
    gantt.templates.task_text = (_start, _end, task) => task.item_type === 'milestone' ? '' : task.text;
    gantt.templates.tooltip_text = (start, _end, task) => {
      const resources = task.resource_names?.length ? ` Zdroje: ${task.resource_names.join(', ')}.` : '';
      return `${task.text}. Začátek ${formatAccessibleDate(start)}. Konec ${formatAccessibleDate(task.actual_end || start)}.${resources}`;
    };

    gantt.init(containerRef.current);
    gantt.parse(data);

    const eventIds = [];
    eventIds.push(gantt.attachEvent('onTaskDblClick', (id) => {
      const item = items.find((candidate) => candidate.id === String(id));
      if (item) onItemEdit?.(item);
      return false;
    }));
    eventIds.push(gantt.attachEvent('onAfterTaskUpdate', async (id, task) => {
      if (!canEdit) return;
      const start = task.start_date;
      const end = task.item_type === 'milestone' ? start : task.end_date;
      await onItemDatesChange?.(String(id), {
        start_at: toIso(start),
        end_at: toIso(end < start ? start : end),
        progress: Number(task.progress) || 0,
      });
    }));
    eventIds.push(gantt.attachEvent('onBeforeLinkAdd', (_id, link) => !gantt.isCircularLink(link)));
    eventIds.push(gantt.attachEvent('onAfterLinkAdd', async (_id, link) => {
      if (!canEdit) return;
      await onDependencyCreate?.({
        predecessor_id: String(link.source),
        successor_id: String(link.target),
        dependency_type: LINK_TO_DB[link.type] || 'fs',
      });
    }));
    eventIds.push(gantt.attachEvent('onAfterLinkDelete', async (id) => {
      if (!canEdit || String(id).startsWith('$')) return;
      await onDependencyDelete?.(String(id));
    }));

    return () => {
      eventIds.forEach((eventId) => gantt.detachEvent(eventId));
      gantt.clearAll();
    };
  }, [canEdit, data, items, onDependencyCreate, onDependencyDelete, onItemDatesChange, onItemEdit, scale]);

  return (
    <div className="planning-gantt planning-gantt-scroll overflow-x-auto rounded-md border border-slate-200 bg-white">
      <div className="planning-gantt-canvas min-w-[1080px]">
        <div ref={containerRef} className="h-[620px] min-h-[420px] w-full" />
      </div>
    </div>
  );
};

export default PlanningGantt;
