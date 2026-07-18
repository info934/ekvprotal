import { useEffect, useMemo, useRef } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { gantt } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';

const LINK_TO_DB = { 0: 'fs', 1: 'ss', 2: 'ff', 3: 'sf' };
const LINK_FROM_DB = { fs: '0', ss: '1', ff: '2', sf: '3' };

const toDate = (value) => value instanceof Date ? value : parseISO(value);
const toDateOnly = (value) => format(value, 'yyyy-MM-dd');

const toGanttTask = (item) => {
  const start = toDate(item.start_date);
  const inclusiveDuration = Math.max(1, differenceInCalendarDays(toDate(item.end_date), start) + 1);

  return {
    id: item.id,
    parent: item.parent_id || 0,
    text: item.name,
    start_date: start,
    duration: item.item_type === 'milestone' ? 0 : inclusiveDuration,
    type: item.item_type === 'milestone' ? gantt.config.types.milestone : gantt.config.types.task,
    progress: Number(item.progress) || 0,
    member_name: item.member?.name || 'Nepřiřazeno',
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
      { name: 'start_date', label: 'Začátek', align: 'center', width: 82 },
      { name: 'duration', label: 'Dny', align: 'center', width: 48 },
      { name: 'member_name', label: 'Řešitel', align: 'left', width: 110 },
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
      const end = task.item_type === 'milestone' ? start : addDays(task.end_date, -1);
      await onItemDatesChange?.(String(id), {
        start_date: toDateOnly(start),
        end_date: toDateOnly(end < start ? start : end),
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
    <div className="planning-gantt overflow-hidden rounded-md border border-slate-200 bg-white">
      <div ref={containerRef} className="h-[620px] min-h-[420px] w-full" />
    </div>
  );
};

export default PlanningGantt;
