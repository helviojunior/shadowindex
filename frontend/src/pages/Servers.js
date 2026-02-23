import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, CheckCircle, XCircle, HardDrive, Download, Network, Pencil, X, Check, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Search, Plug, ShieldAlert, AlertTriangle } from 'lucide-react';
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
  const [formData, setFormData] = useState({ name: '', ip: '', plugin_instance_id: '' });
  const [loading, setLoading] = useState(false);
  const [loadingServers, setLoadingServers] = useState(true);
  const [resolvingIp, setResolvingIp] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [editIp, setEditIp] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [availablePlugins, setAvailablePlugins] = useState({});
  const [pluginInstances, setPluginInstances] = useState([]);
  const [soapApiUrl, setSoapApiUrl] = useState('');
  
  // Estados para edição do plugin
  const [editingPluginServer, setEditingPluginServer] = useState(null);
  const [editPluginInstanceId, setEditPluginInstanceId] = useState('');
  
  // Estados para edição do nome
  const [editingNameServer, setEditingNameServer] = useState(null);
  const [editName, setEditName] = useState('');
  
  // Estados para busca e ordenação
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'last_verified_at', direction: 'desc' });

  useEffect(() => {
    loadServers();
    loadAvailablePlugins();
    loadSoapApiUrls();
    loadPluginInstances();
  }, []);

  const loadPluginInstances = async () => {
    try {
      const response = await axios.get(`${API}/plugin-instances?active_only=true`);
      setPluginInstances(response.data);
    } catch (error) {
      console.error('Error loading plugin instances:', error);
    }
  };

  const getPluginInstanceName = (instanceId) => {
    if (!instanceId) return 'Não configurado';
    const instance = pluginInstances.find(i => i.id === instanceId);
    return instance ? instance.name : `ID: ${instanceId}`;
  };

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
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        if (sortConfig.key === 'ip') {
          // Ordenação especial para IP (numérica)
          const aParts = (aValue || '').split('.').map(Number);
          const bParts = (bValue || '').split('.').map(Number);
          for (let i = 0; i < 4; i++) {
            if (aParts[i] !== bParts[i]) {
              return sortConfig.direction === 'asc' 
                ? aParts[i] - bParts[i] 
                : bParts[i] - aParts[i];
            }
          }
          return 0;
        }
        
        // Ordenação por data (last_verified_at, created_at)
        const dateFields = ['last_verified_at', 'created_at'];
        if (dateFields.includes(sortConfig.key)) {
          const aDate = aValue ? new Date(aValue).getTime() : 0;
          const bDate = bValue ? new Date(bValue).getTime() : 0;
          // NULLs vão para o final
          if (!aValue && bValue) return sortConfig.direction === 'desc' ? 1 : -1;
          if (aValue && !bValue) return sortConfig.direction === 'desc' ? -1 : 1;
          return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
        }
        
        // Ordenação numérica para campos numéricos
        const numericFields = ['shares_count', 'downloaded_files_count', 'leaks_count', 'risk_score'];
        if (numericFields.includes(sortConfig.key)) {
          const aNum = aValue || 0;
          const bNum = bValue || 0;
          return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        
        // Ordenação alfabética para outros campos
        const aStr = aValue || '';
        const bStr = bValue || '';
        const comparison = aStr.localeCompare(bStr, 'pt-BR', { sensitivity: 'base' });
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

  // Renderiza o badge de risco com cor baseada no score
  const getRiskBadge = (riskScore) => {
    if (riskScore === 0) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          0
        </Badge>
      );
    }
    if (riskScore < 30) {
      return (
        <Badge className="bg-green-600 hover:bg-green-700">
          {riskScore}
        </Badge>
      );
    }
    if (riskScore < 60) {
      return (
        <Badge className="bg-yellow-600 hover:bg-yellow-700">
          <AlertTriangle className="w-3 h-3 mr-1" />
          {riskScore}
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-600 hover:bg-red-700">
        <ShieldAlert className="w-3 h-3 mr-1" />
        {riskScore}
      </Badge>
    );
  };

  const loadServers = async () => {
    setLoadingServers(true);
    try {
      const response = await axios.get(`${API}/servers`);
      setServers(response.data);
    } catch (error) {
      console.error('Error loading servers:', error);
      toast.error('Erro ao carregar servidores');
    } finally {
      setLoadingServers(false);
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
      const payload = {
        name: formData.name,
        ip: formData.ip
      };

      // Add plugin_instance_id if selected (not 'none' or empty)
      if (formData.plugin_instance_id && formData.plugin_instance_id !== 'none') {
        payload.plugin_instance_id = parseInt(formData.plugin_instance_id);
      }

      await axios.post(`${API}/servers`, payload);
      toast.success('Servidor cadastrado com sucesso');
      setFormData({ name: '', ip: '', plugin_instance_id: '' });
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

  const handleEditName = (server) => {
    setEditingNameServer(server.id);
    setEditName(server.name);
  };

  const handleCancelNameEdit = () => {
    setEditingNameServer(null);
    setEditName('');
  };

  const handleSaveName = async (serverId) => {
    if (!editName.trim()) {
      toast.error('Nome não pode estar vazio');
      return;
    }

    const server = servers.find(s => s.id === serverId);
    if (editName.trim() === server?.name) {
      handleCancelNameEdit();
      return;
    }

    try {
      await axios.patch(`${API}/servers/${serverId}`, { name: editName.trim() });
      toast.success('Nome atualizado com sucesso');
      setEditingNameServer(null);
      setEditName('');
      loadServers();
    } catch (error) {
      console.error('Error updating server name:', error);
      toast.error('Erro ao atualizar nome');
    }
  };

  const handleEditPlugin = (server) => {
    setEditingPluginServer(server.id);
    setEditPluginInstanceId(server.plugin_instance_id?.toString() || '');
  };

  const handleCancelPluginEdit = () => {
    setEditingPluginServer(null);
    setEditPluginInstanceId('');
  };

  const handleSavePlugin = async (serverId) => {
    try {
      const payload = { 
        plugin_instance_id: editPluginInstanceId ? parseInt(editPluginInstanceId) : null 
      };
      await axios.patch(`${API}/servers/${serverId}`, payload);
      toast.success('Plugin atualizado com sucesso');
      setEditingPluginServer(null);
      setEditPluginInstanceId('');
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
      // Preparar payload com plugin_instance_id se selecionado
      const payload = {
        operation: 'Resolve',
        s1: formData.name,
        s2: '',
        ignore_cache: ignoreCache
      };
      
      // Adicionar plugin_instance_id se uma instância foi selecionada
      if (formData.plugin_instance_id && formData.plugin_instance_id !== 'none') {
        payload.plugin_instance_id = parseInt(formData.plugin_instance_id);
      }
      
      // Usar endpoint que prioriza IPv4
      const response = await axios.post(`${API}/soap/resolve-ipv4`, payload);

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
      
      // Tratamento de erro estruturado
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === 'object') {
          toast.error(detail.message || 'Erro ao resolver IP', {
            description: 'Verifique as configurações do plugin selecionado.'
          });
        } else {
          toast.error(detail);
        }
      } else {
        toast.error('Erro ao resolver IP. Verifique o nome do servidor.');
      }
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
                  <Label htmlFor="plugin_instance">Instância de Plugin</Label>
                  <Select 
                    value={formData.plugin_instance_id || 'none'} 
                    onValueChange={(value) => setFormData({ ...formData, plugin_instance_id: value === 'none' ? '' : value })}
                  >
                    <SelectTrigger data-testid="server-plugin-select">
                      <SelectValue placeholder="Selecione a instância (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <span className="text-muted-foreground">Nenhuma (usar padrão)</span>
                      </SelectItem>
                      {pluginInstances.map((instance) => (
                        <SelectItem key={instance.id} value={instance.id.toString()}>
                          <div className="flex items-center gap-2">
                            <Plug className="w-4 h-4" />
                            {instance.name}
                            <Badge variant="outline" className="text-xs ml-1">
                              {instance.plugin_type === 'soap_api' ? 'SOAP' : 'Direto'}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
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
                    <th 
                      className="text-center p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('risk_score')}
                    >
                      <div className="flex items-center justify-center">
                        <ShieldAlert className="w-4 h-4 mr-1" />
                        Risco
                        {getSortIcon('risk_score')}
                      </div>
                    </th>
                    <th 
                      className="text-center p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('leaks_count')}
                    >
                      <div className="flex items-center justify-center">
                        <AlertTriangle className="w-4 h-4 mr-1" />
                        Leaks
                        {getSortIcon('leaks_count')}
                      </div>
                    </th>
                    <th 
                      className="text-center p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('shares_count')}
                    >
                      <div className="flex items-center justify-center">
                        <HardDrive className="w-4 h-4 mr-1" />
                        Shares
                        {getSortIcon('shares_count')}
                      </div>
                    </th>
                    <th 
                      className="text-center p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('downloaded_files_count')}
                    >
                      <div className="flex items-center justify-center">
                        <Download className="w-4 h-4 mr-1" />
                        Downloads
                        {getSortIcon('downloaded_files_count')}
                      </div>
                    </th>
                    <th 
                      className="text-left p-3 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => handleSort('last_verified_at')}
                    >
                      <div className="flex items-center">
                        Última Verificação
                        {getSortIcon('last_verified_at')}
                      </div>
                    </th>
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
                        {editingNameServer === server.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-48 h-8 text-sm"
                              placeholder="Nome do servidor"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveName(server.id);
                                if (e.key === 'Escape') handleCancelNameEdit();
                              }}
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              onClick={() => handleSaveName(server.id)}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={handleCancelNameEdit}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div>
                              <div 
                                className="font-medium cursor-pointer hover:text-primary transition-colors"
                                onClick={() => navigate(`/servers/${server.id}/browse?from=/servers`)}
                              >
                                {server.name}
                              </div>
                              <div className="text-xs text-muted-foreground">{server.guid.substring(0, 8)}...</div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => handleEditName(server)}
                              title="Editar nome do servidor"
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
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
                              value={editPluginInstanceId || 'none'}
                              onValueChange={(value) => setEditPluginInstanceId(value === 'none' ? '' : value)}
                            >
                              <SelectTrigger className="w-40 h-8 text-xs">
                                <SelectValue placeholder="Instância" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  <span className="text-muted-foreground">Nenhuma</span>
                                </SelectItem>
                                {pluginInstances.map((instance) => (
                                  <SelectItem key={instance.id} value={instance.id.toString()}>
                                    {instance.name}
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
                              {getPluginInstanceName(server.plugin_instance_id)}
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
                        {getRiskBadge(server.risk_score || 0)}
                      </td>
                      <td className="p-3 text-center">
                        {server.leaks_count > 0 ? (
                          <Badge className="bg-red-600 hover:bg-red-700">
                            {server.leaks_count}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            0
                          </Badge>
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