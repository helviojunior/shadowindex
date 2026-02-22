import { useState, useEffect, useCallback } from 'react';
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
  FileSearch
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

  // Carregar status do GitLeaks
  const loadGitleaksStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/gitleaks/status`);
      setGitleaksStatus(response.data);
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

  // Polling para jobs ativos
  useEffect(() => {
    if (polling) {
      const interval = setInterval(() => {
        loadJobs();
        loadFindings();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [polling, loadJobs, loadFindings]);

  // Carregar dados iniciais
  useEffect(() => {
    loadGitleaksStatus();
    loadServers();
    loadJobs();
    loadFindings();
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
      toast.success('Job cancelado');
      loadJobs();
    } catch (error) {
      toast.error('Erro ao cancelar job');
    }
  };

  // Limpar jobs finalizados
  const handleClearFinished = async () => {
    try {
      const response = await axios.delete(`${API}/gitleaks/jobs/clear-finished`);
      toast.success(`${response.data.cleared} jobs removidos`);
      loadJobs();
    } catch (error) {
      toast.error('Erro ao limpar jobs');
    }
  };

  // Limpar todos findings
  const handleClearFindings = async () => {
    if (!confirm('Tem certeza que deseja limpar todos os findings?')) return;
    
    try {
      const response = await axios.delete(`${API}/gitleaks/findings`);
      toast.success(`${response.data.cleared} findings removidos`);
      loadFindings();
    } catch (error) {
      toast.error('Erro ao limpar findings');
    }
  };

  // Recarregar do disco
  const handleReload = async () => {
    try {
      await axios.post(`${API}/gitleaks/findings/reload`);
      toast.success('Findings recarregados do disco');
      loadFindings();
    } catch (error) {
      toast.error('Erro ao recarregar');
    }
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
              <Button variant="outline" size="sm" onClick={handleReload}>
                <Download className="w-4 h-4 mr-1" />
                Disco
              </Button>
              {totalFindings > 0 && (
                <Button variant="destructive" size="sm" onClick={handleClearFindings}>
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
                    <TableHead className="font-semibold">TARGET</TableHead>
                    <TableHead className="font-semibold">LINE</TableHead>
                    <TableHead className="font-semibold">RULE</TableHead>
                    <TableHead className="font-semibold">TAGS</TableHead>
                    <TableHead className="font-semibold">RISK</TableHead>
                    <TableHead className="font-semibold text-right">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFiles.map((file) => 
                    file.findings.map((finding, fIndex) => {
                      const risk = getRiskIndicators(finding.RuleID);
                      // Usar dados já normalizados pelo backend
                      const originalFile = finding.original_file || finding.File;
                      const detectionSource = finding.detection_source; // "ocr", "metadata" ou null
                      const fileName = originalFile.split('/').pop();
                      
                      return (
                        <TableRow key={`${file.file}-${fIndex}`} className="hover:bg-muted/30">
                          <TableCell>
                            <div className="flex items-start gap-2">
                              {detectionSource && (
                                <div className="flex-shrink-0 mt-0.5">
                                  {detectionSource === 'ocr' ? (
                                    <FileSearch className="w-4 h-4 text-blue-400" title="Detectado via OCR" />
                                  ) : (
                                    <FileText className="w-4 h-4 text-purple-400" title="Detectado via Metadata" />
                                  )}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-sm text-cyan-400 truncate max-w-[280px]">
                                  {fileName}
                                </p>
                                <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                                  {originalFile}
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
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedFinding(finding)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {finding.Secret && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCopy(finding.Secret)}
                                >
                                  <Copy className="w-4 h-4" />
                                </Button>
                              )}
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
            <DialogDescription>
              {selectedFinding?.RuleID}
            </DialogDescription>
          </DialogHeader>
          
          {selectedFinding && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Regra</p>
                  <Badge className="font-mono">{selectedFinding.RuleID}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Linha</p>
                  <p className="font-mono">
                    {selectedFinding.StartLine || 'N/A'}
                    {selectedFinding.EndLine && selectedFinding.EndLine !== selectedFinding.StartLine 
                      ? ` - ${selectedFinding.EndLine}` 
                      : ''}
                  </p>
                </div>
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-muted-foreground">Arquivo Original</p>
                  {selectedFinding.detection_source && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {selectedFinding.detection_source === 'ocr' ? 'Detectado via OCR' : 'Detectado via Metadata'}
                    </Badge>
                  )}
                </div>
                <p className="font-mono text-sm break-all bg-muted p-2 rounded">
                  {selectedFinding.original_file || selectedFinding.File}
                </p>
                {selectedFinding.detection_source && selectedFinding.scanned_file && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Arquivo de análise: <span className="font-mono">{selectedFinding.scanned_file}</span>
                  </p>
                )}
              </div>
              
              {selectedFinding.Description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Descrição</p>
                  <p className="text-sm">{selectedFinding.Description}</p>
                </div>
              )}
              
              {selectedFinding.Secret && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Secret Detectado</p>
                  <div className="flex items-start gap-2">
                    <code className="flex-1 text-xs bg-red-500/10 p-3 rounded border border-red-500/30 font-mono break-all">
                      {selectedFinding.Secret}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(selectedFinding.Secret)}
                    >
                      {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              )}
              
              {selectedFinding.Match && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Match</p>
                  <code className="block text-xs bg-muted p-3 rounded font-mono break-all">
                    {selectedFinding.Match}
                  </code>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Leaks;
