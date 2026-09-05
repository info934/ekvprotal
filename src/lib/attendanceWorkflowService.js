import { supabase } from '@/lib/customSupabaseClient';
import { attendanceDateOnly as toDateOnly } from './attendanceWorkspace.js';
import { saveAttendanceBatch, saveAttendanceEdit } from './attendanceMutations.js';

export const saveAttendanceRecords = async (records, recordId = null, { batchId } = {}) => {
  if (recordId) {
    if (Array.isArray(records)) throw new Error('Úprava se vztahuje k jedinému záznamu.');
    return saveAttendanceEdit(supabase, records, recordId);
  }
  return saveAttendanceBatch(supabase, Array.isArray(records) ? records : [records], batchId);
};
export const saveAttendanceRecord = (record, recordId = null, options) => saveAttendanceRecords(record, recordId, options);

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

export const withdrawAttendanceSubmission = async (submissionId) => {
  const { data, error } = await supabase.rpc('withdraw_attendance_submission', {
    p_submission_id: submissionId,
  });

  if (error) throw error;
  return data;
};

export const deleteAttendanceSubmission = async (submissionId) => {
  const { data, error } = await supabase.rpc('delete_attendance_submission', {
    p_submission_id: submissionId,
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

export const returnAttendanceSubmissionForEdit = async (submissionId, notes) => {
  const { data, error } = await supabase.rpc('return_attendance_submission_for_edit', {
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
