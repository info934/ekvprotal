export const getFinancialVisibility = (userRole) => {
    // Global/company financial data is deliberately admin-only. Other roles
    // receive their own compensation through self-scoped read models.
    const canView = userRole === 'admin';
    
    return {
        canViewAmounts: canView,
        canViewCosts: canView,
        canViewProfit: canView
    };
};
