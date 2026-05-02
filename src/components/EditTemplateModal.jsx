import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Save } from 'lucide-react';

const EditTemplateModal = ({ isOpen, onClose, templateData, onSuccess }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isEditing = !!templateData?.id;

    const { register, handleSubmit, reset, formState: { errors } } = useForm({
        defaultValues: {
            name: '',
            description: ''
        }
    });

    useEffect(() => {
        if (templateData && isOpen) {
            reset({
                name: templateData.name || '',
                description: templateData.description || ''
            });
        } else if (!isEditing && isOpen) {
            reset({ name: '', description: '' });
        }
    }, [templateData, isOpen, reset, isEditing]);

    const onSubmit = async (data) => {
        if (!user) return;
        setIsSubmitting(true);
        try {
            const payload = {
                name: data.name,
                description: data.description,
            };

            let error;
            if (isEditing) {
                const res = await supabase.from('project_templates_custom').update(payload).eq('id', templateData.id);
                error = res.error;
            } else {
                payload.user_id = user.id;
                const res = await supabase.from('project_templates_custom').insert(payload);
                error = res.error;
            }

            if (error) throw error;

            toast({ title: isEditing ? 'Šablona aktualizována' : 'Šablona vytvořena', variant: 'default' });
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error saving template:', error);
            toast({ title: 'Chyba při ukládání šablony', description: error.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{isEditing ? 'Upravit šablonu' : 'Nová šablona'}</DialogTitle>
                    <DialogDescription>
                        {isEditing ? 'Upravte základní údaje o šabloně.' : 'Vytvořte novou prázdnou šablonu.'}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Název šablony <span className="text-red-500">*</span></Label>
                        <Input 
                            id="name" 
                            {...register('name', { required: 'Název šablony je povinný' })} 
                            placeholder="Např. Standardní bytový dům"
                            className={errors.name ? 'border-red-500' : ''}
                        />
                        {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Popis (volitelné)</Label>
                        <Textarea 
                            id="description" 
                            {...register('description')} 
                            placeholder="Stručný popis šablony..."
                            rows={4}
                        />
                    </div>

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                            Zrušit
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Ukládání...</>
                            ) : (
                                <><Save className="w-4 h-4 mr-2" /> Uložit</>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default EditTemplateModal;