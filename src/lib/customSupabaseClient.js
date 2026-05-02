import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://yurysbxxevtuvhrbmloc.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1cnlzYnh4ZXZ0dXZocmJtbG9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzOTEwNzAsImV4cCI6MjA3NDk2NzA3MH0.2vIaUUID77aXwZ0dbwk8ZmBHX365M8noa8ZlXFFRA0Y';

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};
