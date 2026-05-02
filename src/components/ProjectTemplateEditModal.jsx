import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Save } from 'lucide-react';

const ProjectTemplateEditModal = ({ isOpen, onClose, templateData, onSuccess }) => {
    const { toast } = useToast();

    const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm({
        defaultValues: {
            name: '',
            description: '',
            includeTasks: true,
            includePhases: true,
            includeMilestones: true
        }
    });

    const includeTasks = watch('includeTasks');
    const includePhases = watch('includePhases');
    const includeMilestones = watch('includeMilestones');

    useEffect(() => {
        if (templateData && isOpen) {
            reset({
                name: templateData.name || '',
                description: templateData.description || '',
                includeTasks: Array.isArray(templateData.tasks_data) && templateData.tasks_data.length > 0,
                includePhases: Array.isArray(templateData.phases_data) && templateData.phases_data.length > 0,
                includeMilestones: Array.isArray(templateData.milestones_data) && templateData.milestones_data.length > 0,
            });
        }
    }, [templateData, isOpen, reset]);

    const onSubmit = async (data) => {
        if (!templateData) return;
        try {
            const payload = {
                name: data.name,
                description: data.description,
                tasks_data: data.includeTasks ? templateData.tasks_data : [],
                phases_data: data.includePhases ? templateData.phases_data : [],
                milestones_data: data.includeMilestones ? templateData.milestones_data : [],
            };

            const { error } = await supabase
                .from('project_templates_custom')
                .update(payload)
                .eq('id', templateData.id);

            if (error) throw error;

            toast({ title: 'Šablona byla úspěšně upravena', variant: 'default' });
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error updating template:', error);
            toast({ title: 'Chyba při ukládání šablony', description: error.message, variant: 'destructive' });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Upravit šablonu</DialogTitle>
                    <DialogDescription>
                        Upravte název, popis nebo odstraňte vybraná data ze šablony.
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
                        <Label className="text-sm font-semibold text-slate-700">Obsah šablony:</Label>
                        
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="includeTasks" 
                                checked={includeTasks} 
                                onCheckedChange={(checked) => setValue('includeTasks', checked)} 
                                disabled={!(Array.isArray(templateData?.tasks_data) && templateData?.tasks_data.length > 0)}
                            />
                            <Label htmlFor="includeTasks" className="font-normal cursor-pointer">
                                Obsahuje úkoly ({(templateData?.tasks_data?.length || 0)})
                            </Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="includePhases" 
                                checked={includePhases} 
                                onCheckedChange={(checked) => setValue('includePhases', checked)} 
                                disabled={!(Array.isArray(templateData?.phases_data) && templateData?.phases_data.length > 0)}
                            />
                            <Label htmlFor="includePhases" className="font-normal cursor-pointer">
                                Obsahuje fáze ({(templateData?.phases_data?.length || 0)})
                            </Label>
                        </div>

                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="includeMilestones" 
                                checked={includeMilestones} 
                                onCheckedChange={(checked) => setValue('includeMilestones', checked)} 
                                disabled={!(Array.isArray(templateData?.milestones_data) && templateData?.milestones_data.length > 0)}
                            />
                            <Label htmlFor="includeMilestones" className="font-normal cursor-pointer">
                                Obsahuje milníky ({(templateData?.milestones_data?.length || 0)})
                            </Label>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            * Zrušením zaškrtnutí trvale odstraníte tato data ze šablony.
                        </p>
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

export default ProjectTemplateEditModal;