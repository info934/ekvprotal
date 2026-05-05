import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/page-header';
import PayoutDialog from '@/components/PayoutDialog';
import { savePayoutRequest } from '@/lib/payoutRequestService';

const PayoutFormPage = () => {
  const navigate = useNavigate();

  const handleSave = async (payoutData) => {
    return savePayoutRequest(payoutData, false, null);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 pb-20">
      <PageHeader
        icon={Wallet}
        title="Nová žádost o výplatu"
        description="Vyberte položky, zkontrolujte dostupné částky a odešlete žádost ke schválení."
        actions={
          <Button variant="ghost" onClick={() => navigate('/payouts')} className="text-slate-500 hover:text-slate-800">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Zpět
          </Button>
        }
        className="mb-6"
      />

      <PayoutDialog
        embedded
        isOpen
        onClose={() => navigate('/payouts')}
        onSave={handleSave}
      />
    </div>
  );
};

export default PayoutFormPage;
