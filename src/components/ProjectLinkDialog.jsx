import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

const ProjectLinkDialog = ({ isOpen, onClose, onSave, link, linkData, projectId }) => {
  const currentLink = link || linkData;
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (currentLink) {
      setUrl(currentLink.url || '');
      setDescription(currentLink.description || '');
    } else {
      setUrl('');
      setDescription('');
    }
    setValidationError('');
  }, [currentLink, isOpen]);

  const handleSave = async () => {
    if (!url) {
      setValidationError('Prosím, zadejte URL odkazu.');
      return;
    }

    try {
      new URL(url);
    } catch (error) {
      setValidationError('Prosím, zadejte platnou URL včetně https://.');
      return;
    }
    
    const linkData = {
      project_id: projectId,
      url,
      description,
    };

    setValidationError('');
    setIsSaving(true);
    try {
      const result = await onSave(linkData);
      if (result !== false) onClose();
    } catch (error) {
      toast({ title: 'Odkaz se nepodařilo uložit', description: error?.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentLink ? 'Upravit odkaz' : 'Přidat odkaz'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="url">URL odkazu *</Label>
            <Input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
            {validationError && <p role="alert" className="text-sm text-red-600">{validationError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Popis odkazu</Label>
            <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Např. Dokumentace na Google Drive" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>Zrušit</Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Ukládám…' : 'Uložit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectLinkDialog;
