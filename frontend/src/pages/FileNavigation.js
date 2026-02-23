import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Server, Search, Loader2, HardDrive, Wifi, WifiOff } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const FileNavigation = () => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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

  const filteredServers = servers.filter(server => {
    const search = searchTerm.toLowerCase();
    return (
      server.name.toLowerCase().includes(search) ||
      server.ip.toLowerCase().includes(search)
    );
  });

  const handleServerClick = (serverId) => {
    navigate(`/servers/${serverId}/browse`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="file-navigation-page">
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
          {/* Stats - show count below search when filtering */}
          {servers.length > 0 && searchTerm && (
            <p className="text-sm text-muted-foreground mt-3">
              {filteredServers.length} encontrado{filteredServers.length !== 1 ? 's' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Server Grid */}
      {filteredServers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Server className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {searchTerm ? 'Nenhum servidor encontrado com esse filtro' : 'Nenhum servidor cadastrado'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredServers.map((server) => (
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
                
                {/* Plugin Badge - Nome da instância ou tipo */}
                {(server.plugin_instance_name || server.plugin_type) && (
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    {server.plugin_instance_name || 
                      (server.plugin_type === 'direct_interaction' ? 'SMB' : server.plugin_type)}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileNavigation;
