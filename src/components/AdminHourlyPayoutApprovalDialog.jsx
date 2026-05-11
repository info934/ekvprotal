import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CheckCircle, Clock, FileText, FileWarning, Wallet } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const AdminHourlyPayoutApprovalDialog = ({ isOpen, onClose, request, onConfirm }) => {
  const [isWithoutInvoice, setIsWithoutInvoice] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsWithoutInvoice(false);
      setAdminNote('');
      setError('');
    }
  }, [isOpen]);

  const hasInvoice = !!request?.invoice_url;

  const handleSubmit = async () => {
    setError('');

    if (adminNote.length > 500) {
      setError('Poznámka administrátora může mít maximálně 500 znaků.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(request.id, adminNote, isWithoutInvoice);
      onClose();
    } catch (err) {
      setError('Při schvalování došlo k chybě: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!request) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <FormDialogContent size="md">
        <FormDialogHeader
          icon={Wallet}
          title="Schválení hodinové výplaty"
          description={<>Schvalujete žádost o výplatu pro: <strong className="text-slate-900">{request.members?.name || 'Neznámý'}</strong></>}
        />

        <FormDialogBody className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Období</div>
                <div className="mt-1 font-semibold text-slate-900">
                  {request.payout_month && request.payout_year
                    ? `${request.payout_month}/${request.payout_year}`
                    : request.projects?.name || 'Měsíční žádost'}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Odpracováno</div>
                <div className="mt-1 flex items-center gap-1.5 font-semibold text-slate-900">
                  <Clock className="h-4 w-4 text-slate-500" />
                  {Number(request.total_hours || request.hours || 0).toFixed(1)} h
                </div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Celkem</div>
                <div className="mt-1 font-bold text-emerald-950">{Number(request.total_amount || 0).toLocaleString('cs-CZ')} Kč</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Sazba: <span className="font-semibold text-slate-900">{Number(request.hourly_rate || 0).toLocaleString('cs-CZ')} Kč/h</span>
            </div>
          </div>

          {hasInvoice ? (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
              <FileText className="h-4 w-4 text-emerald-600" />
              <AlertTitle>Faktura je přiložena</AlertTitle>
              <AlertDescription>
                K této žádosti už byla nahrána faktura. Po schválení ji bude možné rovnou uzavřít jako vyplacenou.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-blue-200 bg-blue-50 text-blue-900">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              <AlertTitle>Schválení je první krok</AlertTitle>
              <AlertDescription>
                Po standardním schválení bude žádost čekat na fakturu od zaměstnance. Teprve po jejím nahrání ji půjde označit jako vyplacenou a uzavřít.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
            <Checkbox
              id="without-invoice"
              checked={isWithoutInvoice}
              onCheckedChange={(checked) => setIsWithoutInvoice(Boolean(checked))}
              className="mt-1 border-amber-300 data-[state=checked]:bg-amber-600 data-[state=checked]:text-white"
            />
            <div className="space-y-1">
              <Label htmlFor="without-invoice" className="flex cursor-pointer items-center gap-2 font-semibold text-amber-950">
                <FileWarning className="h-4 w-4 text-amber-700" />
                Schválit bez požadavku na fakturu
              </Label>
              <p className="text-sm leading-5 text-amber-800">
                Použijte jen pro výjimky. Žádost po schválení přeskočí krok nahrání faktury a administrátor ji bude moci rovnou označit jako vyplacenou.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-note">Poznámka (volitelné)</Label>
            <Textarea
              id="admin-note"
              placeholder="Interní poznámka ke schválení..."
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              className="h-24 resize-none"
              maxLength={500}
            />
            <div className="text-right text-xs text-slate-400">{adminNote.length}/500</div>
          </div>

          {error && <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">{error}</div>}
        </FormDialogBody>

        <FormDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Zrušit</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isSubmitting ? 'Schvaluji...' : 'Schválit výplatu'}
          </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default AdminHourlyPayoutApprovalDialog;
