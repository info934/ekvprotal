import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Database, Download, Trash2, HardDrive, RefreshCw, AlertTriangle, FileJson } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';

import { exportDatabaseAsJSON } from '@/lib/BackupService';
import { saveBackupToBrowser, getBackupsList, deleteBackup, downloadBackup, triggerDownload } from '@/lib/BackupStorage';
import { logBackupAction } from '@/lib/BackupAuditLog';
import PageHeader from '@/components/ui/page-header';

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const BackupMaintenance = () => {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [backupToDelete, setBackupToDelete] = useState(null);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setLoading(true);
    const list = await getBackupsList();
    setBackups(list);
    setLoading(false);
  };

  const handleCreateBackup = async () => {
    if (isExporting) return;
    
    setIsExporting(true);
    toast({
      title: "Zálohování zahájeno",
      description: "Probíhá export databáze, prosím čekejte...",
    });

    try {
      // 1. Export Data
      const { jsonString, filename, errors } = await exportDatabaseAsJSON();
      
      if (errors.length > 0) {
        toast({
          title: "Varování",
          description: "Záloha byla vytvořena, ale některé tabulky se nepodařilo exportovat.",
          variant: "warning"
        });
        console.warn('Backup warnings:', errors);
      }

      // 2. Trigger Download Immediately (Safest for user)
      triggerDownload(jsonString, filename);

      // 3. Save to Browser Storage (for history)
      await saveBackupToBrowser(jsonString, filename);

      // 4. Audit Log
      await logBackupAction(
        'backup_created', 
        { filename, size: new Blob([jsonString]).size },
        user.id,
        user.email
      );

      toast({
        title: "Záloha úspěšná",
        description: `Soubor ${filename} byl stažen a uložen do historie.`,
        variant: "success"
      });

      // 5. Refresh List
      await loadBackups();

    } catch (error) {
      console.error('Backup failed:', error);
      toast({
        title: "Chyba zálohování",
        description: error.message || "Nepodařilo se vytvořit zálohu.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!backupToDelete) return;
    const filename = backupToDelete.filename;

    const success = await deleteBackup(filename);
    if (success) {
      await logBackupAction(
        'backup_deleted', 
        { filename },
        user.id,
        user.email
      );
      
      toast({ title: "Záloha odstraněna z historie" });
      loadBackups();
    } else {
      toast({ title: "Chyba při mazání", variant: "destructive" });
    }
    setBackupToDelete(null);
  };

  const handleDownload = async (filename) => {
    const success = await downloadBackup(filename);
    if (!success) {
      toast({ 
        title: "Soubor nedostupný", 
        description: "Soubor již není v mezipaměti prohlížeče dostupný.",
        variant: "destructive" 
      });
    }
  };

  if (userRole !== 'admin') {
    return null; // Should be handled by ProtectedRoute, but double check
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Database}
        title="Zálohování a údržba"
        description="Správa databázových záloh a export dat"
        actions={
          <Button size="lg" onClick={handleCreateBackup} disabled={isExporting}>
            {isExporting ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Zálohování...
              </>
            ) : (
              <>
                <HardDrive className="mr-2 h-4 w-4" /> Vytvořit zálohu databáze
              </>
            )}
          </Button>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Historie záloh (v tomto prohlížeči)</CardTitle>
            <CardDescription>Seznam lokálně uložených záloh. Pozor: Smazáním historie prohlížeče o tyto záznamy přijdete.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Načítání historie...</div>
            ) : backups.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed">
                <Database className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="text-lg font-medium text-slate-900">Žádné zálohy</h3>
                <p className="text-muted-foreground">Zatím nebyly vytvořeny žádné zálohy.</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Název souboru</TableHead>
                      <TableHead>Datum vytvoření</TableHead>
                      <TableHead>Velikost</TableHead>
                      <TableHead className="text-right">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((backup) => (
                      <TableRow key={backup.filename}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <FileJson className="w-4 h-4 text-blue-500" />
                          {backup.filename}
                        </TableCell>
                        <TableCell>
                          {format(new Date(backup.createdAt), 'Pp', { locale: cs })}
                        </TableCell>
                        <TableCell>{formatBytes(backup.size)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleDownload(backup.filename)}>
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setBackupToDelete(backup)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-800 rounded-md border border-blue-100">
              <Database className="w-5 h-5 shrink-0 mt-0.5" />
              <p>Záloha obsahuje kompletní export všech datových tabulek ve formátu JSON.</p>
            </div>
            
            <div className="flex items-start gap-2 p-3 bg-yellow-50 text-yellow-800 rounded-md border border-yellow-100">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>Zálohy obsahují citlivá data. Ukládejte je na bezpečné místo.</p>
            </div>

            <div className="pt-4 border-t">
              <h4 className="font-medium text-slate-900 mb-2">Zahrnuté tabulky:</h4>
              <ul className="list-disc pl-5 space-y-1 text-xs">
                <li>Projekty a Realizace</li>
                <li>Členové a Týmy</li>
                <li>Finance (Náklady, Výplaty)</li>
                <li>Docházka</li>
                <li>Dokumenty a Inženýring</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!backupToDelete} onOpenChange={(open) => !open && setBackupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat zálohu z historie?</AlertDialogTitle>
            <AlertDialogDescription>
              Záloha <span className="font-semibold">{backupToDelete?.filename}</span> bude odstraněna z historie tohoto prohlížeče. Stažené soubory v počítači tím dotčené nejsou.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Smazat z historie
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BackupMaintenance;
