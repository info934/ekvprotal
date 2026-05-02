export const getFinancialVisibility = (userRole) => {
    // Only admins and super_managers can view financial data
    const canView = userRole === 'admin' || userRole === 'super_manager';
    
    return {
        canViewAmounts: canView,
        canViewCosts: canView,
        canViewProfit: canView
    };
};