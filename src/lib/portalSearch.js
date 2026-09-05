import { supabase } from './customSupabaseClient';
import { fetchPortalSearch } from './portalSearchData';
export const searchPortal = (value, hasPermission, signal) => fetchPortalSearch(supabase, value, hasPermission, signal);
