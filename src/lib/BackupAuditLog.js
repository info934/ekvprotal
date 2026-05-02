import { supabase } from '@/lib/customSupabaseClient';

export const logBackupAction = async (action, details, userId, userEmail) => {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      action, // 'backup_created' or 'backup_deleted'
      user_id: userId,
      user_email: userEmail,
      details, // { filename, size }
      created_at: new Date().toISOString()
    });

    if (error) throw error;
  } catch (err) {
    console.error('Failed to log backup action:', err);
    // Non-blocking error
  }
};