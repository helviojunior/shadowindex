import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, CheckCircle, XCircle, Play, Code } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DatabaseConnections = () => {
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [formData, setFormData] = useState({ name: '', connection_string: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const response = await axios.get(`${API}/db-connections`);
      setConnections(response.data);
    } catch (error) {
      console.error('Error loading connections:', error);
      toast.error('Erro ao carregar conexões');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(`${API}/db-connections`, formData);
      toast.success('Conexão cadastrada com sucesso');
      setFormData({ name: '', connection_string: '' });
      loadConnections();
    } catch (error) {
      console.error('Error creating connection:', error);
      toast.error('Erro ao cadastrar conexão');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/db-connections/${id}`);
      toast.success('Conexão removida com sucesso');
      loadConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast.error('Erro ao remover conexão');
    }
  };

  const openSqlExecutor = (connId) => {
    navigate(`/sql/execute/${connId}`);
  };

  const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
      return new Date(dateString).toLocaleString('pt-BR');
    } catch {
      return dateString;
    }
  };

  return (
    <div className="space-y-6" data-testid="db-connections-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Conexões SQL</h1>
          <p className="text-muted-foreground mt-2">Gerencie as conexões com bancos de dados</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/sql/presets')} data-testid="manage-presets-btn">
          <Code className="w-4 h-4 mr-2" />
          Gerenciar Presets
        </Button>
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle>Nova Conexão</CardTitle>
          <CardDescription>Adicione uma nova conexão de banco de dados</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                data-testid="db-connection-name-input"
                placeholder="Minha Conexão"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="connection_string">Connection String</Label>
              <Textarea
                id="connection_string"
                data-testid="db-connection-string-input"
                placeholder="Server=localhost;Database=mydb;User=admin;Password=pass;"
                value={formData.connection_string}
                onChange={(e) => setFormData({ ...formData, connection_string: e.target.value })}
                rows={3}
                required
              />
            </div>
            <Button type="submit" disabled={loading} data-testid="add-db-connection-btn">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Conexão
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List Card */}
      <Card>
        <CardHeader>
          <CardTitle>Conexões Cadastradas</CardTitle>
          <CardDescription>{connections.length} conexões no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma conexão cadastrada</p>
          ) : (
            <div className="space-y-3">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  data-testid={`db-connection-item-${conn.id}`}
                  className="p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2 min-w-0">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openSqlExecutor(conn.id)}
                          className="font-medium text-lg hover:text-primary transition-colors cursor-pointer"
                          data-testid={`open-executor-${conn.id}`}
                        >
                          {conn.name}
                        </button>
                        {conn.verified ? (
                          <Badge variant="outline" className="text-green-500 border-green-500">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Verificado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <XCircle className="w-3 h-3 mr-1" />
                            Não verificado
                          </Badge>
                        )}
                      </div>
                      {conn.last_verified_at && (
                        <p className="text-xs text-muted-foreground">
                          Última verificação: {formatDate(conn.last_verified_at)}
                        </p>
                      )}
                      <div className="font-mono text-sm bg-muted p-2 rounded break-all">
                        {conn.connection_string}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openSqlExecutor(conn.id)}
                        data-testid={`execute-sql-${conn.id}`}
                        title="Executar SQL"
                      >
                        <Play className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(conn.id)}
                        data-testid={`delete-db-connection-${conn.id}`}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DatabaseConnections;