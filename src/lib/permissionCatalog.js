export const PERMISSION_MODULES = [
  { key: 'dashboard', name: 'Přehled' },
  { key: 'projects', name: 'Projekty' },
  { key: 'tasks', name: 'Úkoly' },
  { key: 'attendance', name: 'Docházka' },
  { key: 'documents', name: 'Dokumenty' },
  { key: 'crm', name: 'CRM' },
  { key: 'subjects', name: 'Subjekty' },
  { key: 'engineering', name: 'Inženýring' },
  { key: 'members', name: 'Zaměstnanci' },
  { key: 'payouts', name: 'Výplaty' },
  { key: 'finance', name: 'Finance' },
  { key: 'reports', name: 'Reporty' },
  { key: 'settings', name: 'Nastavení' },
  { key: 'realizace', name: 'Realizace' },
  { key: 'service', name: 'Servis' },
];

export const PERMISSION_LEVELS = [
  { value: 'inherit', label: 'Podle role' },
  { value: 'none', label: 'Bez přístupu' },
  { value: 'read', label: 'Pouze čtení' },
  { value: 'edit', label: 'Čtení a úpravy' },
  { value: 'admin', label: 'Správa' },
];

export const permissionLevelLabel = (level) =>
  PERMISSION_LEVELS.find((item) => item.value === level)?.label || 'Bez přístupu';

