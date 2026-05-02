import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Printer } from 'lucide-react';

const Section = ({ title, children, className = '' }) => (
    <div className={`mb-8 ${className}`}>
        <h3 className="text-lg font-semibold border-b border-primary/50 pb-2 mb-4 text-primary">{title}</h3>
        <div className="space-y-4">{children}</div>
    </div>
);

const EngineeringRequestForm = ({ activity }) => {
    const [formData, setFormData] = useState({
        name: '',
        ico: '',
        address: '',
        phone: '',
        email: '',
        parcels: '',
        relation: '',
        otherRelation: '',
        affectType: '',
        description: '',
        consentConstruction: null,
        consentEntry: null,
        consentEasement: null,
        notes: '',
    });

    useEffect(() => {
        if (activity) {
            const fd = activity.form_data || {};
            setFormData({
                name: activity.subject || '',
                ico: fd.ico || '',
                address: fd.address || '',
                phone: fd.phone || '',
                email: fd.email || '',
                parcels: fd.parcels || '',
                relation: fd.relation || '',
                otherRelation: fd.otherRelation || '',
                affectType: fd.affectType || '',
                // Correctly map 'affectDescription' from DB to 'description' field in this form
                description: fd.affectDescription || '', 
                consentConstruction: fd.consentConstruction || null,
                consentEntry: fd.consentEntry || null,
                consentEasement: fd.consentEasement || null,
                notes: fd.notes || '',
            });
        }
    }, [activity]);

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        const formHtml = document.getElementById('pdf-form-content').innerHTML;
        const styles = Array.from(document.styleSheets)
            .map(styleSheet => {
                try {
                    return Array.from(styleSheet.cssRules)
                        .map(rule => rule.cssText)
                        .join('');
                } catch (e) {
                    return '';
                }
            }).join('');
        
        printWindow.document.write(`
            <html>
                <head>
                    <title>Žádost o vyjádření</title>
                    <style>${styles}</style>
                    <style>
                        @media print { body { -webkit-print-color-adjust: exact; } .no-print { display: none !important; } }
                        body { font-family: 'Inter', sans-serif; }
                    </style>
                </head>
                <body>
                    <div class="p-8">${formHtml}</div>
                    <script>
                        setTimeout(() => {
                            window.print();
                            window.close();
                        }, 250);
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleRadioChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    if (!activity) {
        return null;
    }
    
    // Helper to render radio group values for printing
    const renderRadioValue = (value) => {
      if (value === 'ano') return 'Ano';
      if (value === 'ne') return 'Ne';
      if (value === 'n/a') return 'Není relevantní';
      if (value === 'vlastnik') return 'Vlastník';
      if (value === 'spoluvlastnik') return 'Spoluvlastník';
      if (value === 'najemce') return 'Nájemce';
      if (value === 'spravce') return 'Správce';
      if (value === 'primo') return 'Přímo dotčený';
      if (value === 'neprimo') return 'Nepřímo dotčený';
      if (value === 'jiny' && formData.otherRelation) return `Jiný: ${formData.otherRelation}`;
      return '-';
    };


    return (
        <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Formulář žádosti o vyjádření</h2>
                <Button onClick={handlePrint}>
                    <Printer className="w-4 h-4 mr-2" /> Generovat PDF
                </Button>
            </div>
            
            <div id="pdf-form-content">
                <header className="text-center mb-10 hidden print:block">
                    <h1 className="text-3xl font-bold text-gray-800">Žádost o vyjádření k projektové dokumentaci</h1>
                    <p className="text-muted-foreground mt-2">Projekt: {activity.projects.name} ({activity.projects.code})</p>
                </header>

                <div className="print:hidden">
                    <Section title="1. Identifikace osoby / firmy">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><Label htmlFor="name">Jméno / Název firmy</Label><Input id="name" name="name" value={formData.name} onChange={handleChange} /></div>
                            <div><Label htmlFor="ico">IČO</Label><Input id="ico" name="ico" value={formData.ico} onChange={handleChange} /></div>
                        </div>
                        <div><Label htmlFor="address">Adresa</Label><Input id="address" name="address" value={formData.address} onChange={handleChange} /></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><Label htmlFor="phone">Telefon</Label><Input id="phone" name="phone" value={formData.phone} onChange={handleChange} /></div>
                            <div><Label htmlFor="email">E-mail</Label><Input id="email" name="email" type="email" value={formData.email} onChange={handleChange} /></div>
                        </div>
                    </Section>
                    
                    <Section title="2. Pozemky a vztah ke stavbě">
                        <div><Label htmlFor="parcels">Parcelní čísla a k.ú.</Label><Input id="parcels" name="parcels" value={formData.parcels} onChange={handleChange} /></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <Label>Vztah k pozemku</Label>
                                <RadioGroup name="relation" onValueChange={(v) => handleRadioChange('relation', v)} value={formData.relation} className="mt-2 space-y-2">
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="vlastnik" id="vlastnik" /><Label htmlFor="vlastnik">Vlastník</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="spoluvlastnik" id="spoluvlastnik" /><Label htmlFor="spoluvlastnik">Spoluvlastník</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="najemce" id="najemce" /><Label htmlFor="najemce">Nájemce</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="spravce" id="spravce" /><Label htmlFor="spravce">Správce</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="jiny" id="jiny" /><Label htmlFor="jiny">Jiný:</Label> <Input name="otherRelation" value={formData.otherRelation} onChange={handleChange} disabled={formData.relation !== 'jiny'} className="ml-2 h-8"/></div>
                                </RadioGroup>
                            </div>
                            <div>
                                <Label>Typ dotčení</Label>
                                 <RadioGroup name="affectType" onValueChange={(v) => handleRadioChange('affectType', v)} value={formData.affectType} className="mt-2 space-y-2">
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="primo" id="primo" /><Label htmlFor="primo">Přímo dotčený</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="neprimo" id="neprimo" /><Label htmlFor="neprimo">Nepřímo dotčený</Label></div>
                                </RadioGroup>
                            </div>
                        </div>
                    </Section>

                    <Section title="3. Popis dotčení"><Textarea name="description" value={formData.description} onChange={handleChange} placeholder="Např.: Pozemek sousedí se stavbou..." /></Section>
                    <Section title="4. Souhlasy a stanoviska" className="space-y-4">
                         <div><Label>Souhlas se stavbou</Label><RadioGroup name="consentConstruction" onValueChange={(v) => handleRadioChange('consentConstruction', v)} value={formData.consentConstruction} className="flex gap-4 mt-2"><div className="flex items-center space-x-2"><RadioGroupItem value="ano" id="con_yes" /><Label htmlFor="con_yes">Ano</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="ne" id="con_no" /><Label htmlFor="con_no">Ne</Label></div></RadioGroup></div>
                         <div><Label>Souhlas se vstupem na pozemek</Label><RadioGroup name="consentEntry" onValueChange={(v) => handleRadioChange('consentEntry', v)} value={formData.consentEntry} className="flex gap-4 mt-2"><div className="flex items-center space-x-2"><RadioGroupItem value="ano" id="entry_yes" /><Label htmlFor="entry_yes">Ano</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="ne" id="entry_no" /><Label htmlFor="entry_no">Ne</Label></div></RadioGroup></div>
                        <div><Label>Souhlas se zřízením věcného břemene</Label><RadioGroup name="consentEasement" onValueChange={(v) => handleRadioChange('consentEasement', v)} value={formData.consentEasement} className="flex gap-4 mt-2"><div className="flex items-center space-x-2"><RadioGroupItem value="ano" id="ease_yes" /><Label htmlFor="ease_yes">Ano</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="ne" id="ease_no" /><Label htmlFor="ease_no">Ne</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="n/a" id="ease_na" /><Label htmlFor="ease_na">Není relevantní</Label></div></RadioGroup></div>
                    </Section>
                    <Section title="5. Další podmínky / poznámky"><Textarea name="notes" value={formData.notes} onChange={handleChange} /></Section>
                </div>

                {/* Print-only version */}
                <div className="hidden print:block space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-4 border rounded">
                        <div><strong>Jméno/Firma:</strong> {formData.name || '-'}</div>
                        <div><strong>IČO:</strong> {formData.ico || '-'}</div>
                        <div className="col-span-2"><strong>Adresa:</strong> {formData.address || '-'}</div>
                        <div><strong>Telefon:</strong> {formData.phone || '-'}</div>
                        <div><strong>E-mail:</strong> {formData.email || '-'}</div>
                    </div>
                     <div className="p-4 border rounded space-y-2">
                        <div><strong>Parcely:</strong> {formData.parcels || '-'}</div>
                        <div><strong>Vztah k pozemku:</strong> {renderRadioValue(formData.relation)}</div>
                        <div><strong>Typ dotčení:</strong> {renderRadioValue(formData.affectType)}</div>
                    </div>
                    <div className="p-4 border rounded min-h-[5em]"><strong>Popis dotčení:</strong> {formData.description || '-'}</div>
                    <div className="p-4 border rounded grid grid-cols-3 gap-4">
                        <div><strong>Souhlas se stavbou:</strong> {renderRadioValue(formData.consentConstruction)}</div>
                        <div><strong>Souhlas se vstupem:</strong> {renderRadioValue(formData.consentEntry)}</div>
                        <div><strong>Souhlas s věcným břemenem:</strong> {renderRadioValue(formData.consentEasement)}</div>
                    </div>
                    <div className="p-4 border rounded min-h-[5em]"><strong>Další podmínky:</strong> {formData.notes || '-'}</div>
                </div>

                <footer className="mt-16 pt-8 border-t hidden print:block">
                    <div className="grid grid-cols-2 gap-16">
                        <div>
                            <p className="mb-12">V ........................................ dne ....................</p>
                            <div className="border-t border-gray-400 pt-2"><p>Podpis</p></div>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default EngineeringRequestForm;