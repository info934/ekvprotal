import { supabase } from '@/lib/customSupabaseClient';

export const logAction = async (action, details = {}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      user_email: user.email,
      action,
      details,
    });
  } catch (error) {
    console.error('Error logging action:', error);
  }
};