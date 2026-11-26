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
import { Trash2, Plus, CheckCircle, XCircle, Play, Database, Loader2, Zap, Pencil, ChevronUp, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation, Trans } from 'react-i18next';
import { getDatabaseIcon } from '@/components/DatabaseIcons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DEFAULT_PORT_HINT = {
  mssql: '1433', mysql: '3306', mariadb: '3306',
  postgres: '5432', oracle: '1521', mongodb: '27017',
};
const DB_FIELD_LABELS = {
  oracle: { database: 'wizard.serviceNameSid' },
  sqlite: { database: 'wizard.filePath' },
};

/**
 * Wizard de conexão: coleta campos estruturados (host, porta, database,
 * usuário, senha, extras) e pede ao BACKEND para montar a connection string.
 * Também oferece um modo "Manual" para colar/editar a string diretamente.
 */
function ConnectionFields({ dbTypeId, dbTypes, value, onChange, defaultMode = 'wizard' }) {
  const { t } = useTranslation('database-connections');
  const dbType = dbTypes.find((d) => d.id?.toString() === (dbTypeId || '').toString());
  const code = dbType?.code || '';
  const isSqlite = code === 'sqlite';

  const [mode, setMode] = useState(defaultMode);
  const [fields, setFields] = useState({
    host: '', port: '', database: '', username: '', password: '',
    trust_server_certificate: false, extra: '',
  });
  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));

  // Monta a string no backend sempre que algum campo ou o tipo mudar (modo wizard).
  useEffect(() => {
    if (mode !== 'wizard') return;
    if (!fields.host && !fields.database && !fields.username) return;
    const timer = setTimeout(async () => {
      try {
        const res = await axios.post(`${API}/db-connections/build`, {
          db_type_id: dbTypeId ? parseInt(dbTypeId) : null,
          db_type_code: code || null,
          host: fields.host || null,
          port: fields.port ? parseInt(fields.port) : null,
          database: fields.database || null,
          username: fields.username || null,
          password: fields.password || null,
          options: {
            trust_server_certificate: fields.trust_server_certificate,
            extra: fields.extra || null,
          },
        });
        onChange(res.data.connection_string || '');
      } catch (e) {
        // silencioso: preview apenas
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, dbTypeId, code, mode]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>{t('wizard.connectionString')}</Label>
        <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden text-xs">
          <button type="button" data-testid="conn-mode-wizard"
            className={`px-3 py-1 ${mode === 'wizard' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            onClick={() => setMode('wizard')}>{t('wizard.modeWizard')}</button>
          <button type="button" data-testid="conn-mode-manual"
            className={`px-3 py-1 ${mode === 'manual' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            onClick={() => setMode('manual')}>{t('wizard.modeManual')}</button>
        </div>
      </div>

      {!dbTypeId && mode === 'wizard' && (
        <p className="text-xs text-amber-500"><Trans t={t} i18nKey="wizard.selectDbTypeHint" components={{ strong: <strong /> }} /></p>
      )}

      {mode === 'wizard' ? (
        <div className="space-y-3">
          {!isSqlite && (
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">{t('common:fields.host')}</Label>
                <Input data-testid="wiz-host" placeholder="10.0.0.5 / db.local"
                  value={fields.host} onChange={(e) => set('host', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('common:fields.port')}</Label>
                <Input data-testid="wiz-port" placeholder={DEFAULT_PORT_HINT[code] || t('wizard.portPlaceholder')}
                  value={fields.port} onChange={(e) => set('port', e.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">{DB_FIELD_LABELS[code]?.database ? t(DB_FIELD_LABELS[code].database) : t('wizard.database')}</Label>
            <Input data-testid="wiz-database" placeholder={isSqlite ? t('wizard.sqlitePathPlaceholder') : t('wizard.databasePlaceholder')}
              value={fields.database} onChange={(e) => set('database', e.target.value)} />
          </div>
          {!isSqlite && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('common:fields.username')}</Label>
                <Input data-testid="wiz-username" value={fields.username}
                  onChange={(e) => set('username', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('common:fields.password')}</Label>
                <Input data-testid="wiz-password" type="password" value={fields.password}
                  onChange={(e) => set('password', e.target.value)} />
              </div>
            </div>
          )}
          {code === 'mssql' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={fields.trust_server_certificate}
                onChange={(e) => set('trust_server_certificate', e.target.checked)} />
              {t('wizard.trustServerCertificate')}
            </label>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('wizard.extraParams')}</Label>
            <Input data-testid="wiz-extra" placeholder={t('wizard.extraPlaceholder')}
              value={fields.extra} onChange={(e) => set('extra', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('wizard.generatedString')}</Label>
            <code data-testid="wiz-preview" className="block text-xs bg-muted px-3 py-2 rounded break-all min-h-[2.25rem]">
              {value || <span className="text-muted-foreground">{t('wizard.fillFieldsAbove')}</span>}
            </code>
          </div>
        </div>
      ) : (
        <Textarea
          data-testid="conn-manual-input"
          placeholder="Server=localhost;Database=mydb;User=admin;Password=pass;"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      )}
    </div>
  );
}

const DatabaseConnections = () => {
  const { t } = useTranslation('database-connections');
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [dbTypes, setDbTypes] = useState([]);
  const [pluginInstances, setPluginInstances] = useState([]);
  const [formData, setFormData] = useState({ 
    name: '', 
    db_type_id: '', 
    connection_string: '',
    plugin_instance_id: ''
  });
  const [loading, setLoading] = useState(false);
  const [testingConnectionId, setTestingConnectionId] = useState(null);
  const [testingNewConnection, setTestingNewConnection] = useState(false);
  const [newConnectionTestResult, setNewConnectionTestResult] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState(null);
  const [editFormData, setEditFormData] = useState({ 
    name: '', 
    db_type_id: '', 
    connection_string: '',
    plugin_instance_id: ''
  });
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    loadConnections();
    loadDbTypes();
    loadPluginInstances();
  }, []);

  const loadConnections = async () => {
    try {
      const response = await axios.get(`${API}/db-connections`);
      setConnections(response.data);
    } catch (error) {
      console.error('Error loading connections:', error);
      toast.error(t('toast.loadError'));
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

  const loadAvailablePlugins = async () => {
    try {
      const response = await axios.get(`${API}/plugins`);
      // Keep this for backwards compatibility but not used
    } catch (error) {
      console.error('Error loading plugins:', error);
    }
  };

  const loadPluginInstances = async () => {
    try {
      const response = await axios.get(`${API}/plugin-instances`);
      setPluginInstances(response.data || []);
    } catch (error) {
      console.error('Error loading plugin instances:', error);
      setPluginInstances([]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        connection_string: formData.connection_string,
        db_type_id: formData.db_type_id ? parseInt(formData.db_type_id) : null,
        plugin_instance_id: formData.plugin_instance_id ? parseInt(formData.plugin_instance_id) : null
      };
      
      await axios.post(`${API}/db-connections`, payload);
      toast.success(t('toast.createSuccess'));
      setFormData({ name: '', db_type_id: '', connection_string: '', plugin_instance_id: '' });
      setNewConnectionTestResult(null);
      setShowAddForm(false);
      loadConnections();
    } catch (error) {
      console.error('Error creating connection:', error);
      toast.error(t('toast.createError'));
    } finally {
      setLoading(false);
    }
  };

  // Test new connection before adding
  const testNewConnection = async () => {
    if (!formData.connection_string) {
      toast.error(t('toast.fillConnectionString'));
      return;
    }
    
    setTestingNewConnection(true);
    setNewConnectionTestResult(null);
    
    try {
      // Create a temporary connection to test
      const tempPayload = {
        name: `_temp_test_${Date.now()}`,
        connection_string: formData.connection_string,
        db_type_id: formData.db_type_id ? parseInt(formData.db_type_id) : null,
        plugin_instance_id: formData.plugin_instance_id ? parseInt(formData.plugin_instance_id) : null
      };
      
      // Create temp connection
      const createResponse = await axios.post(`${API}/db-connections`, tempPayload);
      const tempConnId = createResponse.data.id;
      
      try {
        // Test the connection
        const testResponse = await axios.post(`${API}/sql/execute`, {
          connection_id: tempConnId,
          query: 'SELECT 1 AS test'
        });

        if (testResponse.data.success) {
          setNewConnectionTestResult('success');
          toast.success(t('toast.connectionOk', { ms: testResponse.data.execution_time_ms }));
        } else {
          setNewConnectionTestResult('error');
          toast.error(t('toast.connectionFailed', { error: testResponse.data.error_message }));
        }
      } finally {
        // Always delete the temp connection
        await axios.delete(`${API}/db-connections/${tempConnId}`);
      }
    } catch (error) {
      setNewConnectionTestResult('error');
      toast.error(t('toast.testError', { error: error.response?.data?.detail || error.message }));
    } finally {
      setTestingNewConnection(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/db-connections/${id}`);
      toast.success(t('toast.deleteSuccess'));
      loadConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast.error(t('toast.deleteError'));
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
        toast.success(t('toast.connectionOk', { ms: response.data.execution_time_ms }));
        loadConnections();
      } else {
        toast.error(t('toast.connectionFailed', { error: response.data.error_message }));
      }
    } catch (error) {
      toast.error(t('toast.testError', { error: error.response?.data?.detail || error.message }));
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
      connection_string: conn.connection_string,
      plugin_instance_id: conn.plugin_instance_id?.toString() || ''
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
        db_type_id: editFormData.db_type_id ? parseInt(editFormData.db_type_id) : null,
        plugin_instance_id: editFormData.plugin_instance_id ? parseInt(editFormData.plugin_instance_id) : null
      };
      
      await axios.put(`${API}/db-connections/${editingConnection.id}`, payload);
      toast.success(t('toast.updateSuccess'));
      setEditModalOpen(false);
      setEditingConnection(null);
      loadConnections();
    } catch (error) {
      console.error('Error updating connection:', error);
      toast.error(t('toast.updateError'));
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

  const getPluginLabel = (pluginInstanceId) => {
    if (!pluginInstanceId) return t('pluginLabel.notConfigured');
    const instance = pluginInstances.find(p => p.id === pluginInstanceId);
    return instance ? instance.name : t('pluginLabel.instance', { id: pluginInstanceId });
  };

  return (
    <div className="space-y-6" data-testid="db-connections-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
        </div>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          data-testid="toggle-add-form-btn"
          variant={showAddForm ? "secondary" : "default"}
        >
          {showAddForm ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              {t('common:actions.close')}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              {t('addConnection')}
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('newConnection')}</CardTitle>
            <CardDescription>{t('newConnectionDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('common:fields.name')}</Label>
                <Input
                  id="name"
                  data-testid="db-connection-name-input"
                  placeholder={t('namePlaceholder')}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="db_type">{t('dbType')}</Label>
                <Select
                  value={formData.db_type_id}
                  onValueChange={(value) => setFormData({ ...formData, db_type_id: value })}
                >
                  <SelectTrigger data-testid="db-type-select">
                    <SelectValue placeholder={t('selectTypePlaceholder')} />
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
                <Label htmlFor="plugin_instance">{t('pluginInstance')}</Label>
                <Select
                  value={formData.plugin_instance_id}
                  onValueChange={(value) => setFormData({ ...formData, plugin_instance_id: value })}
                >
                  <SelectTrigger data-testid="db-plugin-select">
                    <SelectValue placeholder={t('selectInstancePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {pluginInstances.map((instance) => (
                      <SelectItem key={instance.id} value={instance.id.toString()}>
                        <div className="flex items-center gap-2">
                          <Plug className="w-4 h-4" />
                          {instance.name}
                          <span className="text-xs text-muted-foreground">({instance.plugin_type})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ConnectionFields
              dbTypeId={formData.db_type_id}
              dbTypes={dbTypes}
              value={formData.connection_string}
              onChange={(cs) => {
                setFormData((f) => ({ ...f, connection_string: cs }));
                setNewConnectionTestResult(null);
              }}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={loading || !formData.connection_string} data-testid="add-db-connection-btn">
                <Plus className="w-4 h-4 mr-2" />
                {t('addConnection')}
              </Button>
              <Button 
                type="button" 
                variant="outline"
                onClick={testNewConnection}
                disabled={testingNewConnection || !formData.connection_string}
                data-testid="test-new-connection-btn"
              >
                {testingNewConnection ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                {t('testConnection')}
              </Button>
              {newConnectionTestResult === 'success' && (
                <Badge variant="outline" className="text-green-500 border-green-500">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {t('testResultOk')}
                </Badge>
              )}
              {newConnectionTestResult === 'error' && (
                <Badge variant="outline" className="text-red-500 border-red-500">
                  <XCircle className="w-3 h-3 mr-1" />
                  {t('testResultFailed')}
                </Badge>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      )}

      {/* Connections Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('registeredConnections')}</CardTitle>
          <CardDescription>{t('connectionsCount', { count: connections.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Database className="w-12 h-12 mb-4 opacity-30" />
              <p>{t('noConnections')}</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">{t('common:fields.name')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">{t('common:fields.type')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">{t('table.plugin')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">{t('table.connectionString')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">{t('common:fields.status')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">{t('common:fields.lastVerification')}</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">{t('common:fields.actions')}</th>
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
                          className="font-medium hover:text-primary hover:underline transition-colors cursor-pointer"
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
                        <div className="flex items-center gap-2 text-sm">
                          <Plug className="w-4 h-4 text-muted-foreground" />
                          {getPluginLabel(conn.plugin_instance_id)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-muted px-2 py-1 rounded max-w-xs truncate block">
                          {conn.connection_string.length > 40 
                            ? conn.connection_string.substring(0, 40) + '...' 
                            : conn.connection_string}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        {conn.verified ? (
                          <Badge variant="outline" className="text-green-500 border-green-500">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t('common:status.verified')}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <XCircle className="w-3 h-3 mr-1" />
                            {t('common:status.notVerified')}
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
                            title={t('editConnection')}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => testConnection(conn.id)}
                            disabled={testingConnectionId === conn.id}
                            data-testid={`test-connection-${conn.id}`}
                            title={t('testConnection')}
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
                            title={t('executeSql')}
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
            <DialogTitle>{t('editConnection')}</DialogTitle>
            <DialogDescription>
              {t('editConnectionDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">{t('common:fields.name')}</Label>
                <Input
                  id="edit-name"
                  data-testid="edit-connection-name-input"
                  placeholder={t('editNamePlaceholder')}
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-db-type">{t('dbType')}</Label>
                  <Select
                    value={editFormData.db_type_id}
                    onValueChange={(value) => setEditFormData({ ...editFormData, db_type_id: value })}
                  >
                    <SelectTrigger data-testid="edit-db-type-select">
                      <SelectValue placeholder={t('selectTypePlaceholder')} />
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
                  <Label htmlFor="edit-plugin-instance">{t('pluginInstance')}</Label>
                  <Select
                    value={editFormData.plugin_instance_id}
                    onValueChange={(value) => setEditFormData({ ...editFormData, plugin_instance_id: value })}
                  >
                    <SelectTrigger data-testid="edit-plugin-select">
                      <SelectValue placeholder={t('selectInstancePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {pluginInstances.map((instance) => (
                        <SelectItem key={instance.id} value={instance.id.toString()}>
                          <div className="flex items-center gap-2">
                            <Plug className="w-4 h-4" />
                            {instance.name}
                            <span className="text-xs text-muted-foreground">({instance.plugin_type})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ConnectionFields
                key={editingConnection?.id}
                dbTypeId={editFormData.db_type_id}
                dbTypes={dbTypes}
                value={editFormData.connection_string}
                defaultMode="manual"
                onChange={(cs) => setEditFormData((f) => ({ ...f, connection_string: cs }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditModalOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={editLoading || !editFormData.connection_string} data-testid="save-edit-connection-btn">
                {editLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t('common:actions.saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DatabaseConnections;
