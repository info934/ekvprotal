import React, { useState, useEffect } from 'react';
import { getHourlyPayoutApprovalHistory } from '@/lib/PayoutApprovalService';
import { Loader2, History, User, CheckCircle2, FileWarning } from 'lucide-react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';

const HourlyPayoutApprovalAuditLog = ({ requestId }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!requestId) return;
      setLoading(true);
      const result = await getHourlyPayoutApprovalHistory(requestId);
      if (result.success) {
        setLogs(result.data.filter(log => log.action.startsWith('hourly_payout_approved')));
      }
      setLoading(false);
    };

    fetchLogs();
  }, [requestId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Načítání historie schvalování...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic p-2 bg-slate-50 rounded-md border border-dashed border-slate-200">
        Žádné záznamy o schválení.
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-4">
      <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
        <History className="w-4 h-4" /> Historie schvalování
      </h4>
      <div className="space-y-2">
        {logs.map((log) => {
          const isWithoutInvoice = log.details?.approved_without_invoice;
          
          return (
            <div key={log.id} className="bg-white border border-slate-100 p-3 rounded-lg shadow-sm text-sm">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-full ${isWithoutInvoice ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                    {isWithoutInvoice ? <FileWarning className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">
                      {isWithoutInvoice ? 'Schváleno bez faktury' : 'Schváleno (standardně)'}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <User className="w-3 h-3" /> {log.user_email || 'Neznámý admin'}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">
                  {format(new Date(log.created_at), 'dd. MM. yyyy HH:mm', { locale: cs })}
                </span>
              </div>
              
              {log.details?.admin_note && (
                <div className="mt-2 text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 italic">
                  "{log.details.admin_note}"
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HourlyPayoutApprovalAuditLog;