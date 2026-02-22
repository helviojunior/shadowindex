import { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { 
  Eye, 
  RefreshCw, 
  Trash2, 
  XCircle, 
  CheckCircle, 
  Clock, 
  Loader2,
  AlertTriangle,
  Search,
  Filter,
  StopCircle,
  Play,
  FileText,
  Server,
  SkipForward,
  Wifi,
  WifiOff,
  RotateCcw
} from 'lucide-react';
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

const OCRJobs = () => {
  const { isConnected } = useWebSocket();
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0
  });
  const [tikaStatus, setTikaStatus] = useState({ online: null, server_url: '', error: null });
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: null, jobId: null });
  const isMounted = useRef(true);

  // Carregar status do Tika
  const loadTikaStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/ocr/tika-status`);
      if (isMounted.current) {
        setTikaStatus(response.data || { online: false });
      }
    } catch (error) {
      console.error('Error loading Tika status:', error);
      if (isMounted.current) {
        setTikaStatus({ online: false, error: 'Erro ao verificar status' });
      }
    }
  }, []);

  // Carregar jobs
  const loadJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('limit', '100');
      if (filter !== 'all') {
        params.append('status', filter);
      }
      
      const response = await axios.get(`${API}/ocr/jobs?${params.toString()}`);
      if (isMounted.current) {
        setJobs(response.data || []);
      }
    } catch (error) {
      console.error('Error loading OCR jobs:', error);
    }
  }, [filter]);

  // Carregar estatísticas
  const loadStats = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/ocr/stats`);
      if (isMounted.current) {
        setStats(response.data || {});
      }
    } catch (error) {
      console.error('Error loading OCR stats:', error);
    }
  }, []);

  // Carregar dados iniciais
  useEffect(() => {
    isMounted.current = true;
    
    const loadData = async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadStats(), loadTikaStatus()]);
      setLoading(false);
    };
    
    loadData();
    
    // Polling a cada 5 segundos para jobs e stats
    const interval = setInterval(() => {
      if (isMounted.current) {
        loadJobs();
        loadStats();
      }
    }, 5000);
    
    // Polling a cada 30 segundos para status do Tika
    const tikaInterval = setInterval(() => {
      if (isMounted.current) {
        loadTikaStatus();
      }
    }, 30000);
    
    return () => {
      isMounted.current = false;
      clearInterval(interval);
      clearInterval(tikaInterval);
    };
  }, [loadJobs, loadStats, loadTikaStatus]);

  // Cancelar job
  const cancelJob = async (jobId) => {
    try {
      await axios.post(`${API}/ocr/jobs/${jobId}/cancel`);
      toast.success('Job cancelado com sucesso');
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error cancelling job:', error);
      toast.error('Erro ao cancelar job');
    }
  };

  // Cancelar todos os jobs OCR
  const cancelAllOcrJobs = async () => {
    try {
      const response = await axios.post(`${API}/ocr/cancel-all`);
      toast.success(response.data.message || 'Todos os jobs OCR cancelados');
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error cancelling all OCR jobs:', error);
      toast.error('Erro ao cancelar todos os jobs OCR');
    }
  };

  // Limpar jobs finalizados
  const clearFinishedJobs = async () => {
    try {
      const response = await axios.delete(`${API}/ocr/jobs/clear-finished`);
      toast.success(`${response.data.deleted} jobs removidos`);
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error clearing jobs:', error);
      toast.error('Erro ao limpar jobs');
    }
  };

  // Reexecutar jobs falhados
  const retryFailedJobs = async () => {
    setRetrying(true);
    try {
      const response = await axios.post(`${API}/ocr/retry-failed`);
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

  // Filtrar jobs por termo de busca
  const filteredJobs = jobs.filter(job => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      job.file_name?.toLowerCase().includes(term) ||
      job.file_path?.toLowerCase().includes(term) ||
      String(job.id).includes(term)
    );
  });

  // Status badge
  const StatusBadge = ({ status }) => {
    const variants = {
      pending: { icon: Clock, className: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' },
      running: { icon: Loader2, className: 'bg-blue-500/20 text-blue-500 border-blue-500/50', spin: true },
      completed: { icon: CheckCircle, className: 'bg-green-500/20 text-green-500 border-green-500/50' },
      failed: { icon: XCircle, className: 'bg-red-500/20 text-red-500 border-red-500/50' },
      skipped: { icon: SkipForward, className: 'bg-gray-500/20 text-gray-400 border-gray-500/50' },
      cancelled: { icon: StopCircle, className: 'bg-orange-500/20 text-orange-500 border-orange-500/50' }
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

  // Formatar data
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6 p-6" data-testid="ocr-jobs-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs de OCR</h1>
          <p className="text-muted-foreground mt-1">
            Gerenciamento e monitoramento de processamento OCR
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
          <Button variant="outline" onClick={() => { loadJobs(); loadStats(); loadTikaStatus(); }} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Tika Server Status Card + Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
        {/* Tika Server Status */}
        <Card className={cn(
          "border-l-4",
          tikaStatus.online === null ? "border-l-gray-500" :
          tikaStatus.online ? "border-l-green-500" : "border-l-red-500"
        )}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">
                  {tikaStatus.online === null ? 'Verificando...' :
                   tikaStatus.online ? 'Online' : 'Offline'}
                </p>
                <p className="text-xs text-muted-foreground uppercase">Tika Server</p>
                {tikaStatus.error && (
                  <p className="text-xs text-red-500 mt-1 truncate" title={tikaStatus.error}>
                    {tikaStatus.error}
                  </p>
                )}
              </div>
              {tikaStatus.online === null ? (
                <Loader2 className="w-6 h-6 text-gray-500 opacity-60 animate-spin" />
              ) : tikaStatus.online ? (
                <Wifi className="w-6 h-6 text-green-500 opacity-60" />
              ) : (
                <WifiOff className="w-6 h-6 text-red-500 opacity-60" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <Card className="border-l-4 border-l-blue-500">
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

        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.pending || 0}</p>
                <p className="text-xs text-muted-foreground uppercase">Pendentes</p>
              </div>
              <Clock className="w-6 h-6 text-yellow-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-cyan-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.running || 0}</p>
                <p className="text-xs text-muted-foreground uppercase">Executando</p>
              </div>
              <Play className="w-6 h-6 text-cyan-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.completed || 0}</p>
                <p className="text-xs text-muted-foreground uppercase">Concluídos</p>
              </div>
              <CheckCircle className="w-6 h-6 text-green-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.failed || 0}</p>
                <p className="text-xs text-muted-foreground uppercase">Falhados</p>
              </div>
              <XCircle className="w-6 h-6 text-red-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-gray-500">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.skipped || 0}</p>
                <p className="text-xs text-muted-foreground uppercase">Ignorados</p>
              </div>
              <SkipForward className="w-6 h-6 text-gray-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por arquivo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[150px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filtrar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="running">Executando</SelectItem>
                  <SelectItem value="completed">Concluídos</SelectItem>
                  <SelectItem value="failed">Falhados</SelectItem>
                  <SelectItem value="skipped">Ignorados</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
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
                Reexecutar Falhados
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'cancelAll', jobId: null })}
                disabled={(stats.pending || 0) + (stats.running || 0) === 0}
                className="text-orange-500 border-orange-500/50 hover:bg-orange-500/10"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Cancelar Todos
              </Button>
              <Button 
                variant="destructive" 
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'clear', jobId: null })}
                disabled={stats.completed === 0 && stats.failed === 0 && stats.skipped === 0}
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
            <FileText className="w-5 h-5" />
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
              <p className="text-lg">Nenhum job de OCR encontrado</p>
              <p className="text-sm">Jobs serão criados automaticamente ao baixar arquivos</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead className="w-[100px]">Server</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[100px]">Chars</TableHead>
                    <TableHead className="w-[140px]">Criado</TableHead>
                    <TableHead className="w-[80px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.id}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium truncate max-w-[300px]" title={job.file_name}>
                            {job.file_name}
                          </span>
                          <span className="text-xs text-muted-foreground truncate max-w-[300px]" title={job.file_path}>
                            {job.file_path}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs">
                          <Server className="w-3 h-3" />
                          {job.server_id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {job.status === 'completed' ? (
                          <span className="text-green-500">{(job.ocr_text?.length || 0).toLocaleString()}</span>
                        ) : job.error_message ? (
                          <span className="text-red-500" title={job.error_message}>Erro</span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(job.created_at)}
                      </TableCell>
                      <TableCell>
                        {(job.status === 'pending' || job.status === 'running') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDialog({ open: true, action: 'cancel', jobId: job.id })}
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                          >
                            <StopCircle className="w-4 h-4" />
                          </Button>
                        )}
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
               confirmDialog.action === 'cancelAll' ? 'Cancelar Todos os Jobs' :
               'Cancelar Job'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'clear' 
                ? 'Isso removerá todos os jobs concluídos, falhados e ignorados. Esta ação não pode ser desfeita.'
                : confirmDialog.action === 'retry'
                ? `Isso reenfileirará ${stats.failed} jobs falhados para processamento novamente.`
                : confirmDialog.action === 'cancelAll'
                ? `Isso cancelará ${(stats.pending || 0) + (stats.running || 0)} jobs pendentes e em execução.`
                : 'Tem certeza que deseja cancelar este job?'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDialog.action === 'clear') {
                  clearFinishedJobs();
                } else if (confirmDialog.action === 'cancel') {
                  cancelJob(confirmDialog.jobId);
                } else if (confirmDialog.action === 'retry') {
                  retryFailedJobs();
                } else if (confirmDialog.action === 'cancelAll') {
                  cancelAllOcrJobs();
                }
                setConfirmDialog({ open: false, action: null, jobId: null });
              }}
              className={confirmDialog.action === 'retry' ? "bg-blue-500 hover:bg-blue-600" : "bg-red-500 hover:bg-red-600"}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OCRJobs;
