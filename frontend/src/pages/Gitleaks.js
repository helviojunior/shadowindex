import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Play, 
  Square, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Search,
  Trash2,
  RefreshCw,
  Server,
  FolderSearch,
  Clock,
  FileWarning,
  FileJson,
  Copy,
  Download
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api/v2`;

const Gitleaks = () => {
  const { t } = useTranslation('gitleaks');
  const [status, setStatus] = useState({ available: false, version: null });
  const [jobs, setJobs] = useState([]);
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [scanMode, setScanMode] = useState('server'); // 'server' or 'custom'
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  
  // Estado para modal de visualização do JSON
  const [reportModal, setReportModal] = useState({ open: false, jobId: null, data: null, loading: false });

  // Função para carregar o relatório JSON do job
  const loadJobReport = async (jobId) => {
    setReportModal({ open: true, jobId, data: null, loading: true });
    try {
      const response = await axios.get(`${API}/gitleaks/jobs/${jobId}/report`);
      setReportModal({ open: true, jobId, data: response.data, loading: false });
    } catch (error) {
      console.error('Error loading job report:', error);
      toast.error(t('toast.reportLoadError', { error: error.response?.data?.detail || error.message }));
      setReportModal({ open: false, jobId: null, data: null, loading: false });
    }
  };

  // Copiar JSON para clipboard
  const copyJsonToClipboard = async () => {
    if (reportModal.data?.report) {
      const text = JSON.stringify(reportModal.data.report, null, 2);
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        toast.success(t('toast.jsonCopied'));
      } catch (error) {
        toast.error(t('toast.copyError'));
      }
    }
  };

  // Download do JSON
  const downloadJson = () => {
    if (reportModal.data?.report) {
      const blob = new Blob([JSON.stringify(reportModal.data.report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gitleaks_report_${reportModal.jobId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('toast.downloadStarted'));
    }
  };

  // Carregar status do GitLeaks
  const loadStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/gitleaks/status`);
      setStatus(response.data);
    } catch (error) {
      console.error('Error loading gitleaks status:', error);
      setStatus({ available: false, version: null });
    }
  }, []);

  // Carregar lista de servidores
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
      
      // Verificar se há jobs ativos para continuar polling
      const hasActiveJobs = response.data.jobs?.some(
        j => j.status === 'pending' || j.status === 'running'
      );
      setPolling(hasActiveJobs);
    } catch (error) {
      console.error('Error loading jobs:', error);
    }
  }, []);

  // Polling para jobs ativos (5 segundos)
  useEffect(() => {
    if (polling) {
      const interval = setInterval(loadJobs, 5000);
      return () => clearInterval(interval);
    }
  }, [polling, loadJobs]);

  // Carregar dados iniciais
  useEffect(() => {
    loadStatus();
    loadServers();
    loadJobs();
  }, [loadStatus, loadServers, loadJobs]);

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

    setLoading(true);
    
    try {
      let response;
      
      if (scanMode === 'server') {
        response = await axios.post(`${API}/gitleaks/scan-server/${selectedServer}`);
      } else {
        response = await axios.post(`${API}/gitleaks/scan`, {
          target_path: customPath
        });
      }

      setPolling(true);
      loadJobs();
      
    } catch (error) {
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.scanError', { error: errorMsg }));
    } finally {
      setLoading(false);
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

  const finishedJobs = jobs.filter(j => ['completed', 'failed', 'cancelled'].includes(j.status));

  return (
    <div className="space-y-6" data-testid="gitleaks-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">GitLeaks</h1>
        <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            {t('status.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            {status.available ? (
              <>
                <Badge className="gap-1 bg-green-600">
                  <CheckCircle className="w-3 h-3" />
                  {t('status.available')}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {t('status.version', { version: status.version || 'N/A' })}
                </span>
              </>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="w-3 h-3" />
                {t('status.unavailable')}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={loadStatus}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scan Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderSearch className="w-5 h-5" />
            {t('scan.title')}
          </CardTitle>
          <CardDescription>
            {t('scan.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Modo de scan */}
          <div className="flex gap-4">
            <Button
              variant={scanMode === 'server' ? 'default' : 'outline'}
              onClick={() => setScanMode('server')}
              className="gap-2"
            >
              <Server className="w-4 h-4" />
              {t('scan.byServer')}
            </Button>
            <Button
              variant={scanMode === 'custom' ? 'default' : 'outline'}
              onClick={() => setScanMode('custom')}
              className="gap-2"
            >
              <FolderSearch className="w-4 h-4" />
              {t('scan.customPath')}
            </Button>
          </div>

          {scanMode === 'server' ? (
            <div className="space-y-2">
              <Label>{t('scan.serverLabel')}</Label>
              <Select value={selectedServer} onValueChange={setSelectedServer}>
                <SelectTrigger data-testid="server-selector">
                  <SelectValue placeholder={t('scan.selectServerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {servers.map((server) => (
                    <SelectItem key={server.id} value={server.id.toString()}>
                      <span className="flex items-center gap-2">
                        <Server className="w-3 h-3" />
                        {server.name} ({server.ip})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('scan.serverHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t('scan.directoryLabel')}</Label>
              <Input
                placeholder={t('scan.pathPlaceholder')}
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                data-testid="custom-path-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('scan.pathHint')}
              </p>
            </div>
          )}

          <Button 
            onClick={handleStartScan} 
            disabled={loading || !status.available}
            data-testid="start-scan-btn"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            {t('scan.title')}
          </Button>
        </CardContent>
      </Card>

      {/* Jobs Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileWarning className="w-5 h-5" />
                {t('jobs.title')}
              </CardTitle>
              <CardDescription>
                {t('jobs.registered', { count: jobs.length })}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadJobs}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('common:actions.refresh')}
              </Button>
              {finishedJobs.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleClearFinished}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('jobs.clearFinished')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>{t('jobs.emptyTitle')}</p>
              <p className="text-sm">{t('jobs.emptyDesc')}</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={job.job_id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">
                          #{job.job_id}
                        </span>
                        {getStatusBadge(job.status)}
                        {job.findings_count > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {t('jobs.findingsCount', { count: job.findings_count })}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                        {job.target_path}
                      </p>
                      {job.started_at && (
                        <p className="text-xs text-muted-foreground">
                          {t('jobs.startedAt', { date: new Date(job.started_at).toLocaleString() })}
                        </p>
                      )}
                      {job.error_message && (
                        <p className="text-xs text-red-500 truncate max-w-md">
                          {t('jobs.errorLabel', { error: job.error_message })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {job.status === 'running' && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleCancelJob(job.job_id)}
                        >
                          <Square className="w-4 h-4 mr-1" />
                          {t('common:actions.cancel')}
                        </Button>
                      )}
                      {job.status === 'completed' && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => loadJobReport(job.job_id)}
                            title={t('jobs.viewReportJsonTitle')}
                          >
                            <FileJson className="w-4 h-4 mr-1" />
                            {t('jobs.viewJson')}
                          </Button>
                          {job.findings_count > 0 && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => window.location.href = '/leaks'}
                            >
                              {t('jobs.viewFindings')}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Modal para visualizar JSON do relatório */}
      <Dialog open={reportModal.open} onOpenChange={(open) => !open && setReportModal({ open: false, jobId: null, data: null, loading: false })}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="w-5 h-5" />
              {t('report.title', { id: reportModal.jobId })}
            </DialogTitle>
            <DialogDescription>
              {reportModal.data && (
                <span>
                  {t('report.summary', { count: reportModal.data.findings_count, serverId: reportModal.data.server_id || 'N/A' })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {reportModal.loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="ml-2">{t('report.loading')}</span>
            </div>
          ) : reportModal.data ? (
            <div className="space-y-4">
              {/* Ações */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyJsonToClipboard}>
                  <Copy className="w-4 h-4 mr-2" />
                  {t('report.copyJson')}
                </Button>
                <Button variant="outline" size="sm" onClick={downloadJson}>
                  <Download className="w-4 h-4 mr-2" />
                  {t('report.downloadJson')}
                </Button>
              </div>
              
              {/* Info do relatório */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">{t('report.scannedPath')}</Label>
                  <p className="font-mono text-xs truncate">{reportModal.data.target_path}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('report.reportFile')}</Label>
                  <p className="font-mono text-xs truncate">{reportModal.data.report_path}</p>
                </div>
              </div>
              
              {/* JSON */}
              <ScrollArea className="h-[400px] border rounded-lg">
                <pre className="p-4 text-xs font-mono bg-muted/30">
                  {JSON.stringify(reportModal.data.report, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Gitleaks;
