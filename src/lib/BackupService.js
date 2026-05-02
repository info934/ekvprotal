import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';

const TABLES_TO_BACKUP = [
  'members', 
  'projects', 
  'realizations', 
  'payouts', 
  'payout_items', 
  'realizace_team_members', 
  'attendance', 
  'project_members', 
  'project_costs', 
  'realizace_costs', 
  'realizace_extra_costs', 
  'engineering_activities', 
  'documents', 
  'project_tasks', 
  'project_contacts', 
  'project_subcontractors', 
  'subcontractor_orders', 
  'project_orders', 
  'realizace_orders'
];

export const exportDatabaseAsJSON = async () => {
  const backupData = {};
  const errors = [];

  try {
    // Fetch data for all tables in parallel
    const promises = TABLES_TO_BACKUP.map(async (tableName) => {
      try {
        const { data, error } = await supabase.from(tableName).select('*');
        if (error) throw error;
        return { tableName, data };
      } catch (err) {
        console.error(`Error fetching table ${tableName}:`, err);
        errors.push(`Failed to fetch ${tableName}: ${err.message}`);
        return { tableName, data: [] }; // Return empty array on error to allow partial backup
      }
    });

    const results = await Promise.all(promises);

    results.forEach(({ tableName, data }) => {
      backupData[tableName] = data;
    });

    // Add metadata
    backupData.metadata = {
      createdAt: new Date().toISOString(),
      version: '1.0',
      tablesIncluded: TABLES_TO_BACKUP
    };

    if (errors.length > 0) {
      backupData.errors = errors;
    }

    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `backup_${timestamp}.json`;
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });

    return { 
      blob, 
      filename, 
      jsonString, // Returning string for local storage/size calc
      errors 
    };

  } catch (error) {
    console.error('Critical backup error:', error);
    throw new Error('Failed to generate backup: ' + error.message);
  }
};