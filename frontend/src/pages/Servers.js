import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, CheckCircle, XCircle, HardDrive, Download } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Servers = () => {
  const [servers, setServers] = useState([]);
  const [formData, setFormData] = useState({ name: '', ip: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const response = await axios.get(`${API}/servers`);
      setServers(response.data);
    } catch (error) {
      console.error('Error loading servers:', error);
      toast.error('Erro ao carregar servidores');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(`${API}/servers`, formData);
      toast.success('Servidor cadastrado com sucesso');
      setFormData({ name: '', ip: '' });
      loadServers();
    } catch (error) {
      console.error('Error creating server:', error);
      toast.error('Erro ao cadastrar servidor');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/servers/${id}`);
      toast.success('Servidor removido com sucesso');
      loadServers();
    } catch (error) {
      console.error('Error deleting server:', error);
      toast.error('Erro ao remover servidor');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Nunca';
    return new Date(dateString).toLocaleString('pt-BR');
  };

  return (
    <div className="space-y-6" data-testid="servers-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Servidores</h1>
        <p className="text-muted-foreground mt-2">Gerencie os servidores monitorados</p>
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle>Novo Servidor</CardTitle>
          <CardDescription>Adicione um novo servidor para monitoramento</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do Servidor</Label>
                <Input
                  id="name"
                  data-testid="server-name-input"
                  placeholder="Servidor Principal"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ip">Endereço IP</Label>
                <Input
                  id="ip"
                  data-testid="server-ip-input"
                  placeholder="192.168.1.100"
                  value={formData.ip}
                  onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={loading} data-testid="add-server-btn">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Servidor
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Servers Table Card */}
      <Card>
        <CardHeader>
          <CardTitle>Servidores Cadastrados</CardTitle>
          <CardDescription>{servers.length} servidores no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum servidor cadastrado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Nome</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">IP</th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">Verificado</th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                      <HardDrive className="w-4 h-4 inline mr-1" />
                      Shares
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                      <Download className="w-4 h-4 inline mr-1" />
                      Downloads
                    </th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Última Verificação</th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {servers.map((server) => (
                    <tr
                      key={server.id}
                      data-testid={`server-item-${server.id}`}
                      className="border-b border-border hover:bg-muted/50 transition-colors"
                    >
                      <td className="p-3">
                        <div className="font-medium">{server.name}</div>
                        <div className="text-xs text-muted-foreground">{server.guid.substring(0, 8)}...</div>
                      </td>
                      <td className="p-3">
                        <code className="text-sm bg-muted px-2 py-1 rounded">{server.ip}</code>
                      </td>
                      <td className="p-3 text-center">
                        {server.verified ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Sim
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="w-3 h-3 mr-1" />
                            Não
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
    </div>
  );
};

export default Servers;