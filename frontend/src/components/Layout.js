import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  FileCode,
  Network
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useApp } from '@/contexts/AppContext';

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
    id: 'arquivos',
    icon: FolderTree, 
    label: 'Arquivos',
    children: [
      { id: 'servers', path: '/servers', label: 'Servidores' },
      { id: 'downloads', path: '/downloads', label: 'Downloads' },
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
    id: 'config',
    icon: Settings, 
    label: 'Configuração',
    children: [
      { id: 'proxy', path: '/proxy-servers', label: 'Proxy Servers' },
      { id: 'soap-apis', path: '/soap-apis', label: 'SOAP APIs' },
      { id: 'credentials', path: '/credentials', label: 'Credenciais' },
    ]
  },
  { 
    id: 'tools',
    icon: Wrench, 
    label: 'Tools',
    children: [
      { id: 'soap-ops', path: '/soap-operations', label: 'Operações SOAP' },
    ]
  },
];

// Helper to find active menu and submenu
const findActiveMenu = (pathname) => {
  for (const menu of menuStructure) {
    if (menu.path === pathname) {
      return { menuId: menu.id, subMenuId: null };
    }
    if (menu.children) {
      for (const child of menu.children) {
        if (pathname === child.path || pathname.startsWith(child.path + '/')) {
          return { menuId: menu.id, subMenuId: child.id };
        }
      }
    }
  }
  return { menuId: 'dashboard', subMenuId: null };
};

const Layout = ({ children, darkMode, setDarkMode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });
  const [expandedMenus, setExpandedMenus] = useState({});
  const [hoveredMenu, setHoveredMenu] = useState(null);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const hoverTimeoutRef = useRef(null);
  const location = useLocation();
  const { ignoreCache, setIgnoreCache, offlineMode, setOfflineMode, activeProxy, proxies, loadingProxy, updateActiveProxy } = useApp();

  const { menuId: activeMenuId, subMenuId: activeSubMenuId } = findActiveMenu(location.pathname);

  // Auto-expand active menu when sidebar is expanded
  useEffect(() => {
    if (!sidebarCollapsed && activeMenuId) {
      setExpandedMenus(prev => ({ ...prev, [activeMenuId]: true }));
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

  const handleProxyChange = async (value) => {
    const proxyId = value === 'none' ? null : parseInt(value);
    await updateActiveProxy(proxyId);
  };

  const handleOfflineModeToggle = async () => {
    await setOfflineMode(!offlineMode);
  };

  const toggleMenu = (menuId) => {
    if (!effectiveCollapsed) {
      setExpandedMenus(prev => ({ ...prev, [menuId]: !prev[menuId] }));
    }
  };

  const handleMenuHover = (menuId) => {
    if (effectiveCollapsed) {
      clearTimeout(hoverTimeoutRef.current);
      setHoveredMenu(menuId);
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
          className={cn(
            "flex items-center rounded-md transition-all text-sm relative",
            effectiveCollapsed 
              ? "justify-center p-2.5" 
              : "justify-start gap-2.5 px-3 py-2.5",
            isActive
              ? "bg-primary text-primary-foreground shadow-md"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Icon size={18} />
          {!effectiveCollapsed && (
            <span className="font-medium text-sm">
              {item.label}
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
              {item.label}
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
        onMouseEnter={() => handleMenuHover(item.id)}
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
                {item.label}
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

        {/* Flyout menu when collapsed */}
        {effectiveCollapsed && isHovered && (
          <div 
            className="absolute left-full top-0 ml-2 z-50 min-w-[180px]"
            onMouseEnter={() => handleMenuHover(item.id)}
            onMouseLeave={handleMenuLeave}
          >
            {/* Arrow indicator */}
            <div className="absolute left-0 top-3 -ml-1.5 w-3 h-3 bg-card border-l border-t border-border rotate-[-45deg]" />
            
            <div className="bg-card border border-border rounded-lg shadow-lg py-2 ml-1">
              {/* Header */}
              <div className="px-3 py-2 border-b border-border">
                <span className="font-semibold text-sm">{item.label}</span>
              </div>
              
              {/* Submenu items */}
              {item.children.map((child) => {
                const isChildActive = child.id === activeSubMenuId;
                return (
                  <Link
                    key={child.id}
                    to={child.path}
                    data-testid={`nav-${child.id}`}
                    className={cn(
                      "block px-4 py-2 text-sm transition-colors",
                      isChildActive
                        ? "text-primary bg-primary/5 font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Inline submenu when expanded */}
        {!effectiveCollapsed && isExpanded && (
          <div className="mt-1 space-y-0.5">
            {item.children.map((child) => {
              const isChildActive = child.id === activeSubMenuId;
              return (
                <Link
                  key={child.id}
                  to={child.path}
                  data-testid={`nav-${child.id}`}
                  className={cn(
                    "block pl-10 pr-3 py-2 text-sm rounded-md transition-colors",
                    isChildActive
                      ? "text-primary font-medium bg-primary/10"
                      : "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {child.label}
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
        {/* Top Header - Fixed, spans full width */}
        <header className="flex items-center justify-between bg-card border-b border-border z-50">
          {/* Left side - Logo area (fixed width, centered logo) */}
          <div className={cn(
            "flex items-center justify-center px-4 py-3 border-r border-border transition-all duration-300",
            effectiveCollapsed ? "w-16" : "w-52"
          )}>
            {/* Logo - Always visible in header, centered */}
            {effectiveCollapsed ? (
              <img 
                src="/assets/stratasec_icon.png" 
                alt="Stratasec" 
                className="h-7 w-auto drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <img 
                src="/assets/stratasec_light.png" 
                alt="Stratasec" 
                className="h-7 w-auto drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
              />
            )}
          </div>
          
          {/* Right side - Controls */}
          <div className="flex items-center gap-4 flex-1 justify-end px-6 py-3">
            {/* Seletor de Proxy */}
            <div className="flex items-center gap-2">
              {activeProxy ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-muted-foreground" />
              )}
              <Select
                value={activeProxy?.id?.toString() || 'none'}
                onValueChange={handleProxyChange}
                disabled={loadingProxy}
              >
                <SelectTrigger 
                  className="w-[180px] h-8 text-sm"
                  data-testid="proxy-selector"
                >
                  <SelectValue placeholder="Selecionar Proxy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" data-testid="proxy-option-none">
                    <span className="flex items-center gap-2">
                      <WifiOff className="w-3 h-3" />
                      Sem Proxy
                    </span>
                  </SelectItem>
                  {proxies.map((proxy) => (
                    <SelectItem 
                      key={proxy.id} 
                      value={proxy.id.toString()}
                      data-testid={`proxy-option-${proxy.id}`}
                    >
                      <span className="flex items-center gap-2">
                        <Wifi className="w-3 h-3" />
                        {proxy.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeProxy && (
                <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                  {activeProxy.ip}:{activeProxy.port}
                </Badge>
              )}
            </div>

            {/* Separador */}
            <div className="h-6 w-px bg-border" />

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
                      <span className="text-sm">Offline</span>
                    </>
                  ) : (
                    <>
                      <Wifi className="w-4 h-4" />
                      <span className="text-sm">Online</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{offlineMode ? 'Modo offline ativo - usando apenas cache local' : 'Clique para ativar modo offline'}</p>
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
                Ignorar Cache
              </Label>
              {ignoreCache && !offlineMode && (
                <Badge variant="destructive" className="text-xs">
                  Ativo
                </Badge>
              )}
            </div>
            
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
                "flex-1 space-y-1 overflow-y-auto scrollbar-thin",
                effectiveCollapsed ? "p-2 pt-3" : "p-3"
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
                    <div className="text-[11px]">Ops Integration Desk v1.0.0</div>
                    <div className="mt-0.5 text-[10px]">© StrataSec 2026</div>
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
          <main className="flex-1 overflow-y-auto p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default Layout;
