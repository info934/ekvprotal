import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { PERMISSION_LEVELS, PERMISSION_MODULES, permissionLevelLabel } from '@/lib/permissionCatalog';
import { cn } from '@/lib/utils';

const levelTone = {
  none: 'bg-slate-100 text-slate-700',
  read: 'bg-blue-50 text-blue-700',
  edit: 'bg-amber-50 text-amber-800',
  admin: 'bg-emerald-50 text-emerald-700',
};

const roleLabel = (role) => String(role || 'bez role').replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());

const UserPermissionDialog = ({ user, open, onOpenChange }) => {
  const { toast } = useToast();
  const [settings, setSettings] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!user?.member_id) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_member_permission_settings', { p_member_id: user.member_id });
    setLoading(false);
    if (error) {
      toast({ title: 'Přístupy se nepodařilo načíst', description: error.message, variant: 'destructive' });
      return;
    }
    setSettings(data);
    setValues(Object.fromEntries((data?.permissions || []).map((permission) => [permission.module, permission.override_level || 'inherit'])));
  }, [toast, user?.member_id]);

  useEffect(() => {
    if (open && user?.member_id) void loadSettings();
    if (!open) {
      setSettings(null);
      setValues({});
    }
  }, [loadSettings, open, user?.member_id]);

  const permissionMap = useMemo(
    () => new Map((settings?.permissions || []).map((permission) => [permission.module, permission])),
    [settings?.permissions]
  );
  const overrideCount = Object.values(values).filter((value) => value && value !== 'inherit').length;

  const resetToRole = () => setValues(Object.fromEntries(PERMISSION_MODULES.map((module) => [module.key, 'inherit'])));

  const save = async () => {
    if (!user?.member_id || settings?.is_locked) return;
    const overrides = PERMISSION_MODULES.flatMap((module) => {
      const accessLevel = values[module.key] || 'inherit';
      return accessLevel === 'inherit' ? [] : [{ module: module.key, access_level: accessLevel }];
    });
    setSaving(true);
    const { error } = await supabase.rpc('set_member_permission_overrides', {
      p_member_id: user.member_id,
      p_overrides: overrides,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Přístupy se nepodařilo uložit', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Přístupy uživatele byly uloženy', description: `${overrideCount} individuálních výjimek.` });
    await loadSettings();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="xl">
        <FormDialogHeader
          icon={ShieldCheck}
          title={`Přístupy · ${user?.member_name || user?.email || ''}`}
          description="Role určuje výchozí přístup. Výjimka u konkrétního modulu má před rolí přednost."
        />
        <FormDialogBody className="space-y-4">
          {!user?.member_id ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Nejdříve účet propojte se zaměstnancem. Potom bude možné nastavit individuální přístupy.
            </div>
          ) : loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Načítám oprávnění…
            </div>
          ) : settings ? (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-950">Výchozí role</span>
                    <Badge variant="info">{roleLabel(settings.role)}</Badge>
                    <Badge variant={overrideCount ? 'warning' : 'secondary'}>{overrideCount} výjimek</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Výsledné oprávnění vidíte u každého modulu ještě před uložením.</p>
                </div>
                {!settings.is_locked && (
                  <Button type="button" variant="outline" onClick={resetToRole}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Vrátit vše podle role
                  </Button>
                )}
              </div>

              {settings.is_locked && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  Administrátor má vždy plný přístup. Tím je chráněno obnovení a správa ostatních účtů.
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {PERMISSION_MODULES.map((module) => {
                  const permission = permissionMap.get(module.key) || { role_level: 'none' };
                  const selected = settings.is_locked ? 'inherit' : values[module.key] || 'inherit';
                  const effective = selected === 'inherit' ? permission.role_level : selected;
                  const isOverride = selected !== 'inherit';
                  return (
                    <div key={module.key} className={cn('rounded-xl border p-4 transition-colors', isOverride ? 'border-amber-200 bg-amber-50/35' : 'border-slate-200 bg-white')}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-950">{module.name}</h3>
                          <p className="text-xs text-slate-500">Role: {permissionLevelLabel(permission.role_level)}</p>
                        </div>
                        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', levelTone[effective] || levelTone.none)}>
                          {permissionLevelLabel(effective)}
                        </span>
                      </div>
                      <Select
                        value={selected}
                        onValueChange={(value) => setValues((current) => ({ ...current, [module.key]: value }))}
                        disabled={settings.is_locked || saving}
                      >
                        <SelectTrigger aria-label={`Přístup k modulu ${module.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PERMISSION_LEVELS.map((level) => (
                            <SelectItem key={level.value} value={level.value}>
                              {level.value === 'inherit' ? `${level.label} (${permissionLevelLabel(permission.role_level)})` : level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </FormDialogBody>
        <FormDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Zavřít</Button>
          {user?.member_id && !settings?.is_locked && (
            <Button type="button" onClick={save} disabled={loading || saving || !settings}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Uložit přístupy
            </Button>
          )}
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default UserPermissionDialog;

