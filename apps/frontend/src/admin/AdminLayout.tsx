import { useState, useRef, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Users, MapPin, ScrollText, Menu, ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAdminConfirm, AdminConfirmProvider } from './components/AdminConfirmDialog';
import { cn } from './lib/utils';

const NAV = [
  { key: 'users', path: '/admin/users', label: 'Users', icon: Users },
  { key: 'sites', path: '/admin/sites', label: 'Sites', icon: MapPin },
  { key: 'audit', path: '/admin/logs', label: 'Audit Log', icon: ScrollText },
];

function AdminLayoutInner() {
  const { user, logout } = useAuth();
  const confirm = useAdminConfirm();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;

  const currentNav = NAV.find((n) => location.pathname.startsWith(n.path)) || NAV[0];
  const initial = (user.fullName || user.username).charAt(0).toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 bg-white">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex-shrink-0 bg-sidebar-bg text-sidebar-foreground flex flex-col sticky top-0 h-screen transition-[width] duration-200',
          collapsed ? 'w-[72px]' : 'w-60'
        )}
      >
        <div className={cn('flex items-center h-[60px] px-4 py-2 border-b border-sidebar-border', collapsed && 'justify-center px-2 py-2')}>
          <img src={`${import.meta.env.BASE_URL}sotaico-logo.png`} alt="PesTrack" className={cn('w-full h-full object-contain transition-all', collapsed && 'object-left')} />
        </div>
        <nav className="p-3 flex flex-col gap-1 flex-1">
          {NAV.map(({ key, path, label, icon: Icon }) => {
            const isActive = location.pathname.startsWith(path);
            return (
              <Link
                key={key}
                to={path}
                title={collapsed ? label : undefined}
                className={cn(
                  'flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-[9px] text-sm font-medium transition-colors whitespace-nowrap',
                  collapsed && 'justify-center',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                )}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col bg-background">
        <header className="h-[60px] bg-card border-b border-border flex items-center justify-between px-5 sticky top-0 z-20 shadow-sm">
          <div className="flex items-center gap-3.5">
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="w-9 h-9 grid place-items-center rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              aria-label="Toggle menu"
            >
              <Menu size={18} />
            </button>
            <h1 className="text-lg font-bold m-0">{currentNav.label}</h1>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <span className="w-[34px] h-[34px] rounded-full bg-primary/10 text-primary grid place-items-center font-bold text-sm shrink-0">
                {initial}
              </span>
              <span className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-[13px] font-semibold text-foreground">{user.fullName || user.username}</span>
                <span className="text-[11px] text-muted-foreground capitalize">{user.role.replace('_', ' ')}</span>
              </span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-60 bg-card border border-border rounded-xl shadow-lg p-2 z-30">
                <div className="flex items-center gap-2.5 p-2.5 border-b border-border mb-1.5">
                  <span className="w-[42px] h-[42px] rounded-full bg-primary/10 text-primary grid place-items-center font-bold shrink-0">
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate text-foreground">{user.fullName || user.username}</div>
                    <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    const ok = await confirm({
                      title: 'Log out?',
                      message: 'You will be signed out of PesTrack.',
                      confirmLabel: 'Log out',
                    });
                    if (ok) logout();
                  }}
                  className="flex items-center gap-2 w-full text-left px-2.5 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={15} /> Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="w-full px-6 py-6 flex-1 min-h-0 flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function AdminLayout() {
  return (
    <AdminConfirmProvider>
      <AdminLayoutInner />
    </AdminConfirmProvider>
  );
}
