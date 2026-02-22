import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  
  // Test config (for Info tab)
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testConfig, setTestConfig] = useState({
    credential_id: 'none',
    dns_mode: 'system',
    dns_servers: '',
    test_hostname: 'google.com'
  });

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

  // Test plugin functionality
  const testPlugin = async () => {
    setTesting(true);
    setTestResult(null);
    
    try {
      const config = {
        credential_id: testConfig.credential_id && testConfig.credential_id !== 'none' 
          ? parseInt(testConfig.credential_id) 
          : null,
        dns_mode: testConfig.dns_mode,
        dns_servers: testConfig.dns_mode === 'custom' && testConfig.dns_servers
          ? testConfig.dns_servers.split(',').map(s => s.trim()).filter(Boolean)
          : []
      };
      
      const response = await axios.post(`${API}/plugins/direct_interaction/health`, config);
      setTestResult(response.data);
      
      if (response.data.healthy) {
        toast.success('Plugin funcionando corretamente');
      } else {
        toast.error(`Erro: ${response.data.message}`);
      }
    } catch (error) {
      setTestResult({ healthy: false, message: error.message });
      toast.error(`Erro ao testar: ${error.message}`);
    } finally {
      setTesting(false);
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
    <div className="space-y-6" data-testid="plugin-direct-config-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Server className="w-8 h-8" />
            Interação Direta
          </h1>
          <p className="text-muted-foreground mt-2">Comunicação direta via SMB/Impacket</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="instances" data-testid="tab-instances">
            <Plug className="w-4 h-4 mr-2" />
            Instâncias
          </TabsTrigger>
          <TabsTrigger value="info" data-testid="tab-info">
            <Settings className="w-4 h-4 mr-2" />
            Info
          </TabsTrigger>
        </TabsList>

        {/* Tab: Instâncias */}
        <TabsContent value="instances" className="space-y-6 mt-6">
          {/* Botão Adicionar */}
          <div className="flex justify-end">
            <Button 
              onClick={() => setShowAddForm(!showAddForm)} 
              data-testid="toggle-add-instance-btn"
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
                  Nova Instância
                </>
              )}
            </Button>
          </div>

          {/* Form para nova instância */}
          {showAddForm && (
            <Card>
              <CardHeader>
                <CardTitle>Nova Instância de Interação Direta</CardTitle>
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
                    />
                  </div>
                  <Button type="submit" disabled={formLoading} data-testid="create-instance-btn">
                    {formLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Criar Instância
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Lista de Instâncias */}
          <Card>
            <CardHeader>
              <CardTitle>Instâncias Configuradas</CardTitle>
              <CardDescription>{instances.length} instância(s) de interação direta</CardDescription>
            </CardHeader>
            <CardContent>
              {instances.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhuma instância configurada</p>
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
                                <span className="font-medium text-lg">{instance.name}</span>
                                {instance.is_default && (
                                  <Badge variant="secondary" className="gap-1">
                                    <Star className="w-3 h-3" /> Padrão
                                  </Badge>
                                )}
                                {!instance.is_active && (
                                  <Badge variant="outline" className="text-muted-foreground">Inativo</Badge>
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
                                <Badge variant={health.healthy ? "default" : "destructive"} className="mr-2">
                                  {health.healthy ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                                  {health.healthy ? 'OK' : 'Erro'}
                                </Badge>
                              )}
                              
                              {/* Health check */}
                              <Button
                                variant="ghost"
                                size="icon"
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
                                onClick={() => startEdit(instance)}
                                title="Editar"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              
                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(instance.id)}
                                className="text-destructive hover:text-destructive"
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Info */}
        <TabsContent value="info" className="space-y-6 mt-6">
          {/* Plugin Info Card */}
          {pluginInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plug className="w-5 h-5" />
                  Informações do Plugin
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Nome</div>
                    <div className="font-medium">{pluginInfo.name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Tipo</div>
                    <Badge variant="outline">{pluginInfo.type}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Versão</div>
                    <div className="font-medium">{pluginInfo.version}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Descrição</div>
                    <div className="text-sm text-muted-foreground">{pluginInfo.description}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Test Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="w-5 h-5" />
                Testar Configuração
              </CardTitle>
              <CardDescription>Configure e teste a resolução DNS do plugin</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Credential Selector */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <ShieldKeyIcon className="w-4 h-4" />
                    Credencial (tipo Usuário/Senha)
                  </Label>
                  <Select 
                    value={testConfig.credential_id} 
                    onValueChange={(value) => setTestConfig({ ...testConfig, credential_id: value })}
                  >
                    <SelectTrigger data-testid="test-credential-selector">
                      <SelectValue placeholder="Selecione uma credencial" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {credentials.map((cred) => (
                        <SelectItem key={cred.id} value={cred.id.toString()}>
                          {cred.name || `${cred.domain || ''}\\${cred.username}`}
                          {cred.verified && ' ✓'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Modo DNS</Label>
                  <Select 
                    value={testConfig.dns_mode} 
                    onValueChange={(value) => setTestConfig({ ...testConfig, dns_mode: value })}
                  >
                    <SelectTrigger data-testid="test-dns-mode-selector">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Padrão do Sistema Operacional</SelectItem>
                      <SelectItem value="custom">Servidores Personalizados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Custom DNS Servers */}
              {testConfig.dns_mode === 'custom' && (
                <div className="space-y-2">
                  <Label>Servidores DNS (separados por vírgula)</Label>
                  <Input
                    placeholder="8.8.8.8, 8.8.4.4"
                    value={testConfig.dns_servers}
                    onChange={(e) => setTestConfig({ ...testConfig, dns_servers: e.target.value })}
                    data-testid="test-dns-servers-input"
                  />
                </div>
              )}

              {/* Test Hostname */}
              <div className="space-y-2">
                <Label>Hostname para Teste</Label>
                <Input
                  placeholder="google.com"
                  value={testConfig.test_hostname}
                  onChange={(e) => setTestConfig({ ...testConfig, test_hostname: e.target.value })}
                  data-testid="test-hostname-input"
                />
              </div>

              {/* Test Button */}
              <Button onClick={testPlugin} disabled={testing} data-testid="test-plugin-btn">
                {testing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Testar Plugin
              </Button>

              {/* Test Result */}
              {testResult && (
                <div className={`p-4 rounded-lg border ${testResult.healthy ? 'bg-green-500/10 border-green-500' : 'bg-red-500/10 border-red-500'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {testResult.healthy ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className="font-medium">
                      {testResult.healthy ? 'Sucesso' : 'Falha'}
                    </span>
                  </div>
                  <p className="text-sm">{testResult.message}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Funcionalidades */}
          <Card>
            <CardHeader>
              <CardTitle>Funcionalidades</CardTitle>
              <CardDescription>Status das funcionalidades do plugin</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Network className="w-5 h-5 text-green-500" />
                    <div>
                      <div className="font-medium">Resolução DNS</div>
                      <div className="text-sm text-muted-foreground">
                        Resolver nomes de domínio para IP com suporte a DNS personalizado e proxy SOCKS
                      </div>
                    </div>
                  </div>
                  <Badge variant="default" className="bg-green-500">Implementado</Badge>
                </div>
                
                <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Network className="w-5 h-5 text-green-500" />
                    <div>
                      <div className="font-medium">Listagem de Compartilhamentos (SMB)</div>
                      <div className="text-sm text-muted-foreground">
                        Listar compartilhamentos de rede via protocolo SMB usando impacket
                      </div>
                    </div>
                  </div>
                  <Badge variant="default" className="bg-green-500">Implementado</Badge>
                </div>
                
                <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Network className="w-5 h-5 text-green-500" />
                    <div>
                      <div className="font-medium">Navegação de Diretórios (SMB)</div>
                      <div className="text-sm text-muted-foreground">
                        Navegar diretórios em compartilhamentos de rede
                      </div>
                    </div>
                  </div>
                  <Badge variant="default" className="bg-green-500">Implementado</Badge>
                </div>
                
                <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Network className="w-5 h-5 text-green-500" />
                    <div>
                      <div className="font-medium">Download de Arquivos (SMB)</div>
                      <div className="text-sm text-muted-foreground">
                        Baixar arquivos diretamente via protocolo SMB
                      </div>
                    </div>
                  </div>
                  <Badge variant="default" className="bg-green-500">Implementado</Badge>
                </div>

                <div className="flex items-center justify-between p-3 border border-border rounded-lg opacity-60">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">Execução SQL Direta</div>
                      <div className="text-sm text-muted-foreground">
                        Execução de queries SQL via conexão direta
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline">Não Implementado</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Config Schema Card */}
          {pluginInfo?.config_schema && (
            <Card>
              <CardHeader>
                <CardTitle>Esquema de Configuração</CardTitle>
                <CardDescription>Campos disponíveis para configuração de instâncias</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
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
                          <div className="text-sm text-muted-foreground mt-1">{prop.description}</div>
                        )}
                        {prop.enum && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Valores: {prop.enum.join(', ')}
                          </div>
                        )}
                      </div>
                      {prop.default !== undefined && (
                        <div className="text-sm text-muted-foreground">
                          default: <span className="font-mono">{JSON.stringify(prop.default)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PluginDirectConfig;
