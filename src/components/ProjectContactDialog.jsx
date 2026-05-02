import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const ProjectContactDialog = ({ isOpen, onClose, onSave, contact, projectId }) => {
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    if (isOpen) {
      if (contact) {
        setFormData({
          name: contact.name || '',
          role: contact.role || '',
          email: contact.email || '',
          phone: contact.phone || '',
        });
      } else {
        setFormData({
          name: '',
          role: '',
          email: '',
          phone: '',
        });
      }
    }
  }, [contact, isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ ...formData, project_id: projectId });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? 'Upravit kontakt' : 'Přidat nový kontakt'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Jméno a příjmení *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="Jan Novák"
            />
          </div>
          <div>
            <Label htmlFor="role">Role / Pozice</Label>
            <Input
              id="role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              placeholder="např. Statik"
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="jan.novak@email.cz"
            />
          </div>
          <div>
            <Label htmlFor="phone">Telefon</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+420 123 456 789"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Zrušit
            </Button>
            <Button type="submit">
              {contact ? 'Uložit změny' : 'Přidat kontakt'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectContactDialog;