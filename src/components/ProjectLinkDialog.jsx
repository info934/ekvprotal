import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ProjectLinkDialog = ({ isOpen, onClose, onSave, link, projectId }) => {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (link) {
      setUrl(link.url || '');
      setDescription(link.description || '');
    } else {
      setUrl('');
      setDescription('');
    }
  }, [link, isOpen]);

  const handleSave = () => {
    if (!url) {
      alert('Prosím, zadejte URL odkazu.');
      return;
    }

    try {
      new URL(url);
    } catch (error) {
      alert('Prosím, zadejte platnou URL.');
      return;
    }
    
    const linkData = {
      project_id: projectId,
      url,
      description,
    };

    onSave(linkData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link ? 'Upravit odkaz' : 'Přidat odkaz'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="url">URL odkazu *</Label>
            <Input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Popis odkazu</Label>
            <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Např. Dokumentace na Google Drive" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button onClick={handleSave}>Uložit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectLinkDialog;