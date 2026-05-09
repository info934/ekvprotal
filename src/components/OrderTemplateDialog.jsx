import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Clipboard, FileUp } from 'lucide-react';
import { Badge } from './ui/badge';
import JSZip from 'jszip';

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

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const readFileAsText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Soubor se nepodarilo nacist.'));
  reader.readAsText(file, 'utf-8');
});

const extractDocxAsHtml = async (file) => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file('word/document.xml')?.async('text');
  if (!documentXml) throw new Error('DOCX neobsahuje word/document.xml.');

  const xml = new DOMParser().parseFromString(documentXml, 'application/xml');
  const paragraphs = Array.from(xml.getElementsByTagName('w:p'))
    .map((paragraph) => Array.from(paragraph.getElementsByTagName('w:t'))
      .map((node) => node.textContent || '')
      .join(''))
    .map((text) => text.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) throw new Error('Z DOCX se nepodarilo nacist zadny text.');
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
};

const OrderTemplateDialog = ({ isOpen, onClose, onSave, template }) => {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [importingFile, setImportingFile] = useState(false);

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

  const handleTemplateFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportingFile(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let nextContent = '';

      if (extension === 'docx') {
        nextContent = await extractDocxAsHtml(file);
      } else if (['html', 'htm', 'txt'].includes(extension)) {
        nextContent = await readFileAsText(file);
      } else {
        throw new Error('Podporovane jsou soubory .html, .htm, .txt a .docx.');
      }

      setContent(nextContent);
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''));
      toast({
        title: 'Sablona nactena',
        description: extension === 'docx'
          ? 'DOCX byl preveden na jednoduche HTML odstavce. Zkontrolujte prosim formatovani a zastupne symboly.'
          : 'Obsah souboru byl vlozen do sablony.',
      });
    } catch (error) {
      toast({
        title: 'Soubor se nepodarilo nacist',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setImportingFile(false);
    }
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
            <div className="rounded-lg border border-dashed bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label htmlFor="template-file">Nahrat sablonu</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Podporovane formaty: HTML, TXT a DOCX. DOCX se prevede na editovatelne HTML.
                  </p>
                </div>
                <Button type="button" variant="outline" disabled={importingFile} asChild>
                  <label htmlFor="template-file" className="cursor-pointer">
                    <FileUp className="mr-2 h-4 w-4" />
                    {importingFile ? 'Nacitam...' : 'Vybrat soubor'}
                  </label>
                </Button>
              </div>
              <Input
                id="template-file"
                type="file"
                accept=".html,.htm,.txt,.docx"
                className="hidden"
                onChange={handleTemplateFile}
              />
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
