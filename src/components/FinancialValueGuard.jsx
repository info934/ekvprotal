import React from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';

const FinancialValueGuard = ({ value, fallback = '***', className = '' }) => {
    const { userRole } = useAuth();
    const { canViewAmounts } = getFinancialVisibility(userRole);

    if (!canViewAmounts) {
        return (
            <span className={className} title="Přístup odepřen">
                {fallback}
            </span>
        );
    }

    return <span className={className}>{value}</span>;
};

export default FinancialValueGuard;