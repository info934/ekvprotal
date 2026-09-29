import { supabase } from './customSupabaseClient';
import { fetchMyWorkOverview } from './overviewRpc.js';

export const loadWorkOverview = options => fetchMyWorkOverview(supabase, options);
