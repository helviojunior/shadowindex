import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, Plus, CheckCircle, XCircle, Play, Code, Database, Loader2, Zap, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { getDatabaseIcon } from '@/components/DatabaseIcons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DatabaseConnections = () => {
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [dbTypes, setDbTypes] = useState([]);
  const [formData, setFormData] = useState({ name: '', db_type_id: '', connection_string: '' });
  const [loading, setLoading] = useState(false);
  const [testingConnectionId, setTestingConnectionId] = useState(null);
  
  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);
  const [editFormData, setEditFormData] = useState({ name: '', db_type_id: '', connection_string: '' });
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    loadConnections();
    loadDbTypes();
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

  const loadDbTypes = async () => {
    try {
      const response = await axios.get(`${API}/db-types`);
      setDbTypes(response.data);
    } catch (error) {
      console.error('Error loading db types:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        connection_string: formData.connection_string,
        db_type_id: formData.db_type_id ? parseInt(formData.db_type_id) : null
      };
      
      await axios.post(`${API}/db-connections`, payload);
      toast.success('Conexão cadastrada com sucesso');
      setFormData({ name: '', db_type_id: '', connection_string: '' });
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

  // Test connection function
  const testConnection = async (connId) => {
    setTestingConnectionId(connId);
    try {
      const response = await axios.post(`${API}/sql/execute`, {
        connection_id: connId,
        query: 'SELECT 1 AS test'
      });

      if (response.data.success) {
        toast.success(`Conexão OK! (${response.data.execution_time_ms}ms)`);
        loadConnections(); // Reload to update verified status
      } else {
        toast.error(`Falha na conexão: ${response.data.error_message}`);
      }
    } catch (error) {
      toast.error(`Erro ao testar: ${error.response?.data?.detail || error.message}`);
    } finally {
      setTestingConnectionId(null);
    }
  };

  // Edit connection functions
  const openEditModal = (conn) => {
    setEditingConnection(conn);
    setEditFormData({
      name: conn.name,
      db_type_id: conn.db_type_id?.toString() || '',
      connection_string: conn.connection_string
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditLoading(true);

    try {
      const payload = {
        name: editFormData.name,
        connection_string: editFormData.connection_string,
        db_type_id: editFormData.db_type_id ? parseInt(editFormData.db_type_id) : null
      };
      
      await axios.put(`${API}/db-connections/${editingConnection.id}`, payload);
      toast.success('Conexão atualizada com sucesso');
      setEditModalOpen(false);
      setEditingConnection(null);
      loadConnections();
    } catch (error) {
      console.error('Error updating connection:', error);
      toast.error('Erro ao atualizar conexão');
    } finally {
      setEditLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '---';
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
            <div className="grid grid-cols-2 gap-4">
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
                <Label htmlFor="db_type">Tipo de Banco</Label>
                <Select
                  value={formData.db_type_id}
                  onValueChange={(value) => setFormData({ ...formData, db_type_id: value })}
                >
                  <SelectTrigger data-testid="db-type-select">
                    <SelectValue placeholder="Selecione o tipo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {dbTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id.toString()}>
                        <div className="flex items-center gap-2">
                          {getDatabaseIcon(type.name, "w-4 h-4")}
                          {type.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="connection_string">Connection String</Label>
              <Textarea
                id="connection_string"
                data-testid="db-connection-string-input"
                placeholder="Server=localhost;Database=mydb;User=admin;Password=pass;"
                value={formData.connection_string}
                onChange={(e) => setFormData({ ...formData, connection_string: e.target.value })}
                rows={2}
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

      {/* Connections Table */}
      <Card>
        <CardHeader>
          <CardTitle>Conexões Cadastradas</CardTitle>
          <CardDescription>{connections.length} conexões no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Database className="w-12 h-12 mb-4 opacity-30" />
              <p>Nenhuma conexão cadastrada</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Nome</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Tipo</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Connection String</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Última Verificação</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((conn) => (
                    <tr 
                      key={conn.id} 
                      className="border-t border-border hover:bg-muted/50 transition-colors"
                      data-testid={`db-connection-row-${conn.id}`}
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openSqlExecutor(conn.id)}
                          className="font-medium hover:text-primary transition-colors cursor-pointer"
                          data-testid={`open-executor-${conn.id}`}
                        >
                          {conn.name}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {conn.db_type_name ? (
                          <div className="flex items-center gap-2">
                            {getDatabaseIcon(conn.db_type_name, "w-5 h-5")}
                            <span className="text-sm">{conn.db_type_name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-muted px-2 py-1 rounded max-w-xs truncate block">
                          {conn.connection_string.length > 50 
                            ? conn.connection_string.substring(0, 50) + '...' 
                            : conn.connection_string}
                        </code>
                      </td>
                      <td className="px-4 py-3">
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
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatDate(conn.last_verified_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(conn)}
                            data-testid={`edit-connection-${conn.id}`}
                            title="Editar Conexão"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => testConnection(conn.id)}
                            disabled={testingConnectionId === conn.id}
                            data-testid={`test-connection-${conn.id}`}
                            title="Testar Conexão"
                          >
                            {testingConnectionId === conn.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                          </Button>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Connection Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editar Conexão</DialogTitle>
            <DialogDescription>
              Atualize as informações da conexão de banco de dados
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nome</Label>
                <Input
                  id="edit-name"
                  data-testid="edit-connection-name-input"
                  placeholder="Nome da conexão"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-db-type">Tipo de Banco</Label>
                <Select
                  value={editFormData.db_type_id}
                  onValueChange={(value) => setEditFormData({ ...editFormData, db_type_id: value })}
                >
                  <SelectTrigger data-testid="edit-db-type-select">
                    <SelectValue placeholder="Selecione o tipo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {dbTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id.toString()}>
                        <div className="flex items-center gap-2">
                          {getDatabaseIcon(type.name, "w-4 h-4")}
                          {type.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-connection-string">Connection String</Label>
                <Textarea
                  id="edit-connection-string"
                  data-testid="edit-connection-string-input"
                  placeholder="Server=localhost;Database=mydb;User=admin;Password=pass;"
                  value={editFormData.connection_string}
                  onChange={(e) => setEditFormData({ ...editFormData, connection_string: e.target.value })}
                  rows={3}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editLoading} data-testid="save-edit-connection-btn">
                {editLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DatabaseConnections;
