import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Save } from 'lucide-react';

const SaveTemplateModal = ({ isOpen, onClose, projectData }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
        defaultValues: {
            name: projectData?.name ? `${projectData.name} - Šablona` : '',
            description: '',
            includeTasks: true,
            includePhases: true,
            includeMilestones: true
        }
    });

    const includeTasks = watch('includeTasks');
    const includePhases = watch('includePhases');
    const includeMilestones = watch('includeMilestones');

    const onSubmit = async (data) => {
        if (!user) return;
        setIsSubmitting(true);
        try {
            const templateData = {
                user_id: user.id,
                name: data.name,
                description: data.description,
                tasks_data: data.includeTasks && projectData?.tasks ? projectData.tasks : [],
                phases_data: data.includePhases && projectData?.phases ? projectData.phases : [],
                milestones_data: data.includeMilestones && projectData?.milestones ? projectData.milestones : [],
            };

            const { error } = await supabase.from('project_templates_custom').insert(templateData);

            if (error) throw error;

            toast({ title: 'Šablona byla úspěšně uložena', variant: 'default' });
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
                    <DialogTitle>Uložit jako šablonu</DialogTitle>
                    <DialogDescription>
                        Uložte aktuální strukturu projektu jako šablonu pro budoucí použití.
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
                            rows={3}
                        />
                    </div>

                    <div className="space-y-3 pt-2 border-t">
                        <Label className="text-sm font-semibold text-slate-700">Zahrnout do šablony:</Label>
                        
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="includeTasks" 
                                checked={includeTasks} 
                                onCheckedChange={(checked) => setValue('includeTasks', checked)} 
                            />
                            <Label htmlFor="includeTasks" className="font-normal cursor-pointer">Zahrnout úkoly</Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="includePhases" 
                                checked={includePhases} 
                                onCheckedChange={(checked) => setValue('includePhases', checked)} 
                            />
                            <Label htmlFor="includePhases" className="font-normal cursor-pointer">Zahrnout fáze</Label>
                        </div>

                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="includeMilestones" 
                                checked={includeMilestones} 
                                onCheckedChange={(checked) => setValue('includeMilestones', checked)} 
                            />
                            <Label htmlFor="includeMilestones" className="font-normal cursor-pointer">Zahrnout milníky</Label>
                        </div>
                    </div>

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                            Zrušit
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Ukládání...</>
                            ) : (
                                <><Save className="w-4 h-4 mr-2" /> Uložit šablonu</>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default SaveTemplateModal;