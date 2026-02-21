import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, CheckCircle, XCircle, HardDrive, Download, Network, Pencil, X, Check, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Função para validar se é um IP válido
const isValidIp = (ip) => {
  if (!ip) return false;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
};

const Servers = () => {
  const navigate = useNavigate();
  const { ignoreCache } = useApp();
  const [servers, setServers] = useState([]);
  const [formData, setFormData] = useState({ name: '', ip: '' });
  const [loading, setLoading] = useState(false);
  const [resolvingIp, setResolvingIp] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [editIp, setEditIp] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

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

  const handleEditIp = (server) => {
    setEditingServer(server.id);
    setEditIp(server.ip);
  };

  const handleCancelEdit = () => {
    setEditingServer(null);
    setEditIp('');
  };

  const handleSaveIp = async (serverId) => {
    if (!editIp.trim()) {
      toast.error('IP não pode estar vazio');
      return;
    }

    if (!isValidIp(editIp.trim())) {
      toast.error('IP inválido. Use o formato: 192.168.1.100');
      return;
    }

    try {
      await axios.patch(`${API}/servers/${serverId}`, { ip: editIp.trim() });
      toast.success('IP atualizado com sucesso');
      setEditingServer(null);
      setEditIp('');
      loadServers();
    } catch (error) {
      console.error('Error updating server IP:', error);
      toast.error('Erro ao atualizar IP');
    }
  };

  const handleResolveIp = async () => {
    if (!formData.name) {
      toast.error('Digite o nome do servidor primeiro');
      return;
    }

    setResolvingIp(true);
    try {
      // Usar endpoint que prioriza IPv4
      const response = await axios.post(`${API}/soap/resolve-ipv4`, {
        operation: 'Resolve',
        s1: formData.name,
        s2: '',
        ignore_cache: ignoreCache
      });

      // O backend já retorna o IPv4 prioritário
      const result = response.data.result;
      
      if (result && result.trim()) {
        const ipAddress = result.trim();
        setFormData({ ...formData, ip: ipAddress });
        toast.success(`IP resolvido: ${ipAddress}`);
      } else {
        toast.error('Nenhum IP encontrado para este hostname');
      }
    } catch (error) {
      console.error('Error resolving IP:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao resolver IP. Verifique o nome do servidor.';
      toast.error(errorMsg);
    } finally {
      setResolvingIp(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Nunca';
    return new Date(dateString).toLocaleString('pt-BR');
  };

  return (
    <div className="space-y-6" data-testid="servers-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Servidores</h1>
          <p className="text-muted-foreground mt-2">Gerencie os servidores monitorados</p>
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
              Adicionar Servidor
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
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
                    placeholder="servidor.exemplo.com"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ip">Endereço IP</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ip"
                      data-testid="server-ip-input"
                      placeholder="192.168.1.100"
                      value={formData.ip}
                      onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleResolveIp}
                      disabled={resolvingIp || !formData.name}
                      data-testid="resolve-ip-btn"
                    >
                      <Network className="w-4 h-4 mr-2" />
                      {resolvingIp ? 'Resolvendo...' : 'Resolve IP'}
                    </Button>
                  </div>
                </div>
              </div>
              <Button type="submit" disabled={loading} data-testid="add-server-btn">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Servidor
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

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
                        <div 
                          className="font-medium cursor-pointer hover:text-primary transition-colors"
                          onClick={() => navigate(`/servers/${server.id}/browse`)}
                        >
                          {server.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{server.guid.substring(0, 8)}...</div>
                      </td>
                      <td className="p-3">
                        {editingServer === server.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editIp}
                              onChange={(e) => setEditIp(e.target.value)}
                              className="w-36 h-8 text-sm"
                              placeholder="192.168.1.100"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveIp(server.id);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              onClick={() => handleSaveIp(server.id)}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={handleCancelEdit}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <code className="text-sm bg-muted px-2 py-1 rounded">{server.ip}</code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => handleEditIp(server)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
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