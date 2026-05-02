import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { KeyRound } from 'lucide-react';

const UpdatePassword = () => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // This event is handled automatically by the Supabase client,
        // which sets the session. We just need to provide the UI to update the password.
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage('Nepodařilo se aktualizovat heslo. Zkuste to prosím znovu, nebo si vygenerujte nový odkaz pro obnovu.');
      toast({
        title: 'Chyba',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setMessage('Vaše heslo bylo úspěšně změněno. Nyní budete přesměrováni na přihlášení.');
      toast({
        title: '✅ Heslo změněno!',
        description: 'Nyní se můžete přihlásit s novým heslem.',
      });
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-200">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-2xl"
      >
        <div className="text-center">
          <KeyRound className="mx-auto h-12 w-12 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900 mt-4">Nastavit nové heslo</h1>
          <p className="text-muted-foreground mt-2">Zadejte své nové heslo pro přístup do portálu.</p>
        </div>
        
        <form onSubmit={handlePasswordUpdate} className="space-y-6">
          <div>
            <Label htmlFor="new-password">Nové heslo</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1"
            />
          </div>

          <div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Ukládání...' : 'Změnit heslo a přihlásit se'}
            </Button>
          </div>
        </form>

        {message && <p className="text-center text-sm text-gray-600">{message}</p>}
      </motion.div>
    </div>
  );
};

export default UpdatePassword;