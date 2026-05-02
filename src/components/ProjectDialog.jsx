// This file is no longer used and can be considered for deletion.
// The form logic has been moved to ProjectForm.jsx.
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const ProjectDialog = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project Form</DialogTitle>
        </DialogHeader>
        <p>This dialog is deprecated. Project creation and editing is now handled on a dedicated page.</p>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectDialog;