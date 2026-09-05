import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, Search, ChevronRight } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from './GlobalSearch';
import PortalNotifications from './PortalNotifications';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { getPortalSection } from '@/lib/portalNavigation';

export default function PortalShell({ children, searchRecords }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('ekv-sidebar-collapsed') === 'true'; } catch { return false; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const section = getPortalSection(location.pathname);
  useEffect(() => { try { localStorage.setItem('ekv-sidebar-collapsed', String(collapsed)); } catch { /* Storage may be disabled. */ } }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const handler = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(current => !current); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return <div className={`portal-shell${collapsed ? ' nav-collapsed' : ''}`}>
    <a href="#portal-main" className="portal-skip-link">Přejít na obsah</a>
    <div className="portal-desktop-nav"><Sidebar collapsed={collapsed} onCollapse={() => setCollapsed(current => !current)} /></div>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" className="w-[280px] max-w-[90vw] border-0 bg-[#142938] p-0 text-white"><SheetTitle className="sr-only">Navigace portálu</SheetTitle><SheetDescription className="sr-only">Pracovní a obchodní moduly</SheetDescription><Sidebar mobile onNavigate={() => setMobileOpen(false)} /></SheetContent></Sheet>
    <div className="portal-workspace">
      <header className="portal-topbar">
        <button type="button" className="portal-mobile-menu" aria-label="Otevřít menu" onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
        <nav aria-label="Drobečková navigace" className="portal-breadcrumb"><Link to="/">Portál</Link><ChevronRight size={14} aria-hidden="true" />{location.pathname !== section.path ? <><Link to={section.path}>{section.label}</Link><ChevronRight size={14} aria-hidden="true" /><span>Detail</span></> : <span>{section.label}</span>}</nav>
        <button type="button" className="portal-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Hledat v portálu"><Search size={19} /><span>Hledat zakázku, klienta, dokument…</span><kbd>Ctrl K</kbd></button>
        <PortalNotifications />
      </header>
      <main id="portal-main" tabIndex={-1}>{children}</main>
    </div>
    <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} searchRecords={searchRecords} />
  </div>;
}
