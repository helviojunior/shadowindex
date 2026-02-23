import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  AlertTriangle, 
  Search, 
  FileWarning, 
  Trash2,
  RefreshCw,
  File,
  Eye,
  Copy,
  CheckCircle,
  Play,
  Square,
  Loader2,
  Server,
  FolderSearch,
  ChevronDown,
  ChevronRight,
  Download,
  XCircle,
  Clock,
  FileText,
  FileSearch,
  Key,
  ExternalLink,
  ShieldOff,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { ShieldKeyIcon } from '@/components/icons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api/v2`;

const Leaks = () => {
  // State para findings
  const [findings, setFindings] = useState([]);
  const [files, setFiles] = useState([]);
  const [totalFindings, setTotalFindings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [copied, setCopied] = useState(false);

  // State para GitLeaks Jobs
  const [gitleaksStatus, setGitleaksStatus] = useState({ available: false, version: null });
  const [jobs, setJobs] = useState([]);
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [scanMode, setScanMode] = useState('all'); // 'all', 'server', 'custom'
  const [scanning, setScanning] = useState(false);
  const [polling, setPolling] = useState(false);
  const [showScanPanel, setShowScanPanel] = useState(true);
  const errorCountRef = useRef(0);
  
  // State para diálogo de confirmação
  const [confirmDialog, setConfirmDialog] = useState({ 
    open: false, 
    action: null, // 'clearAll' ou 'deleteFinding'
    fingerprint: null 
  });

  // Carregar status do GitLeaks
  const loadGitleaksStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/gitleaks/status`);
      setGitleaksStatus(response.data);
      errorCountRef.current = 0;
    } catch (error) {
      console.error('Error loading gitleaks status:', error);
      setGitleaksStatus({ available: false, version: null });
    }
  }, []);

  // Carregar servidores
  const loadServers = useCallback(async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/servers`);
      setServers(response.data);
    } catch (error) {
      console.error('Error loading servers:', error);
    }
  }, []);

  // Carregar jobs
  const loadJobs = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/gitleaks/jobs`);
      setJobs(response.data.jobs || []);
      
      const hasActiveJobs = response.data.jobs?.some(
        j => j.status === 'pending' || j.status === 'running'
      );
      setPolling(hasActiveJobs);
    } catch (error) {
      console.error('Error loading jobs:', error);
    }
  }, []);

  // Carregar findings
  const loadFindings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/gitleaks/findings`);
      setFindings(response.data.findings || []);
      setFiles(response.data.files || []);
      setTotalFindings(response.data.total_findings || 0);
    } catch (error) {
      console.error('Error loading findings:', error);
      toast.error('Erro ao carregar findings');
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling para jobs ativos - para após erros consecutivos
  useEffect(() => {
    let isMounted = true;
    
    if (polling && errorCountRef.current < 3) {
      const interval = setInterval(() => {
        if (isMounted) {
          loadJobs();
          loadFindings();
        }
      }, 5000);
      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }
    
    return () => { isMounted = false; };
  }, [polling, loadJobs, loadFindings]);

  // Carregar dados iniciais
  useEffect(() => {
    let isMounted = true;
    
    const loadInitial = async () => {
      if (isMounted) {
        await loadGitleaksStatus();
        await loadServers();
        await loadJobs();
        await loadFindings();
      }
    };
    
    loadInitial();
    
    return () => { isMounted = false; };
  }, [loadGitleaksStatus, loadServers, loadJobs, loadFindings]);

  // Iniciar scan
  const handleStartScan = async () => {
    if (scanMode === 'server' && !selectedServer) {
      toast.error('Selecione um servidor');
      return;
    }
    
    if (scanMode === 'custom' && !customPath) {
      toast.error('Informe o caminho do diretório');
      return;
    }

    setScanning(true);
    
    try {
      let response;
      
      if (scanMode === 'all') {
        response = await axios.post(`${API}/gitleaks/scan-all-servers`);
        if (response.data.scans_started > 0) {
          toast.success(`${response.data.scans_started} scans iniciados em background`);
        } else {
          toast.warning('Nenhum servidor com arquivos baixados para escanear');
        }
      } else if (scanMode === 'server') {
        response = await axios.post(`${API}/gitleaks/scan-server/${selectedServer}`);
        toast.success(`Scan iniciado! Job ID: ${response.data.job_id}`);
      } else {
        response = await axios.post(`${API}/gitleaks/scan`, {
          target_path: customPath
        });
        toast.success(`Scan iniciado! Job ID: ${response.data.job_id}`);
      }
      
      setPolling(true);
      loadJobs();
      
    } catch (error) {
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(`Erro ao iniciar scan: ${errorMsg}`);
    } finally {
      setScanning(false);
    }
  };

  // Cancelar job
  const handleCancelJob = async (jobId) => {
    try {
      await axios.post(`${API}/gitleaks/jobs/${jobId}/cancel`);
      loadJobs();
    } catch (error) {
      toast.error('Erro ao cancelar job');
    }
  };

  // Limpar jobs finalizados
  const handleClearFinished = async () => {
    try {
      await axios.delete(`${API}/gitleaks/jobs/clear-finished`);
      loadJobs();
    } catch (error) {
      toast.error('Erro ao limpar jobs');
    }
  };

  // Limpar todos findings - com confirmação
  const handleClearFindings = async () => {
    try {
      await axios.delete(`${API}/gitleaks/findings`);
      loadFindings();
      toast.success('Todos os findings foram removidos');
    } catch (error) {
      toast.error('Erro ao limpar findings');
    }
  };

  // Deletar um finding específico
  const handleDeleteFinding = async (fingerprint) => {
    console.log('Tentando deletar finding:', fingerprint);
    
    if (!fingerprint) {
      toast.error('Finding sem fingerprint');
      return;
    }
    
    try {
      const url = `${API}/gitleaks/findings/${encodeURIComponent(fingerprint)}`;
      console.log('URL de delete:', url);
      
      const response = await axios.delete(url);
      console.log('Resposta:', response.data);
      
      if (response.data.success) {
        // Recarregar findings para atualizar a estrutura de files
        loadFindings();
        toast.success('Finding removido');
      } else {
        toast.error(response.data.message || 'Erro ao remover finding');
      }
    } catch (error) {
      console.error('Erro ao deletar finding:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(`Erro ao remover finding: ${errorMsg}`);
    }
  };

  // Toggle falso positivo
  const handleToggleFalsePositive = async (fingerprint, currentValue) => {
    if (!fingerprint) {
      toast.error('Finding sem fingerprint');
      return;
    }
    
    try {
      const newValue = !currentValue;
      const url = `${API}/gitleaks/findings/${encodeURIComponent(fingerprint)}/false-positive?is_false_positive=${newValue}`;
      
      const response = await axios.patch(url);
      
      if (response.data.success) {
        // Atualizar localmente sem recarregar tudo
        setFindings(prev => prev.map(f => 
          f.Fingerprint === fingerprint 
            ? { ...f, is_false_positive: newValue }
            : f
        ));
        toast.success(newValue ? 'Marcado como falso positivo' : 'Desmarcado como falso positivo');
      } else {
        toast.error(response.data.message || 'Erro ao atualizar finding');
      }
    } catch (error) {
      console.error('Erro ao atualizar finding:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(`Erro ao atualizar finding: ${errorMsg}`);
    }
  };

  // Abrir diálogo de confirmação para limpar todos os findings
  const confirmClearAllFindings = () => {
    setConfirmDialog({ open: true, action: 'clearAll', fingerprint: null });
  };

  // Abrir diálogo de confirmação para deletar um finding
  const confirmDeleteFinding = (fingerprint) => {
    setConfirmDialog({ open: true, action: 'deleteFinding', fingerprint });
  };

  // Executar ação confirmada
  const executeConfirmedAction = () => {
    if (confirmDialog.action === 'clearAll') {
      handleClearFindings();
    } else if (confirmDialog.action === 'deleteFinding' && confirmDialog.fingerprint) {
      handleDeleteFinding(confirmDialog.fingerprint);
    }
    setConfirmDialog({ open: false, action: null, fingerprint: null });
  };

  // Copiar para clipboard
  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Copiado!');
  };

  // Filtrar arquivos por termo de busca
  const filteredFiles = files.filter(file => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      file.file.toLowerCase().includes(term) ||
      file.findings.some(f => 
        f.RuleID?.toLowerCase().includes(term) ||
        f.Description?.toLowerCase().includes(term) ||
        f.Secret?.toLowerCase().includes(term)
      )
    );
  });

  // Risk indicators coloridos (como na imagem do Sn1per)
  const getRiskIndicators = (ruleId) => {
    const rule = (ruleId || '').toLowerCase();
    let critical = 0, high = 0, medium = 0, low = 0;
    
    if (['private-key', 'jwt', 'rsa'].some(s => rule.includes(s))) {
      critical = 1;
    } else if (['aws', 'stripe', 'github', 'ssh'].some(s => rule.includes(s))) {
      high = 1;
    } else if (['slack', 'webhook', 'password', 'token'].some(s => rule.includes(s))) {
      medium = 1;
    } else {
      low = 1;
    }
    
    const score = critical * 100 + high * 50 + medium * 25 + low * 10;
    
    return { critical, high, medium, low, score };
  };

  // Status badge do job
  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="gap-1"><Clock className="w-3 h-3" />Pendente</Badge>;
      case 'running':
        return <Badge className="gap-1 bg-blue-600"><Loader2 className="w-3 h-3 animate-spin" />Executando</Badge>;
      case 'completed':
        return <Badge className="gap-1 bg-green-600"><CheckCircle className="w-3 h-3" />Concluído</Badge>;
      case 'failed':
        return <Badge className="gap-1 bg-red-600"><XCircle className="w-3 h-3" />Falhou</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="gap-1"><Square className="w-3 h-3" />Cancelado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const runningJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');
  const finishedJobs = jobs.filter(j => ['completed', 'failed', 'cancelled'].includes(j.status));

  return (
    <div className="space-y-6" data-testid="leaks-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leaks</h1>
          <p className="text-muted-foreground mt-2">
            Detecção de secrets e credenciais em arquivos baixados
          </p>
        </div>
        <div className="flex items-center gap-2">
          {gitleaksStatus.available && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              GitLeaks v{gitleaksStatus.version}
            </Badge>
          )}
        </div>
      </div>

      {/* Scan Control Panel */}
      <Collapsible open={showScanPanel} onOpenChange={setShowScanPanel}>
        <Card>
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <FolderSearch className="w-5 h-5" />
                <CardTitle className="text-lg">Iniciar Scan</CardTitle>
                {runningJobs.length > 0 && (
                  <Badge className="bg-blue-600 ml-2">{runningJobs.length} em execução</Badge>
                )}
              </div>
              {showScanPanel ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Scan Mode Selection */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={scanMode === 'all' ? 'default' : 'outline'}
                  onClick={() => setScanMode('all')}
                  size="sm"
                  className="gap-2"
                >
                  <Server className="w-4 h-4" />
                  Todos os Servidores
                </Button>
                <Button
                  variant={scanMode === 'server' ? 'default' : 'outline'}
                  onClick={() => setScanMode('server')}
                  size="sm"
                  className="gap-2"
                >
                  <Server className="w-4 h-4" />
                  Servidor Específico
                </Button>
                <Button
                  variant={scanMode === 'custom' ? 'default' : 'outline'}
                  onClick={() => setScanMode('custom')}
                  size="sm"
                  className="gap-2"
                >
                  <FolderSearch className="w-4 h-4" />
                  Caminho Custom
                </Button>
              </div>

              {/* Scan Options */}
              <div className="flex items-end gap-4">
                {scanMode === 'server' && (
                  <div className="flex-1 max-w-xs">
                    <Select value={selectedServer} onValueChange={setSelectedServer}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um servidor" />
                      </SelectTrigger>
                      <SelectContent>
                        {servers.map((server) => (
                          <SelectItem key={server.id} value={server.id.toString()}>
                            {server.name} ({server.ip})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                {scanMode === 'custom' && (
                  <div className="flex-1 max-w-md">
                    <Input
                      placeholder="/caminho/para/diretorio"
                      value={customPath}
                      onChange={(e) => setCustomPath(e.target.value)}
                    />
                  </div>
                )}

                <Button 
                  onClick={handleStartScan} 
                  disabled={scanning || !gitleaksStatus.available}
                >
                  {scanning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {scanMode === 'all' ? 'Escanear Todos' : 'Iniciar Scan'}
                </Button>
              </div>

              {/* Running Jobs */}
              {jobs.length > 0 && (
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Jobs Recentes</span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={loadJobs}>
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      {finishedJobs.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={handleClearFinished}>
                          <Trash2 className="w-4 h-4 mr-1" />
                          Limpar
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {jobs.slice(0, 5).map((job) => (
                      <div key={job.job_id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">#{job.job_id}</span>
                          {getStatusBadge(job.status)}
                          {job.findings_count > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {job.findings_count} leaks
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {job.target_path}
                        </span>
                        {job.status === 'running' && (
                          <Button size="sm" variant="ghost" onClick={() => handleCancelJob(job.job_id)}>
                            <Square className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total de Leaks</p>
                <p className="text-2xl font-bold">{totalFindings}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Arquivos Afetados</p>
                <p className="text-2xl font-bold">{files.length}</p>
              </div>
              <File className="w-8 h-8 text-orange-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tipos de Secrets</p>
                <p className="text-2xl font-bold">{new Set(findings.map(f => f.RuleID)).size}</p>
              </div>
              <ShieldKeyIcon className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Alta Severidade</p>
                <p className="text-2xl font-bold text-red-500">
                  {findings.filter(f => 
                    ['aws', 'private-key', 'github', 'jwt', 'stripe'].some(s => 
                      (f.RuleID || '').toLowerCase().includes(s)
                    )
                  ).length}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table - Inspirado no Sn1per */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="w-5 h-5 text-orange-500" />
              Findings
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Button variant="outline" size="sm" onClick={loadFindings}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              {totalFindings > 0 && (
                <Button variant="destructive" size="sm" onClick={confirmClearAllFindings}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : totalFindings === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhum Leak Detectado</p>
              <p className="text-sm mt-2">Execute um scan para detectar secrets nos arquivos baixados</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">SERVIDOR</TableHead>
                    <TableHead className="font-semibold">ARQUIVO</TableHead>
                    <TableHead className="font-semibold">LINHA</TableHead>
                    <TableHead className="font-semibold">REGRA</TableHead>
                    <TableHead className="font-semibold">TAGS</TableHead>
                    <TableHead className="font-semibold">RISCO</TableHead>
                    <TableHead className="font-semibold text-right">AÇÕES</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFiles.map((file) => 
                    file.findings.map((finding, fIndex) => {
                      const risk = getRiskIndicators(finding.RuleID);
                      // Usar dados enriquecidos pelo backend
                      const detectionSource = finding.detection_source; // "ocr", "metadata" ou null
                      
                      // Dados do banco de dados
                      const serverName = finding.server_name || '-';
                      const serverIp = finding.server_ip || '';
                      
                      // Extrair nome do arquivo e diretório do path
                      const fullPath = finding.server_path || finding.original_file || finding.File || '';
                      // Separar por \ ou / para pegar o nome do arquivo
                      const pathParts = fullPath.replace(/\//g, '\\').split('\\').filter(p => p); // filter remove strings vazias
                      const extractedFileName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'Arquivo';
                      
                      // Diretório: remover \\IP do início e o nome do arquivo do final
                      // Path típico: \\172.31.255.5\E$\subdir\file.txt -> queremos: E$\subdir
                      let directoryPath = '';
                      if (pathParts.length > 1) {
                        // Se começa com IP (primeiro componente parece IP), pular ele
                        const startIndex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pathParts[0]) ? 1 : 0;
                        // Pegar do share até antes do arquivo
                        directoryPath = pathParts.slice(startIndex, -1).join('\\');
                      }
                      
                      // Usar o nome do arquivo do banco ou extraído do path
                      const fileName = finding.file_name || extractedFileName || 'Arquivo';
                      
                      // Versão do arquivo (V1, V2, etc.)
                      const fileVersion = finding.extracted_version ? `V${finding.extracted_version}` : '';
                      
                      return (
                        <TableRow key={`${file.file}-${fIndex}`} className="hover:bg-muted/30">
                          {/* Coluna Servidor */}
                          <TableCell>
                            <div className="min-w-0">
                              <p className="font-medium text-sm text-emerald-400 truncate max-w-[140px]" title={serverName}>
                                {serverName}
                              </p>
                              {serverIp && (
                                <p className="text-xs text-muted-foreground font-mono">
                                  {serverIp}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          {/* Coluna Arquivo */}
                          <TableCell>
                            <div className="flex items-start gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm text-cyan-400 truncate max-w-[280px]" title={fileName}>
                                  {fileName}
                                  {fileVersion && (
                                    <span className="text-xs text-muted-foreground ml-1">({fileVersion})</span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground truncate max-w-[280px]" title={directoryPath}>
                                  {directoryPath || fullPath}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              {finding.StartLine || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge className="bg-slate-700 text-xs">
                                {finding.RuleID}
                              </Badge>
                              {finding.Description && (
                                <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {finding.Description}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {/* Tag de fonte da detecção */}
                              {finding.detection_source === 'manual' ? (
                                <Badge className="text-xs bg-yellow-600">
                                  Manual
                                </Badge>
                              ) : finding.detection_source === 'auto-pfx' ? (
                                <Badge className="text-xs bg-orange-600">
                                  Auto-PFX
                                </Badge>
                              ) : finding.detection_source === 'auto-key' ? (
                                <Badge className="text-xs bg-red-600">
                                  Auto-Key
                                </Badge>
                              ) : (
                                <Badge 
                                  className={`text-xs ${
                                    finding.job_id ? 'bg-purple-600' : 'bg-green-600'
                                  }`}
                                >
                                  {finding.job_id ? 'Scan' : 'GitLeaks'}
                                </Badge>
                              )}
                              {detectionSource && detectionSource !== 'manual' && detectionSource !== 'auto-pfx' && detectionSource !== 'auto-key' && (
                                <Badge 
                                  className={`text-xs ${
                                    detectionSource === 'ocr' ? 'bg-blue-600' : 'bg-violet-600'
                                  }`}
                                >
                                  {detectionSource === 'ocr' ? 'OCR' : 'META'}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {/* Risk indicators coloridos como no Sn1per */}
                              <span className={`w-3 h-3 rounded-full ${risk.critical ? 'bg-red-500' : 'bg-red-500/20'}`} />
                              <span className={`w-3 h-3 rounded-full ${risk.high ? 'bg-orange-500' : 'bg-orange-500/20'}`} />
                              <span className={`w-3 h-3 rounded-full ${risk.medium ? 'bg-yellow-500' : 'bg-yellow-500/20'}`} />
                              <span className={`w-3 h-3 rounded-full ${risk.low ? 'bg-green-500' : 'bg-green-500/20'}`} />
                              <span className="ml-2 font-mono text-sm">{risk.score}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {/* View */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedFinding(finding)}
                                title="Ver detalhes"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {/* Copy */}
                              {finding.Secret && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCopy(finding.Secret)}
                                  title="Copiar secret"
                                >
                                  <Copy className="w-4 h-4" />
                                </Button>
                              )}
                              {/* Abrir arquivo - mostra se tem extracted_file_id OU se tem server_id com path */}
                              {(finding.extracted_file_id || (finding.server_id && (finding.server_path || finding.File))) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const serverId = finding.extracted_server_id || finding.server_id;
                                    if (!serverId) return;
                                    
                                    // Se tem extracted_file_id, usar navegação direta por file_id
                                    if (finding.extracted_file_id) {
                                      window.open(`/servers/${serverId}/browse?file_id=${finding.extracted_file_id}&from=/leaks`, '_blank');
                                    } else {
                                      // Fallback: navegar pelo path do arquivo
                                      const filePath = finding.server_path || finding.File || finding.original_file;
                                      if (filePath) {
                                        const encodedPath = encodeURIComponent(filePath);
                                        window.open(`/servers/${serverId}/browse?path=${encodedPath}&from=/leaks`, '_blank');
                                      }
                                    }
                                  }}
                                  title="Abrir arquivo no navegador"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              )}
                              {/* Toggle Falso Positivo */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleFalsePositive(finding.Fingerprint, finding.is_false_positive)}
                                title={finding.is_false_positive ? "Desmarcar como falso positivo" : "Marcar como falso positivo"}
                                className={finding.is_false_positive ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground hover:text-yellow-500"}
                              >
                                {finding.is_false_positive ? (
                                  <ShieldCheck className="w-4 h-4" />
                                ) : (
                                  <ShieldOff className="w-4 h-4" />
                                )}
                              </Button>
                              {/* Deletar finding */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => confirmDeleteFinding(finding.Fingerprint)}
                                title="Remover finding"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Finding Detail Modal */}
      <Dialog open={!!selectedFinding} onOpenChange={() => setSelectedFinding(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Detalhes do Finding
            </DialogTitle>
          </DialogHeader>
          
          {selectedFinding && (() => {
            // Extrair informações do arquivo
            const fullPath = selectedFinding.server_path || selectedFinding.original_file || selectedFinding.File || '';
            const pathParts = fullPath.replace(/\//g, '\\').split('\\').filter(p => p);
            const fileName = selectedFinding.file_name || (pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'Arquivo');
            const startIndex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pathParts[0]) ? 1 : 0;
            const directoryPath = pathParts.length > 1 ? pathParts.slice(startIndex, -1).join('\\') : '';
            
            return (
              <div className="space-y-6">
                {/* Header com informações principais */}
                <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge className="bg-red-600 text-white font-mono text-sm px-3 py-1">
                        {selectedFinding.RuleID}
                      </Badge>
                      {selectedFinding.detection_source && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {selectedFinding.detection_source === 'ocr' ? 'OCR' : 'Metadata'}
                        </Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-muted-foreground">Linha</span>
                      <p className="font-mono text-lg font-bold text-orange-400">
                        {selectedFinding.StartLine || 'N/A'}
                        {selectedFinding.EndLine && selectedFinding.EndLine !== selectedFinding.StartLine 
                          ? `-${selectedFinding.EndLine}` 
                          : ''}
                      </p>
                    </div>
                  </div>
                  
                  {selectedFinding.Description && (
                    <p className="text-sm text-muted-foreground mt-3 italic">
                      {selectedFinding.Description}
                    </p>
                  )}
                </div>
                
                {/* Informações do Arquivo */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    Localização
                  </h4>
                  
                  <div className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
                    {selectedFinding.server_name && (
                      <>
                        <span className="text-muted-foreground">Servidor:</span>
                        <span className="font-medium text-emerald-400">{selectedFinding.server_name}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">Arquivo:</span>
                    <span className="font-medium text-cyan-400">{fileName}</span>
                    
                    {directoryPath && (
                      <>
                        <span className="text-muted-foreground">Diretório:</span>
                        <span className="font-mono text-xs text-muted-foreground">{directoryPath}</span>
                      </>
                    )}
                  </div>
                  
                  {/* Botão Abrir Arquivo no modal - mostra se tem extracted_file_id OU path */}
                  {(selectedFinding.extracted_file_id || (selectedFinding.server_id && fullPath)) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => {
                        const serverId = selectedFinding.extracted_server_id || selectedFinding.server_id;
                        if (!serverId) return;
                        
                        if (selectedFinding.extracted_file_id) {
                          window.open(`/servers/${serverId}/browse?file_id=${selectedFinding.extracted_file_id}&from=/leaks`, '_blank');
                        } else if (fullPath) {
                          const encodedPath = encodeURIComponent(fullPath);
                          window.open(`/servers/${serverId}/browse?path=${encodedPath}&from=/leaks`, '_blank');
                        }
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Abrir Arquivo no Navegador
                    </Button>
                  )}
                </div>
                
                {/* Secret Detectado */}
                {selectedFinding.Secret && (
                  <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                        <Key className="w-4 h-4" />
                        Secret Detectado
                      </h4>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleCopy(selectedFinding.Secret)}
                      >
                        {copied ? <CheckCircle className="w-3 h-3 mr-1 text-green-500" /> : <Copy className="w-3 h-3 mr-1" />}
                        {copied ? 'Copiado!' : 'Copiar'}
                      </Button>
                    </div>
                    <code className="block text-sm bg-black/30 p-3 rounded font-mono break-all text-red-300 border border-red-500/20">
                      {selectedFinding.Secret}
                    </code>
                  </div>
                )}
                
                {/* Match - só mostrar se for diferente do Secret */}
                {selectedFinding.Match && selectedFinding.Match !== selectedFinding.Secret && (
                  <div className="border rounded-lg p-4">
                    <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Contexto (Match)</h4>
                    <code className="block text-xs bg-muted p-3 rounded font-mono break-all">
                      {selectedFinding.Match}
                    </code>
                  </div>
                )}
                
                {/* Tags */}
                {selectedFinding.Tags && selectedFinding.Tags.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Tags:</span>
                    {selectedFinding.Tags.map((tag, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      
      {/* Diálogo de Confirmação */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === 'clearAll' ? 'Limpar Todos os Findings' : 'Excluir Finding'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'clearAll' 
                ? 'Tem certeza que deseja limpar todos os findings? Esta ação não pode ser desfeita.'
                : 'Tem certeza que deseja excluir este finding? Esta ação não pode ser desfeita.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeConfirmedAction}
              className="bg-red-500 hover:bg-red-600"
            >
              {confirmDialog.action === 'clearAll' ? 'Limpar Tudo' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Leaks;
