import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import Sidebar from '@/components/Sidebar';
import { AuthProvider, useAuth } from '@/contexts/SupabaseAuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import ErrorBoundary from '@/components/ErrorBoundary';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';

const Dashboard = lazy(() => import('@/components/Dashboard'));
const WorkspaceLanding = lazy(() => import('@/components/WorkspaceLanding'));
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

const PortalLoaderCard = ({ title = 'Načítání modulu', description = 'Připravujeme data a rozhraní portálu.', showActions = false, onResetSession }) => (
  <div className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] border border-white/70 bg-white/90 p-6 text-left shadow-2xl shadow-slate-950/10 backdrop-blur-xl">
    <div className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full bg-blue-200/60 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-24 -left-20 h-48 w-48 rounded-full bg-emerald-100 blur-3xl" />
    <div className="relative flex items-start gap-4">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold tracking-tight text-slate-950">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Bezpečná relace
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            Online portal
          </span>
        </div>
      </div>
    </div>
    {showActions && (
      <div className="relative mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 p-4">
        <p className="text-sm font-semibold text-amber-950">Načítání trvá déle než obvykle.</p>
        <p className="mt-1 text-sm leading-5 text-amber-800">Může jít o pomalé připojení nebo zaseknutou relaci. Zkuste obnovit stránku nebo relaci bezpečně resetovat.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-amber-600 text-white hover:bg-amber-700">
            <RefreshCw className="mr-2 h-4 w-4" />
            Obnovit stránku
          </Button>
          <Button type="button" variant="outline" onClick={onResetSession} className="rounded-xl border-amber-200 bg-white/80 text-amber-800 hover:bg-amber-100">
            <LogOut className="mr-2 h-4 w-4" />
            Odhlásit a resetovat
          </Button>
        </div>
      </div>
    )}
  </div>
);

const LegacyPageLoader = () => (
  <div className="flex min-h-[50vh] w-full items-center justify-center p-8">
    <div className="rounded-lg border border-slate-200/90 bg-white px-8 py-7 text-center shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-b-primary" />
      <p className="font-medium text-slate-700">Načítání modulu...</p>
    </div>
  </div>
);

const PageLoader = () => (
  <div className="flex min-h-[50vh] w-full items-center justify-center p-8">
    <PortalLoaderCard />
  </div>
);

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
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 p-5">
        <PortalLoaderCard
          title="Načítání portálu"
          description="Ověřujeme relaci a připravujeme pracovní prostředí."
          showActions={loadingTimeout}
          onResetSession={async () => {
            await supabase.auth.signOut();
            localStorage.clear();
            window.location.href = '/login';
          }}
        />
      </div>
    );
  }

  if (false && loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="max-w-md rounded-lg border border-slate-200/90 bg-white px-8 py-7 text-center shadow-[0_16px_42px_rgba(15,23,42,0.10)]">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-b-primary"></div>
          <p className="text-xl font-semibold text-foreground">Načítání...</p>
          <p className="text-muted-foreground">Chvilku strpení, připravujeme portál.</p>
          {loadingTimeout && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm animate-in fade-in slide-in-from-bottom-4">
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
          <main className="min-w-0 flex-1 overflow-x-hidden transition-all duration-300 lg:ml-[var(--sidebar-width,16rem)] print:ml-0 print:p-0">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<WorkspaceLanding />} />
                  <Route path="/dashboard" element={<PrivateRoute module="dashboard"><Dashboard /></PrivateRoute>} />
                  <Route path="/projects" element={<PrivateRoute module="projects"><Projects /></PrivateRoute>} />
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
                  
                  <Route path="/payouts" element={<ProtectedRoute><Payouts /></ProtectedRoute>} />
                  <Route path="/payouts/new" element={<ProtectedRoute><PayoutFormPage /></ProtectedRoute>} />
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
                    <Route path="crm" element={<PrivateRoute module="settings" level="can_admin"><SettingsCRM /></PrivateRoute>} />
                    <Route path="storage" element={<PrivateRoute module="settings" level="can_admin"><SettingsStorage /></PrivateRoute>} />
                    <Route path="project-templates" element={<PrivateRoute module="settings" level="can_admin"><ProjectTemplatesSettings /></PrivateRoute>} />
                    <Route path="backup-maintenance" element={<ProtectedRoute requiredRole="admin"><BackupMaintenance /></ProtectedRoute>} />
                  </Route>
                  <Route path="/login" element={<Navigate to="/" />} />
                  <Route path="/statements" element={<Navigate to="/engineering" />} />
                  <Route path="/authorities" element={<Navigate to="/engineering" />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </>
      ) : (
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Auth />} />
              <Route path="/order/:token" element={<OrderPage />} />
              <Route path="/sub-order/:token" element={<SubcontractorOrderPage />} />
              <Route path="/update-password" element={<UpdatePassword />} />
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
