import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { User, Camera, Save } from 'lucide-react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';

const PasswordStrengthIndicator = ({ password }) => {
  const getStrength = () => {
    let score = 0;
    if (!password) return { score: 0, text: '' };
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    const text = ['Velmi slabé', 'Slabé', 'Střední', 'Silné', 'Velmi silné'][score];
    return { score, text };
  };
  const { score, text } = getStrength();
  const colors = ['bg-red-500', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];

  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="w-full bg-muted rounded-full h-2">
        <div className={`${colors[score]} h-2 rounded-full`} style={{ width: `${(score / 4) * 100}%` }}></div>
      </div>
      <span className="text-sm font-medium w-28 text-right">{text}</span>
    </div>
  );
};

const SettingsProfile = () => {
  const { user, memberId, permissions, userRole } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState(null);
  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const fileInputRef = useRef();

  useEffect(() => {
    const fetchMemberProfile = async () => {
      if (!memberId) return;
      const { data, error } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (error) {
        toast({ title: 'Chyba při načítání profilu', description: error.message, variant: 'destructive' });
      } else {
        setProfile(data);
        setAvatarPreview(data.avatar_url);
      }
    };
    fetchMemberProfile();
  }, [memberId, toast]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setProfile(p => ({ ...p, [name]: value }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPassword(p => ({ ...p, [name]: value }));
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleSaveChanges = async () => {
    setLoading(true);

    // 1. Update Avatar if changed
    let avatar_url = profile.avatar_url;
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

    // 2. Update Member Profile
    const { name, phone, company, job_title, department, bio, language, notification_preferences } = profile;
    const { error: memberError } = await supabase
      .from('members')
      .update({ name, phone, company, job_title, department, bio, language, notification_preferences, avatar_url })
      .eq('id', memberId);

    if (memberError) {
      toast({ title: 'Chyba při aktualizaci profilu', description: memberError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    // 3. Update Auth User Metadata
    const { error: authError } = await supabase.auth.updateUser({ data: { full_name: name, avatar_url } });
    if (authError) {
      toast({ title: 'Chyba při aktualizaci uživatele', description: authError.message, variant: 'destructive' });
    }

    // 4. Update Password if fields are filled
    if (password.new && password.confirm) {
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
      setPassword({ current: '', new: '', confirm: '' });
    }

    toast({ title: 'Profil úspěšně aktualizován' });
    setLoading(false);
    setAvatarFile(null); // Reset file input after successful upload
  };

  if (!profile || !user) return <div>Načítání profilu...</div>;

  const getInitials = (name) => {
    if (!name) return '?';
    const names = name.split(' ');
    return (names.length > 1 ? `${names[0][0]}${names[names.length - 1][0]}` : name[0]).toUpperCase();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><User className="w-6 h-6" /> Můj profil</h2>
          <p className="text-muted-foreground">Spravujte své osobní údaje, nastavení a zabezpečení.</p>
        </div>
        <Button onClick={handleSaveChanges} disabled={loading}>
          <Save className="w-4 h-4 mr-2" /> {loading ? 'Ukládání...' : 'Uložit změny'}
        </Button>
      </header>

      <Tabs defaultValue="personal" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="personal">Osobní údaje</TabsTrigger>
          <TabsTrigger value="security">Účet a zabezpečení</TabsTrigger>
          <TabsTrigger value="notifications">Notifikace</TabsTrigger>
          <TabsTrigger value="language">Jazyk</TabsTrigger>
        </TabsList>
        <TabsContent value="personal" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Osobní údaje</CardTitle>
              <CardDescription>Informace, které se zobrazují ostatním uživatelům v portálu.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <Avatar className="w-24 h-24">
                    <AvatarImage src={avatarPreview} />
                    <AvatarFallback className="text-3xl">{getInitials(profile.name)}</AvatarFallback>
                  </Avatar>
                  <Button size="icon" variant="secondary" className="absolute -bottom-2 -right-2 rounded-full h-8 w-8" onClick={() => fileInputRef.current.click()}>
                    <Camera className="h-4 w-4" />
                    <input type="file" ref={fileInputRef} onChange={handleAvatarChange} accept="image/*" className="hidden" />
                  </Button>
                </div>
                <div className="grid gap-1.5 flex-1">
                  <Label htmlFor="name">Celé jméno</Label>
                  <Input id="name" name="name" value={profile.name} onChange={handleInputChange} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={user.email} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input id="phone" name="phone" value={profile.phone || ''} onChange={handleInputChange} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Společnost</Label>
                  <Input id="company" name="company" value={profile.company || ''} onChange={handleInputChange} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="job_title">Pracovní pozice</Label>
                  <Input id="job_title" name="job_title" value={profile.job_title || ''} onChange={handleInputChange} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bio">Bio</Label>
                <Textarea id="bio" name="bio" value={profile.bio || ''} onChange={handleInputChange} placeholder="Něco o sobě..." />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="security" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Změna hesla</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Nové heslo</Label>
                <Input id="new-password" name="new" type="password" value={password.new} onChange={handlePasswordChange} />
                {password.new && <PasswordStrengthIndicator password={password.new} />}
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
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p><strong>Role:</strong> <span className="font-medium text-foreground capitalize">{userRole}</span></p>
              <p><strong>Uživatel vytvořen:</strong> {format(new Date(user.created_at), 'd. MMMM yyyy', { locale: cs })}</p>
              <p><strong>Poslední přihlášení:</strong> {user.last_sign_in_at ? format(new Date(user.last_sign_in_at), "d. MMMM yyyy 'v' HH:mm", { locale: cs }) : 'N/A'}</p>
              <p><strong>Oprávnění:</strong></p>
              <ul className="list-disc list-inside pl-4">
                {Object.entries(permissions)
                  .filter(([, perms]) => perms.can_read)
                  .map(([module]) => <li key={module} className="capitalize">{module}</li>)
                }
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Notifikace</CardTitle>
              <CardDescription>Vyberte, jaké e-mailové notifikace si přejete dostávat.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {['orders', 'realizations', 'projects', 'tasks'].map(item => (
                <div key={item} className="flex items-center justify-between">
                  <Label htmlFor={`notif-${item}`} className="capitalize">{item}</Label>
                  <Switch
                    id={`notif-${item}`}
                    checked={profile.notification_preferences?.[item] ?? true}
                    onCheckedChange={(checked) => setProfile(p => ({
                      ...p,
                      notification_preferences: { ...p.notification_preferences, [item]: checked }
                    }))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="language" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Jazyk a region</CardTitle>
              <CardDescription>Nastavte preferovaný jazyk rozhraní.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <Label>Jazyk</Label>
                <Select value={profile.language || 'cs'} onValueChange={(value) => setProfile(p => ({ ...p, language: value }))}>
                  <SelectTrigger>
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
