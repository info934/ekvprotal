import React, { useEffect, useState } from 'react';
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
  '{document_number}',
  '{document_title}',
  '{document_type}',
  '{document_date}',
  '{document_valid_until}',
  '{client_name}',
  '{project_name}',
  '{project_code}',
  '{opportunity_title}',
  '{opportunity_value}',
  '{items_table}',
  '{subtotal}',
  '{discount_total}',
  '{tax_total}',
  '{total_amount}',
  '{total_with_tax}',
  '{notes}',
  '{generated_at}',
  '{supplier_name}',
  '{order_number}',
  '{order_date}',
  '{delivery_date}',
  '{realization_name}',
  '{admin_name}',
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
        title: 'Chybejici udaje',
        description: 'Nazev a obsah sablony jsou povinne.',
        variant: 'destructive',
      });
      return;
    }
    onSave({ id: template?.id, name, description, content });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({ title: `Zkopirovano: ${text}` });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <FormDialogContent size="xl">
        <FormDialogHeader
          icon={Clipboard}
          title={template ? 'Upravit sablonu dokumentu' : 'Nova sablona dokumentu'}
        />
        <FormDialogBody className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <div>
              <Label htmlFor="template-name">Nazev sablony</Label>
              <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="template-description">Popis</Label>
              <Input id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="template-content">Obsah sablony (HTML je podporovan)</Label>
              <Textarea id="template-content" value={content} onChange={(event) => setContent(event.target.value)} rows={15} />
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="font-semibold">Dostupne zastupne symboly</h4>
            <div className="space-y-2">
              {placeholders.map((placeholder) => (
                <div key={placeholder} className="flex items-center justify-between rounded-md bg-muted/50 p-2">
                  <Badge variant="secondary">{placeholder}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(placeholder)}>
                    <Clipboard className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </FormDialogBody>
        <FormDialogFooter>
          <Button variant="outline" onClick={onClose}>Zrusit</Button>
          <Button onClick={handleSave}>Ulozit sablonu</Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default OrderTemplateDialog;
