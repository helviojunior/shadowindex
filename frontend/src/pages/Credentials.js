import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash2, Plus, ChevronUp, Pencil, X, Check, Hash, Ticket, KeyRound, CheckCircle, XCircle, Loader2, Key } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { ShieldKeyIcon } from '@/components/icons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CREDENTIAL_TYPES = {
  user_password: { label: 'Usuário e Senha/NTLM', icon: ShieldKeyIcon, color: 'text-blue-500' },
  token: { label: 'Token', icon: Ticket, color: 'text-green-500' },
  ssh_key: { label: 'Chave SSH', icon: KeyRound, color: 'text-purple-500' }
};

const Credentials = () => {
  const [credentials, setCredentials] = useState([]);
  const [activeTab, setActiveTab] = useState('user_password');
  const [formData, setFormData] = useState({
    name: '',
    credential_type: 'user_password',
    domain: '',
    username: '',
    password: '',
    ntlm_hash: '',
    token: '',
    token_type: 'bearer',
    ssh_private_key: '',
    ssh_passphrase: '',
    ssh_public_key: ''
  });
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const response = await axios.get(`${API}/credentials`);
      setCredentials(response.data);
    } catch (error) {
      console.error('Error loading credentials:', error);
      toast.error('Erro ao carregar credenciais');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      credential_type: activeTab,
      domain: '',
      username: '',
      password: '',
      ntlm_hash: '',
      token: '',
      token_type: 'bearer',
      ssh_private_key: '',
      ssh_passphrase: '',
      ssh_public_key: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const payload = {
        ...formData,
        credential_type: activeTab
      };
      
      // Clean up null values
      Object.keys(payload).forEach(key => {
        if (payload[key] === '') payload[key] = null;
      });
      
      await axios.post(`${API}/credentials`, payload);
      toast.success('Credencial cadastrada com sucesso');
      resetForm();
      setShowAddForm(false);
      loadCredentials();
    } catch (error) {
      console.error('Error creating credential:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao cadastrar credencial';
      toast.error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/credentials/${id}`);
      toast.success('Credencial removida com sucesso');
      loadCredentials();
    } catch (error) {
      console.error('Error deleting credential:', error);
      toast.error('Erro ao remover credencial');
    }
  };

  const startEdit = (cred) => {
    setEditingId(cred.id);
    setEditData({ ...cred });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    try {
      const payload = { ...editData };
      Object.keys(payload).forEach(key => {
        if (payload[key] === '') payload[key] = null;
      });
      
      await axios.put(`${API}/credentials/${id}`, payload);
      toast.success('Credencial atualizada com sucesso');
      setEditingId(null);
      setEditData({});
      loadCredentials();
    } catch (error) {
      console.error('Error updating credential:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao atualizar credencial';
      toast.error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }
  };

  const getCredentialsByType = (type) => {
    return credentials.filter(c => (c.credential_type || 'user_password') === type);
  };

  const getTypeInfo = (type) => CREDENTIAL_TYPES[type] || CREDENTIAL_TYPES.user_password;

  const renderCredentialDisplay = (cred) => {
    const type = cred.credential_type || 'user_password';
    const TypeIcon = getTypeInfo(type).icon;
    
    if (type === 'user_password') {
      return (
        <div className="flex-1 grid grid-cols-5 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Nome</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Domínio</div>
            <div className="font-medium">{cred.domain || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Usuário</div>
            <div className="font-medium">{cred.username}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Autenticação</div>
            <div className="flex items-center gap-2">
              {cred.password && (
                <Badge variant="outline" className="gap-1">
                  <Key className="w-3 h-3" />
                  Senha
                </Badge>
              )}
              {cred.ntlm_hash && (
                <Badge variant="secondary" className="gap-1">
                  <Hash className="w-3 h-3" />
                  NTLM
                </Badge>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Status</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                Verificada
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                Não verificada
              </Badge>
            )}
          </div>
        </div>
      );
    } else if (type === 'token') {
      return (
        <div className="flex-1 grid grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Nome</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Tipo de Token</div>
            <div className="font-medium">{cred.token_type || 'bearer'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Token</div>
            <div className="font-mono text-sm">{cred.token ? `${cred.token.substring(0, 20)}...` : '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Status</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                Verificada
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                Não verificada
              </Badge>
            )}
          </div>
        </div>
      );
    } else if (type === 'ssh_key') {
      return (
        <div className="flex-1 grid grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Nome</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Chave Privada</div>
            <div className="font-mono text-sm">{cred.ssh_private_key ? '********' : '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Passphrase</div>
            <div className="font-mono text-sm">{cred.ssh_passphrase ? '••••••••' : 'Sem passphrase'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Status</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                Verificada
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                Não verificada
              </Badge>
            )}
          </div>
        </div>
      );
    }
  };

  return (
    <div className="space-y-6" data-testid="credentials-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credenciais</h1>
          <p className="text-muted-foreground mt-2">Gerencie credenciais de acesso (usuário/senha, tokens, chaves SSH)</p>
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
              Adicionar Credencial
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nova Credencial</CardTitle>
            <CardDescription>Adicione uma nova credencial ao sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="user_password" className="gap-2">
                  <Key className="w-4 h-4" />
                  Usuário/Senha
                </TabsTrigger>
                <TabsTrigger value="token" className="gap-2">
                  <Ticket className="w-4 h-4" />
                  Token
                </TabsTrigger>
                <TabsTrigger value="ssh_key" className="gap-2">
                  <KeyRound className="w-4 h-4" />
                  Chave SSH
                </TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit}>
                {/* Name field - common to all types */}
                <div className="space-y-2 mb-4">
                  <Label htmlFor="name">Nome (opcional)</Label>
                  <Input
                    id="name"
                    data-testid="credential-name-input"
                    placeholder="Nome identificador da credencial"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <TabsContent value="user_password" className="space-y-4 mt-0">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="domain">Domínio</Label>
                      <Input
                        id="domain"
                        data-testid="credential-domain-input"
                        placeholder="exemplo.com"
                        value={formData.domain}
                        onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="username">Usuário *</Label>
                      <Input
                        id="username"
                        data-testid="credential-username-input"
                        placeholder="usuario"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        required={activeTab === 'user_password'}
                      />
                    </div>
                  </div>
                  
                  <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border">
                    <div className="space-y-2">
                      <Label htmlFor="password" className="flex items-center gap-2">
                        <Key className="w-4 h-4" />
                        Senha
                      </Label>
                      <Input
                        id="password"
                        data-testid="credential-password-input"
                        type="password"
                        placeholder="••••••••"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ntlm_hash" className="flex items-center gap-2">
                        <Hash className="w-4 h-4" />
                        NTLM Hash
                      </Label>
                      <Input
                        id="ntlm_hash"
                        data-testid="credential-ntlm-input"
                        placeholder="aad3b435b51404eeaad3b435b51404ee:..."
                        value={formData.ntlm_hash}
                        onChange={(e) => setFormData({ ...formData, ntlm_hash: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Formato: LM:NT ou apenas NT hash</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                    <span className="text-yellow-500">⚠</span>
                    <span>É obrigatório informar pelo menos uma senha OU um hash NTLM</span>
                  </div>
                </TabsContent>

                <TabsContent value="token" className="space-y-4 mt-0">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="token_type">Tipo de Token</Label>
                      <Select 
                        value={formData.token_type} 
                        onValueChange={(value) => setFormData({ ...formData, token_type: value })}
                      >
                        <SelectTrigger data-testid="token-type-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bearer">Bearer Token</SelectItem>
                          <SelectItem value="api_key">API Key</SelectItem>
                          <SelectItem value="basic">Basic Auth</SelectItem>
                          <SelectItem value="oauth">OAuth Token</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="token">Token *</Label>
                    <Textarea
                      id="token"
                      data-testid="credential-token-input"
                      placeholder="Cole o token aqui..."
                      value={formData.token}
                      onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                      className="font-mono text-sm"
                      rows={3}
                      required={activeTab === 'token'}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="ssh_key" className="space-y-4 mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="ssh_private_key">Chave Privada SSH *</Label>
                    <Textarea
                      id="ssh_private_key"
                      data-testid="credential-ssh-private-input"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      value={formData.ssh_private_key}
                      onChange={(e) => setFormData({ ...formData, ssh_private_key: e.target.value })}
                      className="font-mono text-sm"
                      rows={6}
                      required={activeTab === 'ssh_key'}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ssh_passphrase">Passphrase (opcional)</Label>
                      <Input
                        id="ssh_passphrase"
                        data-testid="credential-ssh-passphrase-input"
                        type="password"
                        placeholder="••••••••"
                        value={formData.ssh_passphrase}
                        onChange={(e) => setFormData({ ...formData, ssh_passphrase: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ssh_public_key">Chave Pública SSH (opcional)</Label>
                    <Textarea
                      id="ssh_public_key"
                      data-testid="credential-ssh-public-input"
                      placeholder="ssh-rsa AAAA..."
                      value={formData.ssh_public_key}
                      onChange={(e) => setFormData({ ...formData, ssh_public_key: e.target.value })}
                      className="font-mono text-sm"
                      rows={3}
                    />
                  </div>
                </TabsContent>

                <Button type="submit" disabled={loading} className="mt-4" data-testid="add-credential-btn">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Adicionar Credencial
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* List Cards by Type */}
      <div className="space-y-10 mt-8">
        {Object.entries(CREDENTIAL_TYPES).map(([type, info]) => {
          const TypeIcon = info.icon;
          const typeCreds = getCredentialsByType(type);
          
          return (
            <Card key={type} className="mt-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TypeIcon className={`w-5 h-5 ${info.color}`} />
                  {info.label}
                </CardTitle>
                <CardDescription>{typeCreds.length} credenciais</CardDescription>
              </CardHeader>
              <CardContent>
                {typeCreds.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">Nenhuma credencial deste tipo</p>
                ) : (
                  <div className="space-y-3">
                    {typeCreds.map((cred) => (
                      <div
                        key={cred.id}
                        data-testid={`credential-item-${cred.id}`}
                        className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        {editingId === cred.id ? (
                          // Edit mode - simplified for now
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <Input
                                value={editData.name || ''}
                                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                                placeholder="Nome"
                              />
                              {type === 'user_password' && (
                                <>
                                  <Input
                                    value={editData.domain || ''}
                                    onChange={(e) => setEditData({ ...editData, domain: e.target.value })}
                                    placeholder="Domínio"
                                  />
                                  <Input
                                    value={editData.username || ''}
                                    onChange={(e) => setEditData({ ...editData, username: e.target.value })}
                                    placeholder="Usuário"
                                  />
                                  <Input
                                    type="password"
                                    value={editData.password || ''}
                                    onChange={(e) => setEditData({ ...editData, password: e.target.value })}
                                    placeholder="Nova senha"
                                  />
                                  <Input
                                    value={editData.ntlm_hash || ''}
                                    onChange={(e) => setEditData({ ...editData, ntlm_hash: e.target.value })}
                                    placeholder="NTLM Hash (LM:NT ou apenas NT)"
                                    className="col-span-2 font-mono text-sm"
                                  />
                                </>
                              )}
                              {type === 'token' && (
                                <Textarea
                                  value={editData.token || ''}
                                  onChange={(e) => setEditData({ ...editData, token: e.target.value })}
                                  placeholder="Token"
                                  className="col-span-2"
                                />
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => saveEdit(cred.id)}>
                                <Check className="w-4 h-4 mr-1" /> Salvar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                <X className="w-4 h-4 mr-1" /> Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {renderCredentialDisplay(cred)}
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => startEdit(cred)}
                                data-testid={`edit-credential-${cred.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(cred.id)}
                                data-testid={`delete-credential-${cred.id}`}
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
          );
        })}
      </div>
    </div>
  );
};

export default Credentials;
