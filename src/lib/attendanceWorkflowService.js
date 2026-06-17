import { supabase } from '@/lib/customSupabaseClient';

const toDateOnly = (value) => {
  if (!value) return value;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
};

export const saveAttendanceRecord = async (record, recordId = null) => {
  const { data, error } = await supabase.rpc('save_attendance_record', {
    p_record_id: recordId,
    p_member_id: record.member_id,
    p_date: toDateOnly(record.date),
    p_hours: Number(record.hours),
    p_project_id: record.project_id || null,
    p_realizace_id: record.realizace_id || null,
    p_description: record.description || null,
  });

  if (error) throw error;
  return data;
};

export const saveAttendanceRecords = async (records, recordId = null) => {
  if (Array.isArray(records)) {
    const saved = [];
    for (const record of records) {
      saved.push(await saveAttendanceRecord(record));
    }
    return saved;
  }

  return saveAttendanceRecord(records, recordId);
};

export const deleteAttendanceRecord = async (recordId) => {
  const { data, error } = await supabase.rpc('delete_attendance_record', {
    p_record_id: recordId,
  });

  if (error) throw error;
  return data;
};

export const submitAttendanceMonth = async (memberId, monthDate) => {
  const { data, error } = await supabase.rpc('submit_attendance_month', {
    p_member_id: memberId,
    p_month_date: toDateOnly(monthDate),
  });

  if (error) throw error;
  return data;
};

export const approveAttendanceSubmission = async (submissionId) => {
  const { data, error } = await supabase.rpc('approve_attendance_submission', {
    p_submission_id: submissionId,
  });

  if (error) throw error;
  return data;
};

export const rejectAttendanceSubmission = async (submissionId, notes) => {
  const { data, error } = await supabase.rpc('reject_attendance_submission', {
    p_submission_id: submissionId,
    p_notes: notes || null,
  });

  if (error) throw error;
  return data;
};

export const revertAttendanceSubmission = async (submissionId) => {
  const { data, error } = await supabase.rpc('revert_attendance_submission', {
    p_submission_id: submissionId,
  });

  if (error) throw error;
  return data;
};
