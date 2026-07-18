import React, { useEffect, useState } from 'react';
import { CalendarDays, Mail, RefreshCw, Save, Settings as SettingsIcon } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const SETTING_KEYS = [
  'accounting_email',
  'planning_company_calendar_mailbox',
  'planning_company_calendar_name',
];

const SettingsPortal = () => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [accountingEmail, setAccountingEmail] = useState('');
  const [calendarMailbox, setCalendarMailbox] = useState('');
  const [calendarName, setCalendarName] = useState('EKV Plánování');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingCalendar, setTestingCalendar] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      if (!hasPermission('settings', 'can_admin')) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', SETTING_KEYS);

      if (error) {
        toast({ title: 'Chyba při načítání nastavení', description: error.message, variant: 'destructive' });
      } else {
        const values = Object.fromEntries((data || []).map(({ key, value }) => [key, value]));
        setAccountingEmail(values.accounting_email || '');
        setCalendarMailbox(values.planning_company_calendar_mailbox || '');
        setCalendarName(values.planning_company_calendar_name || 'EKV Plánování');
      }
      setLoading(false);
    };

    fetchSettings();
  }, [hasPermission, toast]);

  const saveSettings = async (entries, successTitle) => {
    if (!hasPermission('settings', 'can_admin')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemůžete upravit toto nastavení.', variant: 'destructive' });
      return false;
    }

    setSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert(entries, { onConflict: 'key' });
    setSaving(false);

    if (error) {
      toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: successTitle });
    return true;
  };

  const handleSaveAccountingEmail = async () => {
    const normalized = accountingEmail
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
      .join(', ');
    if (await saveSettings([{ key: 'accounting_email', value: normalized }], 'Nastavení uloženo')) {
      setAccountingEmail(normalized);
    }
  };

  const handleSaveCalendar = async () => {
    const mailbox = calendarMailbox.trim().toLowerCase();
    const name = calendarName.trim() || 'EKV Plánování';
    if (!mailbox || !mailbox.includes('@')) {
      toast({ title: 'Zadejte platnou adresu sdíleného mailboxu', variant: 'destructive' });
      return;
    }
    if (await saveSettings([
      { key: 'planning_company_calendar_mailbox', value: mailbox },
      { key: 'planning_company_calendar_name', value: name },
    ], 'Firemní kalendář byl uložen')) {
      setCalendarMailbox(mailbox);
      setCalendarName(name);
    }
  };

  const handleTestCalendar = async () => {
    if (!calendarMailbox.trim()) {
      toast({ title: 'Nejdříve nastavte adresu kalendáře', variant: 'destructive' });
      return;
    }
    setTestingCalendar(true);
    const { data, error } = await supabase.functions.invoke('planning-calendar', {
      body: { action: 'testConnection', mailbox: calendarMailbox.trim().toLowerCase() },
    });
    setTestingCalendar(false);
    if (error || !data?.success) {
      toast({ title: 'Kalendář se nepodařilo ověřit', description: data?.error || error?.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Microsoft 365 kalendář je dostupný',
      description: `${data.calendar?.name || calendarName} · ${data.mailbox}`,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="Nastavení portálu"
        description="Systémové hodnoty, které ovlivňují chování aplikace napříč moduly."
      />

      <div className="grid gap-5 xl:grid-cols-2">
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
              <Input id="accountingEmail" placeholder="ucetni@firma.cz" value={accountingEmail} onChange={(event) => setAccountingEmail(event.target.value)} disabled={loading || saving} />
            </div>
            <Button onClick={handleSaveAccountingEmail} disabled={loading || saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Ukládám...' : 'Uložit nastavení'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Firemní Outlook kalendář plánování
            </CardTitle>
            <CardDescription>
              Úkoly a milníky se publikují do hlavního kalendáře tohoto sdíleného mailboxu. Kalendář nasdílejte celé firmě v Microsoft 365.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="calendarName">Název v portálu</Label>
                <Input id="calendarName" placeholder="EKV Plánování" value={calendarName} onChange={(event) => setCalendarName(event.target.value)} disabled={loading || saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calendarMailbox">Sdílený mailbox</Label>
                <Input id="calendarMailbox" type="email" placeholder="planovani@ekvproject.cz" value={calendarMailbox} onChange={(event) => setCalendarMailbox(event.target.value)} disabled={loading || saving} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Aplikace zapisuje pouze pracovní termín, řešitele a odkaz do portálu. Finanční údaje se do Outlooku neposílají.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSaveCalendar} disabled={loading || saving}>
                <Save className="mr-2 h-4 w-4" />
                Uložit kalendář
              </Button>
              <Button variant="outline" onClick={handleTestCalendar} disabled={loading || saving || testingCalendar}>
                <RefreshCw className={`mr-2 h-4 w-4 ${testingCalendar ? 'animate-spin' : ''}`} />
                Ověřit připojení
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SettingsPortal;
