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
import { sanitizeDocumentTemplateHtml } from '@/lib/htmlSanitizer';

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
  reader.onerror = () => reject(reader.error || new Error('Soubor se nepodařilo načíst.'));
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

  if (paragraphs.length === 0) throw new Error('Z DOCX se nepodařilo načíst žádný text.');
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
        title: 'Chybějící údaje',
        description: 'Název a obsah šablony jsou povinné.',
        variant: 'destructive',
      });
      return;
    }
    onSave({
      id: template?.id,
      name: name.trim(),
      description: description.trim(),
      content: sanitizeDocumentTemplateHtml(content),
    });
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
        throw new Error('Podporované jsou soubory .html, .htm, .txt a .docx.');
      }

      const sanitizedContent = sanitizeDocumentTemplateHtml(nextContent);
      setContent(sanitizedContent);
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''));
      toast({
        title: 'Šablona načtena',
        description: extension === 'docx'
          ? 'DOCX byl převeden na jednoduché HTML odstavce. Zkontrolujte prosím formátování a zástupné symboly.'
          : 'Obsah souboru byl vložen do šablony.',
      });
    } catch (error) {
      toast({
        title: 'Soubor se nepodařilo načíst',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setImportingFile(false);
    }
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
          title={template ? 'Upravit šablonu dokumentu' : 'Nová šablona dokumentu'}
        />
        <FormDialogBody className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <div>
              <Label htmlFor="template-name">Název šablony</Label>
              <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="template-description">Popis</Label>
              <Input id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className="rounded-lg border border-dashed bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label htmlFor="template-file">Nahrát šablonu</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Podporované formáty: HTML, TXT a DOCX. DOCX se převede na editovatelné HTML.
                  </p>
                </div>
                <Button type="button" variant="outline" disabled={importingFile} asChild>
                  <label htmlFor="template-file" className="cursor-pointer">
                    <FileUp className="mr-2 h-4 w-4" />
                    {importingFile ? 'Načítám...' : 'Vybrat soubor'}
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
              <Label htmlFor="template-content">Obsah šablony (HTML je podporované)</Label>
              <Textarea
                id="template-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={15}
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="space-y-4 rounded-lg border bg-slate-50 p-4">
            <div>
              <h4 className="font-semibold">Dostupné zástupné symboly</h4>
              <p className="mt-1 text-xs text-muted-foreground">Kliknutím zkopírujete placeholder do schránky.</p>
            </div>
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {placeholders.map((placeholder) => (
                <div key={placeholder} className="flex items-center justify-between rounded-md border bg-white p-2">
                  <Badge variant="secondary">{placeholder}</Badge>
                  <Button type="button" variant="ghost" size="icon" onClick={() => copyToClipboard(placeholder)}>
                    <Clipboard className="h-4 w-4" />
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
