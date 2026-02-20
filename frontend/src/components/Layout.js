import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Key, 
  Database, 
  Server, 
  Globe, 
  PlayCircle,
  Menu,
  X,
  Moon,
  Sun,
  HardDrive,
  DatabaseZap,
  Wifi,
  WifiOff
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { ignoreCache, setIgnoreCache } = useApp();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-card border-r border-border transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h1 className="text-xl font-bold text-blue-400">
              Ops Integration
            </h1>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-muted-foreground hover:text-foreground"
              data-testid="close-sidebar-btn"
            >
              <X size={24} />
            </button>
          </div>

          {/* Menu Items */}
          <nav className="flex-1 p-4 space-y-2 overflow-y-auto scrollbar-thin">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon size={20} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-border">
            <div className="text-xs text-muted-foreground text-center">
              v1.0.0 | Ops Integration Desk
            </div>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 bg-card border-b border-border">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
            data-testid="open-sidebar-btn"
          >
            <Menu size={24} />
          </button>
          
          <div className="flex-1" />
          
          {/* Controles à direita */}
          <div className="flex items-center gap-4">
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

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6 bg-background">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;