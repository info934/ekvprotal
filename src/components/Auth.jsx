import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Target,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';

const formVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
  transition: { duration: 0.22, ease: 'easeOut' },
};

const HERO_IMAGE_URL = 'https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/gemini_generated_image_6o2xfv6o2xfv6o2x-A6n0A.png';

const GoogleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l6.19 5.238C42.021 35.596 44 30.138 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

const MicrosoftIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 21 21" aria-hidden="true">
    <path fill="#f25022" d="M1 1h9v9H1z" />
    <path fill="#00a4ef" d="M1 11h9v9H1z" />
    <path fill="#7fba00" d="M11 1h9v9h-9z" />
    <path fill="#ffb900" d="M11 11h9v9h-9z" />
  </svg>
);

const BrandMark = ({ compact = false }) => (
  <div className="flex items-center gap-3">
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
      <span className="text-lg font-black tracking-tight">E</span>
    </div>
    {!compact && (
      <div className="min-w-0">
        <div className="text-lg font-semibold tracking-tight text-slate-950">EKV Portal</div>
        <div className="text-xs font-medium text-slate-500">Project operating system</div>
      </div>
    )}
  </div>
);

const Field = ({ icon: Icon, label, id, children, action }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Icon className="h-4 w-4 text-slate-400" />
        {label}
      </Label>
      {action}
    </div>
    {children}
  </div>
);

const AuthStateMark = ({ icon: Icon }) => (
  <div className="relative shrink-0">
    <div className="grid h-14 w-14 place-items-center rounded-[22px] bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-xl shadow-blue-600/20">
      <span className="text-xl font-black tracking-tight">E</span>
    </div>
    <div className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-xl border-2 border-white bg-white text-blue-700 shadow-md ring-1 ring-blue-100">
      <Icon className="h-4 w-4" />
    </div>
  </div>
);

const PasswordInput = ({ id, value, onChange, placeholder = 'Zadejte heslo' }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required
        placeholder={placeholder}
        className="h-12 rounded-xl border-slate-200 bg-white pr-12 text-base shadow-sm transition focus-visible:ring-blue-500"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 h-10 w-10 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        onClick={() => setShowPassword((current) => !current)}
        aria-label={showPassword ? 'Skrýt heslo' : 'Zobrazit heslo'}
      >
        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
};

const AuthPanel = ({ title, description, icon: Icon, children }) => (
  <motion.div {...formVariants} className="w-full">
    <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-2xl shadow-slate-950/10 backdrop-blur md:p-7">
      <div className="mb-7 flex items-start gap-4">
        <AuthStateMark icon={Icon} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">{title}</h1>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </div>
  </motion.div>
);

const PrimaryButton = ({ loading, icon: Icon, loadingText, children }) => (
  <Button
    type="submit"
    className="h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-blue-600/25"
    disabled={loading}
  >
    {loading ? (
      <>
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {loadingText}
      </>
    ) : (
      <>
        <Icon className="mr-2 h-5 w-5" />
        {children}
      </>
    )}
  </Button>
);

const LoginForm = ({ onSwitchToSignup, onSwitchToReset, onSubmit, onSocialLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    await onSubmit(email, password);
    setLoading(false);
  };

  const handleSocialLogin = async (provider) => {
    setSocialLoading(provider);
    await onSocialLogin(provider);
    setSocialLoading(null);
  };

  return (
    <AuthPanel title="Přihlášení do portálu" description="Bezpečný vstup do projektů, CRM, realizací a firemních financí." icon={ShieldCheck}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field id="email" icon={Mail} label="E-mail">
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="jmeno@ekvproject.cz"
            className="h-12 rounded-xl border-slate-200 bg-white text-base shadow-sm transition focus-visible:ring-blue-500"
          />
        </Field>

        <Field
          id="password"
          icon={Lock}
          label="Heslo"
          action={
            <Button type="button" variant="link" onClick={onSwitchToReset} className="h-auto p-0 text-sm font-semibold text-blue-700 hover:text-blue-800">
              Zapomenuté heslo
            </Button>
          }
        >
          <PasswordInput id="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>

        <PrimaryButton loading={loading} loadingText="Přihlašování..." icon={ShieldCheck}>
          Přihlásit se
        </PrimaryButton>

        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">nebo</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => handleSocialLogin('google')}
            disabled={!!socialLoading}
            className="h-12 rounded-xl border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50"
          >
            {socialLoading === 'google' ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <GoogleIcon />}
            <span className="ml-2">Google</span>
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => handleSocialLogin('azure')}
            disabled={!!socialLoading}
            className="h-12 rounded-xl border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50"
          >
            {socialLoading === 'azure' ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <MicrosoftIcon />}
            <span className="ml-2">Microsoft</span>
          </Button>
        </div>

        <p className="text-center text-sm text-slate-500">
          Nemáte účet?{' '}
          <Button type="button" variant="link" onClick={onSwitchToSignup} className="h-auto p-0 font-semibold text-blue-700 hover:text-blue-800">
            Požádat o přístup
          </Button>
        </p>
      </form>
    </AuthPanel>
  );
};

const SignupForm = ({ onSwitchToLogin, onSubmit }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    await onSubmit(email, password, fullName);
    setLoading(false);
  };

  return (
    <AuthPanel title="Žádost o přístup" description="Vytvořte účet a po potvrzení e-mailu se přihlaste do portálu." icon={User}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field id="full-name-signup" icon={User} label="Jméno a příjmení">
          <Input
            id="full-name-signup"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
            autoComplete="name"
            placeholder="Jan Novák"
            className="h-12 rounded-xl border-slate-200 bg-white text-base shadow-sm transition focus-visible:ring-blue-500"
          />
        </Field>

        <Field id="email-signup" icon={Mail} label="E-mail">
          <Input
            id="email-signup"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="jmeno@ekvproject.cz"
            className="h-12 rounded-xl border-slate-200 bg-white text-base shadow-sm transition focus-visible:ring-blue-500"
          />
        </Field>

        <Field id="password-signup" icon={Lock} label="Heslo">
          <PasswordInput id="password-signup" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Zvolte silné heslo" />
        </Field>

        <PrimaryButton loading={loading} loadingText="Odesílání..." icon={User}>
          Vytvořit účet
        </PrimaryButton>

        <p className="text-center text-sm text-slate-500">
          Už máte účet?{' '}
          <Button type="button" variant="link" onClick={onSwitchToLogin} className="h-auto p-0 font-semibold text-blue-700 hover:text-blue-800">
            Přihlaste se
          </Button>
        </p>
      </form>
    </AuthPanel>
  );
};

const ResetPasswordForm = ({ onSwitchToLogin, onSubmit }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    await onSubmit(email);
    setLoading(false);
  };

  return (
    <AuthPanel title="Obnova hesla" description="Pošleme vám odkaz pro nastavení nového hesla." icon={Lock}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field id="email-reset" icon={Mail} label="E-mail">
          <Input
            id="email-reset"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="jmeno@ekvproject.cz"
            className="h-12 rounded-xl border-slate-200 bg-white text-base shadow-sm transition focus-visible:ring-blue-500"
          />
        </Field>

        <PrimaryButton loading={loading} loadingText="Odesílání..." icon={Mail}>
          Odeslat odkaz
        </PrimaryButton>

        <Button type="button" variant="link" onClick={onSwitchToLogin} className="mx-auto flex h-auto items-center p-0 font-semibold text-blue-700 hover:text-blue-800">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Zpět na přihlášení
        </Button>
      </form>
    </AuthPanel>
  );
};

const MetricCard = ({ icon: Icon, label, description, tone = 'blue' }) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  };

  return (
    <div className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 text-sm font-semibold leading-5 text-slate-800">{description}</p>
        </div>
        <div className={cn('grid h-10 w-10 place-items-center rounded-xl ring-1', tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-600">
        <CheckCircle2 className="h-4 w-4" />
        Připraveno k práci
      </div>
    </div>
  );
};

const ModulePill = ({ icon: Icon, label }) => (
  <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-white">
      <Icon className="h-4 w-4" />
    </div>
    <span className="truncate text-sm font-semibold text-slate-700">{label}</span>
  </div>
);

const HeroImagePanel = () => (
  <div className="relative overflow-hidden rounded-[34px] border border-white/70 bg-white/70 p-3 shadow-2xl shadow-slate-950/10 backdrop-blur">
    <div className="relative h-[260px] overflow-hidden rounded-[26px] bg-slate-200 xl:h-[320px]">
      <img
        src={HERO_IMAGE_URL}
        alt="Moderní kancelářské prostředí EKV Portal"
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/10 via-transparent to-blue-950/25" />
      <div className="absolute left-5 top-5 rounded-2xl border border-white/50 bg-white/80 px-4 py-3 shadow-lg backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">EKV Portal</div>
        <div className="mt-1 text-sm font-semibold text-slate-950">Obchod, projekce a realizace v jednom toku</div>
      </div>
      <div className="absolute bottom-5 right-5 flex items-center gap-2 rounded-full border border-white/60 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg backdrop-blur">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        Live provoz
      </div>
    </div>
  </div>
);

const PortalPreview = () => (
  <div className="relative mx-auto w-full max-w-2xl">
    <div className="absolute -inset-6 rounded-[40px] bg-blue-500/10 blur-3xl" />
    <div className="relative overflow-hidden rounded-[32px] border border-white/70 bg-white/75 shadow-2xl shadow-slate-950/10 backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-slate-950">Přehled portálu</div>
          <div className="text-xs text-slate-500">Aktuální stav firmy</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold text-slate-500">Online</span>
        </div>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-3">
        <MetricCard icon={BarChart3} label="Obchod" description="Pipeline, nabídky a objednávky" />
        <MetricCard icon={Target} label="Řízení" description="Projekty, úkoly a odpovědnosti" tone="green" />
        <MetricCard icon={CalendarDays} label="Provoz" description="Realizace, docházka a finance" tone="amber" />
      </div>
      <div className="space-y-3 px-5 pb-5">
        {[
          ['CRM', 'Obchodní případy', 'Nabídky a objednávky'],
          ['PRO', 'Projekce', 'Dokumentace a kapacity'],
          ['REA', 'Realizace', 'Náklady, docházka a výstupy'],
        ].map(([code, title, status]) => (
          <div key={code} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-100">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-center text-xs font-semibold text-blue-700">{code}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-800">{title}</div>
              <div className="mt-0.5 text-xs text-slate-400">{status}</div>
            </div>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

const Auth = () => {
  const [view, setView] = useState('login');
  const { signIn, signUp, signInWithSso } = useAuth();
  const { toast } = useToast();

  const handleSignIn = async (email, password) => {
    const { error } = await signIn(email, password);
    if (!error) {
      toast({ title: 'Přihlášení úspěšné' });
    }
  };

  const handleSignUp = async (email, password, fullName) => {
    const { error } = await signUp(email, password, fullName);
    if (!error) {
      toast({
        title: 'Registrace úspěšná',
        description: 'Zkontrolujte svůj e-mail pro potvrzení účtu.',
        duration: 9000,
      });
      setView('login');
    }
  };

  const handlePasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      toast({
        title: 'Obnova hesla se nezdařila',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Odkaz odeslán',
      description: 'Zkontrolujte svou e-mailovou schránku.',
      duration: 9000,
    });
    setView('login');
  };

  const handleSocialLogin = async (provider) => {
    const providerLabel = provider === 'azure' ? 'Microsoft' : 'Google';
    const { error } = await signInWithSso(provider);

    if (!error) {
      toast({
        title: `Přesměrovávám na ${providerLabel}`,
        description: 'Po ověření budete vráceni zpět do portálu.',
      });
      return;
    }

    toast({
      title: `${providerLabel} SSO není dostupné`,
      description: 'Zkontrolujte nastavení poskytovatele v Supabase Auth.',
      variant: 'destructive',
    });
  };

  return (
    <main className="min-h-screen overflow-hidden bg-slate-50 text-slate-950">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-10%] top-[-12%] h-[360px] w-[360px] rounded-full bg-blue-200/55 blur-3xl" />
        <div className="absolute bottom-[-18%] right-[-8%] h-[460px] w-[460px] rounded-full bg-emerald-100 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:56px_56px] opacity-30" />
      </div>

      <div className="relative grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(420px,0.84fr)_minmax(560px,1.16fr)]">
        <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
          <div className="w-full max-w-[460px]">
            <div className="mb-8 flex items-center justify-between">
              <BrandMark />
              <div className="hidden rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm sm:block">
                Online
              </div>
            </div>

            <AnimatePresence mode="wait">
              {view === 'login' && (
                <LoginForm
                  key="login"
                  onSubmit={handleSignIn}
                  onSwitchToSignup={() => setView('signup')}
                  onSwitchToReset={() => setView('reset')}
                  onSocialLogin={handleSocialLogin}
                />
              )}
              {view === 'signup' && (
                <SignupForm key="signup" onSubmit={handleSignUp} onSwitchToLogin={() => setView('login')} />
              )}
              {view === 'reset' && (
                <ResetPasswordForm key="reset" onSubmit={handlePasswordReset} onSwitchToLogin={() => setView('login')} />
              )}
            </AnimatePresence>

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Supabase Auth
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Cloud className="h-4 w-4 text-blue-600" />
                Online databáze
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-amber-500" />
                Rychlý přístup
              </span>
            </div>
          </div>
        </section>

        <aside className="hidden min-h-screen items-center justify-center border-l border-white/70 px-10 py-10 lg:flex">
          <div className="w-full max-w-4xl">
            <div className="mb-10 max-w-2xl">
              <div className="mb-5 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <span className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">EKV Project</span>
              </div>
              <h2 className="text-5xl font-semibold tracking-tight text-slate-950 xl:text-6xl">
                Jeden portál pro obchod, projekce i realizace.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
                Přehledná práce s obchodními případy, dokumenty, docházkou, výplatami a projektovou ekonomikou v jednom prostředí.
              </p>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr] xl:items-stretch">
              <HeroImagePanel />
              <PortalPreview />
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ModulePill icon={Target} label="CRM a nabídky" />
              <ModulePill icon={Building2} label="Projekce" />
              <ModulePill icon={Users} label="Realizace" />
              <ModulePill icon={BarChart3} label="Finance" />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
};

export default Auth;
