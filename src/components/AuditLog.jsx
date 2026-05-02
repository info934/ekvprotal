import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { History, Filter, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/page-header';

const actionLabels = {
  'create_project': 'Vytvořil projekt',
  'update_project': 'Upravil projekt',
  'create_member': 'Vytvořil projektanta',
  'update_member': 'Upravil projektanta',
  'delete_member': 'Smazal projektanta',
  'create_subcontractor': 'Vytvořil subdodavatele',
  'update_subcontractor': 'Upravil subdodavatele',
  'delete_subcontractor': 'Smazal subdodavatele',
  'create_payout_request': 'Vytvořil žádost o výplatu',
  'update_payout_status': 'Změnil stav výplaty',
  'create_user': 'Vytvořil uživatele',
};

const AuditLog = () => {
  const { toast } = useToast();
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchLogs = useCallback(async () => {
    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false });

    if (searchTerm) {
      query = query.or(`user_email.ilike.%${searchTerm}%,action.ilike.%${searchTerm}%`);
    }

    const { data, error } = await query;
    if (error) {
      toast({ title: 'Chyba při načítání logů', variant: 'destructive' });
    } else {
      setLogs(data);
    }
  }, [toast, searchTerm]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={History}
        title="Audit Log"
        description="Historie všech akcí v systému"
      />
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="hidden"
      >
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold gradient-text mb-2 flex items-center gap-3">
            <History className="w-8 h-8" />
            Audit Log
          </h1>
          <p className="text-muted-foreground">Historie všech akcí v systému</p>
        </div>
      </motion.div>

      <div className="glass-effect rounded-xl p-6">
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Hledat v logu (email, akce)..."
              className="w-full pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          {logs.map((log, index) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="glass-effect rounded-lg p-4 border-l-4 border-purple-500"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <History className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{log.user_email}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-sm text-muted-foreground">{actionLabels[log.action] || log.action}</span>
                    </div>
                    {log.details?.name && <p className="text-sm font-medium text-purple-600">{log.details.name}</p>}
                    {log.details?.email && <p className="text-sm text-muted-foreground mt-1">Email: {log.details.email}</p>}
                    {log.details?.status && <p className="text-sm text-muted-foreground mt-1">Nový stav: {log.details.status}</p>}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(log.timestamp || log.created_at).toLocaleString('cs-CZ')}
                </span>
              </div>
            </motion.div>
          ))}
           {logs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
                Žádné záznamy k zobrazení.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditLog;
