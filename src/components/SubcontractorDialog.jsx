import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, Search, Building, Plus, Edit2, MapPin, Mail, Phone, User, FileText, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        
        if (!formData.name.trim()) {
            toast({
                title: "Chyba",
                description: "Prosím, vyplňte název subjektu.",
                variant: "destructive"
            });
            return;
        }

        if (!formData.ico.trim()) {
            toast({
                title: "Chyba",
                description: "Prosím, vyplňte IČO.",
                variant: "destructive"
            });
            return;
        }

        setIsSaving(true);
        await onSave(formData);
        setIsSaving(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <FormDialogContent size="xl">
                <FormDialogHeader
                    icon={subject ? Edit2 : Plus}
                    title={subject ? 'Upravit subjekt' : 'Nový subjekt'}
                    description="Zadejte informace o subjektu. Pro urychlení můžete načíst data z ARES pomocí IČO."
                />
                
                <form onSubmit={handleSubmit} className="flex-1 overflow-hidden">
                    <Tabs defaultValue="basic" className="h-full flex flex-col">
                        <FormDialogBody className="flex flex-col gap-6">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="basic" className="flex items-center gap-2">
                                <Building className="h-4 w-4" />
                                Základní
                            </TabsTrigger>
                            <TabsTrigger value="contact" className="flex items-center gap-2">
                                <Mail className="h-4 w-4" />
                                Kontakt
                            </TabsTrigger>
                            <TabsTrigger value="details" className="flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                Detaily
                            </TabsTrigger>
                        </TabsList>
                        
                        <div className="min-h-0 flex-1 space-y-6">
                            {/* Basic Information Tab */}
                            <TabsContent value="basic" className="space-y-6">
                                <motion.div 
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-4"
                                >
                                    <div className="flex items-end gap-2">
                                        <div className="flex-grow space-y-2">
                                            <Label htmlFor="ico" className="flex items-center gap-2 text-sm font-medium">
                                                <Building className="h-4 w-4 text-muted-foreground" />
                                                IČO
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input 
                                                id="ico" 
                                                value={formData.ico} 
                                                onChange={handleChange} 
                                                required 
                                                disabled={!!subject}
                                                placeholder="12345678"
                                            />
                                        </div>
                                        <Button 
                                            type="button" 
                                            onClick={handleFetchFromAres} 
                                            disabled={isFetchingAres || !!subject} 
                                            className="min-w-[120px]"
                                            variant="outline"
                                        >
                                            {isFetchingAres ? (
                                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                            ) : (
                                                <Search className="w-4 h-4 mr-2" />
                                            )}
                                            Načíst z ARES
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="name" className="flex items-center gap-2 text-sm font-medium">
                                                <Building className="h-4 w-4 text-muted-foreground" />
                                                Název subjektu
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input 
                                                id="name" 
                                                value={formData.name} 
                                                onChange={handleChange} 
                                                required 
                                                placeholder="Zadejte název subjektu"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="dic" className="flex items-center gap-2 text-sm font-medium">
                                                <FileText className="h-4 w-4 text-muted-foreground" />
                                                DIČ
                                            </Label>
                                            <Input 
                                                id="dic" 
                                                value={formData.dic} 
                                                onChange={handleChange}
                                                placeholder="CZ12345678"
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-2">
                                        <Label htmlFor="address" className="flex items-center gap-2 text-sm font-medium">
                                            <MapPin className="h-4 w-4 text-muted-foreground" />
                                            Adresa
                                        </Label>
                                        <Input 
                                            id="address" 
                                            value={formData.address} 
                                            onChange={handleChange}
                                            placeholder="Ulice, číslo, město, PSČ"
                                        />
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="type_id" className="flex items-center gap-2 text-sm font-medium">
                                                <Building className="h-4 w-4 text-muted-foreground" />
                                                Typ subjektu
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Select
                                                value={formData.type_id}
                                                onValueChange={(value) => setFormData(prev => ({ ...prev, type_id: value }))}
                                                required
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Vyberte typ subjektu" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {subjectTypes.map(type => (
                                                        <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="region" className="flex items-center gap-2 text-sm font-medium">
                                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                                Kraj
                                            </Label>
                                            <Input 
                                                id="region" 
                                                value={formData.region} 
                                                onChange={handleChange}
                                                placeholder="např. Praha"
                                            />
                                        </div>
                                    </div>
                                </motion.div>
                            </TabsContent>

                            {/* Contact Tab */}
                            <TabsContent value="contact" className="space-y-6">
                                <motion.div 
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-4"
                                >
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="contact_person" className="flex items-center gap-2 text-sm font-medium">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                                Kontaktní osoba
                                            </Label>
                                            <Input 
                                                id="contact_person" 
                                                value={formData.contact_person} 
                                                onChange={handleChange}
                                                placeholder="Jméno kontaktní osoby"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="email" className="flex items-center gap-2 text-sm font-medium">
                                                <Mail className="h-4 w-4 text-muted-foreground" />
                                                Kontaktní e-mail
                                            </Label>
                                            <Input 
                                                id="email" 
                                                type="email" 
                                                value={formData.email} 
                                                onChange={handleChange}
                                                placeholder="kontakt@example.com"
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-2">
                                        <Label htmlFor="phone" className="flex items-center gap-2 text-sm font-medium">
                                            <Phone className="h-4 w-4 text-muted-foreground" />
                                            Kontaktní telefon
                                        </Label>
                                        <Input 
                                            id="phone" 
                                            type="tel" 
                                            value={formData.phone} 
                                            onChange={handleChange}
                                            placeholder="+420 123 456 789"
                                        />
                                    </div>
                                </motion.div>
                            </TabsContent>

                            {/* Details Tab */}
                            <TabsContent value="details" className="space-y-6">
                                <motion.div 
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-4"
                                >
                                    <div className="space-y-2">
                                        <Label htmlFor="legal_form" className="flex items-center gap-2 text-sm font-medium">
                                            <FileText className="h-4 w-4 text-muted-foreground" />
                                            Právní forma
                                        </Label>
                                        <Input 
                                            id="legal_form" 
                                            value={formData.legal_form} 
                                            onChange={handleChange}
                                            placeholder="např. s.r.o., a.s."
                                        />
                                    </div>
                                    
                                    <div className="space-y-2">
                                        <Label htmlFor="note" className="flex items-center gap-2 text-sm font-medium">
                                            <FileText className="h-4 w-4 text-muted-foreground" />
                                            Poznámka
                                        </Label>
                                        <Textarea
                                            id="note"
                                            value={formData.note}
                                            onChange={handleChange}
                                            placeholder="Další informace o subjektu..."
                                            rows={4}
                                            className="resize-none"
                                        />
                                    </div>
                                </motion.div>
                            </TabsContent>
                        </div>
                        </FormDialogBody>
                        
                        <FormDialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Zrušit
                            </Button>
                            <Button type="submit" disabled={isSaving} className="min-w-[120px]">
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                        Ukládám...
                                    </>
                                ) : (
                                    'Uložit'
                                )}
                            </Button>
                        </FormDialogFooter>
                    </Tabs>
                </form>
            </FormDialogContent>
        </Dialog>
    );
};

export default SubjectDialog;
