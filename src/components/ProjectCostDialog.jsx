import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DollarSign, FileText, Plus, Edit2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';

const ProjectCostDialog = ({ isOpen, onClose, onSave, costData, projectId }) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (costData) {
      setDescription(costData.description || '');
      setAmount(costData.amount || '');
    } else {
      setDescription('');
      setAmount('');
    }
  }, [costData, isOpen]);

  const handleSave = () => {
    if (!description.trim()) {
      toast({
        title: "Chyba",
        description: "Prosím, vyplňte popis nákladu.",
        variant: "destructive"
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Chyba", 
        description: "Prosím, zadejte platnou částku větší než 0.",
        variant: "destructive"
      });
      return;
    }

    const newCostData = {
      project_id: projectId,
      description: description.trim(),
      amount: parseFloat(amount),
    };

    onSave(newCostData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            {costData ? (
              <>
                <Edit2 className="h-5 w-5 text-primary" />
                Upravit náklad
              </>
            ) : (
              <>
                <Plus className="h-5 w-5 text-primary" />
                Přidat náklad
              </>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 py-4"
        >
          <div className="space-y-2">
            <Label htmlFor="description" className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Popis nákladu
              <span className="text-red-500">*</span>
            </Label>
            <Textarea 
              id="description" 
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Zadejte popis nákladu..."
              rows={3}
              className="resize-none"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="amount" className="flex items-center gap-2 text-sm font-medium">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Částka (Kč)
              <span className="text-red-500">*</span>
            </Label>
            <Input 
              id="amount" 
              type="number" 
              value={amount} 
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              min="0"
              step="0.01"
              className="text-right font-mono"
            />
          </div>
        </motion.div>
        
        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={onClose}>
            Zrušit
          </Button>
          <Button onClick={handleSave} className="min-w-[100px]">
            {costData ? 'Uložit' : 'Přidat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectCostDialog;