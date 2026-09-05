import React from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import Members from '@/components/Members';
import MemberDetail from '@/components/MemberDetail';
import EmployeeCenter from './EmployeeCenter';

export function EmployeesHome() {
  const { hasPermission, isAdmin } = useAuth();
  const [search] = useSearchParams();
  if (search.get('view') === 'requests' && isAdmin) return <EmployeeCenter allRequests />;
  return hasPermission('members', 'can_read') ? <Members /> : <EmployeeCenter />;
}

export function EmployeeDetailRoute() {
  const { memberId } = useParams();
  const { hasPermission } = useAuth();
  return hasPermission('members', 'can_read') ? <MemberDetail key={memberId} /> : <EmployeeCenter key={memberId} targetId={memberId} />;
}

export function LegacyEmployeeRedirect() {
  const { employeeMemberId } = useParams();
  const { memberId, isAdmin } = useAuth();
  const [search] = useSearchParams();
  const next = new URLSearchParams(search);
  const queue = next.get('scope') === 'all';
  next.delete('scope');
  if (queue && isAdmin) {
    next.set('view', 'requests');
    next.delete('tab');
    return <Navigate replace to={`/members?${next}`} />;
  }
  const target = employeeMemberId || memberId;
  return <Navigate replace to={`${target ? `/members/${target}` : '/members'}${next.size ? `?${next}` : ''}`} />;
}
