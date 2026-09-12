import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Bot, Eye, BarChart3, AlertTriangle, MessageSquare, Brain, ShieldCheck, Filter, Sparkles, BookOpen, Activity } from 'lucide-react';
import alfaWolfLogo from '@/assets/alfa-wolf-logo.png';
import { useI18n } from '@/lib/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

const navItems = [
  { to: '/', icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/rc21', icon: ShieldCheck, key: 'nav.rc21' },
  { to: '/filters', icon: Filter, key: 'nav.filters' },
  { to: '/spec', icon: BookOpen, key: 'nav.spec' },
  { to: '/simulator', icon: Sparkles, key: 'nav.simulator' },
  { to: '/models', icon: Bot, key: 'nav.models' },
  { to: '/analysis', icon: Eye, key: 'nav.analysis' },
  { to: '/chat', icon: MessageSquare, key: 'nav.chat' },
  { to: '/benchmark', icon: BarChart3, key: 'nav.benchmark' },
  { to: '/incidents', icon: AlertTriangle, key: 'nav.incidents' },
  { to: '/llm', icon: Brain, key: 'nav.llm' },
  { to: '/diagnostics', icon: Activity, key: 'nav.diagnostics' },
];

export function AppSidebar() {
  const location = useLocation();
  const { t } = useI18n();

  return (
    <aside className="w-64 min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img src={alfaWolfLogo} alt="ALFA" className="w-10 h-10 object-contain" width={512} height={512} />
          <div>
            <h1 className="font-display text-lg font-bold text-primary tracking-wider">ALFA</h1>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Pipeline Control</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, key }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-sidebar-accent text-primary glow-primary border border-primary/10'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(key)}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border space-y-3">
        <LanguageSwitcher />
        <div className="glass rounded-lg p-4">
          <p className="text-[10px] text-muted-foreground font-mono tracking-wide">LASUCH — CERBER — GUARDIAN</p>
          <p className="text-[10px] text-muted-foreground mt-1">{t('sidebar.footer')}</p>
        </div>
      </div>
    </aside>
  );
}
