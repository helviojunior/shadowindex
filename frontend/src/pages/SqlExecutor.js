import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, 
  Play, 
  History, 
  ListOrdered,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
  ChevronDown,
  Database
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SqlExecutor = () => {
  const { connectionId } = useParams();
  const navigate = useNavigate();
  
  const [connection, setConnection] = useState(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState([]);
  const [history, setHistory] = useState([]);
  const [showPresets, setShowPresets] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState('result');

  useEffect(() => {
    loadConnection();
    loadPresets();
    loadHistory();
  }, [connectionId]);

  const loadConnection = async () => {
    try {
      const response = await axios.get(`${API}/db-connections/${connectionId}`);
      setConnection(response.data);
    } catch (error) {
      console.error('Error loading connection:', error);
      toast.error('Erro ao carregar conexão');
      navigate('/sql');
    }
  };

  const loadPresets = async () => {
    try {
      const response = await axios.get(`${API}/sql-presets`);
      setPresets(response.data);
    } catch (error) {
      console.error('Error loading presets:', error);
    }
  };

  const loadHistory = async () => {
    try {
      const response = await axios.get(`${API}/sql/history?connection_id=${connectionId}&limit=20`);
      setHistory(response.data);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  const executeQuery = async () => {
    if (!query.trim()) {
      toast.error('Digite uma query SQL');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await axios.post(`${API}/sql/execute`, {
        connection_id: parseInt(connectionId),
        query: query.trim()
      });

      setResult(response.data);
      loadHistory(); // Recarregar histórico

      if (response.data.success) {
        toast.success(`Query executada em ${response.data.execution_time_ms}ms - ${response.data.row_count} resultado(s)`);
      } else {
        toast.error('Erro ao executar query');
      }
    } catch (error) {
      console.error('Error executing query:', error);
      toast.error('Erro ao executar query');
      setResult({
        success: false,
        error_message: error.response?.data?.detail || error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const selectPreset = (preset) => {
    setQuery(preset.query);
    setShowPresets(false);
    toast.success(`Preset "${preset.name}" selecionado`);
  };

  const reExecuteFromHistory = (historyItem) => {
    setQuery(historyItem.query);
    setShowHistory(false);
    
    // Se há resultado no histórico, parsear e mostrar
    if (historyItem.result) {
      try {
        const parsed = JSON.parse(historyItem.result);
        setResult({
          success: historyItem.success,
          columns: parsed.columns,
          rows: parsed.rows,
          row_count: parsed.rows?.length || 0,
          execution_time_ms: historyItem.execution_time_ms,
          error_message: historyItem.error_message
        });
      } catch {
        // Se não conseguir parsear, só preenche a query
      }
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

  if (!connection) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col" data-testid="sql-executor-page">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/sql')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">{connection.name}</h1>
              <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                {connection.connection_string.substring(0, 60)}...
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {connection.verified && (
            <Badge variant="outline" className="text-green-500 border-green-500">
              <CheckCircle className="w-3 h-3 mr-1" />
              Verificado
            </Badge>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Query Editor */}
        <div className="w-1/2 flex flex-col border-r border-border">
          {/* Toolbar */}
          <div className="flex items-center gap-2 p-3 border-b border-border bg-muted/30">
            <Button 
              onClick={executeQuery} 
              disabled={loading || !query.trim()}
              data-testid="execute-sql-btn"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Executar
            </Button>
            
            <div className="relative">
              <Button 
                variant="outline" 
                onClick={() => { setShowPresets(!showPresets); setShowHistory(false); }}
                data-testid="show-presets-btn"
              >
                <ListOrdered className="w-4 h-4 mr-2" />
                Presets
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
              
              {showPresets && (
                <Card className="absolute top-full left-0 mt-1 w-80 z-50 shadow-lg">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm">Comandos Pré-definidos</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="max-h-64">
                      {presets.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-3">Nenhum preset disponível</p>
                      ) : (
                        presets.map((preset) => (
                          <div
                            key={preset.id}
                            className="p-3 hover:bg-muted cursor-pointer border-b border-border last:border-0"
                            onClick={() => selectPreset(preset)}
                            data-testid={`preset-item-${preset.id}`}
                          >
                            <div className="font-medium text-sm">{preset.name}</div>
                            {preset.description && (
                              <div className="text-xs text-muted-foreground mt-1">{preset.description}</div>
                            )}
                            <div className="text-xs font-mono text-primary/70 mt-1 truncate">{preset.query}</div>
                          </div>
                        ))
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
            
            <div className="relative">
              <Button 
                variant="outline" 
                onClick={() => { setShowHistory(!showHistory); setShowPresets(false); }}
                data-testid="show-history-btn"
              >
                <History className="w-4 h-4 mr-2" />
                Histórico
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
              
              {showHistory && (
                <Card className="absolute top-full left-0 mt-1 w-96 z-50 shadow-lg">
                  <CardHeader className="py-2 px-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">Histórico de Queries</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="max-h-80">
                      {history.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-3">Nenhuma query no histórico</p>
                      ) : (
                        history.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 hover:bg-muted cursor-pointer border-b border-border last:border-0"
                            onClick={() => reExecuteFromHistory(item)}
                            data-testid={`history-item-${item.id}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {item.success ? (
                                <CheckCircle className="w-3 h-3 text-green-500" />
                              ) : (
                                <XCircle className="w-3 h-3 text-red-500" />
                              )}
                              <span className="text-xs text-muted-foreground">
                                {formatDate(item.executed_at)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({item.execution_time_ms}ms)
                              </span>
                            </div>
                            <div className="text-xs font-mono truncate">{item.query}</div>
                            {!item.success && item.error_message && (
                              <div className="text-xs text-red-400 mt-1 truncate">{item.error_message}</div>
                            )}
                          </div>
                        ))
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
          
          {/* Query Editor */}
          <div className="flex-1 p-3">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite sua query SQL aqui...&#10;&#10;Exemplo:&#10;SELECT * FROM tabela WHERE coluna = 'valor'"
              className="h-full font-mono text-sm resize-none bg-zinc-900"
              data-testid="sql-query-input"
            />
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="w-1/2 flex flex-col bg-background">
          {/* Tabs */}
          <div className="flex items-center gap-4 px-4 pt-3 border-b border-border">
            <button
              onClick={() => setActiveTab('result')}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === 'result' 
                  ? 'text-green-500' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Resultado
              {activeTab === 'result' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`pb-3 text-sm font-medium transition-colors relative ${
                activeTab === 'history' 
                  ? 'text-green-500' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Histórico Completo
              {activeTab === 'history' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
              )}
            </button>
          </div>

          {/* Tab Content */}
          <ScrollArea className="flex-1">
            {activeTab === 'result' && (
              <div className="p-4">
                {!result ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Database className="w-12 h-12 mb-4 opacity-30" />
                    <p>Execute uma query para ver os resultados</p>
                  </div>
                ) : result.success ? (
                  <div className="space-y-4">
                    {/* Result Info */}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        Sucesso
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {result.execution_time_ms}ms
                      </span>
                      <span>{result.row_count} linha(s)</span>
                    </div>
                    
                    {/* Result Table */}
                    {result.columns && result.columns.length > 0 && (
                      <div className="border border-border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted">
                              <tr>
                                {result.columns.map((col, idx) => (
                                  <th key={idx} className="px-4 py-2 text-left font-medium border-b border-border">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {result.rows.map((row, rowIdx) => (
                                <tr key={rowIdx} className="hover:bg-muted/50">
                                  {row.map((cell, cellIdx) => (
                                    <td key={cellIdx} className="px-4 py-2 border-b border-border font-mono">
                                      {cell || <span className="text-muted-foreground italic">NULL</span>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-red-500">
                      <XCircle className="w-5 h-5" />
                      <span className="font-medium">Erro na execução</span>
                    </div>
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <p className="text-sm text-red-400 font-mono whitespace-pre-wrap">
                        {result.error_message}
                      </p>
                    </div>
                    {result.execution_time_ms && (
                      <p className="text-sm text-muted-foreground">
                        Tempo de execução: {result.execution_time_ms}ms
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="p-4">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <History className="w-12 h-12 mb-4 opacity-30" />
                    <p>Nenhuma query no histórico</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {history.map((item) => (
                      <Card key={item.id} className="overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                {item.success ? (
                                  <Badge variant="outline" className="text-green-500 border-green-500">
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Sucesso
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-red-500 border-red-500">
                                    <XCircle className="w-3 h-3 mr-1" />
                                    Erro
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(item.executed_at)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {item.execution_time_ms}ms
                                </span>
                              </div>
                              
                              <pre className="text-sm font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
                                {item.query}
                              </pre>
                              
                              {!item.success && item.error_message && (
                                <div className="mt-2 text-sm text-red-400">
                                  {item.error_message}
                                </div>
                              )}
                            </div>
                            
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reExecuteFromHistory(item)}
                              data-testid={`reexecute-${item.id}`}
                            >
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default SqlExecutor;
