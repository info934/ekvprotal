import React, { useRef, useState } from 'react';
import {
  Dialog,
} from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import ConfirmActionDialog from '@/components/ui/confirm-action-dialog';
import { getFinanceErrorMessage } from '@/lib/financePresentation';

const HourlyPayoutRequestDialog = ({ isOpen, onClose, onConfirm, isSubmitting, mode = 'reject' }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const inFlight = useRef(false);
  const busy = isSubmitting || pending;
  const cancelling = mode === 'cancel';

  const handleConfirm = async () => {
    if (inFlight.current || busy) return;
    if (!reason.trim() || reason.trim().length > 500) { setError('Uveďte důvod v rozsahu 1 až 500 znaků.'); return; }
    inFlight.current = true; setPending(true); setError(null);
    try {
      const result = await onConfirm(reason.trim());
      if (result === false) throw new Error('Rozhodnutí nebylo uloženo. Rozepsaný důvod zůstal zachovaný.');
      onClose();
    } catch (failure) { setError(getFinanceErrorMessage(failure, failure?.message)); }
    finally { inFlight.current = false; setPending(false); }
  };

  const handleOpenChange = (open) => {
    if (!open && !inFlight.current && !busy) {
      if (reason.trim()) setDiscard(true); else onClose();
    }
  };

  return (
    <><Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <FormDialogContent size="sm">
        <FormDialogHeader
          title={cancelling ? 'Stornovat hodinovou žádost' : 'Zamítnout hodinovou žádost'}
          description={cancelling ? 'Storno uzavře tuto žádost a uvolní podklady pro případnou opravenou žádost. Již provedenou úhradu tím nelze vrátit.' : 'Uveďte srozumitelný důvod, aby pracovník mohl případnou chybu opravit.'}
        />
        <FormDialogBody className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="hourly-decision-reason">{cancelling ? 'Důvod storna' : 'Důvod zamítnutí'} *</Label>
            <Textarea
              id="hourly-decision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Např. Nesouhlasí počet odpracovaných hodin..."
              className="min-h-[100px] resize-none"
              maxLength={500}
              disabled={busy}
            />
          </div>
          {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </FormDialogBody>
        <FormDialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Zrušit
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleConfirm} 
            disabled={!reason.trim() || busy}
          >
            {busy ? 'Ukládám…' : cancelling ? 'Potvrdit storno' : 'Potvrdit zamítnutí'}
          </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog><ConfirmActionDialog open={discard} onOpenChange={setDiscard} title="Zahodit rozepsaný důvod?" description="Odůvodnění zatím není uložené." confirmLabel="Zahodit změny" onConfirm={() => { setDiscard(false); onClose(); }} /></>
  );
};

export default HourlyPayoutRequestDialog;
