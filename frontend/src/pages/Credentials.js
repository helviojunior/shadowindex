import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus, ChevronUp, Pencil, X, Check, Key, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Credentials = () => {
  const [credentials, setCredentials] = useState([]);
  const [formData, setFormData] = useState({ domain: '', username: '', password: '', ntlm_hash: '' });
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

  const validateForm = (data) => {
    if (!data.password && !data.ntlm_hash) {
      toast.error('É obrigatório informar uma senha OU um hash NTLM');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm(formData)) return;
    
    setLoading(true);
    try {
      const payload = {
        domain: formData.domain,
        username: formData.username,
        password: formData.password || null,
        ntlm_hash: formData.ntlm_hash || null
      };
      
      await axios.post(`${API}/credentials`, payload);
      toast.success('Credencial cadastrada com sucesso');
      setFormData({ domain: '', username: '', password: '', ntlm_hash: '' });
      setShowAddForm(false);
      loadCredentials();
    } catch (error) {
      console.error('Error creating credential:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao cadastrar credencial';
      toast.error(errorMsg);
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
    setEditData({
      domain: cred.domain,
      username: cred.username,
      password: cred.password || '',
      ntlm_hash: cred.ntlm_hash || ''
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    // Validar que pelo menos um dos dois está preenchido
    if (!editData.password && !editData.ntlm_hash) {
      toast.error('É obrigatório manter uma senha OU um hash NTLM');
      return;
    }
    
    try {
      const payload = {
        domain: editData.domain,
        username: editData.username,
        password: editData.password || null,
        ntlm_hash: editData.ntlm_hash || null
      };
      
      await axios.put(`${API}/credentials/${id}`, payload);
      toast.success('Credencial atualizada com sucesso');
      setEditingId(null);
      setEditData({});
      loadCredentials();
    } catch (error) {
      console.error('Error updating credential:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao atualizar credencial';
      toast.error(errorMsg);
    }
  };

  const getAuthType = (cred) => {
    if (cred.password && cred.ntlm_hash) return 'both';
    if (cred.ntlm_hash) return 'ntlm';
    return 'password';
  };

  return (
    <div className="space-y-6" data-testid="credentials-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credenciais</h1>
          <p className="text-muted-foreground mt-2">Gerencie as credenciais de acesso (senha ou NTLM hash)</p>
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
            <CardDescription>Adicione uma nova credencial (senha OU NTLM hash obrigatório)</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="domain">Domínio</Label>
                  <Input
                    id="domain"
                    data-testid="credential-domain-input"
                    placeholder="exemplo.com"
                    value={formData.domain}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Usuário</Label>
                  <Input
                    id="username"
                    data-testid="credential-username-input"
                    placeholder="usuario"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
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
              
              <Button type="submit" disabled={loading} data-testid="add-credential-btn">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Credencial
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List Card */}
      <Card>
        <CardHeader>
          <CardTitle>Credenciais Cadastradas</CardTitle>
          <CardDescription>{credentials.length} credenciais no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma credencial cadastrada</p>
          ) : (
            <div className="space-y-3">
              {credentials.map((cred) => (
                <div
                  key={cred.id}
                  data-testid={`credential-item-${cred.id}`}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {editingId === cred.id ? (
                    // Edit mode
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          value={editData.domain}
                          onChange={(e) => setEditData({ ...editData, domain: e.target.value })}
                          placeholder="Domínio"
                          data-testid={`edit-domain-${cred.id}`}
                        />
                        <Input
                          value={editData.username}
                          onChange={(e) => setEditData({ ...editData, username: e.target.value })}
                          placeholder="Usuário"
                          data-testid={`edit-username-${cred.id}`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          type="password"
                          value={editData.password}
                          onChange={(e) => setEditData({ ...editData, password: e.target.value })}
                          placeholder="Senha (deixe em branco para manter)"
                          data-testid={`edit-password-${cred.id}`}
                        />
                        <Input
                          value={editData.ntlm_hash}
                          onChange={(e) => setEditData({ ...editData, ntlm_hash: e.target.value })}
                          placeholder="NTLM Hash"
                          data-testid={`edit-ntlm-${cred.id}`}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(cred.id)} data-testid={`save-edit-${cred.id}`}>
                          <Check className="w-4 h-4 mr-1" /> Salvar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid={`cancel-edit-${cred.id}`}>
                          <X className="w-4 h-4 mr-1" /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <>
                      <div className="flex-1 grid grid-cols-4 gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Domínio</div>
                          <div className="font-medium">{cred.domain}</div>
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
                          <div className="text-xs text-muted-foreground mb-1">Dados</div>
                          <div className="font-medium text-muted-foreground">
                            {cred.password && <span>Senha: ••••••••</span>}
                            {cred.password && cred.ntlm_hash && <span className="mx-1">|</span>}
                            {cred.ntlm_hash && <span>Hash: {cred.ntlm_hash.substring(0, 8)}...</span>}
                          </div>
                        </div>
                      </div>
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
    </div>
  );
};

export default Credentials;
