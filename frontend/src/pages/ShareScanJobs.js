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
import { useTranslation } from 'react-i18next';
import { dateLocale } from '@/lib/datetime';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/v2`;

const ScanStatusBadge = ({ status }) => {
  const { t } = useTranslation('common');
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
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
};

const getErrorLabel = (errorMessage, t) => {
  if (!errorMessage) return t('errorLabels.generic');
  const msg = errorMessage.toLowerCase();
  if (msg.startsWith('server unreachable') || msg.includes('erro de rede')) return t('errorLabels.unreachable');
  if (msg.startsWith('access denied') || msg.includes('access denied') || msg.includes('acesso negado')) return t('errorLabels.accessDenied');
  if (msg.startsWith('credential not set') || msg.includes('credential')) return t('errorLabels.noCredential');
  if (msg.startsWith('connection error') || msg.includes('connection')) return t('errorLabels.connectionError');
  if (msg.startsWith('plugin not configured')) return t('errorLabels.pluginNotConfigured');
  if (msg.includes('timeout') || msg.includes('timed out')) return t('errorLabels.timeout');
  return t('errorLabels.generic');
};

const ShareScanJobs = () => {
  const { t } = useTranslation('share-scan-jobs');
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
    pending: { label: t('statusLabels.pending'), icon: Clock, textColor: 'text-yellow-500', borderColor: 'border-l-yellow-500', ringColor: 'ring-yellow-500' },
    running: { label: t('statusLabels.running'), icon: Play, textColor: 'text-cyan-500', borderColor: 'border-l-cyan-500', ringColor: 'ring-cyan-500' },
    completed: { label: t('statusLabels.completed'), icon: CheckCircle, textColor: 'text-green-500', borderColor: 'border-l-green-500', ringColor: 'ring-green-500' },
    failed: { label: t('statusLabels.failed'), icon: XCircle, textColor: 'text-red-500', borderColor: 'border-l-red-500', ringColor: 'ring-red-500' },
    cancelled: { label: t('statusLabels.cancelled'), icon: StopCircle, textColor: 'text-orange-500', borderColor: 'border-l-orange-500', ringColor: 'ring-orange-500' },
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
      toast.success(t('toast.cancelSuccess'));
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error cancelling job:', error);
      toast.error(t('toast.cancelError'));
    }
  };

  const cancelAllJobs = async () => {
    try {
      const response = await axios.post(`${API}/share-scan/cancel-all`);
      toast.success(response.data.message || t('toast.cancelAllSuccess'));
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error cancelling all jobs:', error);
      toast.error(t('toast.cancelAllError'));
    }
  };

  const clearFinishedJobs = async () => {
    try {
      const response = await axios.delete(`${API}/share-scan/jobs/clear-finished`);
      toast.success(t('toast.clearSuccess', { count: response.data.deleted }));
      loadJobs();
      loadStats();
    } catch (error) {
      console.error('Error clearing jobs:', error);
      toast.error(t('toast.clearError'));
    }
  };

  const prioritizeJob = async (jobId) => {
    try {
      const response = await axios.post(`${API}/share-scan/jobs/${jobId}/prioritize`);
      toast.success(response.data.message);
      loadJobs();
    } catch (error) {
      console.error('Error prioritizing job:', error);
      toast.error(error.response?.data?.detail || t('toast.prioritizeError'));
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
      toast.error(t('toast.retryFailedError'));
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
      toast.error(t('toast.retryCancelledError'));
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
      toast.error(error.response?.data?.detail || t('toast.retryError'));
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
      toast.error(error.response?.data?.detail || t('toast.deleteError'));
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
    return date.toLocaleString(dateLocale(), {
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
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={isConnected ? "outline" : "secondary"}
            className={`text-xs ${isConnected ? 'border-green-600 text-green-600' : 'text-muted-foreground'}`}
          >
            <span className={`w-2 h-2 rounded-full mr-1.5 ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`}></span>
            {isConnected ? t('realtime') : t('offline')}
          </Badge>
          <Button variant="outline" onClick={() => { loadJobs(); loadStats(); }} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            {t('common:actions.refresh')}
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
                <p className="text-xs text-muted-foreground uppercase">{t('total')}</p>
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
            {t('filter', { label: statusConfig[activeFilter]?.label })}
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
                placeholder={t('searchPlaceholder')}
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
                {t('actions.retryFailed')} ({stats.failed || 0})
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
                {t('actions.retryCancelled')} ({stats.cancelled || 0})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'cancelAll', jobId: null })}
                disabled={(stats.pending || 0) + (stats.running || 0) === 0}
                className="text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                {t('actions.cancelAll')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDialog({ open: true, action: 'clear', jobId: null })}
                disabled={stats.completed === 0 && stats.failed === 0 && stats.cancelled === 0}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('actions.clearFinished')}
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
            {t('table.jobs')} ({filteredJobs.length})
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
              <p className="text-lg">{t('table.empty')}</p>
              <p className="text-sm">{t('table.emptyHint')}</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">{t('table.id')}</TableHead>
                    <TableHead>{t('table.server')}</TableHead>
                    <TableHead className="w-[100px]">{t('table.status')}</TableHead>
                    <TableHead className="w-[100px]">{t('table.shares')}</TableHead>
                    <TableHead className="w-[120px]">{t('table.nonAdminShares')}</TableHead>
                    <TableHead className="w-[140px]">{t('table.created')}</TableHead>
                    <TableHead className="w-[80px]">{t('table.actions')}</TableHead>
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
                            {getErrorLabel(job.error_message, t)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {job.status === 'completed' ? (
                          job.has_non_admin_shares ? (
                            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-500 border-emerald-500/50 text-[10px]">
                              {t('table.hasNonAdmin')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-zinc-500/20 text-zinc-400 border-zinc-500/50 text-[10px]">
                              {t('table.onlyAdmin')}
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
                              title={t('rowActions.prioritize')}
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
                              title={t('rowActions.cancel')}
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
                                title={t('rowActions.retry')}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDialog({ open: true, action: 'delete', jobId: job.id })}
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                title={t('rowActions.remove')}
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
              {confirmDialog.action === 'clear' ? t('dialog.clearTitle') :
               confirmDialog.action === 'retry' ? t('dialog.retryTitle') :
               confirmDialog.action === 'retryCancelled' ? t('dialog.retryCancelledTitle') :
               confirmDialog.action === 'cancelAll' ? t('dialog.cancelAllTitle') :
               confirmDialog.action === 'delete' ? t('dialog.deleteTitle') :
               t('dialog.cancelTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'clear'
                ? t('dialog.clearDesc')
                : confirmDialog.action === 'retry'
                ? t('dialog.retryDesc', { count: stats.failed })
                : confirmDialog.action === 'retryCancelled'
                ? t('dialog.retryCancelledDesc', { count: stats.cancelled })
                : confirmDialog.action === 'cancelAll'
                ? t('dialog.cancelAllDesc', { count: (stats.pending || 0) + (stats.running || 0) })
                : confirmDialog.action === 'delete'
                ? t('dialog.deleteDesc')
                : t('dialog.cancelDesc')
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.back')}</AlertDialogCancel>
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
              {t('common:actions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ShareScanJobs;
