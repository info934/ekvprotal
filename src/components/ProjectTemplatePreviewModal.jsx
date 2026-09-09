import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Building2, ClipboardList, Layers, Flag, Settings2 } from 'lucide-react';
import { normalizeProjectTemplateData } from '@/lib/projectTemplates';

const ProjectTemplatePreviewModal = ({ isOpen, onClose, templateData }) => {
    if (!templateData) return null;

    const tasks = Array.isArray(templateData.tasks_data) ? templateData.tasks_data : [];
    const phases = Array.isArray(templateData.phases_data) ? templateData.phases_data : [];
    const milestones = Array.isArray(templateData.milestones_data) ? templateData.milestones_data : [];
    const projectData = normalizeProjectTemplateData(templateData.project_data);
    const investor = projectData.subjects?.investor?.name;
    const client = projectData.subjects?.client?.name;
    const hasProjectData = Object.keys(projectData).length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[700px] h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Náhled šablony: {templateData.name}</DialogTitle>
                    <DialogDescription>
                        {templateData.description || 'Tato šablona nemá žádný popis.'}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 pr-4 -mr-4">
                    <div className="space-y-6 py-4">
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2 mb-3 border-b pb-2 text-slate-800">
                                <Settings2 className="w-5 h-5 text-blue-500" />
                                Výchozí údaje projektu
                            </h3>
                            {hasProjectData ? (
                                <dl className="grid gap-3 rounded-md border bg-slate-50 p-3 text-sm sm:grid-cols-2">
                                    <div><dt className="text-xs text-slate-500">Investor</dt><dd className="font-medium text-slate-900">{investor || 'Není nastaven'}</dd></div>
                                    <div><dt className="text-xs text-slate-500">Zadavatel</dt><dd className="font-medium text-slate-900">{client || (projectData.investor_is_client ? investor : null) || 'Není nastaven'}</dd></div>
                                    <div><dt className="text-xs text-slate-500">Druh projektu</dt><dd className="font-medium text-slate-900">{projectData.type || 'Není nastaven'}</dd></div>
                                    <div><dt className="text-xs text-slate-500">Místo</dt><dd className="font-medium text-slate-900">{projectData.location || 'Není nastaveno'}</dd></div>
                                </dl>
                            ) : (
                                <p className="flex items-center gap-2 text-sm italic text-slate-500"><Building2 className="h-4 w-4" />Šablona neobsahuje výchozí údaje projektu.</p>
                            )}
                        </div>

                        {/* Tasks Section */}
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2 mb-3 border-b pb-2 text-slate-800">
                                <ClipboardList className="w-5 h-5 text-blue-500" />
                                Úkoly ({tasks.length})
                            </h3>
                            {tasks.length > 0 ? (
                                <ul className="space-y-2">
                                    {tasks.map((task, idx) => (
                                        <li key={idx} className="bg-slate-50 p-3 rounded-md border text-sm">
                                            <div className="font-medium text-slate-900">{task.name || task.title || 'Nepojmenovaný úkol'}</div>
                                            {task.description && <div className="text-slate-500 mt-1">{task.description}</div>}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-500 italic">Šablona neobsahuje žádné úkoly.</p>
                            )}
                        </div>

                        {/* Phases Section */}
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2 mb-3 border-b pb-2 text-slate-800">
                                <Layers className="w-5 h-5 text-purple-500" />
                                Fáze ({phases.length})
                            </h3>
                            {phases.length > 0 ? (
                                <ul className="space-y-2">
                                    {phases.map((phase, idx) => (
                                        <li key={idx} className="bg-slate-50 p-3 rounded-md border text-sm">
                                            <div className="font-medium text-slate-900">{phase.name || 'Nepojmenovaná fáze'}</div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-500 italic">Šablona neobsahuje žádné fáze.</p>
                            )}
                        </div>

                        {/* Milestones Section */}
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2 mb-3 border-b pb-2 text-slate-800">
                                <Flag className="w-5 h-5 text-green-500" />
                                Milníky ({milestones.length})
                            </h3>
                            {milestones.length > 0 ? (
                                <ul className="space-y-2">
                                    {milestones.map((milestone, idx) => (
                                        <li key={idx} className="bg-slate-50 p-3 rounded-md border text-sm">
                                            <div className="font-medium text-slate-900">{milestone.name || 'Nepojmenovaný milník'}</div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-500 italic">Šablona neobsahuje žádné milníky.</p>
                            )}
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter className="pt-4 mt-auto border-t">
                    <Button type="button" onClick={onClose}>
                        Zavřít
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ProjectTemplatePreviewModal;
