import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Credentials = () => {
  const [credentials, setCredentials] = useState([]);
  const [formData, setFormData] = useState({ domain: '', username: '', password: '' });
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(`${API}/credentials`, formData);
      toast.success('Credencial cadastrada com sucesso');
      setFormData({ domain: '', username: '', password: '' });
      loadCredentials();
    } catch (error) {
      console.error('Error creating credential:', error);
      toast.error('Erro ao cadastrar credencial');
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

  return (
    <div className="space-y-6" data-testid="credentials-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Credenciais</h1>
        <p className="text-muted-foreground mt-2">Gerencie as credenciais de acesso</p>
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle>Nova Credencial</CardTitle>
          <CardDescription>Adicione uma nova credencial ao sistema</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
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
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  data-testid="credential-password-input"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={loading} data-testid="add-credential-btn">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Credencial
            </Button>
          </form>
        </CardContent>
      </Card>

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
                  <div className="flex-1 grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Domínio</div>
                      <div className="font-medium">{cred.domain}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Usuário</div>
                      <div className="font-medium">{cred.username}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Senha</div>
                      <div className="font-medium">••••••••</div>
                    </div>
                  </div>
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Credentials;