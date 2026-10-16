import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { previewJobNumber } from '@/lib/projectNumbering';

function useNumberPreview(type, enabled, revision, rpc) {
  const [result, setResult] = useState({ code: '', loading: false, error: '' });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setResult({ code: '', loading: true, error: '' });
    previewJobNumber(supabase, type, rpc).then(code => {
      if (active) setResult({ code, loading: false, error: '' });
    }).catch(error => {
      if (active) setResult({ code: '', loading: false, error: error.message });
    });
    return () => { active = false; };
  }, [type, enabled, revision, rpc]);
  return result;
}

export const useProjectCodePreview = (type, enabled, revision = 0) => useNumberPreview(type, enabled, revision, 'preview_project_code');
export const useOpportunityNumberPreview = (type, enabled, revision = 0) => useNumberPreview(type, enabled, revision, 'preview_crm_opportunity_number');
