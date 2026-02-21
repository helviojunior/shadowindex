import { useState, useEffect, useCallback } from 'react';
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
  RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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

const Downloads = () => {
  const [downloadJobs, setDownloadJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(null);
  const [expandedServers, setExpandedServers] = useState({});
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0
  });

  // Load download jobs
  const loadDownloadJobs = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/downloads`);
      const jobs = response.data || [];
      setDownloadJobs(jobs);
      
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
      console.error('Error loading download jobs:', error);
      toast.error('Erro ao carregar downloads');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    loadDownloadJobs();
    
    // Poll every 2 seconds for active downloads
    const interval = setInterval(() => {
      loadDownloadJobs();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [loadDownloadJobs]);

  // Cancel single job
  const cancelJob = async (jobId) => {
    try {
      await axios.post(`${API}/downloads/${jobId}/cancel`);
      toast.success('Download cancelado');
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
      toast.success('Todos os downloads cancelados');
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
      toast.success('Download forçado iniciado');
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
      toast.success('Download reiniciado');
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
      toast.success('Histórico limpo');
      loadDownloadJobs();
    } catch (error) {
      console.error('Error clearing finished:', error);
      toast.error('Erro ao limpar histórico');
    }
  };

  // Filter jobs
  const filteredJobs = activeFilter 
    ? downloadJobs.filter(job => job.status === activeFilter)
    : downloadJobs;

  // Group jobs by server
  const jobsByServer = filteredJobs.reduce((acc, job) => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground">Gerencie os downloads de arquivos dos servidores</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadDownloadJobs}
            data-testid="refresh-downloads"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
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
                "cursor-pointer transition-all hover:shadow-md border-2",
                isActive ? "ring-2 ring-primary border-primary" : "border-transparent hover:border-muted-foreground/30"
              )}
              onClick={() => setActiveFilter(isActive ? null : status)}
              data-testid={`filter-${status}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className={cn("text-sm font-medium", config.textColor)}>{config.label}</p>
                  </div>
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    status === 'downloading' ? 'bg-blue-500/20' : 'bg-muted/50'
                  )}>
                    <Icon className={cn("w-5 h-5", config.textColor)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        
        {/* Total card */}
        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md border-2",
            activeFilter === null ? "ring-2 ring-primary border-primary" : "border-transparent hover:border-muted-foreground/30"
          )}
          onClick={() => setActiveFilter(null)}
          data-testid="filter-all"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground font-medium">Total</p>
              </div>
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-muted/50">
                <Download className="w-5 h-5 text-muted-foreground" />
              </div>
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

      {/* Download list grouped by server */}
      {Object.keys(jobsByServer).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
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
