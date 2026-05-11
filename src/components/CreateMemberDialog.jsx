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
  ico: z.string().optional().or(z.literal('')),
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
      ico: '',
      email: '',
      phone: '',
    },
  });

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const table = entityType === 'subject' ? 'subjects' : 'members';

      if (entityType === 'subject' && !data.ico?.trim()) {
        toast({
          title: "Doplňte IČO",
          description: "Subjekt nelze založit bez IČO.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      
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
        payload.ico = data.ico.trim();
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
