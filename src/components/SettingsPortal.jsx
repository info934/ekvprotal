import React, { useEffect, useState } from 'react';
import { Mail, Save, Settings as SettingsIcon } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const SettingsPortal = () => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [accountingEmail, setAccountingEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchAccountingEmail = async () => {
      if (!hasPermission('settings', 'can_admin')) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'accounting_email')
        .maybeSingle();

      if (error) {
        toast({ title: 'Chyba při načítání nastavení', description: error.message, variant: 'destructive' });
      } else {
        setAccountingEmail(data?.value || '');
      }
      setLoading(false);
    };

    fetchAccountingEmail();
  }, [hasPermission, toast]);

  const handleSaveAccountingEmail = async () => {
    if (!hasPermission('settings', 'can_admin')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemůžete upravit toto nastavení.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const normalized = accountingEmail
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
      .join(', ');

    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'accounting_email', value: normalized }, { onConflict: 'key' });

    if (error) {
      toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Nastavení uloženo' });
      setAccountingEmail(normalized);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="Nastavení portálu"
        description="Systémové hodnoty, které ovlivňují chování aplikace napříč moduly."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            E-mail účetní pro docházkové reporty
          </CardTitle>
          <CardDescription>
            Jedna nebo více adres oddělených čárkou. Na tyto adresy se odesílají reporty docházky.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="accountingEmail">E-mailové adresy</Label>
            <Input
              id="accountingEmail"
              placeholder="ucetni@firma.cz, accounting@firma.cz"
              value={accountingEmail}
              onChange={(event) => setAccountingEmail(event.target.value)}
              disabled={loading || saving}
            />
            <p className="text-xs text-muted-foreground">
              Změna se projeví při dalším odesílání docházkového reportu.
            </p>
          </div>
          <Button onClick={handleSaveAccountingEmail} disabled={loading || saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Ukládám...' : 'Uložit nastavení'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPortal;
