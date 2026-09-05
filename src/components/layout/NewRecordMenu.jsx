import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, FolderPlus, HardHat, Clock, Target, ClipboardList } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';

export default function NewRecordMenu() {
  const { hasPermission, memberId } = useAuth();
  const actions = [
    ['projects', 'Nová projekce', '/projects/new', FolderPlus],
    ['realizace', 'Nová realizace', '/realizace/new', HardHat],
    ['attendance', 'Zapsat docházku', '/attendance', Clock],
    ['crm', 'Nový obchodní případ', '/crm/new', Target],
  ].filter(([module]) => hasPermission(module, 'can_edit'));
  if (memberId) actions.push(['employee', 'Zaměstnanecká žádost', '/employee?tab=requests&new=request', ClipboardList]);
  if (!actions.length) return null;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button><Plus size={18} />Nový záznam</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60"><DropdownMenuLabel>Co chcete vytvořit?</DropdownMenuLabel>{actions.map(([module, label, path, Icon]) => <DropdownMenuItem key={module} asChild><Link to={path} className="flex items-center gap-3 py-3"><Icon size={18} />{label}</Link></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}
