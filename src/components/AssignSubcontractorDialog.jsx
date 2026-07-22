import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { uuidv4 } from '@/lib/uuid';
import SubjectDialog from '@/components/SubjectDialog';
import { Plus } from 'lucide-react';


const AssignSubcontractorDialog = ({ isOpen, onClose, onSave, assignedSubcontractor, projectSubcontractors, projectId }) => {
  const { toast } = useToast();
  const [allSubcontractors, setAllSubcontractors] = useState([]);
  const [availableSubcontractors, setAvailableSubcontractors] = useState([]);
  const [subcontractorTypeId, setSubcontractorTypeId] = useState('');
  const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    id: null,
    subject_id: '',
    scope_of_work: '',
    price: '',
    status: 'Poptáno',
    createOrder: false,
    orderValidity: 7,
  });
  const defaultSubcontractorSubject = useMemo(() => ({
    type_id: subcontractorTypeId,
    subject_kind: 'company',
  }), [subcontractorTypeId]);

  const fetchSubcontractorSubjects = useCallback(async () => {
    const { data: subType, error: typeError } = await supabase
      .from('subject_types')
      .select('id')
      .eq('name', 'Subdodavatel')
      .single();

    if (typeError || !subType) {
      toast({ title: "Chyba: Typ 'Subdodavatel' nenalezen.", variant: "destructive" });
      return;
    }
    setSubcontractorTypeId(subType.id);

    const { data, error } = await supabase
      .from('subjects')
      .select('id, name')
      .eq('type_id', subType.id)
      .order('name');
      
    if (error) {
      console.error('Error fetching subcontractor subjects:', error);
      toast({ title: "Chyba při načítání subjektů.", variant: "destructive" });
    } else {
      setAllSubcontractors(data);
    }
  }, [toast]);

  useEffect(() => {
    if (isOpen) {
      fetchSubcontractorSubjects();

      if (assignedSubcontractor) {
        setFormData({
          id: assignedSubcontractor.id,
          subject_id: assignedSubcontractor.subject_id,
          scope_of_work: assignedSubcontractor.scope_of_work || '',
          price: assignedSubcontractor.price || '',
          status: assignedSubcontractor.status || 'Poptáno',
          createOrder: false,
          orderValidity: 7,
        });
      } else {
        setFormData({
          id: null,
          subject_id: '',
          scope_of_work: '',
          price: '',
          status: 'Poptáno',
          createOrder: false,
          orderValidity: 7,
        });
      }
    }
  }, [isOpen, assignedSubcontractor, fetchSubcontractorSubjects]);

  useEffect(() => {
    if (isOpen && allSubcontractors.length > 0 && projectSubcontractors) {
      const currentSubjectId = assignedSubcontractor?.subject_id || null;
      const assignedIds = new Set(
        (projectSubcontractors || [])
          .filter(ps => ps.subject_id && ps.subject_id !== currentSubjectId)
          .map(ps => ps.subject_id)
      );
      const filtered = allSubcontractors.filter(sub => !assignedIds.has(sub.id));
      setAvailableSubcontractors(filtered);
    } else {
       setAvailableSubcontractors(allSubcontractors);
    }
  }, [isOpen, assignedSubcontractor, allSubcontractors, projectSubcontractors]);

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id, value) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleCheckboxChange = (checked) => {
    setFormData(prev => ({ ...prev, createOrder: checked }));
  };

  const handleQuickSubjectSave = async (subject) => {
    const payload = {
      ...subject,
      type_id: subcontractorTypeId || subject.type_id,
    };
    const { data, error } = await supabase
      .from('subjects')
      .insert([payload])
      .select('id, name')
      .single();

    if (error) {
      toast({ title: 'Chyba při vytvoření subdodavatele', description: error.message, variant: 'destructive' });
      return;
    }

    setAllSubcontractors(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'cs')));
    setAvailableSubcontractors(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'cs')));
    setFormData(prev => ({ ...prev, subject_id: data.id }));
    setIsSubjectDialogOpen(false);
    toast({ title: 'Subdodavatel vytvořen' });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.subject_id) {
      toast({ title: 'Prosím, vyberte subdodavatele.', variant: 'destructive'});
      return;
    }
    
    // eslint-disable-next-line no-unused-vars
    const { createOrder, orderValidity, ...dataToSave } = formData;

    if (!dataToSave.id) {
      dataToSave.id = uuidv4();
    }

    if(createOrder) {
      console.log('Order creation requested with validity:', orderValidity);
      toast({
        title: "Vytvoření objednávky",
        description: "🚧 Tato funkce ještě není implementována. O její implementaci můžete požádat v dalším promptu! 🚀"
      });
    }
    
    onSave(dataToSave);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{assignedSubcontractor ? 'Upravit' : 'Přiřadit'} subdodavatele k projektu</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="subject_id">Subdodavatel *</Label>
            <div className="flex gap-2">
              <Select
                value={formData.subject_id}
                onValueChange={(value) => handleSelectChange('subject_id', value)}
                required
              >
                <SelectTrigger className="w-full bg-white dark:bg-gray-700">
                  <SelectValue placeholder="Vyberte subdodavatele..." />
                </SelectTrigger>
                <SelectContent>
                  {availableSubcontractors.map((sub) => (
                      <SelectItem key={sub.id} value={sub.id}>
                        {sub.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" onClick={() => setIsSubjectDialogOpen(true)} aria-label="Vytvořit nového subdodavatele">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="scope_of_work">Rozsah práce</Label>
            <Textarea
              id="scope_of_work"
              value={formData.scope_of_work}
              onChange={handleInputChange}
              placeholder="Popište rozsah práce subdodavatele..."
            />
          </div>
          <div>
            <Label htmlFor="price">Cena subdodávky bez DPH (Kč)</Label>
            <p className="mb-1 text-xs text-muted-foreground">Částka vstupuje do nákladů projektu bez DPH.</p>
            <Input
              id="price"
              type="number"
              value={formData.price}
              onChange={handleInputChange}
              placeholder="např. 50000"
            />
          </div>
          <div>
            <Label htmlFor="status">Stav *</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => handleSelectChange('status', value)}
              required
            >
              <SelectTrigger className="w-full bg-white dark:bg-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Poptáno">Poptáno</SelectItem>
                <SelectItem value="Objednáno">Objednáno</SelectItem>
                <SelectItem value="Ve realizaci">Ve realizaci</SelectItem>
                <SelectItem value="Hotovo">Hotovo</SelectItem>
                <SelectItem value="Fakturováno">Fakturováno</SelectItem>
                <SelectItem value="Zrušeno">Zrušeno</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!assignedSubcontractor && (
            <div className="p-4 border rounded-md space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="createOrder" 
                  checked={formData.createOrder}
                  onCheckedChange={handleCheckboxChange}
                />
                <Label htmlFor="createOrder" className="cursor-pointer">Vytvořit objednávku pro subdodavatele</Label>
              </div>
              {formData.createOrder && (
                <div>
                  <Label htmlFor="orderValidity">Platnost objednávky (dny)</Label>
                  <Input
                    id="orderValidity"
                    type="number"
                    min="1"
                    value={formData.orderValidity}
                    onChange={handleInputChange}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Zrušit
            </Button>
            <Button type="submit">
              {assignedSubcontractor ? 'Uložit změny' : 'Přiřadit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <SubjectDialog
        isOpen={isSubjectDialogOpen}
        onClose={() => setIsSubjectDialogOpen(false)}
        onSave={handleQuickSubjectSave}
        defaultSubject={defaultSubcontractorSubject}
      />
    </Dialog>
  );
};

export default AssignSubcontractorDialog;
