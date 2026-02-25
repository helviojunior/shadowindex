import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Eye,
  RefreshCw,
  Trash2,
  XCircle,
  CheckCircle,
  Clock,
  Loader2,
  Search,
  Filter,
  StopCircle,
  Play,
  Server,
  RotateCcw,
  X,
  HardDrive,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/v2`;

const ScanStatusBadge = ({ status }) => {
  const variants = {
    pending: { icon: Clock, className: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' },
    running: { icon: Loader2, className: 'bg-blue-500/20 text-blue-500 border-blue-500/50', spin: true },
    completed: { icon: CheckCircle, className: 'bg-green-500/20 text-green-500 border-green-500/50' },
    failed: { icon: XCircle, className: 'bg-red-500/20 text-red-500 border-red-500/50' },
    cancelled: { icon: StopCircle, className: 'bg-orange-500/20 text-orange-500 border-orange-500/50' },
  };

  const variant = variants[status] || variants.pending;
  const Icon = variant.icon;

  return (
    <Badge variant="outline" className={cn("gap-1", variant.className)}>
      <Icon className={cn("w-3 h-3", variant.spin && "animate-spin")} />
      {status}
    </Badge>
  );
};

const getErrorLabel = (errorMessage) => {
  if (!errorMessage) return 'Erro';
  const msg = errorMessage.toLowerCase();
  if (msg.startsWith('server unreachable') || msg.includes('erro de rede')) return 'Inacessível';
  if (msg.startsWith('access denied') || msg.includes('access denied') || msg.includes('acesso negado')) return 'Acesso Negado';
  if (msg.startsWith('credential not set') || msg.includes('credential')) return 'Sem Credencial';
  if (msg.startsWith('connection error') || msg.includes('connection')) return 'Erro de Conexão';
  if (msg.startsWith('plugin not configured')) return 'Plugin não configurado';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'Timeout';
  return 'Erro';
};

const ShareScanJobs = () => {
  const { isConnected } = useWebSocket();
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: null, jobId: null });
  const isMounted = useRef(true);

  const statusConfig = {
    pending: { label: 'Pendentes', icon: Clock, textColor: 'text-yellow-500', borderColor: 'border-l-yellow-500', ringColor: 'ring-yellow-500' },
    running: { label: 'Executando', icon: Play, textColor: 'text-cyan-500', borderColor: 'border-l-cyan-500', ringColor: 'ring-cyan-500' },
    completed: { label: 'Concluídos', icon: CheckCircle, textColor: 'text-green-500', borderColor: 'border-l-green-500', ringColor: 'ring-green-500' },
    failed: { label: 'Falhados', icon: XCircle, textColor: 'text-red-500', borderColor: 'border-l-red-500', ringColor: 'ring-red-500' },
    cancelled: { label: 'Cancelados', icon: StopCircle, textColor: 'text-orange-500', borderColor: 'border-l-orange-500', ringColor: 'ring-orange-500' },
  };

  const loadJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('limit', '50');
      if (activeFilter) {
        params.append('status', activeFilter);
      }
      const response = await axios.get(`${API}/share-scan/jobs?${params.toString()}`);
      if (isMounted.current) {
        setJobs(response.data || []);
      }
    } catch (error) {
      console.error('Error loading share scan jobs:', error);
    }
  }, [activeFilter]);

  const loadStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/share-scan/stats`);
      if (isMounted.current) {
        setStats(response.data || {});
      }
    } catch (error) {
      console.error('Error loading share scan stats:', error);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    const loadData = async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadStats()]);
      setLoading(false);
    };

    loadData();

    const interval = setInterval(() => {
      if (isMounted.current) {
        loadJobs();
        loadStats();
      }
    }, 5000);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [loadJobs, loadStats]);

  const cancelJob = async (jobId) => {
    try {
      await axios.post(`${API}/share-scan/jobs/${jobId}/cancel`);
      toast.success('Job cancelado com sucesso');
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error cancelling job:', error);
      toast.error('Erro ao cancelar job');
    }
  };

  const cancelAllJobs = async () => {
    try {
      const response = await axios.post(`${API}/share-scan/cancel-all`);
      toast.success(response.data.message || 'Todos os jobs cancelados');
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error cancelling all jobs:', error);
      toast.error('Erro ao cancelar todos os jobs');
    }
  };

  const clearFinishedJobs = async () => {
    try {
      const response = await axios.delete(`${API}/share-scan/jobs/clear-finished`);
      toast.success(`${response.data.deleted} jobs removidos`);
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error clearing jobs:', error);
      toast.error('Erro ao limpar jobs');
    }
  };

  const prioritizeJob = async (jobId) => {
    try {
      const response = await axios.post(`${API}/share-scan/jobs/${jobId}/prioritize`);
      toast.success(response.data.message);
      loadJobs();
    } catch (error) {
      console.error('Error prioritizing job:', error);
      toast.error(error.response?.data?.detail || 'Erro ao priorizar job');
    }
  };

  const retryFailedJobs = async () => {
    setRetrying(true);
    try {
      const response = await axios.post(`${API}/share-scan/retry-failed`);
      toast.success(response.data.message);
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error retrying failed jobs:', error);
      toast.error('Erro ao reexecutar jobs falhados');
    } finally {
      setRetrying(false);
    }
  };

  const retryCancelledJobs = async () => {
    setRetrying(true);
    try {
      const response = await axios.post(`${API}/share-scan/retry-cancelled`);
      toast.success(response.data.message);
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error retrying cancelled jobs:', error);
      toast.error('Erro ao reexecutar jobs cancelados');
    } finally {
      setRetrying(false);
    }
  };

  const retryJob = async (jobId) => {
    try {
      const response = await axios.post(`${API}/share-scan/jobs/${jobId}/retry`);
      toast.success(response.data.message);
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error retrying job:', error);
      toast.error(error.response?.data?.detail || 'Erro ao reexecutar job');
    }
  };

  const deleteJob = async (jobId) => {
    try {
      const response = await axios.delete(`${API}/share-scan/jobs/${jobId}`);
      toast.success(response.data.message);
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error deleting job:', error);
      toast.error(error.response?.data?.detail || 'Erro ao deletar job');
    }
  };

  const filteredJobs = jobs.filter(job => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      job.server_name?.toLowerCase().includes(term) ||
      job.server_ip?.toLowerCase().includes(term) ||
      String(job.id).includes(term)
    );
  });

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs de Share Scan</h1>
          <p className="text-muted-foreground mt-1">
            Monitoramento de scans de shares nos servidores
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={isConnected ? "outline" : "secondary"}
            className={`text-xs ${isConnected ? 'border-green-600 text-green-600' : 'text-muted-foreground'}`}
          >
            <span className={`w-2 h-2 rounded-full mr-1.5 ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}></span>
            {isConnected ? 'Tempo real' : 'Offline'}
          </Badge>
          <Button variant="outline" onClick={() => { loadJobs(); loadStats(); }} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Object.entries(statusConfig).map(([status, config]) => {
          const count = stats[status] || 0;
          const isActive = activeFilter === status;
          const Icon = config.icon;

          return (
            <Card
              key={status}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md border-l-4",
                config.borderColor,
                isActive
                  ? `ring-2 ${config.ringColor} border ${config.borderColor}`
                  : "border border-transparent hover:border-muted-foreground/30"
              )}
              onClick={() => setActiveFilter(isActive ? null : status)}
            >
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className={cn("text-xs uppercase", config.textColor)}>{config.label}</p>
                  </div>
                  <Icon className={cn("w-6 h-6 opacity-60", config.textColor)} />
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Total card */}
        <Card
          className={cn(
            "cursor-pointer transition-all hover:shadow-md border-l-4 border-l-blue-500",
            activeFilter === null
              ? "ring-2 ring-blue-500 border border-l-blue-500"
              : "border border-transparent hover:border-muted-foreground/30"
          )}
          onClick={() => setActiveFilter(null)}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.total || 0}</p>
                <p className="text-xs text-muted-foreground uppercase">Total</p>
              </div>
              <Eye className="w-6 h-6 text-blue-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active filter indicator */}
      {activeFilter && (
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
      )}

      {/* Search and Actions */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por servidor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'retry', jobId: null })}
                disabled={stats.failed === 0 || retrying}
              >
                {retrying ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Reexecutar Falhados ({stats.failed || 0})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'retryCancelled', jobId: null })}
                disabled={stats.cancelled === 0 || retrying}
                className="text-orange-500 border-orange-500/50 hover:bg-orange-500/10"
              >
                {retrying ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Reexecutar Cancelados ({stats.cancelled || 0})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'cancelAll', jobId: null })}
                disabled={(stats.pending || 0) + (stats.running || 0) === 0}
                className="text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Cancelar Todos
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'clear', jobId: null })}
                disabled={stats.completed === 0 && stats.failed === 0 && stats.cancelled === 0}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Limpar Finalizados
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Jobs ({filteredJobs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && jobs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Eye className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg">Nenhum job de share scan encontrado</p>
              <p className="text-sm">Inicie um scan em Servidores &rarr; Share Scan</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>Servidor</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[100px]">Shares</TableHead>
                    <TableHead className="w-[120px]">Não $ shares</TableHead>
                    <TableHead className="w-[140px]">Criado</TableHead>
                    <TableHead className="w-[80px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.id}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Server className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <div className="flex flex-col">
                            <span className="font-medium text-sm truncate max-w-[200px]" title={job.server_name}>
                              {job.server_name}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {job.server_ip}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ScanStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {job.status === 'completed' ? (
                          <span className="text-green-500 font-medium">{job.shares_found}</span>
                        ) : job.status === 'failed' && job.error_message ? (
                          <span className="text-red-500 truncate max-w-[150px] cursor-help" title={job.error_message}>
                            {getErrorLabel(job.error_message)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {job.status === 'completed' ? (
                          job.has_non_admin_shares ? (
                            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-500 border-emerald-500/50 text-[10px]">
                              Sim
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-zinc-500/20 text-zinc-400 border-zinc-500/50 text-[10px]">
                              Apenas admin
                            </Badge>
                          )
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(job.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {job.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => prioritizeJob(job.id)}
                              className="h-7 w-7 p-0 text-green-500 hover:text-green-600"
                              title="Executar agora (prioridade máxima)"
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
                          {(job.status === 'pending' || job.status === 'running') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDialog({ open: true, action: 'cancel', jobId: job.id })}
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                              title="Cancelar job"
                            >
                              <StopCircle className="w-4 h-4" />
                            </Button>
                          )}
                          {(job.status === 'cancelled' || job.status === 'failed') && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => retryJob(job.id)}
                                className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600"
                                title="Reexecutar job"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDialog({ open: true, action: 'delete', jobId: job.id })}
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                title="Remover job"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === 'clear' ? 'Limpar Jobs Finalizados' :
               confirmDialog.action === 'retry' ? 'Reexecutar Jobs Falhados' :
               confirmDialog.action === 'retryCancelled' ? 'Reexecutar Jobs Cancelados' :
               confirmDialog.action === 'cancelAll' ? 'Cancelar Todos os Jobs' :
               confirmDialog.action === 'delete' ? 'Remover Job' :
               'Cancelar Job'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'clear'
                ? 'Isso removerá todos os jobs concluídos, falhados e cancelados. Esta ação não pode ser desfeita.'
                : confirmDialog.action === 'retry'
                ? `Isso reenfileirará ${stats.failed} jobs falhados para processamento novamente.`
                : confirmDialog.action === 'retryCancelled'
                ? `Isso reenfileirará ${stats.cancelled} jobs cancelados para processamento novamente.`
                : confirmDialog.action === 'cancelAll'
                ? `Isso cancelará ${(stats.pending || 0) + (stats.running || 0)} jobs pendentes e em execução.`
                : confirmDialog.action === 'delete'
                ? 'Tem certeza que deseja remover este job? Esta ação não pode ser desfeita.'
                : 'Tem certeza que deseja cancelar este job?'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDialog.action === 'clear') {
                  clearFinishedJobs();
                } else if (confirmDialog.action === 'cancel') {
                  cancelJob(confirmDialog.jobId);
                } else if (confirmDialog.action === 'retry') {
                  retryFailedJobs();
                } else if (confirmDialog.action === 'retryCancelled') {
                  retryCancelledJobs();
                } else if (confirmDialog.action === 'cancelAll') {
                  cancelAllJobs();
                } else if (confirmDialog.action === 'delete') {
                  deleteJob(confirmDialog.jobId);
                }
                setConfirmDialog({ open: false, action: null, jobId: null });
              }}
              className={
                confirmDialog.action === 'retry' || confirmDialog.action === 'retryCancelled'
                  ? "bg-blue-500 hover:bg-blue-600"
                  : "bg-red-500 hover:bg-red-600"
              }
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ShareScanJobs;
