import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, Search } from 'lucide-react';
import { fetchJsonWithTimeout } from '@/lib/http';

const SubjectDialog = ({ isOpen, onClose, onSave, subject }) => {
    const { toast } = useToast();
    const [formData, setFormData] = useState({
        name: '',
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
    });
    const [subjectTypes, setSubjectTypes] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingAres, setIsFetchingAres] = useState(false);
    
    useEffect(() => {
        const fetchSubjectTypes = async () => {
            const { data, error } = await supabase.from('subject_types').select('*');
            if (!error) {
                setSubjectTypes(data);
                if (!subject && data.length > 0) {
                  setFormData(prev => ({...prev, type_id: data[0].id}));
                }
            }
        };

        if (isOpen) {
          fetchSubjectTypes();
          if (subject) {
              setFormData({
                  name: subject.name || '',
                  ico: subject.ico || '',
                  dic: subject.dic || '',
                  address: subject.address || '',
                  legal_form: subject.legal_form || '',
                  contact_person: subject.contact_person || '',
                  email: subject.email || '',
                  phone: subject.phone || '',
                  note: subject.note || '',
                  type_id: subject.type_id || (subjectTypes.length > 0 ? subjectTypes[0].id : ''),
                  region: subject.region || '',
              });
          } else {
              setFormData({
                  name: '',
                  ico: '',
                  dic: '',
                  address: '',
                  legal_form: '',
                  contact_person: '',
                  email: '',
                  phone: '',
                  note: '',
                  type_id: subjectTypes.length > 0 ? subjectTypes[0].id : '',
                  region: '',
              });
          }
        }
    }, [subject, isOpen, subjectTypes.length]);

    const handleFetchFromAres = async () => {
        if (!formData.ico) {
            toast({ title: 'Zadejte IČO pro vyhledání.', variant: 'destructive' });
            return;
        }
        setIsFetchingAres(true);
        try {
            const data = await fetchJsonWithTimeout(
                `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${formData.ico}`,
                {
                    headers: { 'accept': 'application/json' }
                },
                { timeoutMs: 8000 }
            );
            
            setFormData(prev => ({
                ...prev,
                name: data.obchodniJmeno || prev.name,
                dic: data.dic || prev.dic,
                address: data.sidlo?.textovaAdresa || prev.address,
                legal_form: data.pravniForma ? `Kód ${data.pravniForma}` : prev.legal_form,
                region: data.sidlo?.nazevKraje || prev.region,
            }));

            toast({ title: '✅ Data z ARES úspěšně načtena!' });

        } catch (error) {
            console.error("ARES fetch error:", error);
            const message = error.message === 'Request timeout' 
                ? 'Vypršel časový limit pro požadavek na ARES.' 
                : error.message;
            toast({ title: 'Chyba při načítání z ARES', description: message, variant: 'destructive' });
        } finally {
            setIsFetchingAres(false);
        }
    };


    const handleChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        await onSave(formData);
        setIsSaving(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{subject ? 'Upravit subjekt' : 'Vytvořit nový subjekt'}</DialogTitle>
                    <DialogDescription>
                        Zadejte informace o subjektu. Pro urychlení můžete načíst data z ARES pomocí IČO.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto p-1 pr-4">
                    <div className="flex items-end gap-2">
                        <div className="flex-grow">
                            <Label htmlFor="ico">IČO *</Label>
                            <Input id="ico" value={formData.ico} onChange={handleChange} required disabled={!!subject}/>
                        </div>
                        <Button type="button" onClick={handleFetchFromAres} disabled={isFetchingAres || !!subject} className="min-w-[120px]">
                            {isFetchingAres ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                            Načíst
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="name">Název subjektu *</Label>
                            <Input id="name" value={formData.name} onChange={handleChange} required />
                        </div>
                        <div>
                            <Label htmlFor="dic">DIČ</Label>
                            <Input id="dic" value={formData.dic} onChange={handleChange} />
                        </div>
                    </div>
                    <div>
                        <Label htmlFor="address">Adresa</Label>
                        <Input id="address" value={formData.address} onChange={handleChange} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <Label htmlFor="type_id">Typ subjektu *</Label>
                            <select
                                id="type_id"
                                value={formData.type_id}
                                onChange={handleChange}
                                className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-700"
                                required
                            >
                                {subjectTypes.map(type => (
                                    <option key={type.id} value={type.id}>{type.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                           <Label htmlFor="region">Kraj</Label>
                           <Input id="region" value={formData.region} onChange={handleChange} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <Label htmlFor="contact_person">Kontaktní osoba</Label>
                            <Input id="contact_person" value={formData.contact_person} onChange={handleChange} />
                        </div>
                        <div>
                            <Label htmlFor="email">Kontaktní e-mail</Label>
                            <Input id="email" type="email" value={formData.email} onChange={handleChange} />
                        </div>
                    </div>
                     <div>
                        <Label htmlFor="phone">Kontaktní telefon</Label>
                        <Input id="phone" type="tel" value={formData.phone} onChange={handleChange} />
                    </div>
                    
                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Uložit'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default SubjectDialog;