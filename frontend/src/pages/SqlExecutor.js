import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';
import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs';
import 'prismjs/components/prism-sql';
import 'prismjs/themes/prism-tomorrow.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  ChevronDown,
  Database,
  Download,
  FileSpreadsheet,
  Plus,
  X,
  GripHorizontal,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SqlExecutor = () => {
  const { connectionId } = useParams();
  const navigate = useNavigate();
  
  const [connection, setConnection] = useState(null);
  const [presets, setPresets] = useState([]);
  const [history, setHistory] = useState([]);
  const [showPresets, setShowPresets] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [editorHeight, setEditorHeight] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  
  const containerRef = useRef(null);
  const resizeRef = useRef(null);
  
  // Múltiplas tabs
  const [tabs, setTabs] = useState([
    { id: 1, name: 'Query 1', query: '', result: null, loading: false }
  ]);
  const tabIdCounter = useRef(2);

  useEffect(() => {
    loadConnection();
    loadPresets();
    loadHistory();
  }, [connectionId]);

  // Resizing logic
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const newHeight = e.clientY - containerRect.top - 140; // Account for header and tabs
      
      // Min and max heights
      const minHeight = 100;
      const maxHeight = window.innerHeight - 350;
      
      setEditorHeight(Math.max(minHeight, Math.min(maxHeight, newHeight)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

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
      const response = await axios.get(`${API}/sql/history?connection_id=${connectionId}&limit=50`);
      setHistory(response.data);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  const getCurrentTab = () => tabs[activeTabIndex];
  
  const updateCurrentTab = (updates) => {
    setTabs(prev => prev.map((tab, idx) => 
      idx === activeTabIndex ? { ...tab, ...updates } : tab
    ));
  };

  const addNewTab = (initialQuery = '') => {
    const newTab = {
      id: tabIdCounter.current++,
      name: `Query ${tabIdCounter.current - 1}`,
      query: initialQuery,
      result: null,
      loading: false
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabIndex(tabs.length);
    return newTab;
  };

  const closeTab = (idx, e) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      toast.error('Não é possível fechar a última tab');
      return;
    }
    
    setTabs(prev => prev.filter((_, i) => i !== idx));
    
    if (activeTabIndex >= idx && activeTabIndex > 0) {
      setActiveTabIndex(activeTabIndex - 1);
    }
  };

  const executeQuery = async () => {
    const currentTab = getCurrentTab();
    if (!currentTab.query.trim()) {
      toast.error('Digite uma query SQL');
      return;
    }

    updateCurrentTab({ loading: true, result: null });

    try {
      const response = await axios.post(`${API}/sql/execute`, {
        connection_id: parseInt(connectionId),
        query: currentTab.query.trim()
      });

      updateCurrentTab({ result: response.data, loading: false });
      loadHistory();

      if (response.data.success) {
        toast.success(`Query executada em ${response.data.execution_time_ms}ms - ${response.data.row_count} resultado(s)`);
      } else {
        toast.error('Erro ao executar query');
      }
    } catch (error) {
      console.error('Error executing query:', error);
      toast.error('Erro ao executar query');
      updateCurrentTab({ 
        result: {
          success: false,
          error_message: error.response?.data?.detail || error.message
        },
        loading: false 
      });
    }
  };

  const selectPreset = (preset) => {
    updateCurrentTab({ query: preset.query });
    setShowPresets(false);
    toast.success(`Preset "${preset.name}" selecionado`);
  };

  // Criar nova aba com query do histórico
  const openHistoryInNewTab = (historyItem) => {
    addNewTab(historyItem.query);
    setShowHistoryModal(false);
    toast.success('Nova aba criada com a query do histórico');
  };

  const deleteHistoryItem = async (id, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/sql/history/${id}`);
      loadHistory();
      toast.success('Item removido do histórico');
    } catch (error) {
      toast.error('Erro ao remover item');
    }
  };

  // Exportar para CSV
  const exportToCSV = () => {
    const currentTab = getCurrentTab();
    if (!currentTab.result?.success || !currentTab.result?.columns) {
      toast.error('Nenhum resultado para exportar');
      return;
    }

    const { columns, rows } = currentTab.result;
    
    const csvContent = [
      columns.join(','),
      ...rows.map(row => 
        row.map(cell => {
          const cellStr = String(cell || '');
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `query_result_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    
    toast.success('Exportado para CSV');
  };

  // Exportar para Excel
  const exportToExcel = () => {
    const currentTab = getCurrentTab();
    if (!currentTab.result?.success || !currentTab.result?.columns) {
      toast.error('Nenhum resultado para exportar');
      return;
    }

    const { columns, rows } = currentTab.result;
    
    const wsData = [columns, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultado');
    XLSX.writeFile(wb, `query_result_${new Date().toISOString().slice(0, 10)}.xlsx`);
    
    toast.success('Exportado para Excel');
  };

  const formatDate = (dateString) => {
    if (!dateString) return '---';
    try {
      return new Date(dateString).toLocaleString('pt-BR');
    } catch {
      return dateString;
    }
  };

  const highlightSQL = (code) => {
    return highlight(code, languages.sql, 'sql');
  };

  if (!connection) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const currentTab = getCurrentTab();

  return (
    <div 
      ref={containerRef}
      className="h-[calc(100vh-120px)] flex flex-col" 
      data-testid="sql-executor-page"
    >
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

      {/* Tabs de Query */}
      <div className="flex items-center gap-1 px-4 py-2 bg-muted/30 border-b border-border overflow-x-auto">
        {tabs.map((tab, idx) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabIndex(idx)}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-t cursor-pointer text-sm transition-colors
              ${idx === activeTabIndex 
                ? 'bg-background text-foreground border border-b-0 border-border' 
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }
            `}
            data-testid={`query-tab-${tab.id}`}
          >
            <span className="truncate max-w-[120px]">{tab.name}</span>
            {tab.loading && <Loader2 className="w-3 h-3 animate-spin" />}
            {tabs.length > 1 && (
              <button
                onClick={(e) => closeTab(idx, e)}
                className="ml-1 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive"
                data-testid={`close-tab-${tab.id}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => addNewTab()}
          className="flex items-center justify-center w-7 h-7 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          data-testid="add-query-tab"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content - Vertical Layout */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Section - Query Editor */}
        <div className="flex flex-col border-b border-border" style={{ height: editorHeight }}>
          {/* Toolbar */}
          <div className="flex items-center gap-2 p-3 border-b border-border bg-muted/30">
            <Button 
              onClick={executeQuery} 
              disabled={currentTab.loading || !currentTab.query.trim()}
              data-testid="execute-sql-btn"
            >
              {currentTab.loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Executar
            </Button>
            
            <div className="relative">
              <Button 
                variant="outline" 
                onClick={() => setShowPresets(!showPresets)}
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
            
            <Button 
              variant="outline" 
              onClick={() => setShowHistoryModal(true)}
              data-testid="show-history-btn"
            >
              <History className="w-4 h-4 mr-2" />
              Histórico
            </Button>

            <div className="flex-1" />

            <span className="text-xs text-muted-foreground">
              Arraste a barra abaixo para redimensionar
            </span>
          </div>
          
          {/* Query Editor */}
          <div className="flex-1 overflow-auto bg-zinc-900">
            <Editor
              value={currentTab.query}
              onValueChange={(code) => updateCurrentTab({ query: code })}
              highlight={highlightSQL}
              padding={16}
              placeholder="Digite sua query SQL aqui...

Exemplo:
SELECT * FROM tabela WHERE coluna = 'valor'"
              style={{
                fontFamily: '"Fira Code", "Fira Mono", Menlo, Consolas, monospace',
                fontSize: 14,
                minHeight: '100%',
                backgroundColor: 'transparent',
              }}
              className="min-h-full"
              textareaClassName="outline-none"
              data-testid="sql-query-input"
            />
          </div>
        </div>

        {/* Resize Handle */}
        <div
          ref={resizeRef}
          className="h-2 bg-muted hover:bg-primary/30 cursor-ns-resize flex items-center justify-center transition-colors"
          onMouseDown={() => setIsResizing(true)}
          data-testid="resize-handle"
        >
          <GripHorizontal className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Bottom Section - Results */}
        <div className="flex-1 flex flex-col bg-background overflow-hidden">
          {/* Result Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Resultado</span>
              {currentTab.result?.success && (
                <Badge variant="outline" className="text-green-500 border-green-500">
                  {currentTab.result.row_count} linha(s)
                </Badge>
              )}
            </div>
            
            {/* Export Buttons */}
            {currentTab.result?.success && currentTab.result?.columns && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToCSV}
                  data-testid="export-csv-btn"
                >
                  <Download className="w-4 h-4 mr-1" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToExcel}
                  data-testid="export-excel-btn"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-1" />
                  Excel
                </Button>
              </div>
            )}
          </div>

          {/* Result Content */}
          <ScrollArea className="flex-1">
            <div className="p-4">
              {!currentTab.result ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Database className="w-10 h-10 mb-3 opacity-30" />
                  <p>Execute uma query para ver os resultados</p>
                </div>
              ) : currentTab.result.success ? (
                <div className="space-y-4">
                  {/* Result Info */}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Sucesso
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {currentTab.result.execution_time_ms}ms
                    </span>
                  </div>
                  
                  {/* Result Table */}
                  {currentTab.result.columns && currentTab.result.columns.length > 0 && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted">
                            <tr>
                              {currentTab.result.columns.map((col, idx) => (
                                <th key={idx} className="px-4 py-2 text-left font-medium border-b border-border whitespace-nowrap">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {currentTab.result.rows.map((row, rowIdx) => (
                              <tr key={rowIdx} className="hover:bg-muted/50">
                                {row.map((cell, cellIdx) => (
                                  <td key={cellIdx} className="px-4 py-2 border-b border-border font-mono whitespace-nowrap">
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
                      {currentTab.result.error_message}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* History Modal */}
      <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Histórico de Queries
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] pr-4">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mb-4 opacity-30" />
                <p>Nenhuma query no histórico</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <Card 
                    key={item.id} 
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => openHistoryInNewTab(item)}
                    data-testid={`history-modal-item-${item.id}`}
                  >
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
                          
                          <pre className="text-sm font-mono bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-24">
                            {item.query}
                          </pre>
                          
                          {!item.success && item.error_message && (
                            <div className="mt-2 text-sm text-red-400 truncate">
                              {item.error_message}
                            </div>
                          )}
                          
                          <p className="mt-2 text-xs text-primary">
                            Clique para abrir em nova aba
                          </p>
                        </div>
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          data-testid={`delete-history-${item.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SqlExecutor;
