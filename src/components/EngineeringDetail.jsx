import React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FileText, Download, Calendar, Tag, Info, Edit, Trash2, Bell, AlertTriangle } from 'lucide-react';
import { format, isPast, addDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import EngineeringRequestForm from '@/components/EngineeringRequestForm';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { logAction } from '@/lib/logger';

const statusConfig = {
  new: { label: 'Nová', color: 'text-blue-700', bg: 'bg-blue-100' },
  in_progress: { label: 'V řešení', color: 'text-orange-700', bg: 'bg-orange-100' },
  done: { label: 'Hotovo', color: 'text-green-700', bg: 'bg-green-100' },
  waiting_for_input: { label: 'Čeká na podklady', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  waiting_for_approval: { label: 'Čeká na schválení', color: 'text-purple-700', bg: 'bg-purple-100' },
  rejected: { label: 'Zamítnuto', color: 'text-red-700', bg: 'bg-red-100' },
};

const categoryLabels = {
  dotceny_stavbou: 'Dotčený stavbou',
  doss: 'DOSS',
  vyjadreni_siti: 'Vyjádření existence sítí',
  ostatni: 'Ostatní'
};

const DetailItem = ({ icon, label, children }) => (
    <div className="flex items-start space-x-3">
        <div className="mt-1 text-primary">{icon}</div>
        <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <div className="text-base font-semibold">{children || '-'}</div>
        </div>
    </div>
);

const EngineeringDetail = ({ isOpen, onClose, activity, onEdit, onDelete, onToggleUrgency, onStatusChange }) => {
    const { toast } = useToast();

    if (!activity) {
        return null;
    }

    const handleStatusChange = async (newStatus) => {
        const originalStatus = activity.status;
        const { error } = await supabase
            .from('engineering_activities')
            .update({ status: newStatus })
            .eq('id', activity.id);

        if (error) {
            toast({ title: 'Chyba při změně stavu', variant: 'destructive' });
        } else {
            toast({ title: 'Stav činnosti aktualizován' });
            await logAction('update_activity_status', {
                project_id: activity.project_id,
                project_name: activity.projects?.name || 'N/A',
                activity_subject: activity.subject,
                old_status: statusConfig[originalStatus]?.label || originalStatus,
                new_status: statusConfig[newStatus]?.label || newStatus
            });
            onStatusChange(); // re-fetch activities
            // We don't close dialog here to allow user to see the change in status dropdown
        }
    };

    const status = statusConfig[activity.status] || statusConfig['new'];
    const categoryLabel = categoryLabels[activity.category] || activity.category;
    // Use parseISO for safer date parsing
    const isOverdue = activity.status !== 'done' && activity.start_date && activity.dny_na_vyjadreni && isPast(addDays(parseISO(activity.start_date), activity.dny_na_vyjadreni));

    return (
       <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="text-2xl">{activity.subject}</DialogTitle>
                    <p className="text-muted-foreground mt-1">
                        <Link to={`/projects/${activity.project_id}`} className="hover:underline text-primary" onClick={onClose}>
                            {activity.projects?.name} ({activity.projects?.code})
                        </Link>
                    </p>
                </DialogHeader>

                <div className="flex-grow overflow-y-auto pr-4 -mr-4 space-y-6">
                    <div className="bg-slate-50 p-4 rounded-lg">
                        <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 flex-grow">
                                <DetailItem icon={<Tag className="w-5 h-5" />} label="Kategorie">
                                    {categoryLabel}
                                </DetailItem>
                                <DetailItem icon={<Calendar className="w-5 h-5" />} label="Datum zahájení">
                                    {activity.start_date ? format(parseISO(activity.start_date), 'd. M. yyyy') : '-'}
                                </DetailItem>
                                <DetailItem icon={<Calendar className="w-5 h-5" />} label="Termín dokončení">
                                    {activity.end_date ? format(parseISO(activity.end_date), 'd. M. yyyy') : '-'}
                                </DetailItem>
                                <div className="sm:col-span-2 md:col-span-3">
                                    <DetailItem icon={<Info className="w-5 h-5" />} label="Popis">
                                        {activity.description}
                                    </DetailItem>
                                </div>
                                <DetailItem icon={<FileText className="w-5 h-5" />} label="Vyjádření">
                                    {activity.file_url ? (
                                        <a href={activity.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                            <Download className="w-4 h-4" />
                                            <span>{activity.file_name || 'Stáhnout soubor'}</span>
                                        </a>
                                    ) : activity.no_document ? 'Bez dokumentu' : '-'}
                                </DetailItem>
                                {isOverdue &&
                                <div className="flex items-center gap-2 text-red-600">
                                    <AlertTriangle className="w-5 h-5" />
                                    <span className="font-semibold">Po termínu</span>
                                </div>
                                }
                            </div>
                            <div className="flex-shrink-0 flex flex-col items-end gap-2">
                                <Select onValueChange={handleStatusChange} defaultValue={activity.status}>
                                    <SelectTrigger className={cn("w-[180px] font-bold", status.bg, status.color)}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(statusConfig).map(([key, conf]) => (
                                            <SelectItem key={key} value={key}>{conf.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {activity.category === 'dotceny_stavbou' && (
                        <div className="mt-4">
                            <EngineeringRequestForm activity={activity} />
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-4 pt-4 border-t sm:justify-between w-full">
                    <div className="flex gap-2">
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Smazat
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Opravdu smazat činnost?</AlertDialogTitle>
                            </AlertDialogHeader>
                            <DialogFooter>
                                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onDelete(activity.id)} className="bg-red-600 hover:bg-red-700">Smazat</AlertDialogAction>
                            </DialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onToggleUrgency(activity)}>
                            <Bell className={cn("w-4 h-4 mr-2", activity.is_urgent ? "text-yellow-600 fill-yellow-200" : "")} />
                            {activity.is_urgent ? "Zrušit urgenci" : "Urgentní"}
                        </Button>
                        <Button onClick={() => onEdit(activity)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Upravit
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default EngineeringDetail;