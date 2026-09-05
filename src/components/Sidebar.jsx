import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LogOut, Eye, EyeOff, Star } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PORTAL_NAVIGATION, SETTINGS_NAV, CRM_NAVIGATION, ALL_PORTAL_NAVIGATION, canNavigate } from '@/lib/portalNavigation';
import { cn } from '@/lib/utils';

export default function Sidebar({ collapsed = false, onCollapse, onNavigate, mobile = false }) {
  const { user, userRole, hasPermission, signOut, isAdmin, isPrivateMode, togglePrivateMode } = useAuth();
  const { pathname } = useLocation();
  const [favorites, setFavorites] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('ekv-sidebar-favorites')); return Array.isArray(saved) ? saved.filter(path => ALL_PORTAL_NAVIGATION.some(item => item.path === path)) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('ekv-sidebar-favorites', JSON.stringify(favorites)); } catch { /* Navigation works without storage. */ } }, [favorites]);
  const toggleFavorite = path => setFavorites(current => current.includes(path) ? current.filter(value => value !== path) : [...current, path]);
  const favoriteItems = favorites.map(path => ALL_PORTAL_NAVIGATION.find(item => item.path === path)).filter(item => item && canNavigate(item, hasPermission));
  const name = user?.user_metadata?.full_name || user?.email || 'Můj účet';
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const renderLink = item => (
    <div key={item.path} className="portal-nav-row"><NavLink to={item.path} end={item.exact} onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => cn('portal-nav-link', isActive && 'is-active')}>
      <item.icon size={20} strokeWidth={1.7} aria-hidden="true" />
      <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
    </NavLink>{!collapsed && <button type="button" className={cn('portal-nav-favorite', favorites.includes(item.path) && 'is-favorite')} onClick={() => toggleFavorite(item.path)} aria-label={`${favorites.includes(item.path) ? 'Odebrat' : 'Přidat'} ${item.label} ${favorites.includes(item.path) ? 'z oblíbených' : 'do oblíbených'}`} aria-pressed={favorites.includes(item.path)}><Star size={14} fill={favorites.includes(item.path) ? 'currentColor' : 'none'} /></button>}</div>
  );
  return (
    <aside className={cn('portal-sidebar', collapsed && 'is-collapsed', mobile && 'is-mobile')} aria-label="Hlavní navigace">
      <NavLink to="/" className="portal-brand" onClick={onNavigate} aria-label="EKV Portal – Moje práce"><strong>EKV</strong>{!collapsed && <span>PORTAL</span>}</NavLink>
      <nav className="portal-nav">{!collapsed && favoriteItems.length > 0 && <div className="portal-nav-group portal-favorites"><p className="portal-nav-label">Oblíbené</p>{favoriteItems.map(renderLink)}</div>}{PORTAL_NAVIGATION.map(group => {
        const items = group.items.filter(item => canNavigate(item, hasPermission));
        return items.length ? <div key={group.label} className="portal-nav-group"><p className={collapsed ? 'sr-only' : 'portal-nav-label'}>{group.label}</p>{items.map(item => <React.Fragment key={item.path}>{renderLink(item)}{item.path === '/crm' && pathname.startsWith('/crm') && !collapsed && <div className="portal-nav-children">{CRM_NAVIGATION.filter(child => canNavigate(child, hasPermission)).map(renderLink)}</div>}</React.Fragment>)}</div> : null;
      })}</nav>
      <div className="portal-sidebar-footer">
        {canNavigate(SETTINGS_NAV, hasPermission) && renderLink(SETTINGS_NAV)}
        <div className="portal-user"><span className="portal-avatar" aria-hidden="true">{initials}</span>{!collapsed && <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{name}</strong><span className="text-xs text-slate-400">{userRole === 'admin' ? 'Administrátor' : 'Pracovní účet'}</span></div>}</div>
        <div className="portal-sidebar-tools">
          <button type="button" onClick={() => togglePrivateMode(!isPrivateMode)} title={isPrivateMode ? 'Zobrazit finanční údaje' : 'Skrýt finanční údaje'} aria-label={isPrivateMode ? 'Zobrazit finanční údaje' : 'Skrýt finanční údaje'} aria-pressed={isPrivateMode}>{isPrivateMode ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <button type="button" onClick={signOut} title="Odhlásit se" aria-label="Odhlásit se"><LogOut size={18} /></button>
          {!mobile && <button type="button" onClick={onCollapse} title={collapsed ? 'Rozbalit navigaci' : 'Sbalit navigaci'} aria-label={collapsed ? 'Rozbalit navigaci' : 'Sbalit navigaci'}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>}
        </div>
      </div>
    </aside>
  );
}
