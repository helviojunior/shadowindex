import { useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlayCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SoapOperations = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const { ignoreCache } = useApp();

  // Form states for each operation
  const [resolveForm, setResolveForm] = useState({ s1: '' });
  const [sharesForm, setSharesForm] = useState({ s1: '' });
  const [execForm, setExecForm] = useState({ connStr: '', query: '' });
  const [exec4Form, setExec4Form] = useState({ s1: '' });
  const [exec5Form, setExec5Form] = useState({ s1: '' });

  const handleOperation = async (operation, data) => {
    setLoading(true);
    setResult(null);

    try {
      const response = await axios.post(`${API}/soap/${operation}`, {
        ...data,
        ignore_cache: ignoreCache
      });
      
      setResult({
        success: true,
        operation: response.data.operation,
        data: response.data.result,
        fromCache: response.data.from_cache && !ignoreCache
      });
      
      toast.success(`Operação ${operation} executada com sucesso`);
    } catch (error) {
      console.error('Error executing SOAP operation:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao executar operação SOAP';
      setResult({
        success: false,
        error: errorMsg
      });
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="soap-operations-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Operações SOAP</h1>
        <p className="text-muted-foreground mt-2">Execute operações no WebService SOAP</p>
      </div>

      {/* Operations Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Selecione a Operação</CardTitle>
          <CardDescription>Escolha e execute uma operação SOAP</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="resolve" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="resolve" data-testid="tab-resolve">Resolve</TabsTrigger>
              <TabsTrigger value="shares" data-testid="tab-shares">Shares</TabsTrigger>
              <TabsTrigger value="exec" data-testid="tab-exec">Exec</TabsTrigger>
              <TabsTrigger value="exec4" data-testid="tab-exec4">Exec4</TabsTrigger>
              <TabsTrigger value="exec5" data-testid="tab-exec5">Exec5</TabsTrigger>
            </TabsList>

            {/* Resolve Tab */}
            <TabsContent value="resolve" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Resolução DNS</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Resolve nomes de domínio para endereços IP
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resolve-s1">Nome do Host/Domínio</Label>
                  <Input
                    id="resolve-s1"
                    data-testid="resolve-s1-input"
                    placeholder="exemplo.com"
                    value={resolveForm.s1}
                    onChange={(e) => setResolveForm({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('resolve', resolveForm)} 
                  disabled={loading || !resolveForm.s1}
                  data-testid="execute-resolve-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Executar Resolve
                </Button>
              </div>
            </TabsContent>

            {/* Shares Tab */}
            <TabsContent value="shares" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Listar Compartilhamentos</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Lista os compartilhamentos de rede de um servidor
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shares-s1">Nome do Servidor/IP</Label>
                  <Input
                    id="shares-s1"
                    data-testid="shares-s1-input"
                    placeholder="servidor.local"
                    value={sharesForm.s1}
                    onChange={(e) => setSharesForm({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('shares', sharesForm)} 
                  disabled={loading || !sharesForm.s1}
                  data-testid="execute-shares-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Executar Shares
                </Button>
              </div>
            </TabsContent>

            {/* Exec Tab */}
            <TabsContent value="exec" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Executar Query SQL</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Executa uma query em um banco de dados
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-connStr">Connection String</Label>
                  <Input
                    id="exec-connStr"
                    data-testid="exec-connstr-input"
                    placeholder="Server=localhost;Database=mydb;User=admin;Password=pass;"
                    value={execForm.connStr}
                    onChange={(e) => setExecForm({ ...execForm, connStr: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-query">Query SQL</Label>
                  <Textarea
                    id="exec-query"
                    data-testid="exec-query-input"
                    placeholder="SELECT * FROM users"
                    value={execForm.query}
                    onChange={(e) => setExecForm({ ...execForm, query: e.target.value })}
                    rows={4}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('exec', execForm)} 
                  disabled={loading || !execForm.connStr || !execForm.query}
                  data-testid="execute-exec-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Executar Exec
                </Button>
              </div>
            </TabsContent>

            {/* Exec4 Tab */}
            <TabsContent value="exec4" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Listar Diretório</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Lista arquivos e pastas de um diretório
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec4-s1">Caminho do Diretório</Label>
                  <Input
                    id="exec4-s1"
                    data-testid="exec4-s1-input"
                    placeholder="C:\\Users\\Documents"
                    value={exec4Form.s1}
                    onChange={(e) => setExec4Form({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('exec4', exec4Form)} 
                  disabled={loading || !exec4Form.s1}
                  data-testid="execute-exec4-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Executar Exec4
                </Button>
              </div>
            </TabsContent>

            {/* Exec5 Tab */}
            <TabsContent value="exec5" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Download de Arquivo</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Faz download de um arquivo (retorna em Base64)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec5-s1">Caminho do Arquivo</Label>
                  <Input
                    id="exec5-s1"
                    data-testid="exec5-s1-input"
                    placeholder="C:\\path\\to\\file.txt"
                    value={exec5Form.s1}
                    onChange={(e) => setExec5Form({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('exec5', exec5Form)} 
                  disabled={loading || !exec5Form.s1}
                  data-testid="execute-exec5-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Executar Exec5
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Result Card */}
      {result && (
        <Card data-testid="soap-result-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Resultado</span>
              {result.success && result.fromCache && (
                <span className="text-sm font-normal text-muted-foreground bg-muted px-3 py-1 rounded-full">
                  💾 Do Cache
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.success ? (
              <div className="xml-output" data-testid="soap-result-output">
                {result.data}
              </div>
            ) : (
              <div className="p-4 bg-destructive/10 text-destructive rounded-lg" data-testid="soap-error-output">
                <strong>Erro:</strong> {result.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SoapOperations;