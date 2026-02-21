import { useEffect, useState } from 'react';
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
import { Trash2, Plus, Pencil, Check, X, Code, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { getDatabaseIcon, GenericDbIcon } from '@/components/DatabaseIcons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SqlPresets = () => {
  const [presets, setPresets] = useState([]);
  const [dbTypes, setDbTypes] = useState([]);
  const [formData, setFormData] = useState({ db_type_id: '', name: '', query: '', description: '' });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({ db_type_id: '', name: '', query: '', description: '' });
  const [filterDbType, setFilterDbType] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadDbTypes();
    loadPresets();
  }, []);

  const loadDbTypes = async () => {
    try {
      const response = await axios.get(`${API}/db-types`);
      setDbTypes(response.data);
    } catch (error) {
      console.error('Error loading db types:', error);
    }
  };

  const loadPresets = async () => {
    try {
      const response = await axios.get(`${API}/sql-presets`);
      setPresets(response.data);
    } catch (error) {
      console.error('Error loading presets:', error);
      toast.error('Erro ao carregar presets');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        query: formData.query,
        description: formData.description || null,
        db_type_id: formData.db_type_id && formData.db_type_id !== 'universal' ? parseInt(formData.db_type_id) : null
      };
      
      await axios.post(`${API}/sql-presets`, payload);
      toast.success('Preset cadastrado com sucesso');
      setFormData({ db_type_id: '', name: '', query: '', description: '' });
      loadPresets();
    } catch (error) {
      console.error('Error creating preset:', error);
      toast.error('Erro ao cadastrar preset');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/sql-presets/${id}`);
      toast.success('Preset removido com sucesso');
      loadPresets();
    } catch (error) {
      console.error('Error deleting preset:', error);
      toast.error('Erro ao remover preset');
    }
  };

  const startEditing = (preset) => {
    setEditingId(preset.id);
    setEditData({
      db_type_id: preset.db_type_id ? preset.db_type_id.toString() : '',
      name: preset.name,
      query: preset.query,
      description: preset.description || ''
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData({ db_type_id: '', name: '', query: '', description: '' });
  };

  const saveEditing = async () => {
    try {
      const payload = {
        name: editData.name,
        query: editData.query,
        description: editData.description || null,
        db_type_id: editData.db_type_id && editData.db_type_id !== 'universal' ? parseInt(editData.db_type_id) : null
      };
      
      await axios.put(`${API}/sql-presets/${editingId}`, payload);
      toast.success('Preset atualizado com sucesso');
      setEditingId(null);
      loadPresets();
    } catch (error) {
      console.error('Error updating preset:', error);
      toast.error('Erro ao atualizar preset');
    }
  };

  const filteredPresets = filterDbType === 'all' 
    ? presets 
    : filterDbType === 'universal'
      ? presets.filter(p => !p.db_type_id)
      : presets.filter(p => p.db_type_id === parseInt(filterDbType));

  const getDbTypeColor = (dbTypeId) => {
    const type = dbTypes.find(t => t.id === dbTypeId);
    return type?.color || '#666';
  };

  return (
    <div className="space-y-6" data-testid="sql-presets-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SQL Presets</h1>
          <p className="text-muted-foreground mt-2">Gerencie comandos SQL pré-definidos por tipo de banco</p>
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
              Adicionar Preset
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Novo Preset</CardTitle>
            <CardDescription>Adicione um novo comando SQL pré-definido</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="db_type">Tipo de Banco</Label>
                  <Select
                    value={formData.db_type_id}
                    onValueChange={(value) => setFormData({ ...formData, db_type_id: value })}
                  >
                    <SelectTrigger data-testid="preset-db-type-select">
                      <SelectValue placeholder="Universal (todos)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="universal">
                        <div className="flex items-center gap-2">
                          <GenericDbIcon className="w-4 h-4" color="#888" />
                          Universal (todos)
                        </div>
                      </SelectItem>
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
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    data-testid="preset-name-input"
                    placeholder="Ex: List Users"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Descrição (opcional)</Label>
                  <Input
                    id="description"
                    data-testid="preset-description-input"
                    placeholder="Ex: Lista todos os usuários"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="query">Query SQL</Label>
                <Textarea
                  id="query"
                  data-testid="preset-query-input"
                  placeholder="SELECT * FROM users WHERE active = 1"
                  value={formData.query}
                  onChange={(e) => setFormData({ ...formData, query: e.target.value })}
                  rows={3}
                  className="font-mono text-sm"
                  required
                />
              </div>
              <Button type="submit" disabled={loading} data-testid="add-preset-btn">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Preset
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Presets Cadastrados</CardTitle>
              <CardDescription>{presets.length} presets no sistema</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Filtrar:</Label>
              <Select value={filterDbType} onValueChange={setFilterDbType}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="universal">Universal</SelectItem>
                  {dbTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id.toString()}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: type.color || '#666' }}
                        />
                        {type.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredPresets.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum preset encontrado</p>
          ) : (
            <div className="space-y-3">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  data-testid={`preset-item-${preset.id}`}
                  className="p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {editingId === preset.id ? (
                    // Edit Mode
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <Select
                          value={editData.db_type_id || 'universal'}
                          onValueChange={(value) => setEditData({ ...editData, db_type_id: value === 'universal' ? '' : value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Universal" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="universal">Universal</SelectItem>
                            {dbTypes.map((type) => (
                              <SelectItem key={type.id} value={type.id.toString()}>
                                {type.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={editData.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          placeholder="Nome"
                          data-testid={`edit-name-${preset.id}`}
                        />
                        <Input
                          value={editData.description}
                          onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                          placeholder="Descrição"
                          data-testid={`edit-description-${preset.id}`}
                        />
                      </div>
                      <Textarea
                        value={editData.query}
                        onChange={(e) => setEditData({ ...editData, query: e.target.value })}
                        rows={3}
                        className="font-mono text-sm"
                        data-testid={`edit-query-${preset.id}`}
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={saveEditing} data-testid={`save-edit-${preset.id}`}>
                          <Check className="w-4 h-4 mr-1" />
                          Salvar
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEditing}>
                          <X className="w-4 h-4 mr-1" />
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Code className="w-4 h-4 text-primary" />
                          <span className="font-medium">{preset.name}</span>
                          <Badge 
                            variant="outline" 
                            className="text-xs"
                            style={{ 
                              borderColor: preset.db_type_id ? getDbTypeColor(preset.db_type_id) : '#666',
                              color: preset.db_type_id ? getDbTypeColor(preset.db_type_id) : '#666'
                            }}
                          >
                            {preset.db_type_name || 'Universal'}
                          </Badge>
                        </div>
                        {preset.description && (
                          <p className="text-sm text-muted-foreground">{preset.description}</p>
                        )}
                        <pre className="font-mono text-sm bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
                          {preset.query}
                        </pre>
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEditing(preset)}
                          data-testid={`edit-preset-${preset.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(preset.id)}
                          data-testid={`delete-preset-${preset.id}`}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
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

export default SqlPresets;
