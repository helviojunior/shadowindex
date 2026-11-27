import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  GitBranch, Clock, Loader2, CheckCircle, XCircle, StopCircle,
  X, RotateCcw, ChevronUp, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { dateLocale } from '@/lib/datetime';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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
    <Badge variant="outline" className={cn('gap-1', variant.className)}>
      <Icon className={cn('w-3 h-3', variant.spin && 'animate-spin')} />
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
};

export default function GitCloneJobs() {
  const { t } = useTranslation('git-clone-jobs');
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  const loadJobs = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/jobs?limit=200`);
      if (isMounted.current) setJobs(res.data?.jobs || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/jobs/stats`);
      if (isMounted.current) setStats(res.data);
    } catch (e) { /* noop */ }
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
      if (isMounted.current) { loadJobs(); loadStats(); }
    }, 5000);
    return () => { isMounted.current = false; clearInterval(interval); };
  }, [loadJobs, loadStats]);

  const act = async (fn, successMsg) => {
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
      await Promise.all([loadJobs(), loadStats()]);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.actionError'));
    }
  };

  const cancelJob = (id) => act(() => axios.post(`${API}/git/jobs/${id}/cancel`), t('toast.cancelled'));
  const retryJob = (id) => act(() => axios.post(`${API}/git/jobs/${id}/retry`), t('toast.retried'));
  const prioritize = (id) => act(() => axios.post(`${API}/git/jobs/${id}/prioritize`), t('toast.prioritized'));
  const cancelAll = () => act(() => axios.post(`${API}/git/jobs/cancel-all`), t('toast.cancelAllDone'));
  const retryFailed = () => act(() => axios.post(`${API}/git/jobs/retry-failed`), t('toast.retryFailedDone'));

  const fmtDate = (s) => s ? new Date(s).toLocaleString(dateLocale()) : '';
  const stepLabel = (s) => s ? t(`steps.${s}`, { defaultValue: s }) : '';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GitBranch className="w-7 h-7" />
          <div>
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={cancelAll}><X className="w-4 h-4 mr-2" />{t('actions.cancelAll')}</Button>
          <Button variant="outline" size="sm" onClick={retryFailed}><RotateCcw className="w-4 h-4 mr-2" />{t('actions.retryFailed')}</Button>
          <Button variant="outline" size="icon" onClick={() => { loadJobs(); loadStats(); }}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {['total', 'pending', 'running', 'completed', 'failed', 'cancelled'].map(k => (
            <Card key={k}><CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats[k] ?? 0}</div>
              <div className="text-xs text-muted-foreground">{t(`stats.${k}`)}</div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">{t('title')}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.repo')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead>{t('table.step')}</TableHead>
                <TableHead className="text-right">{t('table.progress')}</TableHead>
                <TableHead className="text-right">{t('table.leaks')}</TableHead>
                <TableHead>{t('table.created')}</TableHead>
                <TableHead className="text-right">{t('table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{t('table.empty')}</TableCell></TableRow>
              ) : jobs.map(j => (
                <TableRow key={j.id} data-testid="git-job-row">
                  <TableCell>
                    <div className="font-medium">{j.repo_full_name}</div>
                    {j.error_message && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 text-xs text-red-500 cursor-help">
                              <AlertTriangle className="w-3 h-3" />{String(j.error_message).slice(0, 40)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">{j.error_message}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                  <TableCell><ScanStatusBadge status={j.status} /></TableCell>
                  <TableCell>{stepLabel(j.current_step) && <Badge variant="outline">{stepLabel(j.current_step)}</Badge>}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {j.total_files ? `${j.processed_files}/${j.total_files}` : (j.processed_files || 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    {j.leaks_found > 0
                      ? <span className="inline-flex items-center gap-1 text-red-500"><AlertTriangle className="w-3 h-3" />{j.leaks_found}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(j.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(j.status === 'pending' || j.status === 'running') && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => cancelJob(j.id)} title={t('actions.cancel')}>
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                      {j.status === 'pending' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => prioritize(j.id)} title={t('actions.prioritize')}>
                          <ChevronUp className="w-4 h-4" />
                        </Button>
                      )}
                      {(j.status === 'failed' || j.status === 'cancelled') && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => retryJob(j.id)} title={t('actions.retry')}>
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
