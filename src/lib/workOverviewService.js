import { supabase } from './customSupabaseClient';
import { fetchWorkOverview } from './workOverviewData';
export const loadWorkOverview = options => fetchWorkOverview(supabase, options);
