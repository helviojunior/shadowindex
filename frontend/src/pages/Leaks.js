import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
  ShieldCheck,
  ChevronsUpDown,
  Check,
  Filter,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ShieldKeyIcon } from '@/components/icons';
import { Checkbox } from '@/components/ui/checkbox';
import JwtDecoded, { looksLikeJwt } from '@/components/JwtDecoded';
import { cn } from '@/lib/utils';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api/v2`;

const Leaks = () => {
  const { t } = useTranslation('leaks');
  const location = useLocation();

  // State para findings
  const [findings, setFindings] = useState([]);
  const [files, setFiles] = useState([]);
  const [totalFindings, setTotalFindings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // Estado para indicar refresh sem bloquear UI
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [copied, setCopied] = useState(false);

  // State para GitLeaks Jobs
  const [gitleaksStatus, setGitleaksStatus] = useState({ available: false, version: null });
  const [jobs, setJobs] = useState([]);
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [serverComboOpen, setServerComboOpen] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [scanMode, setScanMode] = useState('all'); // 'all', 'server', 'custom'
  const [scanning, setScanning] = useState(false);
  const [polling, setPolling] = useState(false);
  const [showScanPanel, setShowScanPanel] = useState(true);
  const errorCountRef = useRef(0);
  const isInitialLoad = useRef(true);

  // Memoizar o servidor selecionado para exibição
  const selectedServerData = useMemo(() => {
    if (!selectedServer) return null;
    return servers.find(s => s.id.toString() === selectedServer);
  }, [selectedServer, servers]);
  
  // State para filtros
  const [selectedRules, setSelectedRules] = useState(new Set());
  const [fpFilter, setFpFilter] = useState('no_fp'); // 'all' | 'only_fp' | 'no_fp'
  const [ruleComboOpen, setRuleComboOpen] = useState(false);

  // State para bulk actions
  const [selectedFingerprints, setSelectedFingerprints] = useState(new Set());

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
  const loadFindings = useCallback(async (showRefreshIndicator = false) => {
    // Apenas mostra loading no carregamento inicial
    if (isInitialLoad.current) {
      setLoading(true);
    } else if (showRefreshIndicator) {
      setRefreshing(true);
    }
    
    try {
      const response = await axios.get(`${API}/gitleaks/findings`);
      setFindings(response.data.findings || []);
      setFiles(response.data.files || []);
      setTotalFindings(response.data.total_findings || 0);
      errorCountRef.current = 0;
    } catch (error) {
      console.error('Error loading findings:', error);
      errorCountRef.current += 1;
      // Só mostra toast de erro se for ação manual
      if (showRefreshIndicator) {
        toast.error(t('toast.loadError'));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      isInitialLoad.current = false;
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
      toast.error(t('toast.selectServer'));
      return;
    }

    if (scanMode === 'custom' && !customPath) {
      toast.error(t('toast.enterPath'));
      return;
    }

    setScanning(true);
    
    try {
      let response;
      
      if (scanMode === 'all') {
        response = await axios.post(`${API}/gitleaks/scan-all-servers`);
        if (response.data.scans_started > 0) {
          toast.success(t('toast.scansStarted', { count: response.data.scans_started }));
        } else {
          toast.warning(t('toast.noServersToScan'));
        }
      } else if (scanMode === 'server') {
        response = await axios.post(`${API}/gitleaks/scan-server/${selectedServer}`);
        toast.success(t('toast.scanStartedJob', { id: response.data.job_id }));
      } else {
        response = await axios.post(`${API}/gitleaks/scan`, {
          target_path: customPath
        });
        toast.success(t('toast.scanStartedJob', { id: response.data.job_id }));
      }
      
      setPolling(true);
      loadJobs();
      
    } catch (error) {
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.scanError', { error: errorMsg }));
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
      toast.error(t('toast.cancelJobError'));
    }
  };

  // Limpar jobs finalizados
  const handleClearFinished = async () => {
    try {
      await axios.delete(`${API}/gitleaks/jobs/clear-finished`);
      loadJobs();
    } catch (error) {
      toast.error(t('toast.clearJobsError'));
    }
  };

  // Limpar todos findings - com confirmação
  const handleClearFindings = async () => {
    try {
      await axios.delete(`${API}/gitleaks/findings`);
      loadFindings();
      toast.success(t('toast.allFindingsRemoved'));
    } catch (error) {
      toast.error(t('toast.clearFindingsError'));
    }
  };

  // Deletar um finding específico
  const handleDeleteFinding = async (fingerprint) => {
    console.log('Tentando deletar finding:', fingerprint);
    
    if (!fingerprint) {
      toast.error(t('toast.noFingerprint'));
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
        toast.success(t('toast.findingRemoved'));
      } else {
        toast.error(response.data.message || t('toast.removeFindingError'));
      }
    } catch (error) {
      console.error('Erro ao deletar finding:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.removeFindingErrorDetail', { error: errorMsg }));
    }
  };

  // Toggle falso positivo
  const handleToggleFalsePositive = async (fingerprint, currentValue) => {
    if (!fingerprint) {
      toast.error(t('toast.noFingerprint'));
      return;
    }
    
    try {
      const newValue = !currentValue;
      const url = `${API}/gitleaks/findings/toggle-false-positive`;
      
      const response = await axios.post(url, null, {
        params: {
          fingerprint: fingerprint,
          is_false_positive: newValue
        }
      });
      
      if (response.data.success) {
        // Atualizar findings
        setFindings(prev => prev.map(f => 
          f.Fingerprint === fingerprint 
            ? { ...f, is_false_positive: newValue }
            : f
        ));
        
        // Atualizar files (que contém os findings agrupados)
        setFiles(prev => prev.map(file => ({
          ...file,
          findings: file.findings.map(f => 
            f.Fingerprint === fingerprint 
              ? { ...f, is_false_positive: newValue }
              : f
          )
        })));
        
        toast.success(newValue ? t('toast.markedFP') : t('toast.unmarkedFP'));
      } else {
        toast.error(response.data.message || t('toast.updateFindingError'));
      }
    } catch (error) {
      console.error('Erro ao atualizar finding:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.updateFindingErrorDetail', { error: errorMsg }));
    }
  };

  // Bulk toggle false positive
  const handleBulkToggleFP = async (isFP) => {
    if (selectedFingerprints.size === 0) return;
    const fps = Array.from(selectedFingerprints);
    try {
      const response = await axios.post(`${API}/gitleaks/findings/bulk-toggle-false-positive`, {
        fingerprints: fps,
        is_false_positive: isFP
      });
      if (response.data.success) {
        const fpSet = new Set(fps);
        setFindings(prev => prev.map(f =>
          fpSet.has(f.Fingerprint) ? { ...f, is_false_positive: isFP } : f
        ));
        setFiles(prev => prev.map(file => ({
          ...file,
          findings: file.findings.map(f =>
            fpSet.has(f.Fingerprint) ? { ...f, is_false_positive: isFP } : f
          )
        })));
        setSelectedFingerprints(new Set());
        toast.success(response.data.message);
      } else {
        toast.error(response.data.message || t('toast.updateFindingsError'));
      }
    } catch (error) {
      console.error('Erro bulk toggle FP:', error);
      toast.error(t('toast.errorDetail', { error: error.response?.data?.detail || error.message }));
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
  const handleCopy = async (text) => {
    if (!text) return;
    
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback para HTTP
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('toast.copied'));
    } catch (error) {
      toast.error(t('toast.copyError'));
    }
  };

  // Lista de regras disponíveis (extraída dos findings carregados)
  const availableRules = useMemo(() => {
    const rules = new Set();
    findings.forEach(f => { if (f.RuleID) rules.add(f.RuleID); });
    return Array.from(rules).sort();
  }, [findings]);

  // Filtragem combinada: texto + regras + FP
  const filteredFiles = useMemo(() => {
    return files.map(file => {
      const filtered = file.findings.filter(f => {
        // Filtro FP
        if (fpFilter === 'no_fp' && f.is_false_positive) return false;
        if (fpFilter === 'only_fp' && !f.is_false_positive) return false;

        // Filtro por regras selecionadas
        if (selectedRules.size > 0 && !selectedRules.has(f.RuleID)) return false;

        // Filtro por texto
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const match =
            file.file.toLowerCase().includes(term) ||
            f.RuleID?.toLowerCase().includes(term) ||
            f.Description?.toLowerCase().includes(term) ||
            f.Secret?.toLowerCase().includes(term) ||
            f.Fingerprint?.toLowerCase().includes(term) ||
            f.decoded_claims?.toLowerCase().includes(term);
          if (!match) return false;
        }

        return true;
      });
      return { ...file, findings: filtered };
    }).filter(file => file.findings.length > 0);
  }, [files, searchTerm, selectedRules, fpFilter]);

  // Helper: todos os fingerprints filtrados visíveis
  const allVisibleFingerprints = useMemo(() => {
    const fps = [];
    filteredFiles.forEach(file => file.findings.forEach(f => { if (f.Fingerprint) fps.push(f.Fingerprint); }));
    return fps;
  }, [filteredFiles]);

  const allVisibleSelected = allVisibleFingerprints.length > 0 && allVisibleFingerprints.every(fp => selectedFingerprints.has(fp));
  const someVisibleSelected = allVisibleFingerprints.some(fp => selectedFingerprints.has(fp));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedFingerprints(new Set());
    } else {
      setSelectedFingerprints(new Set(allVisibleFingerprints));
    }
  };

  const toggleSelectOne = (fingerprint) => {
    setSelectedFingerprints(prev => {
      const next = new Set(prev);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  };

  // Ler hash #leak_{id} e preencher o campo de busca automaticamente
  useEffect(() => {
    const match = location.hash.match(/^#leak_(\d+)$/);
    if (!match || findings.length === 0) return;
    const targetId = parseInt(match[1], 10);
    for (const file of files) {
      const found = file.findings.find(f => f.id === targetId);
      if (found?.Fingerprint) {
        setSearchTerm(found.Fingerprint);
        return;
      }
    }
  }, [location.hash, findings, files]);

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
        return <Badge variant="outline" className="gap-1"><Clock className="w-3 h-3" />{t('common:status.pending')}</Badge>;
      case 'running':
        return <Badge className="gap-1 bg-blue-600"><Loader2 className="w-3 h-3 animate-spin" />{t('common:status.running')}</Badge>;
      case 'completed':
        return <Badge className="gap-1 bg-green-600"><CheckCircle className="w-3 h-3" />{t('common:status.completed')}</Badge>;
      case 'failed':
        return <Badge className="gap-1 bg-red-600"><XCircle className="w-3 h-3" />{t('common:status.failed')}</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="gap-1"><Square className="w-3 h-3" />{t('common:status.cancelled')}</Badge>;
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
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">
            {t('subtitle')}
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
                <CardTitle className="text-lg">{t('scanPanel.title')}</CardTitle>
                {runningJobs.length > 0 && (
                  <Badge className="bg-blue-600 ml-2">{t('scanPanel.running', { count: runningJobs.length })}</Badge>
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
                  onClick={() => {
                    setScanMode('all');
                    setSelectedServer(''); // Limpar servidor selecionado
                  }}
                  size="sm"
                  className="gap-2"
                >
                  <Server className="w-4 h-4" />
                  {t('scanMode.allServers')}
                </Button>
                <Button
                  variant={scanMode === 'server' ? 'default' : 'outline'}
                  onClick={() => setScanMode('server')}
                  size="sm"
                  className="gap-2"
                >
                  <Server className="w-4 h-4" />
                  {t('scanMode.specificServer')}
                </Button>
                <Button
                  variant={scanMode === 'custom' ? 'default' : 'outline'}
                  onClick={() => {
                    setScanMode('custom');
                    setSelectedServer(''); // Limpar servidor selecionado
                  }}
                  size="sm"
                  className="gap-2"
                >
                  <FolderSearch className="w-4 h-4" />
                  {t('scanMode.customPath')}
                </Button>
              </div>

              {/* Scan Options */}
              <div className="flex items-end gap-4">
                {scanMode === 'server' && (
                  <div className="flex-1 max-w-sm">
                    <Popover open={serverComboOpen} onOpenChange={setServerComboOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={serverComboOpen}
                          className="w-full justify-between font-normal"
                        >
                          {selectedServerData ? (
                            <span className="truncate">
                              {selectedServerData.name} ({selectedServerData.ip})
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{t('scanPanel.searchServerPrompt')}</span>
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder={t('scanPanel.serverInputPlaceholder')} />
                          <CommandList>
                            <CommandEmpty>{t('scanPanel.noServerFound')}</CommandEmpty>
                            <CommandGroup>
                              {servers.map((server) => (
                                <CommandItem
                                  key={server.id}
                                  value={`${server.name} ${server.ip}`}
                                  onSelect={() => {
                                    setSelectedServer(server.id.toString());
                                    setServerComboOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedServer === server.id.toString() ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col">
                                    <span className="font-medium">{server.name}</span>
                                    <span className="text-xs text-muted-foreground">{server.ip}</span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                
                {scanMode === 'custom' && (
                  <div className="flex-1 max-w-md">
                    <Input
                      placeholder={t('scanPanel.pathPlaceholder')}
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
                  {scanMode === 'all' ? t('scanMode.scanAll') : t('scanPanel.title')}
                </Button>
              </div>

              {/* Running Jobs */}
              {jobs.length > 0 && (
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{t('jobs.recent')}</span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={loadJobs}>
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      {finishedJobs.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={handleClearFinished}>
                          <Trash2 className="w-4 h-4 mr-1" />
                          {t('common:actions.clear')}
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
                              {t('jobs.leaksCount', { count: job.findings_count })}
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
                <p className="text-sm text-muted-foreground">{t('stats.totalLeaks')}</p>
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
                <p className="text-sm text-muted-foreground">{t('stats.affectedFiles')}</p>
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
                <p className="text-sm text-muted-foreground">{t('stats.secretTypes')}</p>
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
                <p className="text-sm text-muted-foreground">{t('stats.highSeverity')}</p>
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
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileWarning className="w-5 h-5 text-orange-500" />
                {t('findings.title')}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => loadFindings(true)} disabled={refreshing}>
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </Button>
                {totalFindings > 0 && (
                  <Button variant="destructive" size="sm" onClick={confirmClearAllFindings}>
                    <Trash2 className="w-4 h-4 mr-1" />
                    {t('common:actions.clear')}
                  </Button>
                )}
              </div>
            </div>

            {/* Filters Row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('findings.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>

              {/* Rule Multi-Select */}
              <Popover open={ruleComboOpen} onOpenChange={setRuleComboOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1">
                    <Filter className="w-4 h-4" />
                    {t('findings.rule')}
                    {selectedRules.size > 0 && (
                      <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                        {selectedRules.size}
                      </Badge>
                    )}
                    <ChevronsUpDown className="w-3 h-3 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('findings.searchRule')} />
                    <CommandList>
                      <CommandEmpty>{t('findings.noRuleFound')}</CommandEmpty>
                      <CommandGroup>
                        {availableRules.map(rule => (
                          <CommandItem
                            key={rule}
                            onSelect={() => {
                              setSelectedRules(prev => {
                                const next = new Set(prev);
                                if (next.has(rule)) next.delete(rule);
                                else next.add(rule);
                                return next;
                              });
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedRules.has(rule) ? "opacity-100" : "opacity-0")} />
                            <span className="font-mono text-xs truncate">{rule}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedRules.size > 0 && (
                <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setSelectedRules(new Set())}>
                  <X className="w-3 h-3 mr-1" />
                  {t('findings.clearRules')}
                </Button>
              )}

              {/* Separator */}
              <div className="w-px h-6 bg-border" />

              {/* FP Filter Toggle */}
              <div className="flex items-center gap-1">
                <Button
                  variant={fpFilter === 'no_fp' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFpFilter('no_fp')}
                >
                  {t('findings.real')}
                </Button>
                <Button
                  variant={fpFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFpFilter('all')}
                >
                  {t('findings.all')}
                </Button>
                <Button
                  variant={fpFilter === 'only_fp' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFpFilter('only_fp')}
                >
                  {t('findings.falsePositives')}
                </Button>
              </div>

              {/* Filtered count */}
              {(searchTerm || selectedRules.size > 0 || fpFilter !== 'all') && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {t('findings.filteredCount', { count: filteredFiles.reduce((acc, f) => acc + f.findings.length, 0), total: totalFindings })}
                </span>
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
              <p className="text-lg font-medium">{t('findings.emptyTitle')}</p>
              <p className="text-sm mt-2">{t('findings.emptyDesc')}</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="font-semibold">{t('columns.server')}</TableHead>
                    <TableHead className="font-semibold">{t('columns.file')}</TableHead>
                    <TableHead className="font-semibold">{t('columns.line')}</TableHead>
                    <TableHead className="font-semibold">{t('columns.rule')}</TableHead>
                    <TableHead className="font-semibold">{t('columns.tags')}</TableHead>
                    <TableHead className="font-semibold">{t('columns.risk')}</TableHead>
                    <TableHead className="font-semibold text-right">{t('columns.actions')}</TableHead>
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
                      const extractedFileName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : t('fileFallback');
                      
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
                      const fileName = finding.file_name || extractedFileName || t('fileFallback');
                      
                      // Versão do arquivo (V1, V2, etc.)
                      const fileVersion = finding.extracted_version ? `V${finding.extracted_version}` : '';
                      
                      return (
                        <TableRow 
                          key={`${file.file}-${fIndex}`} 
                          className={`hover:bg-muted/30 ${finding.is_false_positive ? 'opacity-50' : ''}`}
                        >
                          {/* Coluna Checkbox */}
                          <TableCell className="w-10">
                            <Checkbox
                              checked={selectedFingerprints.has(finding.Fingerprint)}
                              onCheckedChange={() => toggleSelectOne(finding.Fingerprint)}
                            />
                          </TableCell>
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
                              {finding.is_false_positive && (
                                <Badge className="text-xs bg-green-600">
                                  FP
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
                                title={t('actions.viewDetails')}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {/* Copy */}
                              {finding.Secret && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCopy(finding.Secret)}
                                  title={t('actions.copySecret')}
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
                                  title={t('actions.openFile')}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              )}
                              {/* Abrir no navegador - findings de repositórios Git */}
                              {finding.git_repo_guid && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const relPath = finding.server_path || finding.File || finding.file_name;
                                    const params = new URLSearchParams({ from: '/leaks' });
                                    if (relPath) params.set('file', relPath);
                                    if (finding.commit_hash) params.set('commit', finding.commit_hash);
                                    const hash = finding.StartLine ? `#L${finding.StartLine}` : '';
                                    window.open(`/git/${finding.git_repo_guid}?${params.toString()}${hash}`, '_blank');
                                  }}
                                  title={t('actions.openFile')}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              )}
                              {/* Toggle Falso Positivo */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleFalsePositive(finding.Fingerprint, finding.is_false_positive)}
                                title={finding.is_false_positive ? t('actions.unmarkFP') : t('actions.markFP')}
                                className={finding.is_false_positive ? "text-green-500 hover:text-green-600" : "text-muted-foreground hover:text-green-500"}
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
                                title={t('actions.removeFinding')}
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

      {/* Bulk Actions Bar */}
      {selectedFingerprints.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
          <span className="text-sm font-medium">{t('bulk.selected', { count: selectedFingerprints.size })}</span>
          <div className="w-px h-5 bg-border" />
          <Button size="sm" variant="outline" className="gap-1" onClick={() => handleBulkToggleFP(true)}>
            <ShieldCheck className="w-4 h-4" />
            {t('bulk.markFP')}
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => handleBulkToggleFP(false)}>
            <ShieldOff className="w-4 h-4" />
            {t('bulk.unmarkFP')}
          </Button>
          <div className="w-px h-5 bg-border" />
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => setSelectedFingerprints(new Set())}>
            <X className="w-4 h-4" />
            {t('common:actions.clear')}
          </Button>
        </div>
      )}

      {/* Finding Detail Modal */}
      <Dialog open={!!selectedFinding} onOpenChange={() => setSelectedFinding(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              {t('detail.title')}
            </DialogTitle>
          </DialogHeader>

          {selectedFinding && (() => {
            // Extrair informações do arquivo
            const fullPath = selectedFinding.server_path || selectedFinding.original_file || selectedFinding.File || '';
            const pathParts = fullPath.replace(/\//g, '\\').split('\\').filter(p => p);
            const fileName = selectedFinding.file_name || (pathParts.length > 0 ? pathParts[pathParts.length - 1] : t('fileFallback'));
            const startIndex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pathParts[0]) ? 1 : 0;
            const directoryPath = pathParts.length > 1 ? pathParts.slice(startIndex, -1).join('\\') : '';
            
            return (
              <div className="space-y-6 overflow-y-auto flex-1 pr-2 -mr-2">
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
                      <span className="text-xs text-muted-foreground">{t('detail.line')}</span>
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
                    {t('detail.location')}
                  </h4>
                  
                  <div className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
                    {selectedFinding.server_name && (
                      <>
                        <span className="text-muted-foreground">{t('detail.serverLabel')}</span>
                        <span className="font-medium text-emerald-400">{selectedFinding.server_name}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">{t('detail.fileLabel')}</span>
                    <span className="font-medium text-cyan-400">{fileName}</span>

                    {directoryPath && (
                      <>
                        <span className="text-muted-foreground">{t('detail.directoryLabel')}</span>
                        <span className="font-mono text-xs text-muted-foreground">{directoryPath}</span>
                      </>
                    )}
                    {selectedFinding.commit_hash && (
                      <>
                        <span className="text-muted-foreground">Commit</span>
                        <span className="font-mono text-xs text-amber-400 break-all" title={selectedFinding.commit_hash}>
                          {String(selectedFinding.commit_hash).slice(0, 10)}
                          {selectedFinding.commit_author ? ` · ${selectedFinding.commit_author}` : ''}
                        </span>
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
                      {t('detail.openFile')}
                    </Button>
                  )}
                  {/* Abrir no navegador - findings de repositórios Git */}
                  {selectedFinding.git_repo_guid && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => {
                        const relPath = selectedFinding.server_path || selectedFinding.File || selectedFinding.file_name;
                        const params = new URLSearchParams({ from: '/leaks' });
                        if (relPath) params.set('file', relPath);
                        if (selectedFinding.commit_hash) params.set('commit', selectedFinding.commit_hash);
                        const hash = selectedFinding.StartLine ? `#L${selectedFinding.StartLine}` : '';
                        window.open(`/git/${selectedFinding.git_repo_guid}?${params.toString()}${hash}`, '_blank');
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      {t('detail.openFile')}
                    </Button>
                  )}
                </div>
                
                {/* Secret Detectado */}
                {selectedFinding.Secret && (
                  <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                        <Key className="w-4 h-4" />
                        {t('detail.secretDetected')}
                      </h4>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleCopy(selectedFinding.Secret)}
                      >
                        {copied ? <CheckCircle className="w-3 h-3 mr-1 text-green-500" /> : <Copy className="w-3 h-3 mr-1" />}
                        {copied ? t('detail.copied') : t('detail.copy')}
                      </Button>
                    </div>
                    <code className="block text-sm bg-black/30 p-3 rounded font-mono break-all text-red-300 border border-red-500/20">
                      {selectedFinding.Secret}
                    </code>
                  </div>
                )}

                {/* JWT decodificado (header + claims + validade) */}
                {(() => {
                  const cand = [selectedFinding.Secret, selectedFinding.Match].find((x) => looksLikeJwt(x));
                  return cand ? <JwtDecoded token={cand.trim()} /> : null;
                })()}

                {/* Match - só mostrar se for diferente do Secret */}
                {selectedFinding.Match && selectedFinding.Match !== selectedFinding.Secret && (
                  <div className="border rounded-lg p-4">
                    <h4 className="text-sm font-semibold mb-2 text-muted-foreground">{t('detail.matchContext')}</h4>
                    <code className="block text-xs bg-muted p-3 rounded font-mono break-all">
                      {selectedFinding.Match}
                    </code>
                  </div>
                )}
                
                {/* Tags */}
                {selectedFinding.Tags && selectedFinding.Tags.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{t('detail.tagsLabel')}</span>
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
              {confirmDialog.action === 'clearAll' ? t('confirm.clearAllTitle') : t('confirm.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'clearAll'
                ? t('confirm.clearAllDesc')
                : t('confirm.deleteDesc')
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeConfirmedAction}
              className="bg-red-500 hover:bg-red-600"
            >
              {confirmDialog.action === 'clearAll' ? t('confirm.clearAllAction') : t('confirm.deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Leaks;
