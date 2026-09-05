import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import PortalShell from '@/components/layout/PortalShell';
import { AuthProvider, useAuth } from '@/contexts/SupabaseAuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import ErrorBoundary from '@/components/ErrorBoundary';
import EkvLoader from '@/components/ui/ekv-loader';
import { supabase } from '@/lib/customSupabaseClient';
import { LogOut, RefreshCw } from 'lucide-react';

const Dashboard = lazy(() => import('@/components/Dashboard'));
const WorkspaceLanding = lazy(() => import('@/components/WorkspaceLanding'));
const MyWork = lazy(() => import('@/components/MyWork'));
const EmployeeCenter = lazy(() => import('@/components/employee/EmployeeCenter'));
const Projects = lazy(() => import('@/components/Projects'));
const Documents = lazy(() => import('@/components/Documents'));
const CRM = lazy(() => import('@/components/CRM'));
const CRMCommercialDocuments = lazy(() => import('@/components/CRMCommercialDocuments'));
const Products = lazy(() => import('@/components/Products'));
const ProductForm = lazy(() => import('@/components/ProductForm'));
const Engineering = lazy(() => import('@/components/Engineering'));
const Payouts = lazy(() => import('@/components/Payouts'));
const PayoutFormPage = lazy(() => import('@/components/PayoutFormPage'));
const HourlyPayoutRequestsAdmin = lazy(() => import('@/components/HourlyPayoutRequestsAdmin'));
const AuditLog = lazy(() => import('@/components/AuditLog'));
const ProjectDetail = lazy(() => import('@/components/ProjectDetail'));
const Members = lazy(() => import('@/components/Members'));
const MemberDetail = lazy(() => import('@/components/MemberDetail'));
const Settings = lazy(() => import('@/components/Settings'));
const Reports = lazy(() => import('@/components/Reports'));
const Auth = lazy(() => import('@/components/Auth'));
const UserManagement = lazy(() => import('@/components/UserManagement'));
const Tasks = lazy(() => import('@/components/Tasks'));
const OrderPage = lazy(() => import('@/components/OrderPage'));
const SubcontractorOrderPage = lazy(() => import('@/components/SubcontractorOrderPage'));
const UpdatePassword = lazy(() => import('@/components/UpdatePassword'));
const Attendance = lazy(() => import('@/components/Attendance'));
const ProjectHistory = lazy(() => import('@/components/ProjectHistory'));
const RolePermissions = lazy(() => import('@/components/RolePermissions'));
const Subjects = lazy(() => import('@/components/Subjects'));
const SubjectDetail = lazy(() => import('@/components/SubjectDetail'));
const OverheadCosts = lazy(() => import('@/components/OverheadCosts'));
const MonthlyAllocation = lazy(() => import('@/components/MonthlyAllocation'));
const OverheadReports = lazy(() => import('@/components/OverheadReports'));
const Realizace = lazy(() => import('@/components/Realizace'));
const RealizaceDetail = lazy(() => import('@/components/RealizaceDetail'));
const ProjectForm = lazy(() => import('@/components/ProjectForm'));
const RealizaceForm = lazy(() => import('@/components/RealizaceForm'));
const RealizaceFinancials = lazy(() => import('@/components/RealizaceFinancials'));
const OrderTemplateManager = lazy(() => import('@/components/OrderTemplateManager'));
const RealizaceOrderForm = lazy(() => import('@/components/RealizaceOrderForm'));
const SettingsProfile = lazy(() => import('@/components/SettingsProfile'));
const SettingsPortal = lazy(() => import('@/components/SettingsPortal'));
const SettingsDictionaries = lazy(() => import('@/components/SettingsDictionaries'));
const SettingsStorage = lazy(() => import('@/components/SettingsStorage'));
const SettingsCRM = lazy(() => import('@/components/SettingsCRM'));
const ProjectTemplatesSettings = lazy(() => import('@/components/ProjectTemplatesSettings'));
const ProjectTemplatesPage = lazy(() => import('@/components/ProjectTemplatesPage'));
const BackupMaintenance = lazy(() => import('@/components/BackupMaintenance'));
const PlanningBoard = lazy(() => import('@/components/PlanningBoard'));
const NotFound = lazy(() => import('@/components/NotFound'));

const clearSupabaseSessionStorage = () => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('sb-') || key.includes('supabase.auth'))
    .forEach((key) => localStorage.removeItem(key));
};

const PortalLoaderCard = ({
  title = 'Načítání modulu',
  description = 'Připravujeme data a rozhraní portálu.',
  error,
  showActions = false,
  onRetry,
  onResetSession,
}) => (
  <div className="w-full max-w-[440px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.10)]">
    <EkvLoader title={title} description={description} compact className="py-7" />
    {showActions && (
      <div className="border-t border-amber-200 bg-amber-50 p-4 text-left">
        <p className="text-sm font-semibold text-amber-950">{error ? 'Načítání se nepodařilo dokončit' : 'Načítání trvá déle než obvykle'}</p>
        <p className="mt-1 text-xs leading-5 text-amber-800">{error || 'Zkontrolujte připojení, obnovte stránku nebo bezpečně resetujte relaci.'}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {onRetry && <Button type="button" onClick={onRetry} size="sm" className="bg-amber-600 text-white hover:bg-amber-700">
            <RefreshCw className="mr-2 h-4 w-4" />
            Zkusit znovu
          </Button>}
          <Button type="button" onClick={() => window.location.reload()} size="sm" variant="outline" className="border-amber-200 bg-white text-amber-800 hover:bg-amber-100">
            Obnovit stránku
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onResetSession} className="border-amber-200 bg-white text-amber-800 hover:bg-amber-100">
            <LogOut className="mr-2 h-4 w-4" />
            Odhlásit a resetovat
          </Button>
        </div>
      </div>
    )}
  </div>
);

const PageLoader = () => (
  <EkvLoader title="Načítám modul" description="Synchronizuji data pracovního prostoru." />
);

const PrivateRoute = ({ children, module, level = 'can_read' }) => {
  const { hasPermission, isAdmin, loading, permissionsReady } = useAuth();

  if (loading || !permissionsReady) {
    return <EkvLoader title="Ověřuji přístup" description="Kontroluji oprávnění modulu." className="min-h-[50vh]" />;
  }

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
  const location = useLocation();
  const { session, loading, permissionsReady, authError, retryPermissions } = useAuth();
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const isPortalLoading = loading || Boolean(session && !permissionsReady);

  useEffect(() => {
    if (isPortalLoading) {
      const timeout = setTimeout(() => {
        setLoadingTimeout(true);
      }, 10000); 

      return () => clearTimeout(timeout);
    } else {
      setLoadingTimeout(false);
    }
  }, [isPortalLoading]);

  if (isPortalLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 p-5">
        <PortalLoaderCard
          title="Načítání portálu"
          description="Ověřujeme relaci a připravujeme pracovní prostředí."
          error={authError}
          showActions={loadingTimeout || Boolean(authError)}
          onRetry={retryPermissions}
          onResetSession={async () => {
            await supabase.auth.signOut();
            clearSupabaseSessionStorage();
            window.location.href = '/login';
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-w-0 bg-background text-foreground">
      {session ? (
        <PortalShell>
            <ErrorBoundary resetKey={location.pathname + location.search}>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<MyWork />} />
                  <Route path="/employee" element={<EmployeeCenter />} />
                  <Route path="/employees/:employeeMemberId" element={<EmployeeCenter />} />
                  <Route path="/workspaces" element={<WorkspaceLanding />} />
                  <Route path="/dashboard" element={<PrivateRoute module="dashboard"><Dashboard /></PrivateRoute>} />
                  <Route path="/projects" element={<PrivateRoute module="projects"><Projects /></PrivateRoute>} />
                  <Route path="/planning" element={<ProtectedRoute><PlanningBoard /></ProtectedRoute>} />
                  <Route path="/projects/new" element={<PrivateRoute module="projects" level="can_edit"><ProjectForm /></PrivateRoute>} />
                  <Route path="/projects/:projectId/edit" element={<PrivateRoute module="projects" level="can_edit"><ProjectForm /></PrivateRoute>} />
                  <Route path="/projects/:projectId" element={<PrivateRoute module="projects"><ProjectDetail /></PrivateRoute>} />
                  <Route path="/projects/:projectId/history" element={<PrivateRoute module="projects" level="can_admin"><ProjectHistory /></PrivateRoute>} />
                  
                  <Route path="/templates" element={<PrivateRoute module="projects"><ProjectTemplatesPage /></PrivateRoute>} />

                  <Route path="/realizace" element={<PrivateRoute module="realizace"><Realizace /></PrivateRoute>} />
                  <Route path="/realizace/new" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceForm /></PrivateRoute>} />
                  <Route path="/realizace/financials" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceFinancials /></PrivateRoute>} />
                  <Route path="/realizace/:realizaceId/edit" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceForm /></PrivateRoute>} />
                  <Route path="/realizace/:realizaceId" element={<PrivateRoute module="realizace"><RealizaceDetail /></PrivateRoute>} />
                  <Route path="/realizace/:realizaceId/orders/new" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceOrderForm /></PrivateRoute>} />
                  <Route path="/realizace/:realizaceId/orders/:orderId/edit" element={<PrivateRoute module="realizace" level="can_edit"><RealizaceOrderForm /></PrivateRoute>} />
                  <Route path="/documents" element={<PrivateRoute module="documents"><Documents /></PrivateRoute>} />
                  <Route path="/crm" element={<PrivateRoute module="crm"><CRM /></PrivateRoute>} />
                  <Route path="/crm/board" element={<PrivateRoute module="crm"><CRM /></PrivateRoute>} />
                  <Route path="/crm/new" element={<PrivateRoute module="crm" level="can_edit"><CRM /></PrivateRoute>} />
                  <Route path="/crm/opportunities" element={<PrivateRoute module="crm"><CRM /></PrivateRoute>} />
                  <Route path="/crm/opportunities/new" element={<PrivateRoute module="crm" level="can_edit"><CRM /></PrivateRoute>} />
                  <Route path="/crm/opportunities/:opportunityId" element={<PrivateRoute module="crm"><CRM /></PrivateRoute>} />
                  <Route path="/crm/offers" element={<PrivateRoute module="crm"><CRMCommercialDocuments type="offer" /></PrivateRoute>} />
                  <Route path="/crm/offers/:documentId" element={<PrivateRoute module="crm"><CRMCommercialDocuments type="offer" /></PrivateRoute>} />
                  <Route path="/crm/orders" element={<PrivateRoute module="crm"><CRMCommercialDocuments type="order" /></PrivateRoute>} />
                  <Route path="/crm/orders/:documentId" element={<PrivateRoute module="crm"><CRMCommercialDocuments type="order" /></PrivateRoute>} />
                  <Route path="/crm/:opportunityId" element={<PrivateRoute module="crm"><CRM /></PrivateRoute>} />
                  <Route path="/products" element={<PrivateRoute module="crm"><Products /></PrivateRoute>} />
                  <Route path="/products/new" element={<PrivateRoute module="crm" level="can_edit"><ProductForm /></PrivateRoute>} />
                  <Route path="/products/:productId/edit" element={<PrivateRoute module="crm" level="can_edit"><ProductForm /></PrivateRoute>} />
                  <Route path="/engineering" element={<PrivateRoute module="engineering"><Engineering /></PrivateRoute>} />
                  <Route path="/tasks" element={<PrivateRoute module="tasks"><Tasks /></PrivateRoute>} />
                  <Route path="/attendance" element={<PrivateRoute module="attendance"><Attendance /></PrivateRoute>} />
                  <Route path="/subjects" element={<PrivateRoute module="subjects"><Subjects /></PrivateRoute>} />
                  <Route path="/subjects/:subjectId" element={<PrivateRoute module="subjects"><SubjectDetail /></PrivateRoute>} />
                  <Route path="/members" element={<PrivateRoute module="members"><Members /></PrivateRoute>} />
                  <Route path="/members/:memberId" element={<PrivateRoute module="members"><MemberDetail /></PrivateRoute>} />
                  
                  <Route path="/payouts" element={<PrivateRoute module="payouts"><Payouts /></PrivateRoute>} />
                  <Route path="/payouts/new" element={<PrivateRoute module="payouts" level="can_edit"><PayoutFormPage /></PrivateRoute>} />
                  <Route path="/payouts/hourly-admin" element={<PrivateRoute module="payouts" level="can_admin"><div className="app-page"><HourlyPayoutRequestsAdmin /></div></PrivateRoute>} />

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
                    <Route path="crm" element={<PrivateRoute module="settings" level="can_admin"><SettingsCRM /></PrivateRoute>} />
                    <Route path="storage" element={<PrivateRoute module="settings" level="can_admin"><SettingsStorage /></PrivateRoute>} />
                    <Route path="project-templates" element={<PrivateRoute module="settings" level="can_admin"><ProjectTemplatesSettings /></PrivateRoute>} />
                    <Route path="backup-maintenance" element={<ProtectedRoute requiredRole="admin"><BackupMaintenance /></ProtectedRoute>} />
                  </Route>
                  <Route path="/login" element={<Navigate to="/" />} />
                  <Route path="/statements" element={<Navigate to="/engineering" />} />
                  <Route path="/authorities" element={<Navigate to="/engineering" />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
        </PortalShell>
      ) : (
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Auth />} />
              <Route path="*" element={<Navigate to="/login" />} />
            </Routes>
          </Suspense>
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
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/order/:token" element={<OrderPage />} />
              <Route path="/sub-order/:token" element={<SubcontractorOrderPage />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/*" element={<AppContent />} />
            </Routes>
          </Suspense>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}

export default App;
