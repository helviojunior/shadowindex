import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { 
  LayoutDashboard, 
  Key, 
  Database, 
  Server, 
  Globe, 
  PlayCircle,
  Moon,
  Sun,
  HardDrive,
  DatabaseZap,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FolderTree,
  Download,
  Settings,
  Wrench,
  Radio,
  FileCode,
  Network,
  Plug,
  AlertTriangle,
  RefreshCw,
  X,
  ListTodo,
  GitBranch
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useApp } from '@/contexts/AppContext';
import { useUiSettings } from '@/contexts/UiSettingsContext';
import { useConnectionStatus } from '@/contexts/ConnectionStatusContext';
import { useJobCompletionSFX } from '@/hooks/useJobCompletionSFX';
import GlobalSearch from '@/components/GlobalSearch';
import LanguageSwitcher from '@/components/LanguageSwitcher';

// Menu structure with multi-level support
const menuStructure = [
  { 
    id: 'dashboard',
    path: '/', 
    icon: LayoutDashboard, 
    label: 'Dashboard',
    children: null
  },
  { 
    id: 'servidores',
    icon: Server, 
    label: 'Servidores',
    children: [
      { id: 'servers-list', path: '/servers', label: 'Servidores' },
      { id: 'navigation', path: '/files/browse', label: 'Navegação' },
      { id: 'servers-import', path: '/servers/import', label: 'Importar Servidores' },
      { id: 'share-scan', path: '/servers/share-scan', label: 'Share Scan' },
    ]
  },
  {
    id: 'git',
    icon: GitBranch,
    label: 'GIT',
    children: [
      { id: 'github-search', path: '/git/search', label: 'Github Search' },
      { id: 'git-instances', path: '/git/instances', label: 'Instances' },
      { id: 'git-request', path: '/git/request', label: 'Request Clone' },
      { id: 'github', path: '/git', label: 'Repositórios' },
    ]
  },
  {
    id: 'ad-explorer',
    icon: Network,
    label: 'AD Explorer',
    children: [
      { id: 'ad-domains', path: '/ad', label: 'Domínios' },
    ]
  },
  {
    id: 'arquivos',
    icon: FolderTree,
    label: 'Arquivos',
    children: [
      { id: 'advanced-search', path: '/search', label: 'Search' },
      { id: 'leaks', path: '/leaks', label: 'Leaks' },
    ]
  },
  { 
    id: 'sql',
    icon: Database, 
    label: 'SQL',
    children: [
      { id: 'connections', path: '/sql', label: 'Conexões' },
      { id: 'presets', path: '/sql/presets', label: 'Presets' },
    ]
  },
  { 
    id: 'jobs',
    icon: ListTodo, 
    label: 'Jobs',
    children: [
      { id: 'downloads', path: '/downloads', label: 'Downloads' },
      { id: 'ocr', path: '/ocr', label: 'OCR' },
      { id: 'share-scan-jobs', path: '/jobs/share-scan', label: 'Share Scan' },
      { id: 'git-clone', path: '/jobs/git', label: 'Clones Git' },
    ]
  },
  { 
    id: 'plugins',
    icon: Plug, 
    label: 'Plugins',
    children: [
      { id: 'soap-plugin', path: '/plugins/soap', label: 'SOAP API' },
      { id: 'direct-plugin', path: '/plugins/direct', label: 'Interação Direta' },
    ]
  },
  { 
    id: 'config',
    icon: Settings, 
    label: 'Configuração',
    children: [
      { id: 'general', path: '/settings', label: 'Gerais' },
      { id: 'dns', path: '/settings/dns', label: 'DNS' },
      { id: 'critical-search', path: '/settings/critical-search', label: 'Busca Crítica' },
      { id: 'proxy', path: '/proxy-servers', label: 'Proxy Servers' },
      { id: 'credentials', path: '/credentials', label: 'Credenciais' },
      { id: 'scan-pools', path: '/settings/scan-pools', label: 'Scan Pool' },
    ]
  },
  {
    id: 'audit',
    icon: Radio,
    label: 'Auditoria',
    children: [
      { id: 'external-calls', path: '/audit/external-calls', label: 'Chamadas externas' },
    ]
  },
  {
    id: 'tools',
    icon: Wrench, 
    label: 'Tools',
    children: [
      { id: 'soap-ops', path: '/soap-operations', label: 'Operações SOAP' },
      { id: 'change-domain-password', path: '/tools/change-password', label: 'Change domain password' },
    ]
  },
];

// Helper to find active menu and submenu
// Sorts children by path length (longest first) to ensure most specific match
const findActiveMenu = (pathname) => {
  for (const menu of menuStructure) {
    if (menu.path === pathname) {
      return { menuId: menu.id, subMenuId: null };
    }
    if (menu.children) {
      // Sort children by path length descending to match most specific path first
      const sortedChildren = [...menu.children].sort((a, b) => b.path.length - a.path.length);
      for (const child of sortedChildren) {
        if (pathname === child.path || pathname.startsWith(child.path + '/')) {
          return { menuId: menu.id, subMenuId: child.id };
        }
      }
    }
  }
  return { menuId: 'dashboard', subMenuId: null };
};

// Retorna a cor com transparência (ex: '#34d399' + 0.1 -> 'rgba(...)') para o fundo
// do item ativo. Se não for um hex #rrggbb válido, cai na própria cor.
const colorWithAlpha = (hex, alpha) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const Layout = ({ children, darkMode, setDarkMode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });
  const [expandedMenus, setExpandedMenus] = useState({});
  const [hoveredMenu, setHoveredMenu] = useState(null);
  const [flyoutPosition, setFlyoutPosition] = useState({ top: 0 });
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const hoverTimeoutRef = useRef(null);
  const menuRefs = useRef({});
  const location = useLocation();
  const { t } = useTranslation();
  // Rótulo do menu traduzido pelo id (fallback: label original em português).
  const menuLabel = (it) => t('nav.' + it.id, { defaultValue: it.label });
  const { ignoreCache, setIgnoreCache, offlineMode, setOfflineMode } = useApp();
  const { isConnected, errorMessage, resetConnection } = useConnectionStatus();
  const { logoUrl, logoAlignment, sidebarActiveColor } = useUiSettings();
  
  // Ativar notificações sonoras globais para conclusão de jobs
  useJobCompletionSFX(true);

  // Atalho Ctrl+F para busca global
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handler para tentar reconectar
  const handleRetryConnection = useCallback(async () => {
    setIsRetrying(true);
    try {
      // Testar conexão com o backend
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL || ''}/api/`);
      if (response.ok) {
        resetConnection();
      }
    } catch (error) {
      console.error('Retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  }, [resetConnection]);

  const { menuId: activeMenuId, subMenuId: activeSubMenuId } = findActiveMenu(location.pathname);

  // Auto-expand active menu when sidebar is expanded
  useEffect(() => {
    if (!sidebarCollapsed && activeMenuId) {
      setExpandedMenus({ [activeMenuId]: true });
    }
  }, [activeMenuId, sidebarCollapsed]);

  // Detect small screen
  useEffect(() => {
    const checkScreenSize = () => {
      setIsSmallScreen(window.innerWidth < 1024);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Clear hover state when collapsing
  useEffect(() => {
    if (!sidebarCollapsed) {
      setHoveredMenu(null);
    }
  }, [sidebarCollapsed]);

  const effectiveCollapsed = isSmallScreen || sidebarCollapsed;

  const handleOfflineModeToggle = async () => {
    await setOfflineMode(!offlineMode);
  };

  const toggleMenu = (menuId) => {
    if (!effectiveCollapsed) {
      setExpandedMenus(prev => ({ ...prev, [menuId]: !prev[menuId] }));
    }
  };

  const handleMenuHover = (menuId, event) => {
    if (effectiveCollapsed) {
      clearTimeout(hoverTimeoutRef.current);
      setHoveredMenu(menuId);
      
      // Calculate position for flyout
      if (event && event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        setFlyoutPosition({ top: rect.top });
      }
    }
  };

  const handleMenuLeave = () => {
    if (effectiveCollapsed) {
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredMenu(null);
      }, 150);
    }
  };

  const renderMenuItem = (item) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedMenus[item.id];
    const isActive = item.id === activeMenuId;
    const isHovered = hoveredMenu === item.id;

    // For items without children (like Dashboard)
    if (!hasChildren) {
      const linkContent = (
        <Link
          to={item.path}
          data-testid={`nav-${item.id}`}
          style={isActive ? { color: sidebarActiveColor } : undefined}
          className={cn(
            "flex items-center transition-all text-sm relative",
            effectiveCollapsed
              ? "justify-center p-2.5"
              : "justify-start gap-3 px-4 py-2.5",
            isActive
              ? "font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <Icon size={18} />
          {!effectiveCollapsed && (
            <span className="font-medium text-sm">
              {menuLabel(item)}
            </span>
          )}
        </Link>
      );

      if (effectiveCollapsed) {
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              {linkContent}
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              {menuLabel(item)}
            </TooltipContent>
          </Tooltip>
        );
      }

      return <div key={item.id}>{linkContent}</div>;
    }

    // For items with children
    return (
      <div 
        key={item.id} 
        className="relative"
        onMouseEnter={(e) => handleMenuHover(item.id, e)}
        onMouseLeave={handleMenuLeave}
      >
        {/* Parent menu item */}
        <button
          onClick={() => toggleMenu(item.id)}
          data-testid={`nav-${item.id}`}
          className={cn(
            "w-full flex items-center transition-all text-sm",
            effectiveCollapsed 
              ? "justify-center p-2.5" 
              : "justify-between px-4 py-2.5",
            isActive
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          )}
        >
          <div className="flex items-center gap-3">
            <Icon size={18} />
            {!effectiveCollapsed && (
              <span className="font-medium text-sm">
                {menuLabel(item)}
              </span>
            )}
          </div>
          {!effectiveCollapsed && (
            <ChevronDown 
              size={16} 
              className={cn(
                "transition-transform duration-200",
                isExpanded ? "rotate-180" : ""
              )}
            />
          )}
        </button>

        {/* Flyout menu when collapsed - rendered via Portal */}
        {effectiveCollapsed && isHovered && createPortal(
          <div 
            className="fixed min-w-[180px]"
            style={{ 
              left: '72px',
              top: `${flyoutPosition.top}px`,
              zIndex: 99999
            }}
            onMouseEnter={(e) => handleMenuHover(item.id, e)}
            onMouseLeave={handleMenuLeave}
          >
            {/* Arrow indicator */}
            <div 
              className="absolute left-0 top-3 -ml-1.5 w-3 h-3 bg-popover border-l border-t border-border rotate-[-45deg]" 
              style={{ zIndex: 99999 }}
            />
            
            <div className="bg-popover border border-border rounded-lg shadow-2xl py-2 ml-1">
              {/* Header */}
              <div className="px-3 py-2 border-b border-border">
                <span className="font-semibold text-sm">{menuLabel(item)}</span>
              </div>
              
              {/* Submenu items */}
              {item.children.map((child) => {
                const isChildActive = child.id === activeSubMenuId;
                return (
                  <Link
                    key={child.id}
                    to={child.path}
                    data-testid={`nav-flyout-${child.id}`}
                    style={isChildActive ? { color: sidebarActiveColor, backgroundColor: colorWithAlpha(sidebarActiveColor, 0.1) } : undefined}
                    className={cn(
                      "block px-4 py-2 text-sm transition-colors",
                      isChildActive
                        ? "font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setHoveredMenu(null)}
                  >
                    {menuLabel(child)}
                  </Link>
                );
              })}
            </div>
          </div>,
          document.body
        )}

        {/* Inline submenu when expanded */}
        {!effectiveCollapsed && isExpanded && (
          <div className="space-y-0.5 bg-black/20">
            {item.children.map((child) => {
              const isChildActive = child.id === activeSubMenuId;
              return (
                <Link
                  key={child.id}
                  to={child.path}
                  data-testid={`nav-${child.id}`}
                  style={isChildActive ? { color: sidebarActiveColor } : undefined}
                  className={cn(
                    "block w-full pl-11 pr-4 py-2 text-sm transition-colors",
                    isChildActive
                      ? "font-medium"
                      : "text-muted-foreground/70 hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {menuLabel(child)}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        {/* Connection Error Alert Bar */}
        {!isConnected && (
          <div 
            className="flex items-center justify-between px-4 py-2 bg-red-500/70 text-white z-[60] animate-in slide-in-from-top duration-300"
            data-testid="connection-error-bar"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">
                {errorMessage || 'Falha na comunicação com o backend'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetryConnection}
                disabled={isRetrying}
                className="text-white hover:bg-white/20 h-7 px-3"
                data-testid="retry-connection-btn"
              >
                <RefreshCw className={cn("w-4 h-4 mr-1.5", isRetrying && "animate-spin")} />
                {isRetrying ? 'Tentando...' : 'Tentar novamente'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={resetConnection}
                className="text-white hover:bg-white/20 h-7 w-7"
                data-testid="dismiss-connection-error-btn"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Top Header - Fixed, spans full width */}
        <header className="flex items-center justify-between bg-card border-b border-border z-50">
          {/* Left side - Logo area (fixed width, independent of sidebar) */}
          <div
            className={cn(
              "flex items-center px-4 py-3 border-r border-border w-52",
              logoAlignment === 'center' ? "justify-center"
                : logoAlignment === 'right' ? "justify-end"
                : "justify-start"
            )}
          >
            {/* Logo configurável via Configurações → Gerais → Aparência */}
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo"
                className="h-7 w-auto max-w-full object-contain"
              />
            )}
          </div>
          
          {/* Right side - Controls */}
          <div className="flex items-center gap-4 flex-1 justify-end px-6 py-3">
            {/* Modo Offline Global */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={offlineMode ? "destructive" : "ghost"}
                  size="sm"
                  onClick={handleOfflineModeToggle}
                  className={cn(
                    "flex items-center gap-2",
                    offlineMode && "bg-orange-600 hover:bg-orange-700"
                  )}
                  data-testid="offline-mode-btn"
                >
                  {offlineMode ? (
                    <>
                      <WifiOff className="w-4 h-4" />
                      <span className="text-sm">{t('header.offline')}</span>
                    </>
                  ) : (
                    <>
                      <Wifi className="w-4 h-4" />
                      <span className="text-sm">{t('header.online')}</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{offlineMode ? t('header.offlineTooltipActive') : t('header.offlineTooltipInactive')}</p>
              </TooltipContent>
            </Tooltip>

            {/* Separador */}
            <div className="h-6 w-px bg-border" />

            {/* Ignorar Cache Global */}
            <div className="flex items-center gap-2">
              <DatabaseZap className="w-4 h-4 text-muted-foreground" />
              <Switch 
                id="global-ignore-cache" 
                checked={ignoreCache} 
                onCheckedChange={setIgnoreCache}
                disabled={offlineMode}
                data-testid="global-ignore-cache-switch"
              />
              <Label 
                htmlFor="global-ignore-cache" 
                className={cn("text-sm cursor-pointer", offlineMode && "text-muted-foreground")}
              >
                {t('header.ignoreCache')}
              </Label>
              {ignoreCache && !offlineMode && (
                <Badge variant="destructive" className="text-xs">
                  {t('header.active')}
                </Badge>
              )}
            </div>

            {/* Separador */}
            <div className="h-6 w-px bg-border" />

            {/* Seletor de idioma */}
            <LanguageSwitcher />

            {/* Toggle Dark Mode */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDarkMode(!darkMode)}
              data-testid="theme-toggle-btn"
              className="rounded-full"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </Button>
          </div>
        </header>

        {/* Main container - Sidebar + Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Always visible, collapses on small screens */}
          <aside 
            className={cn(
              "relative bg-card border-r border-border transition-all duration-300 ease-in-out flex-shrink-0",
              effectiveCollapsed ? "w-16" : "w-52"
            )}
          >
            <div className="flex flex-col h-full">
              {/* Menu Items */}
              <nav className={cn(
                "flex-1 space-y-0.5 overflow-y-auto scrollbar-thin pt-2",
                effectiveCollapsed ? "px-2" : "px-0"
              )}>
                {menuStructure.map(renderMenuItem)}
              </nav>

              {/* Footer with collapse toggle - only visible on large screens */}
              <div className={cn(
                "border-t border-border transition-all duration-300 flex items-end relative",
                isSmallScreen ? "hidden" : "flex",
                effectiveCollapsed ? "p-2 justify-center min-h-[60px]" : "p-3 justify-between min-h-[70px]"
              )}>
                {/* Version info - only when expanded */}
                {!effectiveCollapsed && (
                  <div className="text-xs text-muted-foreground">
                    <div className="text-[11px] font-medium">ShadowIndex v1.0.42</div>
                    <div className="text-[10px] text-muted-foreground/60">© M4v3r1ck 2026</div>
                  </div>
                )}
                
                {/* Collapse/Expand Button */}
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className={cn(
                    "flex items-center justify-center transition-all duration-200",
                    effectiveCollapsed 
                      ? "w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover:border-primary/50 shadow-sm"
                      : "absolute right-0 bottom-[10px] w-[35px] h-[45px] rounded-l-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="sidebar-collapse-btn"
                >
                  {effectiveCollapsed ? (
                    <ChevronRight size={18} />
                  ) : (
                    <ChevronLeft size={20} />
                  )}
                </button>
              </div>
            </div>
          </aside>

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto p-6 bg-background relative">
            {children}
            
            {/* Enterprise tagline - subtle fixed card */}
            <div className="fixed bottom-4 left-56 z-10 pointer-events-none transition-all duration-300"
                 style={{ left: effectiveCollapsed ? '5rem' : '14rem' }}>
              <div className="bg-card/40 backdrop-blur-sm border border-border/30 rounded-lg px-3 py-1.5 shadow-sm">
                <p className="text-[10px] text-muted-foreground/70 font-medium tracking-wide">
                  {t('header.tagline')}
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>

      <GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
    </TooltipProvider>
  );
};

export default Layout;
