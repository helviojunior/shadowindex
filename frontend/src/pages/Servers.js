import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, CheckCircle, XCircle, HardDrive, Download, Network, Pencil, X, Check, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Search, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Função para validar se é um IP válido
const isValidIp = (ip) => {
  if (!ip) return false;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
};

const Servers = () => {
  const navigate = useNavigate();
  const { ignoreCache } = useApp();
  const [servers, setServers] = useState([]);
  const [formData, setFormData] = useState({ name: '', ip: '', plugin_type: 'soap_api', plugin_config: {} });
  const [loading, setLoading] = useState(false);
  const [resolvingIp, setResolvingIp] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [editIp, setEditIp] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [availablePlugins, setAvailablePlugins] = useState({});
  const [soapApiUrl, setSoapApiUrl] = useState('');
  
  // Estados para edição do plugin
  const [editingPluginServer, setEditingPluginServer] = useState(null);
  const [editPluginType, setEditPluginType] = useState('');
  
  // Estados para busca e ordenação
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

  useEffect(() => {
    loadServers();
    loadAvailablePlugins();
    loadSoapApiUrls();
  }, []);

  // Filtrar e ordenar servidores
  const filteredAndSortedServers = useMemo(() => {
    let result = [...servers];
    
    // Filtrar por nome ou IP
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(server => 
        server.name.toLowerCase().includes(term) || 
        server.ip.toLowerCase().includes(term)
      );
    }
    
    // Ordenar
    if (sortConfig.key) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key] || '';
        const bValue = b[sortConfig.key] || '';
        
        if (sortConfig.key === 'ip') {
          // Ordenação especial para IP (numérica)
          const aParts = aValue.split('.').map(Number);
          const bParts = bValue.split('.').map(Number);
          for (let i = 0; i < 4; i++) {
            if (aParts[i] !== bParts[i]) {
              return sortConfig.direction === 'asc' 
                ? aParts[i] - bParts[i] 
                : bParts[i] - aParts[i];
            }
          }
          return 0;
        }
        
        // Ordenação alfabética para outros campos
        const comparison = aValue.localeCompare(bValue, 'pt-BR', { sensitivity: 'base' });
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }
    
    return result;
  }, [servers, searchTerm, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown className="w-4 h-4 ml-1 text-muted-foreground/50" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="w-4 h-4 ml-1 text-primary" />
      : <ArrowDown className="w-4 h-4 ml-1 text-primary" />;
  };

  const loadServers = async () => {
    try {
      const response = await axios.get(`${API}/servers`);
      setServers(response.data);
    } catch (error) {
      console.error('Error loading servers:', error);
      toast.error('Erro ao carregar servidores');
    }
  };

  const loadAvailablePlugins = async () => {
    try {
      const response = await axios.get(`${API}/plugins`);
      setAvailablePlugins(response.data);
    } catch (error) {
      console.error('Error loading plugins:', error);
      // Fallback to known plugins
      setAvailablePlugins({
        soap_api: { type: 'soap_api', name: 'SOAP API Plugin', version: '1.0.0' }
      });
    }
  };

  const loadSoapApiUrls = async () => {
    try {
      const response = await axios.get(`${API}/soap-apis`);
      if (response.data && response.data.length > 0) {
        setSoapApiUrl(response.data[0].uri);
      }
    } catch (error) {
      console.error('Error loading SOAP APIs:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Build plugin config based on plugin type
      let pluginConfig = {};
      if (formData.plugin_type === 'soap_api') {
        pluginConfig = { soap_url: formData.plugin_config.soap_url || soapApiUrl };
      }

      await axios.post(`${API}/servers`, {
        name: formData.name,
        ip: formData.ip,
        plugin_type: formData.plugin_type,
        plugin_config: pluginConfig
      });
      toast.success('Servidor cadastrado com sucesso');
      setFormData({ name: '', ip: '', plugin_type: 'soap_api', plugin_config: {} });
      setShowAddForm(false);
      loadServers();
    } catch (error) {
      console.error('Error creating server:', error);
      toast.error('Erro ao cadastrar servidor');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/servers/${id}`);
      toast.success('Servidor removido com sucesso');
      loadServers();
    } catch (error) {
      console.error('Error deleting server:', error);
      toast.error('Erro ao remover servidor');
    }
  };

  const handleEditIp = (server) => {
    setEditingServer(server.id);
    setEditIp(server.ip);
  };

  const handleCancelEdit = () => {
    setEditingServer(null);
    setEditIp('');
  };

  const handleEditPlugin = (server) => {
    setEditingPluginServer(server.id);
    setEditPluginType(server.plugin_type || 'soap_api');
  };

  const handleCancelPluginEdit = () => {
    setEditingPluginServer(null);
    setEditPluginType('');
  };

  const handleSavePlugin = async (serverId) => {
    if (!editPluginType) {
      toast.error('Selecione um plugin');
      return;
    }

    try {
      await axios.patch(`${API}/servers/${serverId}`, { plugin_type: editPluginType });
      toast.success('Plugin atualizado com sucesso');
      setEditingPluginServer(null);
      setEditPluginType('');
      loadServers();
    } catch (error) {
      console.error('Error updating server plugin:', error);
      toast.error('Erro ao atualizar plugin');
    }
  };

  const handleSaveIp = async (serverId) => {
    if (!editIp.trim()) {
      toast.error('IP não pode estar vazio');
      return;
    }

    if (!isValidIp(editIp.trim())) {
      toast.error('IP inválido. Use o formato: 192.168.1.100');
      return;
    }

    try {
      await axios.patch(`${API}/servers/${serverId}`, { ip: editIp.trim() });
      toast.success('IP atualizado com sucesso');
      setEditingServer(null);
      setEditIp('');
      loadServers();
    } catch (error) {
      console.error('Error updating server IP:', error);
      toast.error('Erro ao atualizar IP');
    }
  };

  const handleResolveIp = async () => {
    if (!formData.name) {
      toast.error('Digite o nome do servidor primeiro');
      return;
    }

    setResolvingIp(true);
    try {
      // Usar endpoint que prioriza IPv4
      const response = await axios.post(`${API}/soap/resolve-ipv4`, {
        operation: 'Resolve',
        s1: formData.name,
        s2: '',
        ignore_cache: ignoreCache
      });

      // O backend já retorna o IPv4 prioritário
      const result = response.data.result;
      
      if (result && result.trim()) {
        const ipAddress = result.trim();
        setFormData({ ...formData, ip: ipAddress });
        toast.success(`IP resolvido: ${ipAddress}`);
      } else {
        toast.error('Nenhum IP encontrado para este hostname');
      }
    } catch (error) {
      console.error('Error resolving IP:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao resolver IP. Verifique o nome do servidor.';
      toast.error(errorMsg);
    } finally {
      setResolvingIp(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Nunca';
    return new Date(dateString).toLocaleString('pt-BR');
  };

  return (
    <div className="space-y-6" data-testid="servers-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Servidores</h1>
          <p className="text-muted-foreground mt-2">Gerencie os servidores monitorados</p>
        </div>
        <Button 
          onClick={() => setShowAddForm(!showAddForm)} 
          data-testid="toggle-add-form-btn"
          variant={showAddForm ? "secondary" : "default"}
        >
          {showAddForm ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              Fechar
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Servidor
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Novo Servidor</CardTitle>
            <CardDescription>Adicione um novo servidor para monitoramento</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome do Servidor</Label>
                  <Input
                    id="name"
                    data-testid="server-name-input"
                    placeholder="servidor.exemplo.com"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ip">Endereço IP</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ip"
                      data-testid="server-ip-input"
                      placeholder="192.168.1.100"
                      value={formData.ip}
                      onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleResolveIp}
                      disabled={resolvingIp || !formData.name}
                      data-testid="resolve-ip-btn"
                    >
                      <Network className="w-4 h-4 mr-2" />
                      {resolvingIp ? 'Resolvendo...' : 'Resolve IP'}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plugin_type">Plugin</Label>
                  <Select 
                    value={formData.plugin_type} 
                    onValueChange={(value) => setFormData({ ...formData, plugin_type: value, plugin_config: {} })}
                  >
                    <SelectTrigger data-testid="server-plugin-select">
                      <SelectValue placeholder="Selecione o plugin" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(availablePlugins).map(([type, info]) => (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            <Plug className="w-4 h-4" />
                            {info.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Plugin-specific configuration */}
              {formData.plugin_type === 'soap_api' && (
                <div className="pt-2 border-t border-border">
                  <div className="space-y-2">
                    <Label htmlFor="soap_url">URL da API SOAP (opcional - usa padrão se vazio)</Label>
                    <Input
                      id="soap_url"
                      data-testid="server-soap-url-input"
                      placeholder={soapApiUrl || "http://servidor/soap/api"}
                      value={formData.plugin_config.soap_url || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        plugin_config: { ...formData.plugin_config, soap_url: e.target.value }
                      })}
                    />
                    {soapApiUrl && (
                      <p className="text-xs text-muted-foreground">
                        URL padrão configurada: {soapApiUrl}
                      </p>
                    )}
                  </div>
                </div>
              )}
              
              <Button type="submit" disabled={loading} data-testid="add-server-btn">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Servidor
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Servers Table Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Servidores Cadastrados</CardTitle>
              <CardDescription>
                {filteredAndSortedServers.length === servers.length 
                  ? `${servers.length} servidores no sistema`
                  : `${filteredAndSortedServers.length} de ${servers.length} servidores`
                }
              </CardDescription>
            </div>
            {/* Campo de busca */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou IP..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="server-search-input"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum servidor cadastrado</p>
          ) : filteredAndSortedServers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum servidor encontrado para "{searchTerm}"</p>
          ) : (
            <div className="overflow-auto max-h-[500px] border rounded-lg">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="border-b border-border">
                    <th 
                      className="text-left p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center">
                        Nome
                        {getSortIcon('name')}
                      </div>
                    </th>
                    <th 
                      className="text-left p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('ip')}
                    >
                      <div className="flex items-center">
                        IP
                        {getSortIcon('ip')}
                      </div>
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">Verificado</th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                      <Plug className="w-4 h-4 inline mr-1" />
                      Plugin
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                      <HardDrive className="w-4 h-4 inline mr-1" />
                      Shares
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                      <Download className="w-4 h-4 inline mr-1" />
                      Downloads
                    </th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Última Verificação</th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedServers.map((server) => (
                    <tr
                      key={server.id}
                      data-testid={`server-item-${server.id}`}
                      className="border-b border-border hover:bg-muted/50 transition-colors"
                    >
                      <td className="p-3">
                        <div 
                          className="font-medium cursor-pointer hover:text-primary transition-colors"
                          onClick={() => navigate(`/servers/${server.id}/browse`)}
                        >
                          {server.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{server.guid.substring(0, 8)}...</div>
                      </td>
                      <td className="p-3">
                        {editingServer === server.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editIp}
                              onChange={(e) => setEditIp(e.target.value)}
                              className="w-36 h-8 text-sm"
                              placeholder="192.168.1.100"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveIp(server.id);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              onClick={() => handleSaveIp(server.id)}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={handleCancelEdit}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <code className="text-sm bg-muted px-2 py-1 rounded">{server.ip}</code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => handleEditIp(server)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {server.verified ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Sim
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="w-3 h-3 mr-1" />
                            Não
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {editingPluginServer === server.id ? (
                          <div className="flex items-center justify-center gap-2">
                            <Select
                              value={editPluginType}
                              onValueChange={setEditPluginType}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs">
                                <SelectValue placeholder="Plugin" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(availablePlugins).map(([type, info]) => (
                                  <SelectItem key={type} value={type}>
                                    {info.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              onClick={() => handleSavePlugin(server.id)}
                            >
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={handleCancelPluginEdit}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <Badge variant="outline" className="text-xs">
                              <Plug className="w-3 h-3 mr-1" />
                              {availablePlugins[server.plugin_type]?.name || server.plugin_type || 'soap_api'}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-muted-foreground hover:text-foreground"
                              onClick={() => handleEditPlugin(server)}
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant="outline">{server.shares_count}</Badge>
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant="outline">{server.downloaded_files_count}</Badge>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {formatDate(server.last_verified_at)}
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(server.id)}
                          data-testid={`delete-server-${server.id}`}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Servers;