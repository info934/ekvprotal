import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DollarSign, FileText, Plus, Edit2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const UNASSIGNED_MEMBER_VALUE = 'unassigned';

const ProjectCostDialog = ({ isOpen, onClose, onSave, costData, projectId, members = [] }) => {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [memberId, setMemberId] = useState(UNASSIGNED_MEMBER_VALUE);
  const { toast } = useToast();

  useEffect(() => {
    if (costData) {
      setDescription(costData.description || '');
      setAmount(costData.amount || '');
      setMemberId(costData.member_id || UNASSIGNED_MEMBER_VALUE);
    } else {
      setDescription('');
      setAmount('');
      setMemberId(UNASSIGNED_MEMBER_VALUE);
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
      member_id: memberId === UNASSIGNED_MEMBER_VALUE ? null : memberId,
    };

    onSave(newCostData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <FormDialogContent size="sm">
        <div className="hidden">
          <div className="text-xl font-bold flex items-center gap-2">
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
          </div>
        </div>
        <FormDialogHeader
          icon={costData ? Edit2 : Plus}
          title={costData ? 'Upravit náklad' : 'Přidat náklad'}
          description="Zadejte popis a částku projektového nákladu."
        />
        
        <FormDialogBody>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
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

          <div className="space-y-2">
            <Label>Odečíst z odměny</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger>
                <SelectValue placeholder="Nepřiřazeno" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_MEMBER_VALUE}>Nepřiřazeno - odečíst ze společného budgetu</SelectItem>
                {members.map((assignment) => (
                  <SelectItem key={assignment.member_id} value={assignment.member_id}>
                    {assignment.member?.name || assignment.member?.email || 'Neznámý člen'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Přiřazený náklad sníží odměnu vybraného člena. Nepřiřazený náklad snižuje společný budget projektu.
            </p>
          </div>
        </motion.div>
        </FormDialogBody>
        
        <FormDialogFooter>
          <Button variant="outline" onClick={onClose}>
            Zrušit
          </Button>
          <Button onClick={handleSave} className="min-w-[100px]">
            {costData ? 'Uložit' : 'Přidat'}
          </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default ProjectCostDialog;
