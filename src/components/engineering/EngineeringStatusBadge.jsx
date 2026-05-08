import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getActivityStatusConfig } from './engineeringConfig';

const EngineeringStatusBadge = ({ status, className, showIcon = true }) => {
  const config = getActivityStatusConfig(status);
  const StatusIcon = config.icon;

  return (
    <Badge variant={config.variant} className={cn('text-xs', className)}>
      {showIcon && <StatusIcon className="w-3 h-3 mr-1" />}
      {config.label}
    </Badge>
  );
};

export default EngineeringStatusBadge;
