import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  Trash2, Plus, ChevronUp, Pencil, X, Check, 
  Globe, Server, Star, StarOff, Power, PowerOff,
  Settings, Loader2, CheckCircle, XCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { CredentialKeyIcon } from '@/components/icons/ShieldKeyIcon';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PLUGIN_TYPES = [
  { value: 'soap_api', label: 'SOAP API', icon: Globe, description: 'Comunicação via WebService SOAP' },
  { value: 'direct_interaction', label: 'Interação Direta', icon: Server, description: 'Comunicação direta via SMB/Impacket' }
];

const PluginInstances = () => {
  const [instances, setInstances] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [healthStatus, setHealthStatus] = useState({});
  const [checkingHealth, setCheckingHealth] = useState({});
  
  const [formData, setFormData] = useState({
    name: '',
    plugin_type: 'soap_api',
    description: '',
    config: {},
    is_default: false
  });

  useEffect(() => {
    loadInstances();
    loadCredentials();
  }, []);

  const loadInstances = async () => {
    try {
      const response = await axios.get(`${API}/plugin-instances`);
      setInstances(response.data);
    } catch (error) {
      console.error('Error loading plugin instances:', error);
      toast.error('Erro ao carregar instâncias de plugins');
    }
  };

  const loadCredentials = async () => {
    try {
      const response = await axios.get(`${API}/credentials`);
      const userPassCreds = response.data.filter(c => c.credential_type === 'user_password');
      setCredentials(userPassCreds);
    } catch (error) {
      console.error('Error loading credentials:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        ...formData,
        config: formData.config || {}
      };
      
      await axios.post(`${API}/plugin-instances`, payload);
      toast.success('Instância de plugin criada com sucesso');
      setFormData({ name: '', plugin_type: 'soap_api', description: '', config: {}, is_default: false });
      setShowAddForm(false);
      loadInstances();
    } catch (error) {
      console.error('Error creating instance:', error);
      toast.error(error.response?.data?.detail || 'Erro ao criar instância');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Tem certeza que deseja excluir esta instância?')) return;
    
    try {
      await axios.delete(`${API}/plugin-instances/${id}`);
      toast.success('Instância excluída com sucesso');
      loadInstances();
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
      config: instance.config || {},
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
      loadInstances();
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
      loadInstances();
    } catch (error) {
      console.error('Error toggling default:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const toggleActive = async (instance) => {
    try {
      await axios.put(`${API}/plugin-instances/${instance.id}`, { is_active: !instance.is_active });
      toast.success(instance.is_active ? 'Instância desativada' : 'Instância ativada');
      loadInstances();
    } catch (error) {
      console.error('Error toggling active:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const getPluginTypeInfo = (type) => {
    return PLUGIN_TYPES.find(p => p.value === type) || PLUGIN_TYPES[0];
  };

  const getCredentialName = (credId) => {
    const cred = credentials.find(c => c.id === credId);
    if (!cred) return `ID: ${credId}`;
    return cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`;
  };

  // Group instances by type
  const groupedInstances = instances.reduce((acc, inst) => {
    if (!acc[inst.plugin_type]) acc[inst.plugin_type] = [];
    acc[inst.plugin_type].push(inst);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Instâncias de Plugins</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie instâncias de plugins para comunicação com servidores
          </p>
        </div>
        <Button 
          onClick={() => setShowAddForm(!showAddForm)}
          data-testid="toggle-add-form-btn"
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

      {/* Add Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nova Instância de Plugin</CardTitle>
            <CardDescription>
              Crie uma nova instância de plugin com configurações específicas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome da Instância *</Label>
                  <Input
                    id="name"
                    data-testid="instance-name-input"
                    placeholder="Produção SOAP"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plugin_type">Tipo de Plugin *</Label>
                  <Select 
                    value={formData.plugin_type} 
                    onValueChange={(value) => setFormData({ ...formData, plugin_type: value, config: {} })}
                  >
                    <SelectTrigger data-testid="plugin-type-select">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLUGIN_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="w-4 h-4" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Input
                    id="description"
                    data-testid="instance-description-input"
                    placeholder="Descrição opcional"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
              </div>

              {/* Config fields based on plugin type */}
              {formData.plugin_type === 'direct_interaction' && (
                <div className="space-y-4 pt-4 border-t">
                  <h4 className="font-medium">Configurações do Plugin</h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Credencial de Acesso *</Label>
                      <Select 
                        value={formData.config?.credential_id?.toString() || ''} 
                        onValueChange={(value) => setFormData({ 
                          ...formData, 
                          config: { ...formData.config, credential_id: parseInt(value) } 
                        })}
                      >
                        <SelectTrigger data-testid="credential-select">
                          <SelectValue placeholder="Selecione uma credencial" />
                        </SelectTrigger>
                        <SelectContent>
                          {credentials.map((cred) => (
                            <SelectItem key={cred.id} value={cred.id.toString()}>
                              <div className="flex items-center gap-2">
                                <CredentialKeyIcon className="w-4 h-4" />
                                {cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Modo DNS</Label>
                      <Select 
                        value={formData.config?.dns_mode || 'system'} 
                        onValueChange={(value) => setFormData({ 
                          ...formData, 
                          config: { ...formData.config, dns_mode: value } 
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">Sistema</SelectItem>
                          <SelectItem value="custom">Customizado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 pt-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is_default"
                    checked={formData.is_default}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_default: checked })}
                  />
                  <Label htmlFor="is_default">Definir como padrão para este tipo</Label>
                </div>
              </div>

              <Button type="submit" disabled={loading} data-testid="create-instance-btn">
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Criar Instância
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Instances by type */}
      {PLUGIN_TYPES.map((pluginType) => {
        const typeInstances = groupedInstances[pluginType.value] || [];
        const TypeIcon = pluginType.icon;
        
        return (
          <Card key={pluginType.value}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TypeIcon className="w-5 h-5 text-primary" />
                <CardTitle>{pluginType.label}</CardTitle>
              </div>
              <CardDescription>
                {pluginType.description} - {typeInstances.length} instância(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {typeInstances.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Nenhuma instância deste tipo
                </p>
              ) : (
                <div className="space-y-3">
                  {typeInstances.map((instance) => (
                    <div 
                      key={instance.id} 
                      className={`flex items-center gap-4 p-4 rounded-lg border ${
                        !instance.is_active ? 'opacity-50 bg-muted/50' : 'bg-card'
                      }`}
                    >
                      {editingId === instance.id ? (
                        // Edit mode
                        <div className="flex-1 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <Input
                              value={editData.name}
                              onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                              placeholder="Nome"
                            />
                            <Input
                              value={editData.description}
                              onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                              placeholder="Descrição"
                            />
                          </div>
                          
                          {instance.plugin_type === 'direct_interaction' && (
                            <div className="grid grid-cols-2 gap-3">
                              <Select 
                                value={editData.config?.credential_id?.toString() || ''} 
                                onValueChange={(value) => setEditData({ 
                                  ...editData, 
                                  config: { ...editData.config, credential_id: parseInt(value) } 
                                })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Credencial" />
                                </SelectTrigger>
                                <SelectContent>
                                  {credentials.map((cred) => (
                                    <SelectItem key={cred.id} value={cred.id.toString()}>
                                      {cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => saveEdit(instance.id)}>
                              <Check className="w-4 h-4 mr-1" /> Salvar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit}>
                              <X className="w-4 h-4 mr-1" /> Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{instance.name}</span>
                              {instance.is_default && (
                                <Badge variant="secondary" className="text-xs">
                                  <Star className="w-3 h-3 mr-1" />
                                  Padrão
                                </Badge>
                              )}
                              {!instance.is_active && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  Inativo
                                </Badge>
                              )}
                              {healthStatus[instance.id] && (
                                <Badge variant={healthStatus[instance.id].healthy ? "default" : "destructive"}>
                                  {healthStatus[instance.id].healthy ? (
                                    <><CheckCircle className="w-3 h-3 mr-1" /> OK</>
                                  ) : (
                                    <><XCircle className="w-3 h-3 mr-1" /> Erro</>
                                  )}
                                </Badge>
                              )}
                            </div>
                            {instance.description && (
                              <p className="text-sm text-muted-foreground">{instance.description}</p>
                            )}
                            {instance.plugin_type === 'direct_interaction' && instance.config?.credential_id && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Credencial: {getCredentialName(instance.config.credential_id)}
                              </p>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => checkHealth(instance.id)}
                              disabled={checkingHealth[instance.id]}
                              title="Verificar saúde"
                            >
                              {checkingHealth[instance.id] ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Settings className="w-4 h-4" />
                              )}
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => toggleDefault(instance)}
                              title={instance.is_default ? "Remover como padrão" : "Definir como padrão"}
                            >
                              {instance.is_default ? (
                                <Star className="w-4 h-4 text-yellow-500" />
                              ) : (
                                <StarOff className="w-4 h-4" />
                              )}
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => toggleActive(instance)}
                              title={instance.is_active ? "Desativar" : "Ativar"}
                            >
                              {instance.is_active ? (
                                <Power className="w-4 h-4 text-green-500" />
                              ) : (
                                <PowerOff className="w-4 h-4 text-muted-foreground" />
                              )}
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => startEdit(instance)}
                              title="Editar"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => handleDelete(instance.id)}
                              title="Excluir"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default PluginInstances;
