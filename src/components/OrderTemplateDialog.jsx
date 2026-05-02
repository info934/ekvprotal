import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Clipboard } from 'lucide-react';
import { Badge } from './ui/badge';

const placeholders = [
    '{supplier_name}', '{order_number}', '{order_date}', '{items_table}', '{total_amount}', '{delivery_date}', '{notes}', '{realization_name}', '{admin_name}'
];

const OrderTemplateDialog = ({ isOpen, onClose, onSave, template }) => {
    const { toast } = useToast();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [content, setContent] = useState('');

    useEffect(() => {
        if (template) {
            setName(template.name || '');
            setDescription(template.description || '');
            setContent(template.content || '');
        } else {
            setName('');
            setDescription('');
            setContent('');
        }
    }, [template, isOpen]);

    const handleSave = () => {
        if (!name.trim() || !content.trim()) {
            toast({
                title: 'Chybějící údaje',
                description: 'Název a obsah šablony jsou povinné.',
                variant: 'destructive',
            });
            return;
        }
        onSave({ id: template?.id, name, description, content });
    };
    
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast({ title: `Zkopírováno: ${text}` });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <FormDialogContent size="xl">
                <FormDialogHeader
                    icon={Clipboard}
                    title={template ? 'Upravit šablonu objednávky' : 'Nová šablona objednávky'}
                />
                <FormDialogBody className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    <div className="md:col-span-2 space-y-4">
                        <div>
                            <Label htmlFor="template-name">Název šablony</Label>
                            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="template-description">Popis</Label>
                            <Input id="template-description" value={description} onChange={(e) => setDescription(e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="template-content">Obsah šablony (HTML je podporován)</Label>
                            <Textarea id="template-content" value={content} onChange={(e) => setContent(e.target.value)} rows={15} />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h4 className="font-semibold">Dostupné zástupné symboly</h4>
                        <div className="space-y-2">
                            {placeholders.map(p => (
                                <div key={p} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                                    <Badge variant="secondary">{p}</Badge>
                                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(p)}>
                                        <Clipboard className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </FormDialogBody>
                <FormDialogFooter>
                    <Button variant="outline" onClick={onClose}>Zrušit</Button>
                    <Button onClick={handleSave}>Uložit šablonu</Button>
                </FormDialogFooter>
            </FormDialogContent>
        </Dialog>
    );
};

export default OrderTemplateDialog;
