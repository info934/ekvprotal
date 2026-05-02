import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Search, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const EngineeringForm = ({ activity, formType, onSave, onCancel, projectId }) => {
  // Determine if this is a "Dotčený stavbou" form.
  // Priority: 
  // 1. If activity exists, check its category.
  // 2. If no activity (create mode), check the requested formType.
  const isDotceny = activity 
    ? activity.category === 'dotceny_stavbou' 
    : formType === 'dotceny';
  
  const defaultFormData = {
    project_id: projectId || '',
    subject: '',
    description: '',
    start_date: '',
    end_date: '',
    status: 'new',
    category: isDotceny ? 'dotceny_stavbou' : 'ostatni',
    dny_na_vyjadreni: null,
    no_document: false,
    is_urgent: false,
  };

  const defaultExtendedData = {
    ico: '',
    address: '',
    phone: '',
    email: '',
    parcels: '',
    relation: 'vlastnik',
    otherRelation: '',
    affectType: 'primo',
    affectDescription: '',
    consentConstruction: null,
    consentEntry: null,
    consentEasement: null,
    notes: ''
  };

  const [formData, setFormData] = useState(defaultFormData);
  const [extendedData, setExtendedData] = useState(defaultExtendedData);
  const [projects, setProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchDropdownData = async () => {
      if (!projectId) {
        const { data: projectsData, error: projectsError } = await supabase.from('projects').select('id, name, code').order('code');
        if (!projectsError) {
          setProjects(projectsData);
          setFilteredProjects(projectsData);
        }
      }
      const { data: subjectsData, error: subjectsError } = await supabase.from('engineering_subjects').select('name').order('name');
      if (!subjectsError) setSubjects(subjectsData.map(s => s.name));
    };
    
    fetchDropdownData();
  }, [projectId]);

  useEffect(() => {
    if(projectSearch.trim() === '') {
        setFilteredProjects(projects);
    } else {
        const lowerCaseSearch = projectSearch.toLowerCase();
        setFilteredProjects(
            projects.filter(p => 
                p.name.toLowerCase().includes(lowerCaseSearch) || 
                (p.code && p.code.toLowerCase().includes(lowerCaseSearch))
            )
        );
    }
  }, [projectSearch, projects]);

  // This effect handles populating the form when an activity is provided (Edit mode)
  useEffect(() => {
    if (activity) {
        // Edit mode: Populate form data from activity
        setFormData({
          project_id: activity.project_id || projectId || '',
          subject: activity.subject || '',
          description: activity.description || '',
          start_date: activity.start_date || '',
          end_date: activity.end_date || '',
          status: activity.status || 'new',
          category: activity.category || (isDotceny ? 'dotceny_stavbou' : 'ostatni'),
          dny_na_vyjadreni: activity.dny_na_vyjadreni || null,
          no_document: activity.no_document || false,
          is_urgent: activity.is_urgent || false,
        });
        
        // Populate extended data specifically for "Dotčený stavbou"
        if (activity.form_data) {
            setExtendedData({ ...defaultExtendedData, ...activity.form_data });
        } else {
            setExtendedData(defaultExtendedData);
        }
    } else {
        // Create mode: Reset to defaults based on current formType/isDotceny
        setFormData({
            ...defaultFormData,
            category: isDotceny ? 'dotceny_stavbou' : 'ostatni'
        });
        setExtendedData(defaultExtendedData);
    }
    setFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, isDotceny, projectId]); 

  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.status === 'done' && !file && !activity?.file_url && !formData.no_document) {
        toast({
            title: "Chybí vyjádření",
            description: "Při dokončení činnosti prosím nahrajte soubor s vyjádřením, nebo zaškrtněte, že dokument neexistuje.",
            variant: "destructive",
        });
        return;
    }

    setIsUploading(true);

    const dataToSave = {
        ...formData,
        // Ensure these are null if empty strings
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        dny_na_vyjadreni: formData.dny_na_vyjadreni === '' || formData.dny_na_vyjadreni === null ? null : Number(formData.dny_na_vyjadreni),
        // Save extended data only if it's 'dotceny_stavbou' category. 
        // For general activities, we can either save empty object or keep existing if any (but usually empty is safer to avoid stale data).
        form_data: isDotceny ? extendedData : {}
    };
    
    if (file) {
      const fileName = `${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('engineering-files')
        .upload(fileName, file);

      if (uploadError) {
        toast({ title: 'Chyba při nahrávání souboru', description: uploadError.message, variant: 'destructive' });
        setIsUploading(false);
        return;
      }
      
      const { data: urlData } = supabase.storage.from('engineering-files').getPublicUrl(uploadData.path);
      dataToSave.file_url = urlData.publicUrl;
      dataToSave.file_name = file.name;
    } else if (activity) {
        dataToSave.file_url = activity.file_url;
        dataToSave.file_name = activity.file_name;
    }

    if (dataToSave.subject && !subjects.includes(dataToSave.subject)) {
        await supabase.from('engineering_subjects').insert({ name: dataToSave.subject }).select();
    }
    
    onSave(dataToSave);
    setIsUploading(false);
  };

  const SectionHeader = ({ title }) => (
    <h3 className="text-lg font-semibold border-b pb-2 mt-6 mb-4 text-slate-800">{title}</h3>
  );

  return (
    <Card className="border-l-4 border-l-primary shadow-md mb-6">
      <CardHeader className="pb-4 border-b bg-slate-50 flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-semibold">
          {activity ? 'Upravit činnost' : (isDotceny ? 'Nová: Dotčený stavbou (majetkoprávní)' : 'Nová obecná aktivita')}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* --- Common Fields Section --- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {!projectId && (
               <div className="space-y-2">
                <Label htmlFor="project_id">Projekt *</Label>
                <Select required value={formData.project_id || ''} onValueChange={(value) => setFormData({ ...formData, project_id: value })}>
                    <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Vyberte projekt" />
                    </SelectTrigger>
                    <SelectContent>
                        <div className="p-2">
                          <div className="relative">
                              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input 
                                  placeholder="Hledat projekt..." 
                                  className="pl-8 bg-white"
                                  value={projectSearch} 
                                  onChange={e => setProjectSearch(e.target.value)} 
                              />
                          </div>
                        </div>
                        <div className="max-h-[200px] overflow-y-auto">
                          {filteredProjects.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                          ))}
                        </div>
                    </SelectContent>
                </Select>
              </div>
            )}

            {!isDotceny && (
                <div className="space-y-2">
                <Label htmlFor="category">Kategorie</Label>
                <Select
                    id="category"
                    // Use fallback to 'ostatni' to avoid uncontrolled value warnings
                    value={formData.category || 'ostatni'}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                    <SelectTrigger className="w-full bg-white"><SelectValue/></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="doss">DOSS</SelectItem>
                        <SelectItem value="vyjadreni_siti">Vyjádření existence sítí</SelectItem>
                        <SelectItem value="ostatni">Ostatní</SelectItem>
                    </SelectContent>
                </Select>
                </div>
            )}

            <div className="space-y-2">
                <Label htmlFor="subject">{isDotceny ? 'Vlastník / Dotčený subjekt *' : 'Předmět / Subjekt *'}</Label>
                <Input
                id="subject"
                value={formData.subject || ''}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                required
                list="subject-suggestions"
                className="bg-white"
                placeholder={isDotceny ? "Např. Jan Novák, ČEZ Distribuce..." : "Předmět jednání"}
                />
                <datalist id="subject-suggestions">
                    {subjects.map((subject, index) => (
                        <option key={index} value={subject} />
                    ))}
                </datalist>
            </div>

            <div className="space-y-2">
                <Label htmlFor="status">Stav</Label>
                <Select
                    id="status"
                    value={formData.status || 'new'}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                    <SelectTrigger className="w-full bg-white"><SelectValue/></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="new">Nová</SelectItem>
                        <SelectItem value="in_progress">V řešení</SelectItem>
                        <SelectItem value="waiting_for_input">Čeká na podklady</SelectItem>
                        <SelectItem value="waiting_for_approval">Čeká na schválení</SelectItem>
                        <SelectItem value="done">Hotovo</SelectItem>
                        <SelectItem value="rejected">Zamítnuto</SelectItem>
                    </SelectContent>
                </Select>
            </div>
          </div>

          {/* --- Extended Fields for Dotčený stavbou --- */}
          {isDotceny && (
             <div className="space-y-6 border-t pt-4 mt-4 bg-slate-50/50 p-4 rounded-lg">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="ico">IČO</Label>
                        <Input 
                            id="ico" 
                            value={extendedData.ico || ''} 
                            onChange={(e) => setExtendedData({...extendedData, ico: e.target.value})} 
                            placeholder="12345678"
                            className="bg-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="address">Adresa</Label>
                        <Input 
                            id="address" 
                            value={extendedData.address || ''} 
                            onChange={(e) => setExtendedData({...extendedData, address: e.target.value})} 
                            placeholder="Ulice 123, Město"
                            className="bg-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="phone">Telefon</Label>
                        <Input 
                            id="phone" 
                            value={extendedData.phone || ''} 
                            onChange={(e) => setExtendedData({...extendedData, phone: e.target.value})} 
                            placeholder="+420 123 456 789"
                            className="bg-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">E-mail</Label>
                        <Input 
                            id="email" 
                            type="email"
                            value={extendedData.email || ''} 
                            onChange={(e) => setExtendedData({...extendedData, email: e.target.value})} 
                            placeholder="email@example.com"
                            className="bg-white"
                        />
                    </div>
                </div>

                <SectionHeader title="Pozemky a vztah ke stavbě" />
                
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="parcels">Parcelní čísla a k.ú.</Label>
                        <Input 
                            id="parcels" 
                            value={extendedData.parcels || ''} 
                            onChange={(e) => setExtendedData({...extendedData, parcels: e.target.value})} 
                            placeholder="Např. parc. č. 123/1, k.ú. Vinohrady"
                            className="bg-white"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="space-y-2">
                            <Label className="text-base">Vztah k pozemku</Label>
                            <RadioGroup 
                                value={extendedData.relation || 'vlastnik'} 
                                onValueChange={(val) => setExtendedData({...extendedData, relation: val})}
                                className="flex flex-col gap-2"
                            >
                                <div className="flex items-center space-x-2"><RadioGroupItem value="vlastnik" id="vlastnik" /><Label htmlFor="vlastnik" className="font-normal">Vlastník</Label></div>
                                <div className="flex items-center space-x-2"><RadioGroupItem value="spoluvlastnik" id="spoluvlastnik" /><Label htmlFor="spoluvlastnik" className="font-normal">Spoluvlastník</Label></div>
                                <div className="flex items-center space-x-2"><RadioGroupItem value="najemce" id="najemce" /><Label htmlFor="najemce" className="font-normal">Nájemce</Label></div>
                                <div className="flex items-center space-x-2"><RadioGroupItem value="spravce" id="spravce" /><Label htmlFor="spravce" className="font-normal">Správce</Label></div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="jiny" id="jiny" />
                                    <Label htmlFor="jiny" className="font-normal w-16">Jiný:</Label>
                                    <Input 
                                        className="h-8 w-full bg-white" 
                                        disabled={extendedData.relation !== 'jiny'}
                                        value={extendedData.otherRelation || ''}
                                        onChange={(e) => setExtendedData({...extendedData, otherRelation: e.target.value})}
                                    />
                                </div>
                            </RadioGroup>
                        </div>

                         <div className="space-y-2">
                            <Label className="text-base">Typ dotčení</Label>
                            <RadioGroup 
                                value={extendedData.affectType || 'primo'} 
                                onValueChange={(val) => setExtendedData({...extendedData, affectType: val})}
                                className="flex flex-col gap-2"
                            >
                                <div className="flex items-center space-x-2"><RadioGroupItem value="primo" id="primo" /><Label htmlFor="primo" className="font-normal">Přímo dotčený</Label></div>
                                <div className="flex items-center space-x-2"><RadioGroupItem value="neprimo" id="neprimo" /><Label htmlFor="neprimo" className="font-normal">Nepřímo dotčený</Label></div>
                            </RadioGroup>
                        </div>
                    </div>
                </div>
                
                <div className="space-y-2 mt-4">
                    <Label htmlFor="affectDescription">Popis dotčení (pro žádost)</Label>
                    <Textarea
                        id="affectDescription"
                        value={extendedData.affectDescription || ''}
                        onChange={(e) => setExtendedData({ ...extendedData, affectDescription: e.target.value })}
                        className="bg-white min-h-[80px]"
                        placeholder="Specifikace dotčení, např. 'Pozemek sousedí se stavbou na severní straně...'"
                    />
                </div>

                <SectionHeader title="Souhlasy a stanoviska" />
                
                <div className="space-y-4">
                     <div className="space-y-2">
                        <Label>Souhlas se stavbou</Label>
                        <RadioGroup 
                            value={extendedData.consentConstruction || ''} 
                            onValueChange={(val) => setExtendedData({...extendedData, consentConstruction: val})}
                            className="flex gap-6"
                        >
                            <div className="flex items-center space-x-2"><RadioGroupItem value="ano" id="cc_ano" /><Label htmlFor="cc_ano">Ano</Label></div>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="ne" id="cc_ne" /><Label htmlFor="cc_ne">Ne</Label></div>
                        </RadioGroup>
                    </div>
                    <div className="space-y-2">
                        <Label>Souhlas se vstupem na pozemek</Label>
                        <RadioGroup 
                            value={extendedData.consentEntry || ''} 
                            onValueChange={(val) => setExtendedData({...extendedData, consentEntry: val})}
                            className="flex gap-6"
                        >
                            <div className="flex items-center space-x-2"><RadioGroupItem value="ano" id="ce_ano" /><Label htmlFor="ce_ano">Ano</Label></div>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="ne" id="ce_ne" /><Label htmlFor="ce_ne">Ne</Label></div>
                        </RadioGroup>
                    </div>
                    <div className="space-y-2">
                        <Label>Souhlas se zřízením věcného břemene</Label>
                        <RadioGroup 
                            value={extendedData.consentEasement || ''} 
                            onValueChange={(val) => setExtendedData({...extendedData, consentEasement: val})}
                            className="flex gap-6"
                        >
                            <div className="flex items-center space-x-2"><RadioGroupItem value="ano" id="cv_ano" /><Label htmlFor="cv_ano">Ano</Label></div>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="ne" id="cv_ne" /><Label htmlFor="cv_ne">Ne</Label></div>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="n/a" id="cv_na" /><Label htmlFor="cv_na">Není relevantní</Label></div>
                        </RadioGroup>
                    </div>
                </div>

                <div className="space-y-2 mt-4">
                    <Label htmlFor="notes">Další podmínky / poznámky</Label>
                    <Textarea
                        id="notes"
                        value={extendedData.notes || ''}
                        onChange={(e) => setExtendedData({ ...extendedData, notes: e.target.value })}
                        className="bg-white min-h-[80px]"
                        placeholder="Zvláštní podmínky vlastníka, termíny, atd..."
                    />
                </div>

             </div>
          )}

          {/* --- Common Fields Continuation --- */}
          
          {!isDotceny && (
              <div className="space-y-2">
                <Label htmlFor="description">Popis činnosti</Label>
                <Textarea
                  id="description"
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Detailní popis aktivity..."
                />
              </div>
          )}
          {isDotceny && (
             <div className="space-y-2">
                <Label htmlFor="description">Poznámka k workflow (interní)</Label>
                <Input
                  id="description"
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="bg-white"
                  placeholder="Např. 'Odesláno poštou', 'Čeká se na podpis'..."
                />
              </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="start_date">Datum zahájení</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date || ''}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">Termín dokončení</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.end_date || ''}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="bg-white"
              />
            </div>
             <div className="space-y-2">
              <Label htmlFor="dny_na_vyjadreni">
                {isDotceny ? 'Lhůta pro vyjádření (dny)' : 'Dní na vyjádření'}
              </Label>
              <Input
                id="dny_na_vyjadreni"
                type="number"
                value={formData.dny_na_vyjadreni || ''}
                onChange={(e) => setFormData({ ...formData, dny_na_vyjadreni: e.target.value })}
                className="bg-white"
                placeholder="30"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="file">Příloha {isDotceny ? '(např. souhlas, smlouva)' : '(vyjádření)'}</Label>
            <Input id="file" type="file" onChange={handleFileChange} className="bg-white"/>
            {activity?.file_name && !file && <p className="text-sm text-muted-foreground mt-1">Stávající soubor: {activity.file_name}</p>}
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="is_urgent"
                checked={formData.is_urgent || false}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_urgent: checked }))}
              />
              <label
                htmlFor="is_urgent"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Urgentní priorita
              </label>
            </div>

            {formData.status === 'done' && (
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="no_document"
                    checked={formData.no_document || false}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, no_document: checked }))}
                  />
                  <label
                    htmlFor="no_document"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Bez dokumentu / Uzavřeno ústně
                  </label>
                </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onCancel}>
              Zrušit
            </Button>
            <Button type="submit" disabled={isUploading}>
              {isUploading ? 'Ukládání...' : (activity ? 'Uložit změny' : 'Vytvořit činnost')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default EngineeringForm;