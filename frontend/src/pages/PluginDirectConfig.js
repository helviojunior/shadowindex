import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle, XCircle, RefreshCw, Plus, Trash2, Plug, Network, Key, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PluginDirectConfig = () => {
  const [pluginInfo, setPluginInfo] = useState(null);
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Test config form
  const [testConfig, setTestConfig] = useState({
    credential_id: 'none',
    dns_mode: 'system',
    dns_servers: '',
    test_hostname: 'google.com'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pluginRes, credRes] = await Promise.all([
        axios.get(`${API}/plugins/direct_interaction`),
        axios.get(`${API}/credentials/by-type/user_password`)  // Only user_password type
      ]);
      setPluginInfo(pluginRes.data);
      setCredentials(credRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erro ao carregar dados do plugin');
    } finally {
      setLoading(false);
    }
  };

  const testPlugin = async () => {
    setTesting(true);
    setTestResult(null);
    
    try {
      const config = {
        credential_id: testConfig.credential_id && testConfig.credential_id !== 'none' 
          ? parseInt(testConfig.credential_id) 
          : null,
        dns_mode: testConfig.dns_mode,
        dns_servers: testConfig.dns_mode === 'custom' && testConfig.dns_servers
          ? testConfig.dns_servers.split(',').map(s => s.trim()).filter(Boolean)
          : []
      };
      
      const response = await axios.post(`${API}/plugins/direct_interaction/health`, config);
      setTestResult(response.data);
      
      if (response.data.healthy) {
        toast.success('Plugin funcionando corretamente');
      } else {
        toast.error(`Erro: ${response.data.message}`);
      }
    } catch (error) {
      setTestResult({ healthy: false, message: error.message });
      toast.error(`Erro ao testar: ${error.message}`);
    } finally {
      setTesting(false);
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
    <div className="space-y-6" data-testid="plugin-direct-config-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Interação Direta</h1>
          <p className="text-muted-foreground mt-2">Plugin para interação direta com servidores (DNS, SMB futuro)</p>
        </div>
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

      {/* Test Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            Testar Configuração
          </CardTitle>
          <CardDescription>Configure e teste a resolução DNS do plugin</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Credential Selector */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                Credencial (tipo Usuário/Senha)
              </Label>
              <Select 
                value={testConfig.credential_id} 
                onValueChange={(value) => setTestConfig({ ...testConfig, credential_id: value })}
              >
                <SelectTrigger data-testid="credential-selector">
                  <SelectValue placeholder="Selecione uma credencial" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {credentials.map((cred) => (
                    <SelectItem key={cred.id} value={cred.id.toString()}>
                      {cred.name || `${cred.domain || ''}\\${cred.username}`}
                      {cred.verified && ' ✓'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Apenas credenciais do tipo Usuário/Senha são suportadas para SMB
              </p>
            </div>

            <div className="space-y-2">
              <Label>Modo DNS</Label>
              <Select 
                value={testConfig.dns_mode} 
                onValueChange={(value) => setTestConfig({ ...testConfig, dns_mode: value })}
              >
                <SelectTrigger data-testid="dns-mode-selector">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Padrão do Sistema Operacional</SelectItem>
                  <SelectItem value="custom">Servidores Personalizados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Custom DNS Servers */}
          {testConfig.dns_mode === 'custom' && (
            <div className="space-y-2">
              <Label>Servidores DNS (separados por vírgula)</Label>
              <Input
                placeholder="8.8.8.8, 8.8.4.4"
                value={testConfig.dns_servers}
                onChange={(e) => setTestConfig({ ...testConfig, dns_servers: e.target.value })}
                data-testid="dns-servers-input"
              />
              <p className="text-xs text-muted-foreground">
                Informe um ou mais IPs de servidores DNS separados por vírgula
              </p>
            </div>
          )}

          {/* Test Hostname */}
          <div className="space-y-2">
            <Label>Hostname para Teste</Label>
            <Input
              placeholder="google.com"
              value={testConfig.test_hostname}
              onChange={(e) => setTestConfig({ ...testConfig, test_hostname: e.target.value })}
              data-testid="test-hostname-input"
            />
          </div>

          {/* Test Button */}
          <Button onClick={testPlugin} disabled={testing} data-testid="test-plugin-btn">
            {testing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Testar Plugin
          </Button>

          {/* Test Result */}
          {testResult && (
            <div className={`p-4 rounded-lg border ${testResult.healthy ? 'bg-green-500/10 border-green-500' : 'bg-red-500/10 border-red-500'}`}>
              <div className="flex items-center gap-2 mb-2">
                {testResult.healthy ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
                <span className="font-medium">
                  {testResult.healthy ? 'Sucesso' : 'Falha'}
                </span>
              </div>
              <p className="text-sm">{testResult.message}</p>
              {testResult.details && Object.keys(testResult.details).length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <pre>{JSON.stringify(testResult.details, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Features Card */}
      <Card>
        <CardHeader>
          <CardTitle>Funcionalidades</CardTitle>
          <CardDescription>Status das funcionalidades do plugin</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-green-500" />
                <div>
                  <div className="font-medium">Resolução DNS</div>
                  <div className="text-sm text-muted-foreground">
                    Resolver nomes de domínio para IP com suporte a DNS personalizado e proxy SOCKS
                  </div>
                </div>
              </div>
              <Badge variant="default" className="bg-green-500">Implementado</Badge>
            </div>
            
            <div className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-green-500" />
                <div>
                  <div className="font-medium">Listagem de Compartilhamentos (SMB)</div>
                  <div className="text-sm text-muted-foreground">
                    Listar compartilhamentos de rede via protocolo SMB usando impacket
                  </div>
                </div>
              </div>
              <Badge variant="default" className="bg-green-500">Implementado</Badge>
            </div>
            
            <div className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-green-500" />
                <div>
                  <div className="font-medium">Navegação de Diretórios (SMB)</div>
                  <div className="text-sm text-muted-foreground">
                    Navegar diretórios em compartilhamentos de rede
                  </div>
                </div>
              </div>
              <Badge variant="default" className="bg-green-500">Implementado</Badge>
            </div>
            
            <div className="flex items-center justify-between p-3 border border-border rounded-lg">
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-green-500" />
                <div>
                  <div className="font-medium">Download de Arquivos (SMB)</div>
                  <div className="text-sm text-muted-foreground">
                    Baixar arquivos diretamente via protocolo SMB
                  </div>
                </div>
              </div>
              <Badge variant="default" className="bg-green-500">Implementado</Badge>
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-lg opacity-60">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="font-medium">Execução SQL Direta</div>
                  <div className="text-sm text-muted-foreground">
                    Execução de queries SQL via conexão direta
                  </div>
                </div>
              </div>
              <Badge variant="outline">Não Implementado</Badge>
            </div>
          </div>
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
                    {prop.enum && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Valores: {prop.enum.join(', ')}
                      </div>
                    )}
                  </div>
                  {prop.default !== undefined && (
                    <div className="text-sm text-muted-foreground">
                      default: <span className="font-mono">{JSON.stringify(prop.default)}</span>
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

export default PluginDirectConfig;
