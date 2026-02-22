import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { 
  Download, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle,
  Trash2,
  RefreshCw,
  Filter,
  X,
  Server,
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  FolderSearch,
  Folder,
  Wifi,
  WifiOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useWebSocket, useDownloadEvents, useScanEvents } from '@/hooks/useWebSocket';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

// Status colors and icons
const statusConfig = {
  pending: { label: 'Pendente', color: 'bg-yellow-500', icon: Clock, textColor: 'text-yellow-500' },
  downloading: { label: 'Baixando', color: 'bg-blue-500', icon: Download, textColor: 'text-blue-500' },
  completed: { label: 'Concluído', color: 'bg-green-500', icon: CheckCircle, textColor: 'text-green-500' },
  failed: { label: 'Falhou', color: 'bg-red-500', icon: XCircle, textColor: 'text-red-500' },
  cancelled: { label: 'Cancelado', color: 'bg-gray-500', icon: X, textColor: 'text-gray-500' },
  skipped: { label: 'Ignorado', color: 'bg-orange-500', icon: AlertTriangle, textColor: 'text-orange-500' },
};

// Status config para Scan Jobs
const scanStatusConfig = {
  pending: { label: 'Aguardando', color: 'text-yellow-500', icon: Clock },
  scanning: { label: 'Escaneando', color: 'text-blue-500', icon: Loader2 },
  completed: { label: 'Concluído', color: 'text-green-500', icon: CheckCircle },
  cancelled: { label: 'Cancelado', color: 'text-gray-500', icon: X },
  failed: { label: 'Falhou', color: 'text-red-500', icon: XCircle },
};

const Downloads = () => {
  const [downloadJobs, setDownloadJobs] = useState([]);
  const [scanJobs, setScanJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(null);
  const [expandedServers, setExpandedServers] = useState({});
  const [showScanJobs, setShowScanJobs] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0
  });
  
  // Controle de erros - para polling após muitos erros
  const errorCountRef = useRef(0);
  const pollingPausedRef = useRef(false);
  const pollIntervalRef = useRef(null);

  // WebSocket para atualizações em tempo real
  const { isConnected } = useWebSocket();
  
  // Handler para progresso de download
  const handleDownloadProgress = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { 
            ...job, 
            progress: data.progress, 
            downloaded_bytes: data.downloaded_bytes,
            total_bytes: data.total_bytes,
            status: 'downloading'
          }
        : job
    ));
  }, []);
  
  // Handler para download concluído
  const handleDownloadComplete = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, status: 'completed', progress: 100 }
        : job
    ));
    // Atualizar stats
    setStats(prev => ({
      ...prev,
      downloading: Math.max(0, prev.downloading - 1),
      completed: prev.completed + 1
    }));
  }, []);
  
  // Handler para download falhado
  const handleDownloadFailed = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, status: 'failed', error_message: data.error }
        : job
    ));
    setStats(prev => ({
      ...prev,
      downloading: Math.max(0, prev.downloading - 1),
      failed: prev.failed + 1
    }));
  }, []);
  
  // Handler para download iniciado
  const handleDownloadStarted = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, status: 'downloading', progress: 0 }
        : job
    ));
    setStats(prev => ({
      ...prev,
      pending: Math.max(0, prev.pending - 1),
      downloading: prev.downloading + 1
    }));
  }, []);
  
  // Handler para progresso de scan
  const handleScanProgress = useCallback((data) => {
    setScanJobs(prev => prev.map(scan => 
      scan.id === data.scan_id 
        ? { 
            ...scan, 
            status: data.status,
            processed_files: data.processed_files,
            total_files: data.total_files,
            queued_files: data.queued_files
          }
        : scan
    ));
  }, []);
  
  // Handler para scan concluído
  const handleScanComplete = useCallback((data) => {
    setScanJobs(prev => prev.map(scan => 
      scan.id === data.scan_id 
        ? { ...scan, status: 'completed', total_files: data.total_files, queued_files: data.queued_files }
        : scan
    ));
  }, []);
  
  // Registrar eventos do WebSocket
  useDownloadEvents(
    handleDownloadProgress,
    handleDownloadComplete,
    handleDownloadFailed,
    handleDownloadStarted
  );
  
  useScanEvents(handleScanProgress, handleScanComplete);

  // Load scan jobs
  const loadScanJobs = useCallback(async () => {
    if (pollingPausedRef.current) return;
    
    try {
      const response = await axios.get(`${API}/scans`);
      setScanJobs(response.data || []);
    } catch (error) {
      console.error('Error loading scan jobs:', error);
    }
  }, []);

  // Função para retomar polling manualmente (definida após loadDownloadJobs e loadScanJobs)
  const handleRefresh = useCallback(() => {
    pollingPausedRef.current = false;
    errorCountRef.current = 0;
    setLoading(true);
    loadDownloadJobs();
    loadScanJobs();
  }, [loadDownloadJobs, loadScanJobs]);

  // Cancel scan job
  const cancelScanJob = async (scanId) => {
    try {
      await axios.post(`${API}/scans/${scanId}/cancel`);
      loadScanJobs();
    } catch (error) {
      toast.error('Erro ao cancelar scan');
    }
  };

  // Cancel all scans
  const cancelAllScans = async () => {
    try {
      await axios.post(`${API}/scans/cancel-all`);
      loadScanJobs();
    } catch (error) {
      toast.error('Erro ao cancelar scans');
    }
  };

  // Clear finished scans (completed, cancelled, failed)
  const clearFinishedScans = async () => {
    try {
      await axios.post(`${API}/scans/clear-finished`);
      loadScanJobs();
    } catch (error) {
      toast.error('Erro ao limpar scans');
    }
  };

  // Load download jobs
  const loadDownloadJobs = useCallback(async () => {
    // Se polling está pausado por muitos erros, não tentar
    if (pollingPausedRef.current) {
      return;
    }
    
    try {
      const response = await axios.get(`${API}/downloads`);
      const jobs = response.data || [];
      setDownloadJobs(jobs);
      
      // Reset error count on success
      errorCountRef.current = 0;
      
      // Calculate stats
      const newStats = {
        total: jobs.length,
        pending: jobs.filter(j => j.status === 'pending').length,
        downloading: jobs.filter(j => j.status === 'downloading').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        cancelled: jobs.filter(j => j.status === 'cancelled').length,
        skipped: jobs.filter(j => j.status === 'skipped').length,
      };
      setStats(newStats);
      
      // Auto-expand servers with active downloads
      const serversWithActive = {};
      jobs.forEach(job => {
        if (job.status === 'downloading' || job.status === 'pending') {
          serversWithActive[job.server_id] = true;
        }
      });
      setExpandedServers(prev => ({ ...prev, ...serversWithActive }));
      
    } catch (error) {
      errorCountRef.current += 1;
      console.error('Error loading downloads:', error);
      
      // Após 3 erros consecutivos, pausar polling
      if (errorCountRef.current >= 3) {
        pollingPausedRef.current = true;
        console.log('Polling paused due to consecutive errors');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    loadDownloadJobs();
    loadScanJobs();
    
    // Polling menos frequente quando WebSocket está conectado
    // WebSocket cuida das atualizações em tempo real
    const pollInterval = isConnected ? 10000 : 3000;
    
    const interval = setInterval(() => {
      loadDownloadJobs();
      loadScanJobs();
    }, pollInterval);
    
    return () => clearInterval(interval);
  }, [loadDownloadJobs, loadScanJobs, isConnected]);

  // Cancel single job
  const cancelJob = async (jobId) => {
    try {
      await axios.post(`${API}/downloads/${jobId}/cancel`);
      loadDownloadJobs();
    } catch (error) {
      console.error('Error cancelling job:', error);
      toast.error('Erro ao cancelar download');
    }
  };

  // Cancel all jobs
  const cancelAllJobs = async () => {
    try {
      await axios.post(`${API}/downloads/cancel-all`);
      loadDownloadJobs();
    } catch (error) {
      console.error('Error cancelling all jobs:', error);
      toast.error('Erro ao cancelar downloads');
    }
  };

  // Force download (for skipped files)
  const forceDownload = async (jobId) => {
    try {
      await axios.post(`${API}/downloads/${jobId}/force`);
      loadDownloadJobs();
    } catch (error) {
      console.error('Error forcing download:', error);
      toast.error('Erro ao forçar download');
    }
  };

  // Retry failed download
  const retryDownload = async (jobId) => {
    try {
      await axios.post(`${API}/downloads/${jobId}/retry`);
      loadDownloadJobs();
    } catch (error) {
      console.error('Error retrying download:', error);
      toast.error('Erro ao reiniciar download');
    }
  };

  // Clear completed/failed/cancelled jobs
  const clearFinished = async () => {
    try {
      await axios.post(`${API}/downloads/clear-finished`);
      loadDownloadJobs();
    } catch (error) {
      console.error('Error clearing finished:', error);
      toast.error('Erro ao limpar histórico');
    }
  };

  // Retry all failed downloads
  const retryAllFailed = async () => {
    try {
      await axios.post(`${API}/downloads/retry-all-failed`);
      loadDownloadJobs();
    } catch (error) {
      console.error('Error retrying all failed:', error);
      toast.error('Erro ao recolocar downloads na fila');
    }
  };

  // Filter jobs
  const filteredJobs = activeFilter 
    ? downloadJobs.filter(job => job.status === activeFilter)
    : downloadJobs;

  // Group jobs by server (with sorting: downloading > pending > others)
  const sortedFilteredJobs = [...filteredJobs].sort((a, b) => {
    // Ordem: downloading > pending > completed > failed > cancelled > skipped
    const statusOrder = { downloading: 0, pending: 1, completed: 2, failed: 3, cancelled: 4, skipped: 5 };
    return (statusOrder[a.status] ?? 6) - (statusOrder[b.status] ?? 6);
  });
  
  const jobsByServer = sortedFilteredJobs.reduce((acc, job) => {
    const serverId = job.server_id || 'unknown';
    if (!acc[serverId]) {
      acc[serverId] = {
        serverName: job.server_name || `Server ${serverId}`,
        serverIp: job.server_ip || '',
        jobs: []
      };
    }
    acc[serverId].jobs.push(job);
    return acc;
  }, {});

  const toggleServer = (serverId) => {
    setExpandedServers(prev => ({ ...prev, [serverId]: !prev[serverId] }));
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('pt-BR');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            Gerencie os downloads de arquivos dos servidores
            {loading && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Atualizando...
              </span>
            )}
            {!loading && isConnected ? (
              <span className="flex items-center gap-1 text-xs text-green-500">
                <Wifi className="w-3 h-3" />
                Tempo real
              </span>
            ) : !loading && (
              <span className="flex items-center gap-1 text-xs text-yellow-500">
                <WifiOff className="w-3 h-3" />
                Offline
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={resumePolling}
            disabled={loading}
            data-testid="refresh-downloads"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearFinished}
            data-testid="clear-finished"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar Concluídos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={retryAllFailed}
            disabled={stats.failed === 0}
            data-testid="retry-all-failed"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refazer Falhados
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={cancelAllJobs}
            disabled={stats.pending === 0 && stats.downloading === 0}
            data-testid="cancel-all"
          >
            <X className="w-4 h-4 mr-2" />
            Cancelar Todos
          </Button>
        </div>
      </div>

      {/* Stats Cards - Clickable for filtering */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 lg:gap-6">
        {Object.entries(statusConfig).map(([status, config]) => {
          const count = stats[status] || 0;
          const isActive = activeFilter === status;
          const Icon = config.icon;
          
          return (
            <Card 
              key={status}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md border-2 relative",
                isActive ? "ring-2 ring-primary border-primary" : "border-transparent hover:border-muted-foreground/30"
              )}
              onClick={() => setActiveFilter(isActive ? null : status)}
              data-testid={`filter-${status}`}
            >
              <CardContent className="p-4 pt-4">
                <Icon className={cn("w-5 h-5 absolute top-3 right-3", config.textColor)} />
                <div>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className={cn("text-sm font-medium", config.textColor)}>{config.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
        
        {/* Total card */}
        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md border-2 relative",
            activeFilter === null ? "ring-2 ring-primary border-primary" : "border-transparent hover:border-muted-foreground/30"
          )}
          onClick={() => setActiveFilter(null)}
          data-testid="filter-all"
        >
          <CardContent className="p-4 pt-4">
            <Download className="w-5 h-5 absolute top-3 right-3 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground font-medium">Total</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active filter indicator - only render when filter is active */}
      {activeFilter ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Filter className="w-3 h-3" />
            Filtro: {statusConfig[activeFilter]?.label}
            <button 
              onClick={() => setActiveFilter(null)}
              className="ml-1 hover:text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        </div>
      ) : null}

      {/* Scan Jobs Section */}
      {scanJobs.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <div 
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setShowScanJobs(!showScanJobs)}
              >
                {showScanJobs ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <FolderSearch className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-base">Scan Jobs</CardTitle>
                <Badge variant="secondary">
                  {scanJobs.filter(s => s.status === 'pending' || s.status === 'scanning').length} ativos
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {scanJobs.filter(s => s.status === 'completed' || s.status === 'cancelled' || s.status === 'failed').length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearFinishedScans}
                    className="h-7"
                    data-testid="clear-finished-scans"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Limpar Finalizados
                  </Button>
                )}
                {scanJobs.filter(s => s.status === 'pending' || s.status === 'scanning').length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelAllScans}
                    className="h-7"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Cancelar Todos
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          
          {showScanJobs && (
            <CardContent className="pt-0">
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {[...scanJobs]
                  .sort((a, b) => {
                    // Ordem: scanning > pending > completed > cancelled > failed
                    const statusOrder = { scanning: 0, pending: 1, completed: 2, cancelled: 3, failed: 4 };
                    return (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5);
                  })
                  .map((scan) => {
                  const StatusIcon = scanStatusConfig[scan.status]?.icon || Clock;
                  const isActive = scan.status === 'pending' || scan.status === 'scanning';
                  const pathParts = scan.path.split('\\');
                  const displayPath = pathParts.length > 3 
                    ? `...\\${pathParts.slice(-3).join('\\')}`
                    : scan.path;
                  
                  return (
                    <div 
                      key={scan.id}
                      className={cn(
                        "flex items-center justify-between p-2 rounded border",
                        scan.status === 'scanning' ? "border-blue-500/50 bg-blue-500/10" :
                        scan.status === 'pending' ? "border-yellow-500/30 bg-muted/30" :
                        "border-border bg-muted/20"
                      )}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <StatusIcon className={cn(
                          "w-4 h-4 flex-shrink-0",
                          scanStatusConfig[scan.status]?.color,
                          scan.status === 'scanning' && "animate-spin"
                        )} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" title={scan.path}>
                            {displayPath}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Nível: {scan.depth}/{scan.max_depth}
                            {scan.files_found > 0 && ` • ${scan.files_found} arquivos`}
                            {scan.dirs_found > 0 && ` • ${scan.dirs_found} pastas`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs",
                            scan.status === 'scanning' && "border-blue-500 text-blue-500"
                          )}
                        >
                          {scanStatusConfig[scan.status]?.label}
                        </Badge>
                        {isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cancelScanJob(scan.id)}
                            className="h-6 w-6 p-0"
                            title="Cancelar scan"
                          >
                            <X className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Download list grouped by server */}
      {Object.keys(jobsByServer).length === 0 ? (
        <Card>
          <CardContent className="p-8 pt-8 text-center">
            <Download className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {activeFilter 
                ? `Nenhum download com status "${statusConfig[activeFilter]?.label}"`
                : "Nenhum download na fila"
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(jobsByServer).map(([serverId, serverData]) => (
            <Card key={serverId}>
              <CardHeader 
                className="cursor-pointer hover:bg-muted/50 transition-colors py-3"
                onClick={() => toggleServer(serverId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {expandedServers[serverId] ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronRight className="w-5 h-5" />
                    )}
                    <Server className="w-5 h-5 text-primary" />
                    <div>
                      <CardTitle className="text-base">{serverData.serverName}</CardTitle>
                      {serverData.serverIp && (
                        <p className="text-xs text-muted-foreground">{serverData.serverIp}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline">{serverData.jobs.length} arquivos</Badge>
                </div>
              </CardHeader>
              
              {expandedServers[serverId] && (
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {serverData.jobs.map((job) => {
                      const statusConf = statusConfig[job.status] || statusConfig.pending;
                      const StatusIcon = statusConf.icon;
                      const progress = job.progress || 0;
                      
                      return (
                        <div 
                          key={job.id}
                          className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                          data-testid={`download-item-${job.id}`}
                        >
                          {/* Status icon */}
                          <StatusIcon 
                            className={cn(
                              "w-5 h-5 flex-shrink-0",
                              statusConf.textColor,
                              statusConf.animate && "animate-spin"
                            )}
                          />
                          
                          {/* File info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" title={job.file_path}>
                              {job.file_name || job.file_path?.split('\\').pop() || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate" title={job.file_path}>
                              {job.file_path}
                            </p>
                            
                            {/* Progress bar for downloading */}
                            {job.status === 'downloading' && (
                              <div className="mt-2">
                                <Progress value={progress} className="h-1" />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {progress}% - {formatFileSize(job.downloaded_bytes)} / {formatFileSize(job.total_bytes)}
                                </p>
                              </div>
                            )}
                            
                            {/* Error message for failed */}
                            {job.status === 'failed' && job.error_message && (
                              <p className="text-xs text-red-500 mt-1">{job.error_message}</p>
                            )}
                            
                            {/* Skip reason */}
                            {job.status === 'skipped' && job.skip_reason && (
                              <p className="text-xs text-orange-500 mt-1">{job.skip_reason}</p>
                            )}
                          </div>
                          
                          {/* Size */}
                          <div className="text-right text-sm text-muted-foreground w-24 flex-shrink-0">
                            {formatFileSize(job.file_size)}
                          </div>
                          
                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Force download for skipped */}
                            {job.status === 'skipped' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => forceDownload(job.id)}
                                title="Forçar download"
                                data-testid={`force-${job.id}`}
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            )}
                            
                            {/* Retry for failed */}
                            {job.status === 'failed' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => retryDownload(job.id)}
                                title="Tentar novamente"
                                data-testid={`retry-${job.id}`}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                            )}
                            
                            {/* Cancel for pending/downloading */}
                            {(job.status === 'pending' || job.status === 'downloading') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => cancelJob(job.id)}
                                title="Cancelar"
                                data-testid={`cancel-${job.id}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Downloads;
