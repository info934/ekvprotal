import React, { useState } from 'react';
import {
  Dialog,
} from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const HourlyPayoutRequestDialog = ({ isOpen, onClose, onConfirm, isSubmitting }) => {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    onConfirm(reason);
  };

  const handleOpenChange = (open) => {
    if (!open) {
      setReason('');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <FormDialogContent size="sm">
        <FormDialogHeader
          title="Zamítnout žádost"
          description="Prosím uveďte důvod zamítnutí této žádosti. Tento důvod bude odeslán uživateli na e-mail."
        />
        <FormDialogBody className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reason">Důvod zamítnutí *</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Např. Nesouhlasí počet odpracovaných hodin..."
              className="min-h-[100px] resize-none"
            />
          </div>
        </FormDialogBody>
        <FormDialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Zrušit
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleConfirm} 
            disabled={!reason.trim() || isSubmitting}
          >
            {isSubmitting ? 'Ukládání...' : 'Potvrdit zamítnutí'}
          </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default HourlyPayoutRequestDialog;
