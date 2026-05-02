import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import Projects from '@/components/Projects';
import Documents from '@/components/Documents';
import Engineering from '@/components/Engineering';
import Payouts from '@/components/Payouts';
import HourlyPayoutRequestsAdmin from '@/components/HourlyPayoutRequestsAdmin';
import AuditLog from '@/components/AuditLog';
import ProjectDetail from '@/components/ProjectDetail';
import Members from '@/components/Members';
import MemberDetail from '@/components/MemberDetail';
import Settings from '@/components/Settings';
import Reports from '@/components/Reports';
import Auth from '@/components/Auth';
import { AuthProvider, useAuth } from '@/contexts/SupabaseAuthContext';
import UserManagement from '@/components/UserManagement';
import Tasks from '@/components/Tasks';
import OrderPage from '@/components/OrderPage';
import SubcontractorOrderPage from '@/components/SubcontractorOrderPage';
import UpdatePassword from '@/components/UpdatePassword';
import Attendance from '@/components/Attendance';
import ProjectHistory from '@/components/ProjectHistory';
import RolePermissions from '@/components/RolePermissions';
import Subjects from '@/components/Subjects';
import SubjectDetail from '@/components/SubjectDetail';
import OverheadCosts from '@/components/OverheadCosts';
import MonthlyAllocation from '@/components/MonthlyAllocation';
import OverheadReports from '@/components/OverheadReports';
import Realizace from '@/components/Realizace';
import RealizaceDetail from '@/components/RealizaceDetail';
import ProjectForm from '@/components/ProjectForm';
import RealizaceForm from '@/components/RealizaceForm';
import RealizaceFinancials from '@/components/RealizaceFinancials';
import OrderTemplateManager from '@/components/OrderTemplateManager';
import RealizaceOrderForm from '@/components/RealizaceOrderForm';
import SettingsProfile from '@/components/SettingsProfile';
import SettingsPortal from '@/components/SettingsPortal';
import SettingsDictionaries from '@/components/SettingsDictionaries';
import ProjectTemplatesSettings from '@/components/ProjectTemplatesSettings';
import ProjectTemplatesPage from '@/components/ProjectTemplatesPage';
import BackupMaintenance from '@/components/BackupMaintenance';
import ProtectedRoute from '@/components/ProtectedRoute';
import ErrorBoundary from '@/components/ErrorBoundary';
import { supabase } from '@/lib/customSupabaseClient';

const PrivateRoute = ({ children, module, level = 'can_read' }) => {
  const { hasPermission, isAdmin } = useAuth();

  if (isAdmin) {
    return children;
  }

  if (!hasPermission(module, level)) {
    return (
      <div className="p-8 text-center flex flex-col items-center justify-center min-h-[50vh]">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Přístup odepřen</h1>
        <p className="text-slate-500">Nemáte oprávnění pro přístup k tomuto modulu.</p>
      </div>
    );
  }
  return children;
};

function AppContent() {
  const { session, loading } = useAuth();
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => {
        setLoadingTimeout(true);
      }, 10000); 

      return () => clearTimeout(timeout);
    } else {
      setLoadingTimeout(false);
    }
  }, [loading]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-xl font-semibold text-foreground">Načítání...</p>
          <p className="text-muted-foreground">Chvilku strpení, připravujeme portál.</p>
          {loadingTimeout && (
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-sm animate-in fade-in slide-in-from-bottom-4">
              <p className="text-sm text-yellow-800 font-medium mb-3">
                Načítání trvá déle než obvykle. Pokud problém přetrvává, může být zaseknutá relace.
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors text-sm font-medium"
                >
                  Obnovit stránku
                </button>
                <button
                  onClick={async () => {
                     await supabase.auth.signOut();
                     localStorage.clear();
                     window.location.href = '/login';
                  }}
                  className="px-4 py-2 bg-white border border-yellow-600 text-yellow-700 rounded hover:bg-yellow-50 transition-colors text-sm font-medium"
                >
                  Odhlásit a resetovat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-w-0 bg-background text-foreground">
      {session ? (
        <>
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-x-hidden lg:ml-56 transition-all duration-300 print:ml-0 print:p-0">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<PrivateRoute module="dashboard"><Dashboard /></PrivateRoute>} />
                <Route path="/dashboard" element={<PrivateRoute module="dashboard"><Dashboard /></PrivateRoute>} />
                <Route path="/projects" element={<PrivateRoute module="projects"><Projects /></PrivateRoute>} />
                <Route path="/projects/new" element={<PrivateRoute module="projects" level="can_edit"><ProjectForm /></PrivateRoute>} />
                <Route path="/projects/:projectId/edit" element={<PrivateRoute module="projects" level="can_edit"><ProjectForm /></PrivateRoute>} />
                <Route path="/projects/:projectId" element={<PrivateRoute module="projects"><ProjectDetail /></PrivateRoute>} />
                <Route path="/projects/:projectId/history" element={<PrivateRoute module="projects"><ProjectHistory /></PrivateRoute>} />
                
                <Route path="/templates" element={<PrivateRoute module="projects"><ProjectTemplatesPage /></PrivateRoute>} />

                <Route path="/realizace" element={<PrivateRoute module="realizace"><Realizace /></PrivateRoute>} />
                <Route path="/realizace/new" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceForm /></PrivateRoute>} />
                <Route path="/realizace/financials" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceFinancials /></PrivateRoute>} />
                <Route path="/realizace/:realizaceId/edit" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceForm /></PrivateRoute>} />
                <Route path="/realizace/:realizaceId" element={<PrivateRoute module="realizace"><RealizaceDetail /></PrivateRoute>} />
                <Route path="/realizace/:realizaceId/orders/new" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceOrderForm /></PrivateRoute>} />
                <Route path="/realizace/:realizaceId/orders/:orderId/edit" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceOrderForm /></PrivateRoute>} />
                <Route path="/documents" element={<PrivateRoute module="documents"><Documents /></PrivateRoute>} />
                <Route path="/engineering" element={<PrivateRoute module="engineering"><Engineering /></PrivateRoute>} />
                <Route path="/tasks" element={<PrivateRoute module="tasks"><Tasks /></PrivateRoute>} />
                <Route path="/attendance" element={<PrivateRoute module="attendance"><Attendance /></PrivateRoute>} />
                <Route path="/subjects" element={<PrivateRoute module="subjects"><Subjects /></PrivateRoute>} />
                <Route path="/subjects/:subjectId" element={<PrivateRoute module="subjects"><SubjectDetail /></PrivateRoute>} />
                <Route path="/members" element={<PrivateRoute module="members"><Members /></PrivateRoute>} />
                <Route path="/members/:memberId" element={<PrivateRoute module="members"><MemberDetail /></PrivateRoute>} />
                
                <Route path="/payouts" element={<ProtectedRoute><Payouts /></ProtectedRoute>} />
                <Route path="/payouts/hourly-admin" element={<PrivateRoute module="payouts" level="can_admin"><div className="p-8"><HourlyPayoutRequestsAdmin /></div></PrivateRoute>} />

                <Route path="/overhead-costs" element={<PrivateRoute module="finance" level="can_admin"><OverheadCosts /></PrivateRoute>} />
                <Route path="/overhead-costs/:tab" element={<PrivateRoute module="finance" level="can_admin"><OverheadCosts /></PrivateRoute>} />
                <Route path="/overhead-costs/allocation/:month" element={<PrivateRoute module="finance" level="can_admin"><MonthlyAllocation /></PrivateRoute>} />
                <Route path="/overhead-costs/reports" element={<PrivateRoute module="finance" level="can_admin"><OverheadReports /></PrivateRoute>} />

                <Route path="/reports" element={<PrivateRoute module="reports"><Reports /></PrivateRoute>} />
                <Route path="/audit" element={<PrivateRoute module="settings" level="can_admin"><AuditLog /></PrivateRoute>} />
                <Route path="/settings" element={<PrivateRoute module="settings"><Settings /></PrivateRoute>}>
                  <Route index element={<SettingsProfile />} />
                  <Route path="profile" element={<SettingsProfile />} />
                  <Route path="users" element={<PrivateRoute module="settings" level="can_admin"><UserManagement /></PrivateRoute>} />
                  <Route path="permissions" element={<PrivateRoute module="settings" level="can_admin"><RolePermissions /></PrivateRoute>} />
                  <Route path="portal" element={<PrivateRoute module="settings" level="can_admin"><SettingsPortal /></PrivateRoute>} />
                  <Route path="order-templates" element={<PrivateRoute module="settings" level="can_admin"><OrderTemplateManager /></PrivateRoute>} />
                  <Route path="dictionaries" element={<PrivateRoute module="settings" level="can_admin"><SettingsDictionaries /></PrivateRoute>} />
                  <Route path="project-templates" element={<PrivateRoute module="settings" level="can_admin"><ProjectTemplatesSettings /></PrivateRoute>} />
                  <Route path="backup-maintenance" element={<ProtectedRoute requiredRole="admin"><BackupMaintenance /></ProtectedRoute>} />
                </Route>
                <Route path="/login" element={<Navigate to="/" />} />
                <Route path="/statements" element={<Navigate to="/engineering" />} />
                <Route path="/authorities" element={<Navigate to="/engineering" />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </>
      ) : (
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Auth />} />
            <Route path="/order/:token" element={<OrderPage />} />
            <Route path="/sub-order/:token" element={<SubcontractorOrderPage />} />
            <Route path="/update-password" element={<UpdatePassword />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </ErrorBoundary>
      )}
    </div>
  );
}

function App() {
  return (
    <>
      <Helmet>
        <title>EKV Group - Portál</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Helmet>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/order/:token" element={<OrderPage />} />
            <Route path="/sub-order/:token" element={<SubcontractorOrderPage />} />
            <Route path="/update-password" element={<UpdatePassword />} />
            <Route path="/*" element={<AppContent />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}

export default App;
