import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, CheckCircle, XCircle, RefreshCw, Plus, Trash2, ChevronUp,
  Settings, Plug, Globe, Star, StarOff, Power, PowerOff, Pencil, X, Check,
  Wifi, WifiOff
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PluginSoapConfig = () => {
  const [pluginInfo, setPluginInfo] = useState(null);
  const [instances, setInstances] = useState([]);
  const [soapApis, setSoapApis] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('instances');
  
  // Instance form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    config: { soap_url: '' },
    is_default: false,
    proxy_id: null
  });
  
  // Edit states
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  
  // Health check states
  const [healthStatus, setHealthStatus] = useState({});
  const [checkingHealth, setCheckingHealth] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pluginRes, instancesRes, apisRes, proxiesRes] = await Promise.all([
        axios.get(`${API}/plugins/soap_api`),
        axios.get(`${API}/plugin-instances?plugin_type=soap_api`),
        axios.get(`${API}/soap-apis`),
        axios.get(`${API}/proxy-servers`)
      ]);
      setPluginInfo(pluginRes.data);
      setInstances(instancesRes.data);
      setSoapApis(apisRes.data);
      setProxies(proxiesRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const getProxyName = (proxyId) => {
    if (!proxyId) return 'Sem proxy';
    const proxy = proxies.find(p => p.id === proxyId);
    if (!proxy) return `ID: ${proxyId}`;
    return `${proxy.name} (${proxy.ip}:${proxy.port})`;
  };

  // Instance CRUD
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const payload = {
        ...formData,
        plugin_type: 'soap_api',
        config: formData.config || {},
        proxy_id: formData.proxy_id || null
      };

      await axios.post(`${API}/plugin-instances`, payload);
      toast.success('Instância criada com sucesso');
      setFormData({ name: '', description: '', config: { soap_url: '' }, is_default: false, proxy_id: null });
      setShowAddForm(false);
      loadData();
    } catch (error) {
      console.error('Error creating instance:', error);
      toast.error(error.response?.data?.detail || 'Erro ao criar instância');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Tem certeza que deseja excluir esta instância?')) return;
    
    try {
      await axios.delete(`${API}/plugin-instances/${id}`);
      toast.success('Instância excluída com sucesso');
      loadData();
    } catch (error) {
      console.error('Error deleting instance:', error);
      toast.error(error.response?.data?.detail || 'Erro ao excluir instância');
    }
  };

  const startEdit = (instance) => {
    setEditingId(instance.id);
    setEditData({
      name: instance.name,
      description: instance.description || '',
      config: instance.config || { soap_url: '' },
      is_default: instance.is_default,
      is_active: instance.is_active,
      proxy_id: instance.proxy_id
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    try {
      await axios.put(`${API}/plugin-instances/${id}`, editData);
      toast.success('Instância atualizada com sucesso');
      setEditingId(null);
      setEditData({});
      loadData();
    } catch (error) {
      console.error('Error updating instance:', error);
      toast.error('Erro ao atualizar instância');
    }
  };

  const checkHealth = async (id) => {
    setCheckingHealth(prev => ({ ...prev, [id]: true }));
    try {
      const response = await axios.post(`${API}/plugin-instances/${id}/health`);
      setHealthStatus(prev => ({ ...prev, [id]: response.data }));
      if (response.data.healthy) {
        toast.success('Plugin saudável');
      } else {
        toast.error(response.data.message || 'Plugin com problemas');
      }
    } catch (error) {
      console.error('Error checking health:', error);
      setHealthStatus(prev => ({ ...prev, [id]: { healthy: false, message: 'Erro ao verificar' } }));
      toast.error('Erro ao verificar saúde do plugin');
    } finally {
      setCheckingHealth(prev => ({ ...prev, [id]: false }));
    }
  };

  const toggleDefault = async (instance) => {
    try {
      await axios.put(`${API}/plugin-instances/${instance.id}`, { is_default: !instance.is_default });
      toast.success(instance.is_default ? 'Removido como padrão' : 'Definido como padrão');
      loadData();
    } catch (error) {
      console.error('Error toggling default:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const toggleActive = async (instance) => {
    try {
      await axios.put(`${API}/plugin-instances/${instance.id}`, { is_active: !instance.is_active });
      toast.success(instance.is_active ? 'Instância desativada' : 'Instância ativada');
      loadData();
    } catch (error) {
      console.error('Error toggling active:', error);
      toast.error('Erro ao alterar status');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="plugin-soap-config-page">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
              <Globe className="w-6 h-6" />
              SOAP Plugin
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Comunicação via WebService SOAP</p>
          </div>
          {activeTab === 'instances' && (
            <Button 
              onClick={() => setShowAddForm(!showAddForm)} 
              data-testid="toggle-add-instance-btn"
              variant={showAddForm ? "secondary" : "default"}
              size="sm"
            >
              {showAddForm ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-2" />
                  Fechar
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Nova Instância
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs - Flat Style */}
      <div className="px-6 pt-4 border-b border-border">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('instances')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'instances' 
                ? 'text-green-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-instances"
          >
            <Plug className="w-4 h-4" />
            Instâncias
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{instances.length}</span>
            {activeTab === 'instances' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('info')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'info' 
                ? 'text-green-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-info"
          >
            <Settings className="w-4 h-4" />
            Info
            {activeTab === 'info' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
            )}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {/* Tab: Instâncias */}
          {activeTab === 'instances' && (
            <div className="space-y-6">
              {/* Form para nova instância */}
              {showAddForm && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Nova Instância SOAP</CardTitle>
                    <CardDescription>Configure uma nova instância do plugin SOAP</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor="name">Nome da Instância</Label>
                          <Input
                            id="name"
                            data-testid="instance-name-input"
                            placeholder="Produção, Homologação, etc."
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="soap_url">URL do WebService (WSDL)</Label>
                          <Input
                            id="soap_url"
                            data-testid="instance-soap-url-input"
                            type="url"
                            placeholder="https://exemplo.com/api.asmx?WSDL"
                            value={formData.config?.soap_url || ''}
                            onChange={(e) => setFormData({
                              ...formData,
                              config: { ...formData.config, soap_url: e.target.value }
                            })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Wifi className="w-4 h-4" />
                            Proxy
                          </Label>
                          <Select
                            value={formData.proxy_id?.toString() || 'none'}
                            onValueChange={(value) => setFormData({
                              ...formData,
                              proxy_id: value === 'none' ? null : parseInt(value)
                            })}
                          >
                            <SelectTrigger data-testid="instance-proxy-select">
                              <SelectValue placeholder="Selecione um proxy" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                <span className="flex items-center gap-2">
                                  <WifiOff className="w-3 h-3" />
                                  Sem proxy
                                </span>
                              </SelectItem>
                              {proxies.map((proxy) => (
                                <SelectItem key={proxy.id} value={proxy.id.toString()}>
                                  <span className="flex items-center gap-2">
                                    <Wifi className="w-3 h-3" />
                                    {proxy.name} ({proxy.proxy_type?.toUpperCase()})
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">Descrição</Label>
                        <Textarea
                          id="description"
                          data-testid="instance-description-input"
                          placeholder="Descrição opcional da instância"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          rows={2}
                        />
                      </div>
                      <Button type="submit" disabled={formLoading} data-testid="create-instance-btn" size="sm">
                        {formLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                        Criar Instância
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )}

              {/* Lista de Instâncias */}
              {instances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Plug className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Nenhuma instância configurada</p>
                  <p className="text-sm mt-1">Clique em "Nova Instância" para criar</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {instances.map((instance) => {
                    const health = healthStatus[instance.id];
                    const isEditing = editingId === instance.id;
                    
                    return (
                      <div
                        key={instance.id}
                        data-testid={`instance-item-${instance.id}`}
                        className={`p-4 border rounded-lg transition-colors ${
                          instance.is_active ? 'border-border hover:bg-muted/50' : 'border-border/50 bg-muted/30 opacity-60'
                        }`}
                      >
                        {isEditing ? (
                          // Edit mode
                          <div className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                              <div className="space-y-2">
                                <Label>Nome</Label>
                                <Input
                                  value={editData.name}
                                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>URL do WebService</Label>
                                <Input
                                  value={editData.config?.soap_url || ''}
                                  onChange={(e) => setEditData({
                                    ...editData,
                                    config: { ...editData.config, soap_url: e.target.value }
                                  })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Proxy</Label>
                                <Select
                                  value={editData.proxy_id?.toString() || 'none'}
                                  onValueChange={(value) => setEditData({
                                    ...editData,
                                    proxy_id: value === 'none' ? null : parseInt(value)
                                  })}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sem proxy</SelectItem>
                                    {proxies.map((proxy) => (
                                      <SelectItem key={proxy.id} value={proxy.id.toString()}>
                                        {proxy.name} ({proxy.proxy_type?.toUpperCase()})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Descrição</Label>
                              <Textarea
                                value={editData.description}
                                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                                rows={2}
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" size="sm" onClick={() => saveEdit(instance.id)}>
                                <Check className="w-4 h-4 mr-1" /> Salvar
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                                <X className="w-4 h-4 mr-1" /> Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // View mode
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium">{instance.name}</span>
                                {instance.is_default && (
                                  <Badge variant="secondary" className="gap-1 text-xs">
                                    <Star className="w-3 h-3" /> Padrão
                                  </Badge>
                                )}
                                {!instance.is_active && (
                                  <Badge variant="outline" className="text-muted-foreground text-xs">Inativo</Badge>
                                )}
                              </div>
                              {instance.description && (
                                <p className="text-sm text-muted-foreground mb-2">{instance.description}</p>
                              )}
                              {instance.config?.soap_url ? (
                                <div className="text-xs text-muted-foreground font-mono truncate max-w-xl">
                                  URL: {instance.config.soap_url}
                                </div>
                              ) : (
                                <div className="text-xs text-amber-500">
                                  URL não configurada
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                {instance.proxy_id ? (
                                  <><Wifi className="w-3 h-3" /> Proxy: {getProxyName(instance.proxy_id)}</>
                                ) : (
                                  <><WifiOff className="w-3 h-3" /> Sem proxy</>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {/* Health status */}
                              {health && (
                                <Badge variant={health.healthy ? "default" : "destructive"} className="mr-2 text-xs">
                                  {health.healthy ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                                  {health.healthy ? 'OK' : 'Erro'}
                                </Badge>
                              )}
                              
                              {/* Health check */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => checkHealth(instance.id)}
                                disabled={checkingHealth[instance.id]}
                                title="Verificar saúde"
                              >
                                {checkingHealth[instance.id] ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4" />
                                )}
                              </Button>
                              
                              {/* Toggle default */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => toggleDefault(instance)}
                                title={instance.is_default ? "Remover padrão" : "Definir como padrão"}
                              >
                                {instance.is_default ? (
                                  <Star className="w-4 h-4 text-yellow-500" />
                                ) : (
                                  <StarOff className="w-4 h-4" />
                                )}
                              </Button>
                              
                              {/* Toggle active */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => toggleActive(instance)}
                                title={instance.is_active ? "Desativar" : "Ativar"}
                              >
                                {instance.is_active ? (
                                  <Power className="w-4 h-4 text-green-500" />
                                ) : (
                                  <PowerOff className="w-4 h-4" />
                                )}
                              </Button>
                              
                              {/* Edit */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => startEdit(instance)}
                                title="Editar"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              
                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDelete(instance.id)}
                                className="text-destructive hover:text-destructive h-8 w-8"
                                title="Excluir"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab: Info */}
          {activeTab === 'info' && (
            <div className="space-y-6">
              {/* Plugin Info Card */}
              {pluginInfo && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Plug className="w-4 h-4" />
                      Informações do Plugin
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Nome</div>
                        <div className="font-medium text-sm">{pluginInfo.name}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Tipo</div>
                        <Badge variant="outline" className="text-xs">{pluginInfo.type}</Badge>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Versão</div>
                        <div className="font-medium text-sm">{pluginInfo.version}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Descrição</div>
                        <div className="text-sm text-muted-foreground">{pluginInfo.description}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Funcionalidades */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Funcionalidades</CardTitle>
                  <CardDescription>Operações disponíveis via SOAP</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[
                      { name: 'Resolução de Nomes (Resolve)', desc: 'Resolver hostname para endereço IP via WebService' },
                      { name: 'Listagem de Compartilhamentos', desc: 'Listar shares de rede disponíveis no servidor' },
                      { name: 'Navegação de Diretórios', desc: 'Listar arquivos e pastas em um caminho remoto' },
                      { name: 'Download de Arquivos', desc: 'Baixar arquivos remotos via WebService' },
                    ].map((feat, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 border border-border rounded-lg">
                        <div className="flex items-center gap-3">
                          <Globe className="w-4 h-4 text-green-500" />
                          <div>
                            <div className="font-medium text-sm">{feat.name}</div>
                            <div className="text-xs text-muted-foreground">{feat.desc}</div>
                          </div>
                        </div>
                        <Badge variant="default" className="bg-green-500 text-xs">Implementado</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Config Schema Card */}
              {pluginInfo?.config_schema && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">Esquema de Configuração</CardTitle>
                    <CardDescription>Campos disponíveis para configuração de instâncias</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(pluginInfo.config_schema.properties || {}).map(([key, prop]) => (
                        <div key={key} className="flex items-start gap-3 p-3 border border-border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium">{key}</span>
                              {pluginInfo.config_schema.required?.includes(key) && (
                                <Badge variant="destructive" className="text-[10px]">obrigatório</Badge>
                              )}
                              <Badge variant="outline" className="text-[10px]">{prop.type}</Badge>
                            </div>
                            {prop.description && (
                              <div className="text-xs text-muted-foreground mt-1">{prop.description}</div>
                            )}
                          </div>
                          {prop.default !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              default: <span className="font-mono">{String(prop.default)}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default PluginSoapConfig;
