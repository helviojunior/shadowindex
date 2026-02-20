import { useState, useEffect } from 'react';
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
  ChevronRight
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

const menuItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/soap-operations', icon: PlayCircle, label: 'Operações SOAP' },
  { path: '/servers', icon: HardDrive, label: 'Servidores' },
  { path: '/credentials', icon: Key, label: 'Credenciais' },
  { path: '/db-connections', icon: Database, label: 'Conexões DB' },
  { path: '/proxy-servers', icon: Server, label: 'Proxy Servers' },
  { path: '/soap-apis', icon: Globe, label: 'SOAP APIs' },
];

const Layout = ({ children, darkMode, setDarkMode }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const location = useLocation();
  const { ignoreCache, setIgnoreCache, activeProxy, proxies, loadingProxy, updateActiveProxy } = useApp();

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

  // Em telas pequenas, sempre mostra como colapsado
  const effectiveCollapsed = isSmallScreen || sidebarCollapsed;

  const handleProxyChange = async (value) => {
    const proxyId = value === 'none' ? null : parseInt(value);
    await updateActiveProxy(proxyId);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        {/* Top Header - Fixed, spans full width */}
        <header className="flex items-center justify-between bg-card border-b border-border z-50">
          {/* Left side - Logo area (fixed width, centered logo) */}
          <div className="flex items-center justify-center w-52 px-4 py-3 border-r border-border">
            {/* Logo - Always visible in header, centered */}
            <img 
              src="/assets/stratasec_light.png" 
              alt="Stratasec" 
              className="h-7 w-auto drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
            />
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

            {/* Ignorar Cache Global */}
            <div className="flex items-center gap-2">
              <DatabaseZap className="w-4 h-4 text-muted-foreground" />
              <Switch 
                id="global-ignore-cache" 
                checked={ignoreCache} 
                onCheckedChange={setIgnoreCache}
                data-testid="global-ignore-cache-switch"
              />
              <Label 
                htmlFor="global-ignore-cache" 
                className="text-sm cursor-pointer"
              >
                Ignorar Cache
              </Label>
              {ignoreCache && (
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
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  
                  const linkContent = (
                    <Link
                      key={item.path}
                      to={item.path}
                      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                      className={cn(
                        "flex items-center rounded-md transition-all text-sm",
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

                  // Tooltip when collapsed
                  if (effectiveCollapsed) {
                    return (
                      <Tooltip key={item.path}>
                        <TooltipTrigger asChild>
                          {linkContent}
                        </TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return linkContent;
                })}
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
                
                {/* Collapse/Expand Button - flush to right edge */}
                <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className={cn(
                    "flex items-center justify-center rounded-l-lg",
                    "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors",
                    effectiveCollapsed ? "" : "absolute right-0 bottom-[10px]"
                  )}
                  style={{ height: '45px', width: '35px' }}
                  data-testid="sidebar-collapse-btn"
                >
                  {effectiveCollapsed ? (
                    <ChevronRight size={20} />
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
