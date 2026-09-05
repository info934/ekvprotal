export const MEETING_POINT_TYPES = { information: 'Informace', decision: 'Rozhodnutí', task: 'Úkol' };
export function validateMeetingNote(draft) {
  if (!draft.title?.trim() || draft.title.trim().length > 200) return 'Vyplňte název zápisu (nejvýše 200 znaků).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.meeting_date || '') || !Number.isFinite(Date.parse(draft.meeting_date)) || new Date(draft.meeting_date).toISOString().slice(0,10)!==draft.meeting_date) return 'Vyplňte platné datum jednání.';
  if ((draft.participants || '').length > 5000) return 'Seznam účastníků je příliš dlouhý.';
  if (!Array.isArray(draft.points) || draft.points.length>100) return 'Zápis může mít nejvýše 100 bodů.';
  for (const point of draft.points) {
    if (!MEETING_POINT_TYPES[point.kind] || !point.text?.trim() || point.text.length>5000) return 'Každý bod musí mít typ a text (nejvýše 5000 znaků).';
    if (point.kind==='task' && !point.planning_item_id) return 'K bodu Úkol vyberte existující úkol z plánu.';
  }
  return '';
}

export const meetingDraftSignature = draft => draft ? JSON.stringify({
 title:draft.title,meeting_date:draft.meeting_date,participants:draft.participants,
 points:draft.points?.map(point=>({kind:point.kind,text:point.text,planning_item_id:point.planning_item_id||null})),
}) : '';
export function carryMeetingTasks(points,items){
 const open=new Set(items.filter(i=>!['done','completed','cancelled','canceled'].includes(i.status)).map(i=>i.id));
 return points.filter(p=>p.planning_item_id&&open.has(p.planning_item_id)).map(p=>({...p}));
}
