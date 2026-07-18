import React from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';

const FinancialValueGuard = ({ value, fallback = 'Skryto', className = '' }) => {
    const { userRole } = useAuth();
    const { canViewAmounts } = getFinancialVisibility(userRole);

    if (!canViewAmounts) {
        return (
            <span className={className} title="Finanční údaj je skrytý podle oprávnění" aria-label="Finanční údaj je skrytý">
                {fallback}
            </span>
        );
    }

    return <span className={className}>{value}</span>;
};

export default FinancialValueGuard;
