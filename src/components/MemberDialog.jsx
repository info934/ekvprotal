import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Mail, Phone, DollarSign, Clock, Languages, FileText, Plus, Edit2, Shield, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Validation
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MemberSchema } from '@/lib/validationSchemas';
import { parseApiError } from '@/lib/apiValidation';

const languagesOptions = ['Čeština', 'Angličtina', 'Němčina', 'Slovenština', 'Polština'];

const MemberDialog = ({ isOpen, onClose, onSave, member }) => {
  const { toast } = useToast();
  const [roles, setRoles] = useState([]);

  // React Hook Form with Zod
  const { 
    register, 
    handleSubmit, 
    control, 
    reset, 
    setValue, 
    watch,
    formState: { errors, isSubmitting } 
  } = useForm({
    resolver: zodResolver(MemberSchema),
    defaultValues: {
      name: '',
      role_id: null,
      email: '',
      phone: '',
      attendance_enabled: true,
      hourly_rate: 0,
      internal_note: '',
      languages: [] // Not in Zod schema explicitly but handled manually
    }
  });

  const selectedLanguages = watch('languages') || [];

  useEffect(() => {
    const fetchRoles = async () => {
      const { data } = await supabase.from('member_roles').select('*');
      setRoles(data || []);
    };
    fetchRoles();
  }, []);

  useEffect(() => {
    if (isOpen) {
        if (member) {
            reset({
                name: member.name || '',
                role_id: member.role_id || null,
                email: member.email || '',
                phone: member.phone || '',
                attendance_enabled: member.attendance_enabled ?? true,
                hourly_rate: member.hourly_rate ? parseFloat(member.hourly_rate) : 0,
                internal_note: member.internal_note || '',
                languages: member.languages || []
            });
        } else {
            reset({
                name: '',
                role_id: roles.length > 0 ? roles[0].id : null,
                email: '',
                phone: '',
                attendance_enabled: true,
                hourly_rate: 0,
                internal_note: '',
                languages: []
            });
        }
    }
  }, [member, isOpen, roles, reset]);
  
  const handleLanguageChange = (lang) => {
    const current = selectedLanguages;
    const updated = current.includes(lang) 
        ? current.filter(l => l !== lang)
        : [...current, lang];
    setValue('languages', updated);
  };

  const onSubmit = async (data) => {
    try {
        // Data is already validated by Zod at this point
        
        // Handle API Call inside the parent or here. 
        // The parent onSave currently handles the supabase call. 
        // We will call onSave but catch errors.
        await onSave(data);
        
    } catch (error) {
        console.error("Submission error:", error);
        // Error handling is done in parent or onSave should throw
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <FormDialogContent size="lg">
        <div className="hidden">
          <div className="text-2xl font-bold flex items-center gap-2">
            {member ? (
              <>
                <Edit2 className="h-6 w-6 text-primary" />
                Upravit projektanta
              </>
            ) : (
              <>
                <Plus className="h-6 w-6 text-primary" />
                Nový projektant
              </>
            )}
          </div>
        </div>
        <FormDialogHeader
          icon={member ? Edit2 : Plus}
          title={member ? 'Upravit projektanta' : 'Nový projektant'}
          description="Správa základních údajů, kontaktu a nastavení docházky."
        />
        
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="basic" className="h-full flex flex-col">
            <FormDialogBody>
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="basic" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Základní
              </TabsTrigger>
              <TabsTrigger value="contact" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Kontakt
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Nastavení
              </TabsTrigger>
            </TabsList>
            
            <div className="space-y-6">
              {/* Basic Information Tab */}
              <TabsContent value="basic" className="space-y-6 mt-0">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="name" className="flex items-center gap-2 text-sm font-medium">
                      <User className="h-4 w-4 text-muted-foreground" />
                      Jméno
                      <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      {...register('name')}
                      placeholder="Zadejte jméno projektanta"
                      className={errors.name ? "border-red-500" : ""}
                    />
                    {errors.name && <p className="text-xs text-red-500 flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.name.message}</p>}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="role" className="flex items-center gap-2 text-sm font-medium">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      Role
                    </Label>
                    <Controller
                        name="role_id"
                        control={control}
                        render={({ field }) => (
                            <Select
                              value={field.value || ''}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="-- Vyberte roli --" />
                              </SelectTrigger>
                              <SelectContent>
                                {roles.map(role => (
                                  <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                        )}
                    />
                    {errors.role_id && <p className="text-xs text-red-500 flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.role_id.message}</p>}
                  </div>
                </motion.div>
              </TabsContent>

              {/* Contact Tab */}
              <TabsContent value="contact" className="space-y-6 mt-0">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="flex items-center gap-2 text-sm font-medium">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        Email (propojení s účtem)
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        {...register('email')}
                        placeholder="projektant@example.com"
                        className={errors.email ? "border-red-500" : ""}
                      />
                      {errors.email && <p className="text-xs text-red-500 flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.email.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="flex items-center gap-2 text-sm font-medium">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        Telefon
                      </Label>
                      <Input
                        id="phone"
                        {...register('phone')}
                        placeholder="+420 123 456 789"
                      />
                    </div>
                  </div>
                </motion.div>
              </TabsContent>

              {/* Settings Tab */}
              <TabsContent value="settings" className="space-y-6 mt-0">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="hourly_rate" className="flex items-center gap-2 text-sm font-medium">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        Hodinová sazba (Kč)
                      </Label>
                      <Input
                        id="hourly_rate"
                        type="number"
                        step="0.01"
                        {...register('hourly_rate')}
                        placeholder="např. 500"
                        className={errors.hourly_rate ? "border-red-500 text-right font-mono" : "text-right font-mono"}
                      />
                      {errors.hourly_rate && <p className="text-xs text-red-500 flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1"/>{errors.hourly_rate.message}</p>}
                    </div>
                    
                    <div className="flex items-center space-x-2 p-3 bg-muted/20 rounded-lg">
                      <Controller
                        name="attendance_enabled"
                        control={control}
                        render={({ field }) => (
                            <Checkbox 
                                id="attendance_enabled" 
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                        )}
                      />
                      <Label htmlFor="attendance_enabled" className="flex items-center gap-2 cursor-pointer">
                        <Clock className="h-4 w-4" />
                        Aktivní docházka
                      </Label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Languages className="h-4 w-4 text-muted-foreground" />
                      Jazykové znalosti
                    </Label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {languagesOptions.map(lang => (
                        <motion.div 
                          key={lang} 
                          className="flex items-center space-x-2 p-2 rounded-lg border hover:bg-muted/50 transition-colors"
                          whileHover={{ scale: 1.02 }}
                        >
                          <Checkbox 
                            id={`lang-${lang}`}
                            checked={selectedLanguages.includes(lang)}
                            onCheckedChange={() => handleLanguageChange(lang)}
                          />
                          <Label htmlFor={`lang-${lang}`} className="text-sm cursor-pointer flex-1">
                            {lang}
                          </Label>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="internal_note" className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Interní poznámka
                    </Label>
                    <Textarea
                      id="internal_note"
                      {...register('internal_note')}
                      placeholder="Poznámky k dostupnosti, specializaci atd."
                      rows={4}
                      className="resize-none"
                    />
                  </div>
                </motion.div>
              </TabsContent>
            </div>
            
            </FormDialogBody>
            <FormDialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Zrušit
              </Button>
              <Button type="submit" className="min-w-[120px]" disabled={isSubmitting}>
                {isSubmitting ? 'Ukládání...' : (member ? 'Uložit změny' : 'Vytvořit')}
              </Button>
            </FormDialogFooter>
          </Tabs>
        </form>
      </FormDialogContent>
    </Dialog>
  );
};

export default MemberDialog;
