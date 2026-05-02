import React from 'react';
import { Badge } from '@/components/ui/badge';

// Memoized wrapper for Badge to prevent unnecessary re-renders in lists
const MemoBadge = React.memo((props) => {
  return <Badge {...props} />;
});

MemoBadge.displayName = 'MemoBadge';

export { MemoBadge };