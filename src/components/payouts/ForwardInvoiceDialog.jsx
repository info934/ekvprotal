import React, { useEffect, useState } from 'react';
import { Loader2, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  DEFAULT_INVOICE_FORWARD_EMAIL,
  sendPayoutInvoiceForwardEmail,
} from '@/lib/payoutInvoiceEmailService';

const ForwardInvoiceDialog = ({ open, onOpenChange, payout, type = 'task' }) => {
  const { toast } = useToast();
  const [email, setEmail] = useState(DEFAULT_INVOICE_FORWARD_EMAIL);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setEmail(DEFAULT_INVOICE_FORWARD_EMAIL);
  }, [open]);

  const handleSend = async () => {
    if (!payout?.invoice_url) {
      toast({
        title: 'Faktura není k dispozici',
        description: 'Tato výplata nemá nahranou fakturu, takže ji nelze odeslat.',
        variant: 'warning',
      });
      return;
    }

    setSending(true);
    const result = await sendPayoutInvoiceForwardEmail({ payout, to: email, type });
    setSending(false);

    if (!result.success) {
      toast({
        title: 'Fakturu se nepodařilo odeslat',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Faktura odeslána',
      description: `Faktura byla odeslána na ${email}.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <Mail className="h-5 w-5" />
          </div>
          <DialogTitle>Odeslat fakturu e-mailem?</DialogTitle>
          <DialogDescription>
            Výplata byla označena jako vyplacená. Fakturu můžete rovnou poslat do účetnictví.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <div className="font-medium text-slate-950">{payout?.members?.name || payout?.member_name || 'Pracovník'}</div>
            <div className="mt-1 truncate">{payout?.invoice_url ? 'Faktura je připravena k odeslání.' : 'U této výplaty není nahraná faktura.'}</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-forward-email">Příjemce</Label>
            <Input
              id="invoice-forward-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={DEFAULT_INVOICE_FORWARD_EMAIL}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Přeskočit
          </Button>
          <Button onClick={handleSend} disabled={sending || !payout?.invoice_url} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Odeslat fakturu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ForwardInvoiceDialog;
