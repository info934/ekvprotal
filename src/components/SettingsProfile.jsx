import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Briefcase,
  Camera,
  Clock,
  ExternalLink,
  Languages,
  Mail,
  Save,
  Shield,
  User,
} from 'lucide-react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';

const languageOptions = ['Čeština', 'Angličtina', 'Němčina', 'Slovenština', 'Polština'];

const notificationLabels = {
  orders: 'Objednávky',
  realizations: 'Realizace',
  projects: 'Projekty',
  tasks: 'Úkoly',
};

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0][0]).toUpperCase();
};

const PasswordStrengthIndicator = ({ password }) => {
  const strength = useMemo(() => {
    let score = 0;
    if (!password) return { score: 0, text: '' };
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    return { score, text: ['Velmi slabé', 'Slabé', 'Střední', 'Silné', 'Velmi silné'][score] };
  }, [password]);

  if (!password) return null;

  const colors = ['bg-red-500', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-2 w-full rounded-full bg-muted">
        <div className={`${colors[strength.score]} h-2 rounded-full`} style={{ width: `${(strength.score / 4) * 100}%` }} />
      </div>
      <span className="w-28 text-right text-sm font-medium">{strength.text}</span>
    </div>
  );
};

const ProfileSummaryItem = ({ icon: Icon, label, value, children }) => (
  <div className="rounded-lg border bg-white p-4">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      {label}
    </div>
    <div className="mt-2 text-sm font-semibold text-slate-950">
      {children || value || '-'}
    </div>
  </div>
);

const SettingsProfile = () => {
  const { user, memberId, permissions, userRole, hasPermission } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [password, setPassword] = useState({ new: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);

  const canOpenEmployeeDetail = memberId && hasPermission('members', 'can_read');

  useEffect(() => {
    const fetchMemberProfile = async () => {
      if (!memberId) {
        setProfile(null);
        return;
      }

      const [{ data, error }, { data: compensationData, error: compensationError }] = await Promise.all([
        supabase
          .from('members')
          .select('id, name, role_id, email, phone, attendance_enabled, user_role, languages, company, job_title, department, bio, avatar_url, language, notification_preferences, member_roles(name)')
          .eq('id', memberId)
          .single(),
        supabase.rpc('get_member_compensation', { p_member_id: memberId }),
      ]);

      if (error || compensationError) {
        toast({ title: 'Chyba při načítání profilu', description: (error || compensationError).message, variant: 'destructive' });
        return;
      }

      setProfile({
        ...data,
        ...compensationData,
        languages: Array.isArray(data.languages) ? data.languages : [],
        notification_preferences: data.notification_preferences || {},
      });
      setAvatarPreview(data.avatar_url || user?.user_metadata?.avatar_url || null);
    };

    fetchMemberProfile();
  }, [memberId, toast, user?.user_metadata?.avatar_url]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setProfile((current) => ({ ...current, [name]: value }));
  };

  const handleLanguageToggle = (language) => {
    setProfile((current) => {
      const selected = current.languages || [];
      const next = selected.includes(language)
        ? selected.filter((item) => item !== language)
        : [...selected, language];
      return { ...current, languages: next };
    });
  };

  const handlePasswordChange = (event) => {
    const { name, value } = event.target;
    setPassword((current) => ({ ...current, [name]: value }));
  };

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSaveChanges = async () => {
    if (!profile || !memberId) return;
    setLoading(true);

    let avatar_url = profile.avatar_url || null;
    if (avatarFile) {
      const filePath = `${user.id}/${Date.now()}-${avatarFile.name}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, avatarFile, { upsert: true });

      if (uploadError) {
        toast({ title: 'Chyba při nahrávání avataru', description: uploadError.message, variant: 'destructive' });
        setLoading(false);
        return;
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      avatar_url = urlData.publicUrl;
    }

    const memberPayload = {
      name: profile.name || '',
      phone: profile.phone || null,
      languages: profile.languages || [],
      internal_note: profile.internal_note || null,
      language: profile.language || 'cs',
      notification_preferences: profile.notification_preferences || {},
      avatar_url,
    };

    const { error: memberError } = await supabase
      .from('members')
      .update(memberPayload)
      .eq('id', memberId);

    if (memberError) {
      toast({ title: 'Chyba při aktualizaci profilu', description: memberError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.updateUser({
      data: { full_name: memberPayload.name, avatar_url },
    });

    if (authError) {
      toast({ title: 'Profil uložen, ale účet se neaktualizoval', description: authError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    if (password.new || password.confirm) {
      if (password.new !== password.confirm) {
        toast({ title: 'Nová hesla se neshodují', variant: 'destructive' });
        setLoading(false);
        return;
      }

      const { error: passwordError } = await supabase.auth.updateUser({ password: password.new });
      if (passwordError) {
        toast({ title: 'Chyba při změně hesla', description: passwordError.message, variant: 'destructive' });
        setLoading(false);
        return;
      }
      setPassword({ new: '', confirm: '' });
    }

    setProfile((current) => ({ ...current, ...memberPayload }));
    setAvatarFile(null);
    setLoading(false);
    toast({ title: 'Profil úspěšně aktualizován' });
  };

  if (!user) return <div className="rounded-lg border bg-white p-6 text-muted-foreground">Načítání účtu...</div>;

  if (!memberId || !profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Můj profil</CardTitle>
          <CardDescription>Účet zatím není propojený se záznamem zaměstnance.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Profil lze spravovat až po propojení uživatele se zaměstnancem ve správě uživatelů.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-lg border bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-4">
          <div className="relative shrink-0">
            <Avatar className="h-16 w-16 ring-1 ring-slate-200 sm:h-20 sm:w-20">
              <AvatarImage src={avatarPreview || undefined} />
              <AvatarFallback className="text-xl">{getInitials(profile.name)}</AvatarFallback>
            </Avatar>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full shadow-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
            </Button>
            <input ref={fileInputRef} type="file" onChange={handleAvatarChange} accept="image/*" className="hidden" />
          </div>
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-slate-950">Můj profil</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Osobní údaje jsou napojené na stejný záznam jako modul Zaměstnanci.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">{profile.member_roles?.name || 'Bez pozice'}</Badge>
              <Badge variant={profile.attendance_enabled ? 'success' : 'outline'}>
                {profile.attendance_enabled ? 'Docházka aktivní' : 'Docházka vypnutá'}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {canOpenEmployeeDetail && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to={`/members/${memberId}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Detail zaměstnance
              </Link>
            </Button>
          )}
          <Button onClick={handleSaveChanges} disabled={loading} className="w-full sm:w-auto">
            <Save className="mr-2 h-4 w-4" />
            {loading ? 'Ukládání...' : 'Uložit změny'}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ProfileSummaryItem icon={Mail} label="Přihlašovací e-mail" value={user.email} />
        <ProfileSummaryItem icon={Briefcase} label="Pozice / kategorie" value={profile.member_roles?.name || 'Bez pozice'} />
        <ProfileSummaryItem icon={Clock} label="Hodinová sazba" value={profile.hourly_rate ? `${Number(profile.hourly_rate).toLocaleString('cs-CZ')} Kč/h` : 'Nenastavena'} />
        <ProfileSummaryItem icon={Shield} label="Přístupová role" value={userRole || 'Nenastaveno'} />
      </div>

      <Tabs defaultValue="personal" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="personal">Osobní údaje</TabsTrigger>
          <TabsTrigger value="work">Pracovní profil</TabsTrigger>
          <TabsTrigger value="security">Účet</TabsTrigger>
          <TabsTrigger value="notifications">Notifikace</TabsTrigger>
        </TabsList>

        <TabsContent value="personal" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Osobní údaje</CardTitle>
              <CardDescription>Údaje, které se zobrazují v portálu a v modulu Zaměstnanci.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Celé jméno</Label>
                <Input id="name" name="name" value={profile.name || ''} onChange={handleInputChange} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail účtu</Label>
                <Input id="email" value={user.email || profile.email || ''} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Telefon</Label>
                <Input id="phone" name="phone" value={profile.phone || ''} onChange={handleInputChange} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="employee-email">E-mail v zaměstnanci</Label>
                <Input id="employee-email" value={profile.email || ''} disabled />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Pracovní profil</CardTitle>
              <CardDescription>Pozice, sazba a docházka se spravují centrálně v modulu Zaměstnanci.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ProfileSummaryItem icon={Briefcase} label="Pozice / kategorie" value={profile.member_roles?.name || 'Bez pozice'} />
                <ProfileSummaryItem icon={Clock} label="Hodinová sazba" value={profile.hourly_rate ? `${Number(profile.hourly_rate).toLocaleString('cs-CZ')} Kč/h` : 'Nenastavena'} />
                <ProfileSummaryItem icon={User} label="Docházka" value={profile.attendance_enabled ? 'Aktivní' : 'Neaktivní'} />
              </div>

              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  Jazykové znalosti
                </Label>
                <div className="flex flex-wrap gap-2">
                  {languageOptions.map((language) => {
                    const selected = profile.languages?.includes(language);
                    return (
                      <Button
                        key={language}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleLanguageToggle(language)}
                      >
                        {language}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="internal_note">Dostupnost / poznámka</Label>
                <Textarea
                  id="internal_note"
                  name="internal_note"
                  value={profile.internal_note || ''}
                  onChange={handleInputChange}
                  rows={4}
                  placeholder="Poznámka k dostupnosti, specializaci nebo preferencím práce."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Změna hesla</CardTitle>
              <CardDescription>Heslo se mění přímo v Supabase účtu přihlášeného uživatele.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Nové heslo</Label>
                <Input id="new-password" name="new" type="password" value={password.new} onChange={handlePasswordChange} />
                <PasswordStrengthIndicator password={password.new} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Potvrzení nového hesla</Label>
                <Input id="confirm-password" name="confirm" type="password" value={password.confirm} onChange={handlePasswordChange} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Informace o účtu</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <ProfileSummaryItem icon={Shield} label="Přístupová role" value={userRole || 'Nenastaveno'} />
              <ProfileSummaryItem icon={User} label="Uživatel vytvořen" value={format(new Date(user.created_at), 'd. MMMM yyyy', { locale: cs })} />
              <ProfileSummaryItem icon={Clock} label="Poslední přihlášení" value={user.last_sign_in_at ? format(new Date(user.last_sign_in_at), "d. MMMM yyyy 'v' HH:mm", { locale: cs }) : 'N/A'} />
              <div className="rounded-lg border bg-white p-4">
                <div className="text-sm text-muted-foreground">Dostupné moduly</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(permissions)
                    .filter(([, perms]) => perms.can_read)
                    .map(([module]) => (
                      <Badge key={module} variant="outline" className="capitalize">{module}</Badge>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Notifikace a rozhraní</CardTitle>
              <CardDescription>Osobní preference uložené ve stejném profilu zaměstnance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {Object.entries(notificationLabels).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <Label htmlFor={`notif-${key}`} className="font-medium">{label}</Label>
                  <Switch
                    id={`notif-${key}`}
                    checked={profile.notification_preferences?.[key] ?? true}
                    onCheckedChange={(checked) => setProfile((current) => ({
                      ...current,
                      notification_preferences: { ...current.notification_preferences, [key]: checked },
                    }))}
                  />
                </div>
              ))}

              <div className="space-y-1.5">
                <Label>Jazyk rozhraní</Label>
                <Select
                  value={profile.language || 'cs'}
                  onValueChange={(value) => setProfile((current) => ({ ...current, language: value }))}
                >
                  <SelectTrigger className="max-w-sm">
                    <SelectValue placeholder="Vyberte jazyk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cs">Čeština</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsProfile;
