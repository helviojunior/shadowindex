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

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api/v2`;

const Gitleaks = () => {
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
      toast.error('Erro ao carregar relatório: ' + (error.response?.data?.detail || error.message));
      setReportModal({ open: false, jobId: null, data: null, loading: false });
    }
  };

  // Copiar JSON para clipboard
  const copyJsonToClipboard = () => {
    if (reportModal.data?.report) {
      navigator.clipboard.writeText(JSON.stringify(reportModal.data.report, null, 2));
      toast.success('JSON copiado para a área de transferência');
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
      toast.success('Download iniciado');
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

  // Polling para jobs ativos
  useEffect(() => {
    if (polling) {
      const interval = setInterval(loadJobs, 2000);
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
      toast.error('Selecione um servidor');
      return;
    }
    
    if (scanMode === 'custom' && !customPath) {
      toast.error('Informe o caminho do diretório');
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
      
      toast.success(`Scan iniciado! Job ID: ${response.data.job_id}`);
      setPolling(true);
      loadJobs();
      
    } catch (error) {
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(`Erro ao iniciar scan: ${errorMsg}`);
    } finally {
      setLoading(false);
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

  const finishedJobs = jobs.filter(j => ['completed', 'failed', 'cancelled'].includes(j.status));

  return (
    <div className="space-y-6" data-testid="gitleaks-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">GitLeaks</h1>
        <p className="text-muted-foreground mt-2">Detecção de secrets e credenciais em arquivos</p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Status do GitLeaks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            {status.available ? (
              <>
                <Badge className="gap-1 bg-green-600">
                  <CheckCircle className="w-3 h-3" />
                  Disponível
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Versão: {status.version || 'N/A'}
                </span>
              </>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="w-3 h-3" />
                Não disponível
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
            Iniciar Scan
          </CardTitle>
          <CardDescription>
            Escaneie arquivos em busca de secrets, chaves de API e credenciais
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
              Por Servidor
            </Button>
            <Button
              variant={scanMode === 'custom' ? 'default' : 'outline'}
              onClick={() => setScanMode('custom')}
              className="gap-2"
            >
              <FolderSearch className="w-4 h-4" />
              Caminho Custom
            </Button>
          </div>

          {scanMode === 'server' ? (
            <div className="space-y-2">
              <Label>Servidor</Label>
              <Select value={selectedServer} onValueChange={setSelectedServer}>
                <SelectTrigger data-testid="server-selector">
                  <SelectValue placeholder="Selecione um servidor" />
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
                Escaneia todos os arquivos baixados do servidor selecionado
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Caminho do Diretório</Label>
              <Input
                placeholder="/caminho/para/diretorio"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                data-testid="custom-path-input"
              />
              <p className="text-xs text-muted-foreground">
                Informe o caminho absoluto do diretório a ser escaneado
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
            Iniciar Scan
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
                Jobs de Scan
              </CardTitle>
              <CardDescription>
                {jobs.length} job(s) registrado(s)
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadJobs}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Atualizar
              </Button>
              {finishedJobs.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleClearFinished}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Limpar Finalizados
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Nenhum job de scan registrado</p>
              <p className="text-sm">Inicie um scan para detectar secrets</p>
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
                            {job.findings_count} findings
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                        {job.target_path}
                      </p>
                      {job.started_at && (
                        <p className="text-xs text-muted-foreground">
                          Iniciado: {new Date(job.started_at).toLocaleString()}
                        </p>
                      )}
                      {job.error_message && (
                        <p className="text-xs text-red-500 truncate max-w-md">
                          Erro: {job.error_message}
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
                          Cancelar
                        </Button>
                      )}
                      {job.status === 'completed' && (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => loadJobReport(job.job_id)}
                            title="Ver JSON do relatório"
                          >
                            <FileJson className="w-4 h-4 mr-1" />
                            Ver JSON
                          </Button>
                          {job.findings_count > 0 && (
                            <Button 
                              variant="default" 
                              size="sm"
                              onClick={() => window.location.href = '/leaks'}
                            >
                              Ver Findings
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
              Relatório GitLeaks - Job #{reportModal.jobId}
            </DialogTitle>
            <DialogDescription>
              {reportModal.data && (
                <span>
                  {reportModal.data.findings_count} finding(s) encontrado(s) • 
                  Servidor ID: {reportModal.data.server_id || 'N/A'}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {reportModal.loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="ml-2">Carregando relatório...</span>
            </div>
          ) : reportModal.data ? (
            <div className="space-y-4">
              {/* Ações */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyJsonToClipboard}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copiar JSON
                </Button>
                <Button variant="outline" size="sm" onClick={downloadJson}>
                  <Download className="w-4 h-4 mr-2" />
                  Download JSON
                </Button>
              </div>
              
              {/* Info do relatório */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Caminho escaneado:</Label>
                  <p className="font-mono text-xs truncate">{reportModal.data.target_path}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Arquivo do relatório:</Label>
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
