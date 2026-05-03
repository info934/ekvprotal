import { AlertTriangle, Calendar, CheckCircle, Hourglass, XCircle } from 'lucide-react';

const Clock = (props) => <Calendar {...props} />;

export const activityStatusConfig = {
  new: { label: 'Nová', icon: Clock, color: 'text-blue-600', bg: 'bg-blue-100', variant: 'info' },
  in_progress: { label: 'V řešení', icon: Hourglass, color: 'text-orange-600', bg: 'bg-orange-100', variant: 'warning' },
  waiting_for_input: { label: 'Čeká na podklady', icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-100', variant: 'warning' },
  waiting_for_approval: { label: 'Čeká na schválení', icon: CheckCircle, color: 'text-purple-600', bg: 'bg-purple-100', variant: 'secondary' },
  done: { label: 'Hotovo', icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', variant: 'success' },
  rejected: { label: 'Zamítnuto', icon: XCircle, color: 'text-red-600', bg: 'bg-red-100', variant: 'destructive' },
};

export const categoryLabels = {
  all: 'Všechny kategorie',
  dotceny_stavbou: 'Dotčený stavbou',
  doss: 'DOSS',
  vyjadreni_siti: 'Vyjádření existence sítí',
  ostatni: 'Ostatní',
};

export const getActivityStatusConfig = (status) => activityStatusConfig[status] || activityStatusConfig.new;

export const formatEngineeringCategory = (category) => categoryLabels[category] || category || 'Bez kategorie';
