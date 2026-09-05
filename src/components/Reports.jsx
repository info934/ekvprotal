import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, RefreshCw, AlertTriangle, FileText, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/page-header';
import { toSafeCsv } from '@/lib/operationsHelpers';
import { fetchReportRows } from '@/lib/reportData';

const ReportCard = ({ report, onDelete, onDownload }) => {
  const { hasPermission, isSuperUser } = useAuth();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" }}
      className="bg-card border rounded-lg overflow-hidden transition-all duration-300"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{report.name}</CardTitle>
        <FileText className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground">
          Vytvořeno: {format(new Date(report.created_at), 'd. M. yyyy HH:mm', { locale: cs })}
        </div>
        <div className="flex justify-end space-x-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onDownload(report)}>
            <Download className="h-4 w-4 mr-2" />
            Stáhnout
          </Button>
          {hasPermission('reports', 'can_admin') && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Smazat
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Opravdu smazat report?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tato akce je nevratná a report bude trvale odstraněn.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Zrušit</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(report.id)}>Smazat</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </motion.div>
  );
};

const Reports = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const { toast } = useToast();
  const { hasPermission, isSuperUser } = useAuth();
  const requestId = useRef(0);
  const canViewReports = isSuperUser || hasPermission('reports', 'can_read');
  const canExportProjects = canViewReports && (isSuperUser || hasPermission('projects', 'can_read'));

  const fetchReports = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!canViewReports) {
      setReports([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchReportRows(() => supabase.from('reports').select('*')
        .order('created_at', { ascending: false }).order('id'));
      if (currentRequest === requestId.current) setReports(data);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setLoadError(error.message);
      toast({
        title: 'Chyba při načítání reportů',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [canViewReports, toast]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleGenerateReport = async () => {
    if (!canExportProjects || exporting) return;
    setExporting(true);
    try {
      const projects = await fetchReportRows(() => supabase.from('projects')
          .select('id, code, name, status, start_date, completion_date')
          .order('id'));
      const createdAt = new Date();
      const rows = [
        ['Přehled projektů EKV', format(createdAt, 'd. M. yyyy HH:mm')],
        ['Rozsah', 'Projekty přístupné přihlášenému uživateli'],
        ['Počet projektů', projects.length],
        [],
        ['Kód', 'Název', 'Stav', 'Zahájení', 'Termín dokončení'],
        ...projects.map(project => [project.code, project.name, project.status, project.start_date, project.completion_date]),
      ];
      const url = URL.createObjectURL(new Blob([toSafeCsv(rows)], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `EKV_projekty_${format(createdAt, 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: 'CSV přehled je připraven ke stažení', description: `${projects.length} projektů. Export najdete ve stažených souborech.` });
    } catch (error) {
      toast({ title: 'Export se nepodařilo vytvořit', description: error.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteReport = async (id) => {
    if (!isSuperUser && !hasPermission('reports', 'can_admin')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemáte oprávnění mazat reporty.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('reports').delete().eq('id', id);
    if (error) {
      toast({
        title: 'Chyba při mazání reportu',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Report úspěšně smazán' });
      fetchReports();
    }
  };

  const handleDownloadReport = (report) => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(report.data, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `${report.name.replace(/ /g, '_')}_${new Date(report.created_at).toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      toast({ title: 'Report stažen.' });
    } catch (error) {
      toast({
        title: 'Chyba při stahování reportu',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (!canViewReports) {
    return (
      <div className="app-page">
        <div className="space-y-6">
          <Card className="p-12 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-red-600 mb-2">Přístup odepřen</h1>
            <p className="text-muted-foreground">Nemáte oprávnění pro přístup k tomuto modulu.</p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={BarChart3}
          title="Reporty"
          description="Export aktuálních projektů a archiv uložených reportů."
          actions={
            <>
              <Button disabled={exporting || !canExportProjects} onClick={handleGenerateReport} className="w-full md:w-auto">
                <Download className="mr-2 h-4 w-4" />{exporting ? 'Připravuji export…' : 'Exportovat projekty (CSV)'}
              </Button>
              <Button variant="outline" size="sm" onClick={fetchReports} className="bg-white/80 hidden md:inline-flex">
                <RefreshCw className="w-4 h-4 mr-2" />
                Aktualizovat
              </Button>
            </>
          }
        />
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="hidden"
        >
          <div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-primary" />
              Reporty
            </h1>
            <p className="text-muted-foreground">
              Přehled a správa generovaných reportů a statistik.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button onClick={handleGenerateReport} className="w-full md:w-auto">
              Generovat nový report
            </Button>
            <Button variant="outline" size="sm" onClick={fetchReports} className="bg-white/80 hidden md:inline-flex">
              <RefreshCw className="w-4 h-4 mr-2" />
              Aktualizovat
            </Button>
          </div>
        </motion.div>

        <p className="text-sm text-muted-foreground">CSV obsahuje kód, název, stav a termíny dostupných projektů. Stahuje se přímo do počítače; uložené reporty níže tvoří samostatný archiv.{!canExportProjects && ' Pro export potřebujete oprávnění číst projekty.'}</p>
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : loadError ? (
          <Card role="alert" className="p-6 text-center"><p className="font-medium">Archiv reportů se nepodařilo načíst.</p><p className="mt-1 text-sm text-muted-foreground">{loadError}</p><Button variant="outline" className="mt-4" onClick={fetchReports}>Zkusit znovu</Button></Card>
        ) : reports.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                onDelete={handleDeleteReport}
                onDownload={handleDownloadReport}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Žádné reporty nenalezeny</h3>
              <p className="text-muted-foreground mb-4">
                Zatím nebyly vygenerovány žádné reporty.
              </p>
              <Button disabled={exporting || !canExportProjects} onClick={handleGenerateReport}>
                {exporting ? 'Připravuji export…' : 'Exportovat projekty (CSV)'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Reports;
