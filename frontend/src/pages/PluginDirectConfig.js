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
  Settings, Plug, Server, Star, StarOff, Power, PowerOff, Pencil, X, Check,
  Network, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { ShieldKeyIcon } from '@/components/icons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PluginDirectConfig = () => {
  const [pluginInfo, setPluginInfo] = useState(null);
  const [instances, setInstances] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('instances');
  
  // Instance form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState({ 
    name: '', 
    description: '',
    config: { credential_id: null },
    is_default: false 
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
      const [pluginRes, instancesRes, credRes] = await Promise.all([
        axios.get(`${API}/plugins/direct_interaction`),
        axios.get(`${API}/plugin-instances?plugin_type=direct_interaction`),
        axios.get(`${API}/credentials/by-type/user_password`)
      ]);
      setPluginInfo(pluginRes.data);
      setInstances(instancesRes.data);
      setCredentials(credRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const getCredentialName = (credId) => {
    if (!credId) return 'Sem autenticação';
    const cred = credentials.find(c => c.id === credId);
    if (!cred) return `ID: ${credId}`;
    return cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`;
  };

  // Instance CRUD
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const payload = {
        ...formData,
        plugin_type: 'direct_interaction',
        config: formData.config || {}
      };
      
      await axios.post(`${API}/plugin-instances`, payload);
      toast.success('Instância criada com sucesso');
      setFormData({ name: '', description: '', config: { credential_id: null }, is_default: false });
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
      config: instance.config || { credential_id: null },
      is_default: instance.is_default,
      is_active: instance.is_active
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
    <div className="h-full flex flex-col" data-testid="plugin-direct-config-page">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
              <Server className="w-6 h-6" />
              Interação Direta
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Comunicação direta via SMB/Impacket</p>
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
                    <CardTitle className="text-base">Nova Instância de Interação Direta</CardTitle>
                    <CardDescription>Configure uma nova instância do plugin SMB/Impacket</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
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
                          <Label className="flex items-center gap-2">
                            <ShieldKeyIcon className="w-4 h-4" />
                            Credencial
                          </Label>
                          <Select 
                            value={formData.config?.credential_id?.toString() || 'none'} 
                            onValueChange={(value) => setFormData({ 
                              ...formData, 
                              config: { 
                                ...formData.config, 
                                credential_id: value === 'none' ? null : parseInt(value) 
                              }
                            })}
                          >
                            <SelectTrigger data-testid="instance-credential-select">
                              <SelectValue placeholder="Selecione uma credencial" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sem autenticação</SelectItem>
                              {credentials.map((cred) => (
                                <SelectItem key={cred.id} value={cred.id.toString()}>
                                  {cred.name || `${cred.domain || ''}\\${cred.username}`}
                                  {cred.verified && ' ✓'}
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
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <Label>Nome</Label>
                                <Input
                                  value={editData.name}
                                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Credencial</Label>
                                <Select 
                                  value={editData.config?.credential_id?.toString() || 'none'} 
                                  onValueChange={(value) => setEditData({ 
                                    ...editData, 
                                    config: { 
                                      ...editData.config, 
                                      credential_id: value === 'none' ? null : parseInt(value) 
                                    }
                                  })}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione uma credencial" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sem autenticação</SelectItem>
                                    {credentials.map((cred) => (
                                      <SelectItem key={cred.id} value={cred.id.toString()}>
                                        {cred.name || `${cred.domain || ''}\\${cred.username}`}
                                        {cred.verified && ' ✓'}
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
                              <Button size="sm" onClick={() => saveEdit(instance.id)}>
                                <Check className="w-4 h-4 mr-1" /> Salvar
                              </Button>
                              <Button size="sm" variant="outline" onClick={cancelEdit}>
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
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <ShieldKeyIcon className="w-3 h-3" />
                                Credencial: {getCredentialName(instance.config?.credential_id)}
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
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(instance.id)}
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
                  <CardDescription>Status das funcionalidades do plugin</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[
                      { name: 'Resolução DNS', desc: 'Resolver nomes de domínio para IP com suporte a DNS personalizado', implemented: true },
                      { name: 'Listagem de Compartilhamentos (SMB)', desc: 'Listar compartilhamentos de rede via protocolo SMB', implemented: true },
                      { name: 'Navegação de Diretórios (SMB)', desc: 'Navegar diretórios em compartilhamentos de rede', implemented: true },
                      { name: 'Download de Arquivos (SMB)', desc: 'Baixar arquivos diretamente via protocolo SMB', implemented: true },
                      { name: 'Execução SQL Direta', desc: 'Execução de queries SQL via conexão direta', implemented: false },
                    ].map((feat, idx) => (
                      <div key={idx} className={`flex items-center justify-between p-3 border border-border rounded-lg ${!feat.implemented ? 'opacity-60' : ''}`}>
                        <div className="flex items-center gap-3">
                          {feat.implemented ? (
                            <Network className="w-4 h-4 text-green-500" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-medium text-sm">{feat.name}</div>
                            <div className="text-xs text-muted-foreground">{feat.desc}</div>
                          </div>
                        </div>
                        <Badge 
                          variant={feat.implemented ? "default" : "outline"} 
                          className={`text-xs ${feat.implemented ? 'bg-green-500' : ''}`}
                        >
                          {feat.implemented ? 'Implementado' : 'Não Implementado'}
                        </Badge>
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
                            {prop.enum && (
                              <div className="text-xs text-muted-foreground mt-1">
                                Valores: {prop.enum.join(', ')}
                              </div>
                            )}
                          </div>
                          {prop.default !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              default: <span className="font-mono">{JSON.stringify(prop.default)}</span>
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

export default PluginDirectConfig;
