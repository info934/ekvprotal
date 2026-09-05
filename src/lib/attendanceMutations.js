import { attendanceDateOnly, attendanceRealizationId } from './attendanceWorkspace.js';

export function attendanceWritePayload(record) {
  return { member_id: record.member_id, date: attendanceDateOnly(record.date), hours: Number(record.hours),
    project_id: record.project_id || null, realizace_id: attendanceRealizationId(record), description: record.description || null };
}

export async function saveAttendanceBatch(client, records, batchId) {
  if (!Array.isArray(records) || !records.length || records.length > 100) throw new Error('Zadejte 1 až 100 docházkových záznamů.');
  if (!batchId) throw new Error('Chybí identifikace dávky. Zavřete formulář a otevřete nový zápis.');
  const payload = records.map(attendanceWritePayload);
  if (new Set(payload.map(row => row.member_id)).size !== 1) throw new Error('Jedna dávka patří právě jednomu pracovníkovi.');
  const { data, error } = await client.rpc('save_attendance_records', { p_records: payload, p_batch_id: batchId });
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== payload.length || data.some(row => !row.id)) throw new Error('Server nepotvrdil úplné uložení. Zkuste odeslat stejnou dávku znovu.');
  return data;
}

export async function saveAttendanceEdit(client, record, recordId) {
  if (!recordId) throw new Error('Chybí identifikace upravovaného záznamu.');
  const payload = attendanceWritePayload(record);
  const { data, error } = await client.rpc('save_attendance_record', {
    p_record_id: recordId, p_member_id: payload.member_id, p_date: payload.date, p_hours: payload.hours,
    p_project_id: payload.project_id, p_realizace_id: payload.realizace_id, p_description: payload.description,
  });
  if (error) throw error;
  if (!data) throw new Error('Server nepotvrdil uložení záznamu. Obnovte přehled.');
  return data;
}
