import React, { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Edit2, Loader2, Plus, Search } from 'lucide-react';
import { fetchJsonWithTimeout } from '@/lib/http';

const emptySubject = {
  name: '',
  subject_kind: 'company',
  birth_date: '',
  ico: '',
  dic: '',
  address: '',
  legal_form: '',
  contact_person: '',
  email: '',
  phone: '',
  note: '',
  type_id: '',
  region: '',
};

const subjectKindLabels = {
  person: 'Fyzicka osoba',
  entrepreneur: 'Podnikatel / OSVC',
  company: 'Firma',
};

const SubjectDialog = ({ isOpen, onClose, onSave, subject }) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState(emptySubject);
  const [subjectTypes, setSubjectTypes] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingAres, setIsFetchingAres] = useState(false);

  useEffect(() => {
    const fetchSubjectTypes = async () => {
      const { data, error } = await supabase.from('subject_types').select('*').order('name');
      if (!error) {
        setSubjectTypes(data || []);
      }
    };

    if (isOpen) fetchSubjectTypes();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fallbackTypeId = subjectTypes[0]?.id || '';
    if (subject) {
      setFormData({
        ...emptySubject,
        ...subject,
        subject_kind: subject.subject_kind || (subject.ico ? 'company' : 'person'),
        birth_date: subject.birth_date || '',
        type_id: subject.type_id || fallbackTypeId,
      });
    } else {
      setFormData({ ...emptySubject, type_id: fallbackTypeId });
    }
  }, [subject, isOpen, subjectTypes]);

  const handleFetchFromAres = async () => {
    if (!formData.ico) {
      toast({ title: 'Zadejte ICO pro vyhledani.', variant: 'destructive' });
      return;
    }
    setIsFetchingAres(true);
    try {
      const data = await fetchJsonWithTimeout(
        `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${formData.ico}`,
        { headers: { accept: 'application/json' } },
        { timeoutMs: 8000 }
      );

      setFormData((current) => ({
        ...current,
        subject_kind: current.subject_kind === 'person' ? 'entrepreneur' : current.subject_kind,
        name: data.obchodniJmeno || current.name,
        dic: data.dic || current.dic,
        address: data.sidlo?.textovaAdresa || current.address,
        legal_form: data.pravniForma ? `Kod ${data.pravniForma}` : current.legal_form,
        region: data.sidlo?.nazevKraje || current.region,
      }));

      toast({ title: 'Data z ARES nactena' });
    } catch (error) {
      const message = error.message === 'Request timeout'
        ? 'Vyprsel casovy limit pro pozadavek na ARES.'
        : error.message;
      toast({ title: 'Chyba pri nacitani z ARES', description: message, variant: 'destructive' });
    } finally {
      setIsFetchingAres(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: 'Doplnte nazev nebo jmeno subjektu.', variant: 'destructive' });
      return;
    }
    if (formData.subject_kind !== 'person' && !formData.ico.trim()) {
      toast({ title: 'U firem a podnikatelu je ICO povinne.', variant: 'destructive' });
      return;
    }

    const payload = {
      ...formData,
      name: formData.name.trim(),
      ico: formData.subject_kind === 'person' ? null : (formData.ico.trim() || null),
      dic: formData.subject_kind === 'person' ? null : (formData.dic.trim() || null),
      birth_date: formData.subject_kind === 'person' ? (formData.birth_date || null) : null,
      type_id: formData.type_id || null,
    };

    setIsSaving(true);
    try {
      await onSave(payload);
    } finally {
      setIsSaving(false);
    }
  };

  const isPerson = formData.subject_kind === 'person';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <FormDialogContent size="lg">
        <FormDialogHeader
          icon={subject ? Edit2 : Plus}
          title={subject ? 'Upravit subjekt' : 'Vytvorit novy subjekt'}
          description="Subjekt muze byt fyzicka osoba, podnikatel nebo firma. Pole se prizpusobi zvolenemu typu."
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <FormDialogBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Druh subjektu</Label>
                <Select value={formData.subject_kind} onValueChange={(value) => handleChange('subject_kind', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(subjectKindLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="type_id">Typ v adresari</Label>
                <Select value={formData.type_id || 'none'} onValueChange={(value) => handleChange('type_id', value === 'none' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte typ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Bez typu</SelectItem>
                    {subjectTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!isPerson && (
              <div className="flex items-end gap-2">
                <div className="flex-grow space-y-2">
                  <Label htmlFor="ico">ICO *</Label>
                  <Input id="ico" value={formData.ico || ''} onChange={(event) => handleChange('ico', event.target.value)} required={!isPerson} disabled={!!subject} />
                </div>
                <Button type="button" onClick={handleFetchFromAres} disabled={isFetchingAres || !!subject} className="min-w-[120px]">
                  {isFetchingAres ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Nacist
                </Button>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{isPerson ? 'Jmeno a prijmeni *' : 'Nazev subjektu *'}</Label>
                <Input id="name" value={formData.name || ''} onChange={(event) => handleChange('name', event.target.value)} required />
              </div>
              {isPerson ? (
                <div className="space-y-2">
                  <Label htmlFor="birth_date">Datum narozeni</Label>
                  <Input id="birth_date" type="date" value={formData.birth_date || ''} onChange={(event) => handleChange('birth_date', event.target.value)} />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="dic">DIC</Label>
                  <Input id="dic" value={formData.dic || ''} onChange={(event) => handleChange('dic', event.target.value)} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Adresa</Label>
              <Input id="address" value={formData.address || ''} onChange={(event) => handleChange('address', event.target.value)} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {!isPerson && (
                <div className="space-y-2">
                  <Label htmlFor="legal_form">Pravni forma</Label>
                  <Input id="legal_form" value={formData.legal_form || ''} onChange={(event) => handleChange('legal_form', event.target.value)} />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="region">Kraj</Label>
                <Input id="region" value={formData.region || ''} onChange={(event) => handleChange('region', event.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact_person">Kontaktni osoba</Label>
                <Input id="contact_person" value={formData.contact_person || ''} onChange={(event) => handleChange('contact_person', event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Kontaktni e-mail</Label>
                <Input id="email" type="email" value={formData.email || ''} onChange={(event) => handleChange('email', event.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Kontaktni telefon</Label>
                <Input id="phone" type="tel" value={formData.phone || ''} onChange={(event) => handleChange('phone', event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">Poznamka</Label>
                <Textarea id="note" value={formData.note || ''} onChange={(event) => handleChange('note', event.target.value)} rows={2} />
              </div>
            </div>
          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Zrusit</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ulozit'}
            </Button>
          </FormDialogFooter>
        </form>
      </FormDialogContent>
    </Dialog>
  );
};

export default SubjectDialog;
