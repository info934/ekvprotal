import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const getPasswordStrength = (password) => {
  let score = 0;
  if (!password) return { score: 0, label: '', color: 'bg-slate-200' };
  if (password.length >= 10) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  const labels = ['Velmi slabé', 'Slabé', 'Střední', 'Silné', 'Velmi silné'];
  const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-blue-500', 'bg-emerald-500'];
  return { score, label: labels[score], color: colors[score] };
};

const PasswordField = ({ id, label, value, onChange, autoComplete }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-semibold text-slate-700">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required
          autoComplete={autoComplete}
          className="h-12 rounded-xl border-slate-200 bg-white pr-12 text-base shadow-sm focus-visible:ring-blue-500"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-10 w-10 rounded-lg text-slate-500 hover:bg-slate-100"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Skrýt heslo' : 'Zobrazit heslo'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
};

const humanizeUpdateError = (message) => {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('weak password')) return 'Heslo je příliš slabé. Použijte delší heslo s číslem a speciálním znakem.';
  if (normalized.includes('expired') || normalized.includes('invalid')) return 'Odkaz pro změnu hesla expiroval nebo není platný. Požádejte o nový reset hesla.';
  return message || 'Odkaz mohl expirovat. Vygenerujte si nový odkaz pro obnovu hesla.';
};

const UpdatePassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = password && confirmPassword && password === confirmPassword;

  const handlePasswordUpdate = async (event) => {
    event.preventDefault();

    if (password.length < 10) {
      toast({ title: 'Heslo je příliš krátké', description: 'Zadejte alespoň 10 znaků.', variant: 'destructive' });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: 'Hesla se neshodují', description: 'Zkontrolujte potvrzení nového hesla.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast({
        title: 'Heslo se nepodařilo změnit',
        description: humanizeUpdateError(error.message),
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Heslo bylo změněno', description: 'Nyní se můžete přihlásit novým heslem.' });
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-5 py-10 text-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[-10%] h-72 w-72 rounded-full bg-blue-200/60 blur-3xl" />
        <div className="absolute bottom-[-14%] right-[-10%] h-96 w-96 rounded-full bg-emerald-100 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:56px_56px] opacity-30" />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="relative w-full max-w-[480px] rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-slate-950/10 backdrop-blur md:p-8"
      >
        <div className="mb-7 flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="grid h-14 w-14 place-items-center rounded-[22px] bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-xl shadow-blue-600/20">
              <span className="text-xl font-black tracking-tight">E</span>
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-xl border-2 border-white bg-white text-blue-700 shadow-md ring-1 ring-blue-100">
              <KeyRound className="h-4 w-4" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">EKV Portal</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">Nastavit nové heslo</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">Zadejte nové heslo z odkazu pro obnovu nebo pozvánky.</p>
          </div>
        </div>

        <form onSubmit={handlePasswordUpdate} className="space-y-5">
          <PasswordField id="new-password" label="Nové heslo" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />

          {password && (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`${strength.color} h-full rounded-full transition-all`} style={{ width: `${Math.max(16, (strength.score / 4) * 100)}%` }} />
              </div>
              <p className="text-xs font-medium text-slate-500">Síla hesla: {strength.label}</p>
            </div>
          )}

          <PasswordField id="confirm-password" label="Potvrzení nového hesla" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />

          {confirmPassword && (
            <p className={`text-sm font-medium ${passwordsMatch ? 'text-emerald-700' : 'text-rose-700'}`}>
              {passwordsMatch ? 'Hesla se shodují.' : 'Hesla se zatím neshodují.'}
            </p>
          )}

          <Button type="submit" className="h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="mr-2 h-5 w-5" />}
            {loading ? 'Ukládání...' : 'Změnit heslo'}
          </Button>
        </form>
      </motion.section>
    </main>
  );
};

export default UpdatePassword;