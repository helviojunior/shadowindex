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

const ProxyServers = () => {
  const [proxies, setProxies] = useState([]);
  const [formData, setFormData] = useState({ name: '', ip: '', port: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProxies();
  }, []);

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
      await axios.post(`${API}/proxy-servers`, {
        ...formData,
        port: parseInt(formData.port)
      });
      toast.success('Proxy server cadastrado com sucesso');
      setFormData({ name: '', ip: '', port: '' });
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

  return (
    <div className="space-y-6" data-testid="proxy-servers-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Proxy Servers</h1>
        <p className="text-muted-foreground mt-2">Gerencie os servidores proxy</p>
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle>Novo Proxy Server</CardTitle>
          <CardDescription>Adicione um novo servidor proxy</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
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
            </div>
            <Button type="submit" disabled={loading} data-testid="add-proxy-btn">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Proxy
            </Button>
          </form>
        </CardContent>
      </Card>

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
                  <div className="flex-1 grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Nome</div>
                      <div className="font-medium">{proxy.name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">IP</div>
                      <div className="font-medium">{proxy.ip}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Porta</div>
                      <div className="font-medium">{proxy.port}</div>
                    </div>
                  </div>
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProxyServers;