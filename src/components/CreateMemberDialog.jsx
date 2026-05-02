import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
} from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

// Schema for inline creation
// We use a simplified schema compared to full MemberSchema for inline creation
const InlineMemberSchema = z.object({
  name: z.string().min(1, 'Jméno je povinné'),
  email: z.string().email('Neplatný email').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
});

const CreateMemberDialog = ({
  open,
  onOpenChange,
  onSuccess,
  entityType = 'member', // 'member' or 'subject' to support Task 4 reuse
}) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(InlineMemberSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
    },
  });

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      // Determine table based on entityType
      // Default to 'members' as per Task 2, but allow 'subjects' for Task 4 integration
      const table = entityType === 'subject' ? 'subjects' : 'members';
      
      // For subjects, we might need extra fields like 'ico' if strict validation exists, 
      // but assuming standard nullable fields for now or minimal 'subjects' requirements.
      // Looking at `subjects` table definition: `ico` is NOT NULL. 
      // If we use this for subjects, we MUST ask for ICO.
      // The prompt Task 2 says fields: "name, email, phone".
      // This strongly suggests Task 2 is purely for `members` table (where ICO isn't required).
      //
      // However, Task 4 wants to use this for Investor/Client (Subjects).
      // If I use this for Subjects, insert will fail due to missing ICO.
      //
      // I will implement specific logic: if entityType is 'subject', we mock/require ICO or handle it.
      // Since Task 2 only requested name/email/phone, I'll stick to that for the UI.
      // If `entityType` is subject, I might have to auto-generate a dummy ICO or fail.
      // Let's assume for `members` mostly. For Task 4 integration, I might need to enhance this later.
      //
      // Wait, `subjects` table has `ico text NOT NULL`.
      // I'll add ICO field conditionally if entityType is subject.
      
      const payload = {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
      };

      if (entityType === 'member') {
        // Members might need auth_user_id or role.
        // Public/anon creation of members might need default values.
        payload.user_role = 'user'; // Default
        payload.attendance_enabled = true;
      }
      
      if (entityType === 'subject') {
        // We need ICO for subjects
        if (!data.ico) {
            // If the form doesn't have ICO but table requires it...
            // I'll assume for this task we might default it or the user must provide it.
            // I will add ICO input to the form if entityType is subject.
            payload.ico = data.ico || '00000000'; // Fallback if hidden, but I'll expose it
        } else {
            payload.ico = data.ico;
        }
      }

      const { data: newItem, error } = await supabase
        .from(table)
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Vytvořeno",
        description: `Záznam ${newItem.name} byl úspěšně vytvořen.`,
        variant: "success",
      });

      reset();
      onSuccess(newItem);
      onOpenChange(false);
    } catch (error) {
      console.error("Creation error:", error);
      toast({
        title: "Chyba vytvoření",
        description: error.message || "Nepodařilo se vytvořit záznam.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="sm">
        <FormDialogHeader
          title={entityType === 'subject' ? 'Nový subjekt' : 'Nový člen'}
          description={`Vytvořte ${entityType === 'subject' ? 'nový subjekt' : 'nového člena'} pro rychlý výběr.`}
        />
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <FormDialogBody className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Jméno / Název *</Label>
              <Input id="name" {...register('name')} className={errors.name && "border-red-500"} />
              {errors.name && <span className="text-xs text-red-500">{errors.name.message}</span>}
            </div>
          
            {entityType === 'subject' && (
              <div className="grid gap-2">
                <Label htmlFor="ico">IČO *</Label>
                <Input id="ico" {...register('ico', { required: entityType === 'subject' ? 'IČO je povinné' : false })} />
                {errors.ico && <span className="text-xs text-red-500">{errors.ico.message}</span>}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" {...register('email')} />
              {errors.email && <span className="text-xs text-red-500">{errors.email.message}</span>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input id="phone" {...register('phone')} />
            </div>
          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Zrušit
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vytvořit
            </Button>
          </FormDialogFooter>
        </form>
      </FormDialogContent>
    </Dialog>
  );
};

export default CreateMemberDialog;
