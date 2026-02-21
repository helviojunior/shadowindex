import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, RefreshCw, Plus, Trash2, ChevronUp, Settings, Plug } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PluginSoapConfig = () => {
  const [pluginInfo, setPluginInfo] = useState(null);
  const [soapApis, setSoapApis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', uri: '' });
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pluginRes, apisRes] = await Promise.all([
        axios.get(`${API}/plugins/soap_api`),
        axios.get(`${API}/soap-apis`)
      ]);
      setPluginInfo(pluginRes.data);
      setSoapApis(apisRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const testSoapApi = async (soapApi) => {
    setTestingId(soapApi.id);
    try {
      const response = await axios.post(`${API}/plugins/soap_api/health`, {
        soap_url: soapApi.uri
      });
      
      setTestResults(prev => ({
        ...prev,
        [soapApi.id]: response.data
      }));
      
      if (response.data.healthy) {
        toast.success(`${soapApi.name}: Conexão OK`);
      } else {
        toast.error(`${soapApi.name}: ${response.data.message}`);
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [soapApi.id]: { healthy: false, message: error.message }
      }));
      toast.error(`Erro ao testar: ${error.message}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      await axios.post(`${API}/soap-apis`, formData);
      toast.success('SOAP API cadastrada com sucesso');
      setFormData({ name: '', uri: '' });
      setShowAddForm(false);
      loadData();
    } catch (error) {
      console.error('Error creating SOAP API:', error);
      toast.error('Erro ao cadastrar SOAP API');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/soap-apis/${id}`);
      toast.success('SOAP API removida com sucesso');
      loadData();
    } catch (error) {
      console.error('Error deleting SOAP API:', error);
      toast.error('Erro ao remover SOAP API');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="plugin-soap-config-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SOAP Plugin</h1>
          <p className="text-muted-foreground mt-2">Configure as URLs do plugin SOAP API</p>
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
              Adicionar URL
            </>
          )}
        </Button>
      </div>

      {/* Plugin Info Card */}
      {pluginInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="w-5 h-5" />
              Informações do Plugin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Nome</div>
                <div className="font-medium">{pluginInfo.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Tipo</div>
                <Badge variant="outline">{pluginInfo.type}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Versão</div>
                <div className="font-medium">{pluginInfo.version}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Descrição</div>
                <div className="text-sm text-muted-foreground">{pluginInfo.description}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nova SOAP API</CardTitle>
            <CardDescription>Adicione uma nova URL de API SOAP</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    data-testid="soap-api-name-input"
                    placeholder="Minha API SOAP"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uri">URI (WSDL)</Label>
                  <Input
                    id="uri"
                    data-testid="soap-api-uri-input"
                    type="url"
                    placeholder="https://exemplo.com/api.asmx?WSDL"
                    value={formData.uri}
                    onChange={(e) => setFormData({ ...formData, uri: e.target.value })}
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={formLoading} data-testid="add-soap-api-btn">
                {formLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Adicionar SOAP API
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            URLs Configuradas
          </CardTitle>
          <CardDescription>{soapApis.length} APIs configuradas</CardDescription>
        </CardHeader>
        <CardContent>
          {soapApis.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma SOAP API cadastrada</p>
          ) : (
            <div className="space-y-3">
              {soapApis.map((api) => {
                const result = testResults[api.id];
                return (
                  <div
                    key={api.id}
                    data-testid={`soap-api-item-${api.id}`}
                    className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Nome</div>
                        <div className="font-medium">{api.name}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs text-muted-foreground mb-1">URI</div>
                        <div className="font-mono text-sm break-all">{api.uri}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {/* Status Badge */}
                      {result && (
                        <Badge variant={result.healthy ? "default" : "destructive"} className="gap-1">
                          {result.healthy ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {result.healthy ? 'OK' : 'Erro'}
                        </Badge>
                      )}
                      
                      {/* Test Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testSoapApi(api)}
                        disabled={testingId === api.id}
                        data-testid={`test-soap-api-${api.id}`}
                      >
                        {testingId === api.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                      
                      {/* Delete Button */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(api.id)}
                        data-testid={`delete-soap-api-${api.id}`}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config Schema Card */}
      {pluginInfo?.config_schema && (
        <Card>
          <CardHeader>
            <CardTitle>Esquema de Configuração</CardTitle>
            <CardDescription>Campos disponíveis para configuração do plugin</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(pluginInfo.config_schema.properties || {}).map(([key, prop]) => (
                <div key={key} className="flex items-start gap-3 p-3 border border-border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{key}</span>
                      {pluginInfo.config_schema.required?.includes(key) && (
                        <Badge variant="destructive" className="text-[10px]">obrigatório</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">{prop.type}</Badge>
                    </div>
                    {prop.description && (
                      <div className="text-sm text-muted-foreground mt-1">{prop.description}</div>
                    )}
                  </div>
                  {prop.default !== undefined && (
                    <div className="text-sm text-muted-foreground">
                      default: <span className="font-mono">{String(prop.default)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PluginSoapConfig;
