import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Server, Search, Loader2, HardDrive, CheckCircle, Clock, ShieldX } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const FileNavigation = () => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('accessed');
  const navigate = useNavigate();

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const response = await axios.get(`${API}/servers`);
      setServers(response.data);
    } catch (error) {
      console.error('Error loading servers:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filtrar por busca
  const filteredServers = servers.filter(server => {
    const search = searchTerm.toLowerCase();
    return (
      server.name.toLowerCase().includes(search) ||
      server.ip.toLowerCase().includes(search)
    );
  });

  // Separar por status de acesso
  // Acesso Negado: tem pelo menos 1 share com acesso negado E nenhum item descoberto (diretório/arquivo)
  const accessDeniedServers = filteredServers.filter(
    server => server.access_denied_shares_count > 0 && server.discovered_items_count === 0
  );
  
  // Acessados: tem shares OU downloads OU itens descobertos (excluindo os que estão em "Acesso Negado")
  const accessedServers = filteredServers.filter(
    server => (server.shares_count > 0 || server.downloaded_files_count > 0 || server.discovered_items_count > 0) && 
              !(server.access_denied_shares_count > 0 && server.discovered_items_count === 0)
  );
  
  // Não acessados: nunca teve acesso verificado (sem shares, sem downloads, sem itens E sem tentativas de acesso negado)
  const notAccessedServers = filteredServers.filter(
    server => server.shares_count === 0 && 
              server.downloaded_files_count === 0 && 
              server.discovered_items_count === 0 &&
              server.access_denied_shares_count === 0
  );

  const handleServerClick = (serverId) => {
    navigate(`/servers/${serverId}/browse?from=/files/browse`);
  };

  // Componente de card de servidor (tamanho normal)
  const ServerCard = ({ server }) => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          key={server.id}
          onClick={() => handleServerClick(server.id)}
          className="group cursor-pointer"
          data-testid={`server-card-${server.id}`}
        >
      <div className="h-full p-4 flex flex-col items-center text-center rounded-lg transition-all duration-200 hover:bg-muted/30 group-hover:scale-[1.02]">
        {/* Server Icon */}
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3 group-hover:from-primary/30 group-hover:to-primary/10 transition-all">
          <HardDrive className="w-8 h-8 text-primary" />
        </div>
        
        {/* Server Name */}
        <h3 className="font-semibold text-sm truncate w-full mb-1" title={server.name}>
          {server.name}
        </h3>
        
        {/* Server IP */}
        <p className="text-xs text-muted-foreground font-mono truncate w-full" title={server.ip}>
          {server.ip}
        </p>
        
        {/* Plugin Badge */}
        {(server.plugin_instance_name || server.plugin_type) && (
          <Badge variant="outline" className="mt-2 text-[10px]">
            {server.plugin_instance_name ||
              (server.plugin_type === 'direct_interaction' ? 'SMB' : server.plugin_type)}
          </Badge>
        )}
      </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => handleServerClick(server.id)}>
          Abrir
        </ContextMenuItem>
        <ContextMenuItem onClick={() => window.open(window.location.origin + `/servers/${server.id}/browse?from=/files/browse`, '_blank')}>
          Abrir em nova aba
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  // Componente de card de servidor (tamanho compacto)
  const ServerCardCompact = ({ server, colorClass = 'text-gray-500', bgClass = 'from-gray-500/20 to-gray-500/5' }) => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          key={server.id}
          onClick={() => handleServerClick(server.id)}
          className="group cursor-pointer"
          data-testid={`server-card-compact-${server.id}`}
        >
          <div className="h-full p-2 flex flex-col items-center text-center rounded-lg transition-all duration-200 hover:bg-muted/30 group-hover:scale-[1.02]">
            {/* Server Icon - Menor */}
            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${bgClass} flex items-center justify-center mb-1.5 group-hover:opacity-80 transition-all`}>
              <HardDrive className={`w-4 h-4 ${colorClass}`} />
            </div>

            {/* Server Name */}
            <h3 className={`font-medium text-[11px] truncate w-full mb-0.5 ${colorClass}`} title={server.name}>
              {server.name}
            </h3>

            {/* Server IP */}
            <p className="text-[9px] text-muted-foreground font-mono truncate w-full" title={server.ip}>
              {server.ip}
            </p>

            {/* Plugin Badge - Muito pequeno */}
            {(server.plugin_instance_name || server.plugin_type) && (
              <span className="mt-1 text-[8px] text-muted-foreground/70 truncate w-full">
                {server.plugin_instance_name ||
                  (server.plugin_type === 'direct_interaction' ? 'SMB' : server.plugin_type)}
              </span>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => handleServerClick(server.id)}>
          Abrir
        </ContextMenuItem>
        <ContextMenuItem onClick={() => window.open(window.location.origin + `/servers/${server.id}/browse?from=/files/browse`, '_blank')}>
          Abrir em nova aba
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="file-navigation-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Navegação de Arquivos</h1>
        <p className="text-muted-foreground mt-2">Selecione um servidor para navegar em seus arquivos</p>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 max-w-md"
              data-testid="server-search-input"
            />
          </div>
          {servers.length > 0 && searchTerm && (
            <p className="text-sm text-muted-foreground mt-3">
              {filteredServers.length} encontrado{filteredServers.length !== 1 ? 's' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('accessed')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'accessed' 
                ? 'text-green-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-accessed"
          >
            <CheckCircle className="w-4 h-4" />
            Acessados
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{accessedServers.length}</span>
            {activeTab === 'accessed' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('access-denied')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'access-denied' 
                ? 'text-red-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-access-denied"
          >
            <ShieldX className="w-4 h-4" />
            Acesso Negado
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{accessDeniedServers.length}</span>
            {activeTab === 'access-denied' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('not-accessed')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'not-accessed' 
                ? 'text-green-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-not-accessed"
          >
            <Clock className="w-4 h-4" />
            Não Acessados
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{notAccessedServers.length}</span>
            {activeTab === 'not-accessed' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
            )}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'accessed' && (
        <>
          {accessedServers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  {searchTerm 
                    ? 'Nenhum servidor acessado encontrado com esse filtro' 
                    : 'Nenhum servidor foi acessado ainda'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {accessedServers.map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'access-denied' && (
        <>
          {accessDeniedServers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShieldX className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  {searchTerm 
                    ? 'Nenhum servidor com acesso negado encontrado com esse filtro' 
                    : 'Nenhum servidor com acesso negado'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
              {accessDeniedServers.map((server) => (
                <ServerCardCompact 
                  key={server.id} 
                  server={server} 
                  colorClass="text-red-500"
                  bgClass="from-red-500/20 to-red-500/5"
                />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'not-accessed' && (
        <>
          {notAccessedServers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  {searchTerm 
                    ? 'Nenhum servidor pendente encontrado com esse filtro' 
                    : 'Todos os servidores já foram acessados'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
              {notAccessedServers.map((server) => (
                <ServerCardCompact key={server.id} server={server} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default FileNavigation;
