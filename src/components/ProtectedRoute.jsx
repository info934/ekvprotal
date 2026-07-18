import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import EkvLoader from '@/components/ui/ekv-loader';
import { ShieldAlert } from 'lucide-react';

const ProtectedRoute = ({ children, requiredRole }) => {
  const { user, userRole, loading } = useAuth();

  if (loading) {
    return <EkvLoader title="Ověřuji přístup" description="Kontroluji uživatele a oprávnění modulu." className="min-h-screen" />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check role authorization
  const isAuthorized = 
    requiredRole === 'admin' ? userRole === 'admin' :
    requiredRole === 'super_admin' ? (userRole === 'admin' || userRole === 'super_manager') : // Assuming super_manager is comparable
    true;

  if (requiredRole && !isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center p-6">
        <ShieldAlert className="w-16 h-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">Přístup odepřen</h1>
        <p className="text-muted-foreground max-w-md mb-6">
          Pro přístup k této sekci nemáte dostatečná oprávnění. 
          Vyžadovaná role: {requiredRole}.
        </p>
        <Button onClick={() => window.location.href = '/'}>
          Zpět na nástěnku
        </Button>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;
