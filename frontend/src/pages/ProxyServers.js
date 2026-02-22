import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, ChevronUp, Globe, Shield, Pencil, X, Check, User, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { CredentialIcon } from '@/components/ui/CustomIcons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ProxyServers = () => {
  const [proxies, setProxies] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [formData, setFormData] = useState({ 
    name: '', 
    ip: '', 
    port: '', 
    proxy_type: 'http',
    credential_id: 'none'
  });
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    loadProxies();
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const response = await axios.get(`${API}/credentials`);
      // Filtrar apenas credenciais do tipo user_password
      const userPassCredentials = response.data.filter(c => c.credential_type === 'user_password');
      setCredentials(userPassCredentials);
    } catch (error) {
      console.error('Error loading credentials:', error);
    }
  };

  const loadProxies = async () => {
    try {
      const response = await axios.get(`${API}/proxy-servers`);
      setProxies(response.data);
    } catch (error) {
      console.error('Error loading proxies:', error);
      toast.error('Erro ao carregar proxy servers');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        ip: formData.ip,
        port: parseInt(formData.port),
        proxy_type: formData.proxy_type,
        username: formData.auth_type === 'user_password' ? formData.username : null,
        password: formData.auth_type === 'user_password' ? formData.password : null
      };
      
      await axios.post(`${API}/proxy-servers`, payload);
      toast.success('Proxy server cadastrado com sucesso');
      setFormData({ name: '', ip: '', port: '', proxy_type: 'http', auth_type: 'none', username: '', password: '' });
      setShowAddForm(false);
      loadProxies();
    } catch (error) {
      console.error('Error creating proxy:', error);
      toast.error('Erro ao cadastrar proxy server');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/proxy-servers/${id}`);
      toast.success('Proxy server removido com sucesso');
      loadProxies();
    } catch (error) {
      console.error('Error deleting proxy:', error);
      toast.error('Erro ao remover proxy server');
    }
  };

  const startEdit = (proxy) => {
    setEditingId(proxy.id);
    setEditData({
      name: proxy.name,
      ip: proxy.ip,
      port: proxy.port.toString(),
      proxy_type: proxy.proxy_type || 'http',
      auth_type: proxy.username ? 'user_password' : 'none',
      username: proxy.username || '',
      password: ''  // Don't prefill password
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    try {
      const payload = {
        name: editData.name,
        ip: editData.ip,
        port: parseInt(editData.port),
        proxy_type: editData.proxy_type,
        username: editData.auth_type === 'user_password' ? (editData.username || null) : null,
        password: editData.auth_type === 'user_password' ? (editData.password || undefined) : null
      };
      
      // Don't send password if empty and auth is user_password (keep existing)
      if (editData.auth_type === 'user_password' && !editData.password) {
        delete payload.password;
      }
      
      await axios.put(`${API}/proxy-servers/${id}`, payload);
      toast.success('Proxy server atualizado com sucesso');
      setEditingId(null);
      setEditData({});
      loadProxies();
    } catch (error) {
      console.error('Error updating proxy:', error);
      toast.error('Erro ao atualizar proxy server');
    }
  };

  const getProxyTypeLabel = (type) => {
    return type === 'socks5' ? 'SOCKS5' : 'HTTP';
  };

  const getProxyTypeIcon = (type) => {
    return type === 'socks5' ? <Shield className="w-4 h-4" /> : <Globe className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6" data-testid="proxy-servers-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proxy Servers</h1>
          <p className="text-muted-foreground mt-2">Gerencie os servidores proxy (HTTP e SOCKS5)</p>
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
              Adicionar Proxy
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Novo Proxy Server</CardTitle>
            <CardDescription>Adicione um novo servidor proxy HTTP ou SOCKS5</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    data-testid="proxy-name-input"
                    placeholder="Meu Proxy"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proxy_type">Tipo</Label>
                  <Select 
                    value={formData.proxy_type} 
                    onValueChange={(value) => setFormData({ ...formData, proxy_type: value })}
                  >
                    <SelectTrigger data-testid="proxy-type-select">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4" />
                          HTTP
                        </div>
                      </SelectItem>
                      <SelectItem value="socks5">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          SOCKS5
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ip">IP</Label>
                  <Input
                    id="ip"
                    data-testid="proxy-ip-input"
                    placeholder="192.168.1.1"
                    value={formData.ip}
                    onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">Porta</Label>
                  <Input
                    id="port"
                    data-testid="proxy-port-input"
                    type="number"
                    placeholder="8080"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth_type">Autenticação</Label>
                  <Select 
                    value={formData.auth_type} 
                    onValueChange={(value) => setFormData({ ...formData, auth_type: value, username: '', password: '' })}
                  >
                    <SelectTrigger data-testid="proxy-auth-type-select">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <div className="flex items-center gap-2">
                          <X className="w-4 h-4 text-muted-foreground" />
                          Sem autenticação
                        </div>
                      </SelectItem>
                      <SelectItem value="user_password">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          Usuário e Senha
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Credentials - only show when auth_type is user_password */}
              {formData.auth_type === 'user_password' && (
                <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Usuário
                    </Label>
                    <Input
                      id="username"
                      data-testid="proxy-username-input"
                      placeholder="username"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4" />
                      Senha
                    </Label>
                    <Input
                      id="password"
                      data-testid="proxy-password-input"
                      type="password"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                    />
                  </div>
                </div>
              )}
              
              <Button type="submit" disabled={loading} data-testid="add-proxy-btn">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Proxy
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List Card */}
      <Card>
        <CardHeader>
          <CardTitle>Proxy Servers Cadastrados</CardTitle>
          <CardDescription>{proxies.length} proxies no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {proxies.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum proxy cadastrado</p>
          ) : (
            <div className="space-y-3">
              {proxies.map((proxy) => (
                <div
                  key={proxy.id}
                  data-testid={`proxy-item-${proxy.id}`}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {editingId === proxy.id ? (
                    // Edit mode
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-5 gap-3">
                        <Input
                          value={editData.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          placeholder="Nome"
                          data-testid={`edit-name-${proxy.id}`}
                        />
                        <Select 
                          value={editData.proxy_type} 
                          onValueChange={(value) => setEditData({ ...editData, proxy_type: value })}
                        >
                          <SelectTrigger data-testid={`edit-type-${proxy.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="http">HTTP</SelectItem>
                            <SelectItem value="socks5">SOCKS5</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={editData.ip}
                          onChange={(e) => setEditData({ ...editData, ip: e.target.value })}
                          placeholder="IP"
                          data-testid={`edit-ip-${proxy.id}`}
                        />
                        <Input
                          type="number"
                          value={editData.port}
                          onChange={(e) => setEditData({ ...editData, port: e.target.value })}
                          placeholder="Porta"
                          data-testid={`edit-port-${proxy.id}`}
                        />
                        <Select 
                          value={editData.auth_type} 
                          onValueChange={(value) => setEditData({ ...editData, auth_type: value, username: value === 'none' ? '' : editData.username, password: '' })}
                        >
                          <SelectTrigger data-testid={`edit-auth-type-${proxy.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem autenticação</SelectItem>
                            <SelectItem value="user_password">Usuário e Senha</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {editData.auth_type === 'user_password' && (
                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            value={editData.username}
                            onChange={(e) => setEditData({ ...editData, username: e.target.value })}
                            placeholder="Usuário"
                            data-testid={`edit-username-${proxy.id}`}
                          />
                          <Input
                            type="password"
                            value={editData.password}
                            onChange={(e) => setEditData({ ...editData, password: e.target.value })}
                            placeholder="Nova senha (deixe em branco para manter)"
                            data-testid={`edit-password-${proxy.id}`}
                          />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(proxy.id)} data-testid={`save-edit-${proxy.id}`}>
                          <Check className="w-4 h-4 mr-1" /> Salvar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid={`cancel-edit-${proxy.id}`}>
                          <X className="w-4 h-4 mr-1" /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <>
                      <div className="flex-1 grid grid-cols-4 gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Nome</div>
                          <div className="font-medium">{proxy.name}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Tipo</div>
                          <div className="font-medium flex items-center gap-2">
                            {getProxyTypeIcon(proxy.proxy_type || 'http')}
                            {getProxyTypeLabel(proxy.proxy_type || 'http')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Endereço</div>
                          <div className="font-medium">{proxy.ip}:{proxy.port}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Autenticação</div>
                          <div className="font-medium">
                            {proxy.username ? (
                              <span className="text-green-500">Configurada ({proxy.username})</span>
                            ) : (
                              <span className="text-muted-foreground">Sem autenticação</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEdit(proxy)}
                          data-testid={`edit-proxy-${proxy.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(proxy.id)}
                          data-testid={`delete-proxy-${proxy.id}`}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
    </div>
  );
};

export default ProxyServers;
