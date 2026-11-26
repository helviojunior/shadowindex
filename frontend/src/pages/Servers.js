import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Plus, CheckCircle, XCircle, HardDrive, Download, Network, Pencil, X, Check, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Search, Plug, ShieldAlert, AlertTriangle, Loader2, AlertCircle, Unplug, FolderOpen, Star, CheckCheck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '@/lib/datetime';
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
  const { t } = useTranslation('servers');
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
  
  // Estado para confirmação de IP duplicado
  const [duplicateConfirmDialog, setDuplicateConfirmDialog] = useState({
    open: false,
    existingServer: null
  });

  // Limpeza em lote (inacessíveis / sem tentativa de acesso)
  const [cleanupDialog, setCleanupDialog] = useState({
    open: false,
    loading: false,
    deleting: false,
    unreachable: true,
    neverAccessed: true,
    preview: null
  });

  const openCleanupDialog = async () => {
    setCleanupDialog((d) => ({ ...d, open: true, loading: true, preview: null }));
    try {
      const { data } = await axios.get(`${API}/v2/servers/cleanup/preview`, {
        params: { unreachable: true, never_accessed: true }
      });
      setCleanupDialog((d) => ({ ...d, loading: false, preview: data, unreachable: true, neverAccessed: true }));
    } catch (error) {
      console.error('Error loading cleanup preview:', error);
      toast.error(t('toast.previewError'));
      setCleanupDialog((d) => ({ ...d, open: false, loading: false }));
    }
  };

  const refreshCleanupPreview = async (unreachable, neverAccessed) => {
    setCleanupDialog((d) => ({ ...d, loading: true, unreachable, neverAccessed }));
    try {
      const { data } = await axios.get(`${API}/v2/servers/cleanup/preview`, {
        params: { unreachable, never_accessed: neverAccessed }
      });
      setCleanupDialog((d) => ({ ...d, loading: false, preview: data }));
    } catch (error) {
      console.error('Error loading cleanup preview:', error);
      setCleanupDialog((d) => ({ ...d, loading: false }));
    }
  };

  const handleCleanupConfirm = async () => {
    setCleanupDialog((d) => ({ ...d, deleting: true }));
    try {
      const { data } = await axios.post(`${API}/v2/servers/cleanup`, {
        unreachable: cleanupDialog.unreachable,
        never_accessed: cleanupDialog.neverAccessed
      });
      if (data.deleted > 0) {
        toast.success(t('toast.removed', { count: data.deleted }));
      } else {
        toast.info(t('toast.noneToRemove'));
      }
      if (data.errors && data.errors.length > 0) {
        toast.error(t('toast.removeFailures', { count: data.errors.length }));
      }
      setCleanupDialog((d) => ({ ...d, open: false, deleting: false, preview: null }));
      loadServers();
    } catch (error) {
      console.error('Error during cleanup:', error);
      toast.error(t('toast.removeError'));
      setCleanupDialog((d) => ({ ...d, deleting: false }));
    }
  };

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
    if (!instanceId) return t('table.notConfigured');
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
      toast.error(t('toast.loadError'));
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

  // Função para verificar se existe servidor com mesmo IP
  const checkDuplicateIp = (ip) => {
    return servers.find(server => server.ip === ip);
  };

  // Função para criar o servidor (chamada após confirmação ou se não houver duplicata)
  const createServer = async () => {
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
      toast.success(t('toast.created'));
      setFormData({ name: '', ip: '', plugin_instance_id: '' });
      setShowAddForm(false);
      loadServers();
    } catch (error) {
      console.error('Error creating server:', error);
      toast.error(t('toast.createError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Verificar se já existe servidor com mesmo IP
    const existingServer = checkDuplicateIp(formData.ip);
    
    if (existingServer) {
      // Mostrar dialog de confirmação
      setDuplicateConfirmDialog({
        open: true,
        existingServer
      });
      return;
    }
    
    // Se não houver duplicata, criar diretamente
    await createServer();
  };

  const handleConfirmDuplicate = async () => {
    setDuplicateConfirmDialog({ open: false, existingServer: null });
    await createServer();
  };

  const handleCancelDuplicate = () => {
    setDuplicateConfirmDialog({ open: false, existingServer: null });
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/servers/${id}`);
      toast.success(t('toast.deleted'));
      loadServers();
    } catch (error) {
      console.error('Error deleting server:', error);
      toast.error(t('toast.deleteError'));
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
      toast.error(t('toast.nameEmpty'));
      return;
    }

    const server = servers.find(s => s.id === serverId);
    if (editName.trim() === server?.name) {
      handleCancelNameEdit();
      return;
    }

    try {
      await axios.patch(`${API}/servers/${serverId}`, { name: editName.trim() });
      toast.success(t('toast.nameUpdated'));
      setEditingNameServer(null);
      setEditName('');
      loadServers();
    } catch (error) {
      console.error('Error updating server name:', error);
      toast.error(t('toast.nameUpdateError'));
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
      toast.success(t('toast.pluginUpdated'));
      setEditingPluginServer(null);
      setEditPluginInstanceId('');
      loadServers();
    } catch (error) {
      console.error('Error updating server plugin:', error);
      toast.error(t('toast.pluginUpdateError'));
    }
  };

  const handleSaveIp = async (serverId) => {
    if (!editIp.trim()) {
      toast.error(t('toast.ipEmpty'));
      return;
    }

    if (!isValidIp(editIp.trim())) {
      toast.error(t('toast.ipInvalid'));
      return;
    }

    try {
      await axios.patch(`${API}/servers/${serverId}`, { ip: editIp.trim() });
      toast.success(t('toast.ipUpdated'));
      setEditingServer(null);
      setEditIp('');
      loadServers();
    } catch (error) {
      console.error('Error updating server IP:', error);
      toast.error(t('toast.ipUpdateError'));
    }
  };

  const handleResolveIp = async () => {
    if (!formData.name) {
      toast.error(t('toast.enterNameFirst'));
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
        toast.success(t('toast.ipResolved', { ip: ipAddress }));
      } else {
        toast.error(t('toast.ipNotFound'));
      }
    } catch (error) {
      console.error('Error resolving IP:', error);
      
      // Tratamento de erro estruturado
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === 'object') {
          toast.error(detail.message || t('toast.resolveError'), {
            description: t('toast.resolveErrorDesc')
          });
        } else {
          toast.error(detail);
        }
      } else {
        toast.error(t('toast.resolveErrorCheckName'));
      }
    } finally {
      setResolvingIp(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return t('table.never');
    return new Date(dateString).toLocaleString(dateLocale());
  };

  return (
    <div className="space-y-6" data-testid="servers-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
        <Button
          onClick={openCleanupDialog}
          variant="outline"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          data-testid="cleanup-servers-btn"
        >
          <Unplug className="w-4 h-4 mr-2" />
          {t('cleanup.button')}
        </Button>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          data-testid="toggle-add-form-btn"
          variant={showAddForm ? "secondary" : "default"}
        >
          {showAddForm ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              {t('common:actions.close')}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              {t('addServer')}
            </>
          )}
        </Button>
        </div>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('form.title')}</CardTitle>
            <CardDescription>{t('form.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('form.nameLabel')}</Label>
                  <Input
                    id="name"
                    data-testid="server-name-input"
                    placeholder={t('form.namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ip">{t('form.ipLabel')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ip"
                      data-testid="server-ip-input"
                      placeholder={t('form.ipPlaceholder')}
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
                      {resolvingIp ? t('form.resolving') : t('form.resolveIp')}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plugin_instance">{t('form.pluginLabel')}</Label>
                  <Select 
                    value={formData.plugin_instance_id || 'none'} 
                    onValueChange={(value) => setFormData({ ...formData, plugin_instance_id: value === 'none' ? '' : value })}
                  >
                    <SelectTrigger data-testid="server-plugin-select">
                      <SelectValue placeholder={t('form.pluginPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <span className="text-muted-foreground">{t('form.pluginNone')}</span>
                      </SelectItem>
                      {pluginInstances.map((instance) => (
                        <SelectItem key={instance.id} value={instance.id.toString()}>
                          <div className="flex items-center gap-2">
                            <Plug className="w-4 h-4" />
                            {instance.name}
                            <Badge variant="outline" className="text-xs ml-1">
                              {instance.plugin_type === 'soap_api' ? 'SOAP' : t('pluginType.direct')}
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
                {t('addServer')}
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
              <CardTitle>{t('table.cardTitle')}</CardTitle>
              <CardDescription>
                {filteredAndSortedServers.length === servers.length
                  ? t('table.countAll', { count: servers.length })
                  : t('table.countFiltered', { filtered: filteredAndSortedServers.length, total: servers.length })
                }
              </CardDescription>
            </div>
            {/* Campo de busca */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('table.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="server-search-input"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingServers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : servers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('table.empty')}</p>
          ) : filteredAndSortedServers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('table.noResults', { term: searchTerm })}</p>
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
                        {t('common:fields.name')}
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
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">{t('table.flags')}</th>
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
                        {t('table.risk')}
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
                        {t('common:fields.lastVerification')}
                        {getSortIcon('last_verified_at')}
                      </div>
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">{t('common:fields.actions')}</th>
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
                              placeholder={t('table.editNamePlaceholder')}
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
                              <ContextMenu>
                                <ContextMenuTrigger asChild>
                                  <div
                                    className="font-medium cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => navigate(`/servers/${server.id}/browse?from=/servers`)}
                                  >
                                    {server.name}
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                  <ContextMenuItem onClick={() => window.open(window.location.origin + `/servers/${server.id}/browse?from=/servers`, '_blank')}>
                                    {t('contextMenu.openNewTab')}
                                  </ContextMenuItem>
                                  <ContextMenuItem onClick={() => navigate(`/servers/${server.id}/browse?from=/servers`)}>
                                    {t('common:actions.open')}
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                              <div className="text-xs text-muted-foreground">{server.guid.substring(0, 8)}...</div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => handleEditName(server)}
                              title={t('table.editNameTitle')}
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
                              placeholder={t('form.ipPlaceholder')}
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
                      <td className="p-3">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          <TooltipProvider delayDuration={300}>
                            {server.is_unreachable && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge variant="destructive" className="bg-red-600 px-1.5 py-0.5">
                                    <Unplug className="w-3.5 h-3.5" />
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t('tooltip.unreachable')}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {server.has_no_admin_shares && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge className="bg-amber-600 hover:bg-amber-700 px-1.5 py-0.5">
                                    <FolderOpen className="w-3.5 h-3.5" />
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t('tooltip.openShares')}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {server.favorite && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Star className="w-4 h-4 fill-orange-400 text-orange-400" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t('tooltip.favorite')}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {server.is_checked && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <CheckCheck className="w-4 h-4 text-green-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t('common:status.verified')}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </TooltipProvider>
                          {!server.is_unreachable && !server.has_no_admin_shares && !server.favorite && !server.is_checked && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {editingPluginServer === server.id ? (
                          <div className="flex items-center justify-center gap-2">
                            <Select
                              value={editPluginInstanceId || 'none'}
                              onValueChange={(value) => setEditPluginInstanceId(value === 'none' ? '' : value)}
                            >
                              <SelectTrigger className="w-40 h-8 text-xs">
                                <SelectValue placeholder={t('table.instancePlaceholder')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  <span className="text-muted-foreground">{t('table.instanceNone')}</span>
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

      {/* Dialog de confirmação de IP duplicado */}
      <AlertDialog open={duplicateConfirmDialog.open} onOpenChange={(open) => !open && handleCancelDuplicate()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-500" />
              {t('duplicate.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                {t('duplicate.messagePrefix')} <strong className="text-foreground">{duplicateConfirmDialog.existingServer?.ip}</strong> {t('duplicate.messageMiddle')} <strong className="text-foreground">"{duplicateConfirmDialog.existingServer?.name}"</strong>.
              </p>
              <p>{t('duplicate.confirm')}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDuplicate}>
              {t('common:actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDuplicate} className="bg-yellow-600 hover:bg-yellow-700">
              {t('duplicate.confirmButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cleanup Dialog - remover inacessíveis / sem acesso */}
      <AlertDialog
        open={cleanupDialog.open}
        onOpenChange={(open) => !open && !cleanupDialog.deleting && setCleanupDialog((d) => ({ ...d, open: false }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              {t('cleanup.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              {t('cleanup.descPrefix')} <strong className="text-foreground">downloads</strong> {t('cleanup.descMiddle')} <span className="font-mono">storage_deleted</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={cleanupDialog.unreachable}
                onCheckedChange={(v) => refreshCleanupPreview(!!v, cleanupDialog.neverAccessed)}
              />
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-foreground">{t('cleanup.unreachable')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('cleanup.unreachableDesc')}
                  {cleanupDialog.preview && ` (${cleanupDialog.preview.unreachable})`}
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={cleanupDialog.neverAccessed}
                onCheckedChange={(v) => refreshCleanupPreview(cleanupDialog.unreachable, !!v)}
              />
              <div className="space-y-0.5">
                <div className="text-sm font-medium text-foreground">{t('cleanup.neverAccessed')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('cleanup.neverAccessedDesc')}
                  {cleanupDialog.preview && ` (${cleanupDialog.preview.never_accessed})`}
                </div>
              </div>
            </label>

            <div className="flex items-center gap-2 text-sm bg-muted/50 p-3 rounded-lg">
              {cleanupDialog.loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('cleanup.calculating')}</span>
                </>
              ) : (
                <span>
                  <strong className="text-foreground">{cleanupDialog.preview?.total ?? 0}</strong>{' '}
                  {t('cleanup.willRemoveSuffix')}
                </span>
              )}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupDialog.deleting}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleCleanupConfirm(); }}
              disabled={
                cleanupDialog.deleting ||
                cleanupDialog.loading ||
                !(cleanupDialog.unreachable || cleanupDialog.neverAccessed) ||
                !(cleanupDialog.preview?.total)
              }
              className="bg-destructive hover:bg-destructive/90"
            >
              {cleanupDialog.deleting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('cleanup.removing')}</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-2" /> {t('cleanup.removeCount', { count: cleanupDialog.preview?.total ?? 0 })}</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Servers;