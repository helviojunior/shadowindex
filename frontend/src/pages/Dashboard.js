import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Database, Server, Globe, FileText, Wifi, WifiOff, HardDrive, Download,
  AlertTriangle, Shield, Activity, Search, RefreshCw, Play, FileWarning,
  Clock, CheckCircle, XCircle, Loader2, FolderSearch, X, Eye, ScanSearch
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';
import { useStatsEvents, useWebSocket, useDownloadEvents, useScanEvents } from '@/hooks/useWebSocket';
import { ShieldKeyIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const API_V2 = `${BACKEND_URL}/api/v2`;

const Dashboard = () => {
  const { offlineMode, setOfflineMode } = useApp();
  const { isConnected: wsConnected } = useWebSocket();
  const [stats, setStats] = useState({
    credentials: 0,
    dbConnections: 0,
    proxyServers: 0,
    soapApis: 0,
    cacheEntries: 0,
    servers: 0,
    downloadedFiles: 0
  });
  const [gitleaksStats, setGitleaksStats] = useState(null);
  const [extensionStats, setExtensionStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanningAll, setScanningAll] = useState(false);
  
  // Estados para monitoramento de jobs
  const [downloadJobs, setDownloadJobs] = useState([]);
  const [scanJobs, setScanJobs] = useState([]);
  const [ocrJobs, setOcrJobs] = useState([]);
  const [gitleaksJobs, setGitleaksJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // WebSocket para atualizações em tempo real
  useStatsEvents((data) => {
    // Atualizar estatísticas quando receber evento do WebSocket
    if (data.servers !== undefined) {
      setStats(prev => ({ ...prev, servers: data.servers }));
    }
    if (data.downloadedFiles !== undefined) {
      setStats(prev => ({ ...prev, downloadedFiles: data.downloadedFiles }));
    }
    if (data.credentials !== undefined) {
      setStats(prev => ({ ...prev, credentials: data.credentials }));
    }
    if (data.gitleaks) {
      setGitleaksStats(data.gitleaks);
    }
  });
  
  // Handlers para eventos de download
  const handleDownloadProgress = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, progress: data.progress, status: 'downloading' }
        : job
    ));
  }, []);
  
  const handleDownloadComplete = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, status: 'completed', progress: 100 }
        : job
    ));
  }, []);
  
  const handleDownloadFailed = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, status: 'failed', error_message: data.error }
        : job
    ));
  }, []);
  
  const handleDownloadStarted = useCallback((data) => {
    setDownloadJobs(prev => prev.map(job => 
      job.id === data.job_id 
        ? { ...job, status: 'downloading', progress: 0 }
        : job
    ));
  }, []);
  
  // Handlers para eventos de scan
  const handleScanProgress = useCallback((data) => {
    setScanJobs(prev => prev.map(scan => 
      scan.id === data.scan_id 
        ? { ...scan, status: data.status, processed_files: data.processed_files }
        : scan
    ));
  }, []);
  
  const handleScanComplete = useCallback((data) => {
    setScanJobs(prev => prev.map(scan => 
      scan.id === data.scan_id 
        ? { ...scan, status: 'completed' }
        : scan
    ));
  }, []);
  
  // Registrar eventos do WebSocket
  useDownloadEvents(handleDownloadProgress, handleDownloadComplete, handleDownloadFailed, handleDownloadStarted);
  useScanEvents(handleScanProgress, handleScanComplete);

  useEffect(() => {
    let isMounted = true;
    
    loadData();
    
    const loadJobsIfMounted = async () => {
      if (isMounted) await loadJobs();
    };
    
    loadJobsIfMounted();
    
    // Polling para jobs ativos (a cada 5 segundos)
    const jobsInterval = setInterval(() => {
      if (isMounted) loadJobs();
    }, 5000);
    
    return () => {
      isMounted = false;
      clearInterval(jobsInterval);
    };
  }, []);
  
  const loadJobs = async () => {
    try {
      // Limitar busca a jobs ativos + recentes para melhor performance
      const [downloads, scans, ocr, gitleaks] = await Promise.all([
        axios.get(`${API}/downloads?limit=50&active_first=true`).catch(() => ({ data: [] })),
        axios.get(`${API}/scans?limit=20`).catch(() => ({ data: [] })),
        axios.get(`${API_V2}/ocr/jobs?limit=20`).catch(() => ({ data: [] })),
        axios.get(`${API_V2}/gitleaks/jobs?active_only=false&limit=20`).catch(() => ({ data: { jobs: [] } }))
      ]);
      
      setDownloadJobs(downloads.data || []);
      setScanJobs(scans.data || []);
      setOcrJobs(ocr.data || []);
      // GitLeaks retorna { jobs: [], total: 0 }
      setGitleaksJobs(gitleaks.data?.jobs || []);
      setJobsLoading(false);
    } catch (error) {
      console.error('Error loading jobs:', error);
      setJobsLoading(false);
    }
  };

  const loadData = async () => {
    // Timeout de 10 segundos para todas as requisições
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const config = { signal: controller.signal };
      const [creds, dbs, proxies, soaps, cache, servers, gitleaks, findings] = await Promise.all([
        axios.get(`${API}/credentials`, config).catch(() => ({ data: [] })),
        axios.get(`${API}/db-connections`, config).catch(() => ({ data: [] })),
        axios.get(`${API}/proxy-servers`, config).catch(() => ({ data: [] })),
        axios.get(`${API}/soap-apis`, config).catch(() => ({ data: [] })),
        axios.get(`${API}/cache/stats`, config).catch(() => ({ data: { entries: 0 } })),
        axios.get(`${API}/servers`, config).catch(() => ({ data: [] })),
        axios.get(`${API_V2}/gitleaks/stats`, config).catch(() => ({ data: null })),
        axios.get(`${API_V2}/gitleaks/findings`, config).catch(() => ({ data: { files: [] } }))
      ]);
      
      clearTimeout(timeoutId);

      const totalDownloads = (servers.data || []).reduce((acc, server) => acc + (server.downloaded_files_count || 0), 0);

      setStats({
        credentials: (creds.data || []).length,
        dbConnections: (dbs.data || []).length,
        proxyServers: (proxies.data || []).length,
        soapApis: (soaps.data || []).length,
        cacheEntries: cache.data?.total_entries || 0,
        servers: (servers.data || []).length,
        downloadedFiles: totalDownloads
      });

      if (gitleaks.data) {
        setGitleaksStats(gitleaks.data);
      }

      // Processar extensões de arquivos com vulnerabilidades
      if (findings.data && findings.data.files) {
        const extensionCounts = {};
        findings.data.files.forEach(file => {
          // Usar file_name (do banco) ou extrair do server_path (caminho real no servidor)
          const fileName = file.file_name || '';
          const serverPath = file.server_path || file.file || '';
          
          // Se temos o nome do arquivo, usar ele; senão extrair do path
          let fileToExtract = fileName;
          if (!fileToExtract && serverPath) {
            // Extrair o nome do arquivo do path (último componente)
            const pathParts = serverPath.replace(/\//g, '\\').split('\\');
            fileToExtract = pathParts[pathParts.length - 1] || '';
          }
          
          // Extrair extensão do nome do arquivo
          const ext = fileToExtract.includes('.') 
            ? fileToExtract.split('.').pop()?.toLowerCase() 
            : 'sem extensão';
          const extension = ext && ext.length <= 10 ? `.${ext}` : (ext || 'other');
          extensionCounts[extension] = (extensionCounts[extension] || 0) + (file.findings?.length || 1);
        });

        // Converter para formato do radar chart e pegar top 8
        const extensionData = Object.entries(extensionCounts)
          .map(([ext, count]) => ({ extension: ext, vulnerabilities: count, fullMark: 100 }))
          .sort((a, b) => b.vulnerabilities - a.vulnerabilities)
          .slice(0, 8);

        // Normalizar para o radar (máximo = maior valor)
        const maxVal = Math.max(...extensionData.map(e => e.vulnerabilities), 1);
        extensionData.forEach(e => {
          e.fullMark = maxVal;
        });

        setExtensionStats(extensionData);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      // Não mostrar toast para erros de carregamento - a barra de conexão já informa
      setLoading(false);
    }
  };

  const toggleOfflineMode = async () => {
    const success = await setOfflineMode(!offlineMode);
    if (success) {
      toast.success(`Modo ${!offlineMode ? 'offline' : 'online'} ativado`);
    } else {
      toast.error('Erro ao alterar modo offline');
    }
  };

  const clearCache = async () => {
    try {
      await axios.delete(`${API}/cache/clear`);
      toast.success('Cache limpo com sucesso');
      loadData();
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast.error('Erro ao limpar cache');
    }
  };

  const handleScanAllServers = async () => {
    setScanningAll(true);
    try {
      const response = await axios.post(`${API_V2}/gitleaks/scan-all-servers`);
      if (response.data.scans_started > 0) {
        toast.success(`${response.data.scans_started} scans iniciados em background`);
      } else {
        toast.warning('Nenhum servidor com arquivos baixados para escanear');
      }
      setTimeout(loadData, 2000);
    } catch (error) {
      toast.error('Erro ao iniciar scan');
    } finally {
      setScanningAll(false);
    }
  };

  // Dados para o gráfico de severidade (Donut)
  const severityData = gitleaksStats ? [
    { name: 'Critical', value: gitleaksStats.severity_counts.critical, color: '#EF4444' },
    { name: 'High', value: gitleaksStats.severity_counts.high, color: '#F97316' },
    { name: 'Medium', value: gitleaksStats.severity_counts.medium, color: '#EAB308' },
    { name: 'Low', value: gitleaksStats.severity_counts.low, color: '#22C55E' },
    { name: 'Info', value: gitleaksStats.severity_counts.info, color: '#3B82F6' },
  ].filter(item => item.value > 0) : [];

  // Dados para o gráfico de Risk vs Time
  const riskOverTimeData = [
    { date: '01/02', risk: 0 },
    { date: '05/02', risk: gitleaksStats?.total_findings || 0 },
    { date: '10/02', risk: gitleaksStats?.total_findings || 0 },
    { date: '15/02', risk: gitleaksStats?.total_findings || 0 },
    { date: '20/02', risk: gitleaksStats?.total_findings || 0 },
    { date: 'Hoje', risk: gitleaksStats?.total_findings || 0 },
  ];

  // Calcular Risk Score
  const calculateRiskScore = () => {
    if (!gitleaksStats) return 0;
    const { severity_counts } = gitleaksStats;
    return (
      (severity_counts.critical * 100) +
      (severity_counts.high * 50) +
      (severity_counts.medium * 25) +
      (severity_counts.low * 10) +
      (severity_counts.info * 5)
    );
  };

  const riskScore = calculateRiskScore();
  const scanProgress = stats.servers > 0 
    ? Math.round((gitleaksStats?.servers_scanned || 0) / stats.servers * 100) 
    : 0;

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Visão geral de segurança e assets</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Atualizando...</span>
            </div>
          )}
          {/* WebSocket Status Indicator */}
          <Badge 
            variant={wsConnected ? "outline" : "secondary"} 
            className={`text-xs ${wsConnected ? 'border-green-600 text-green-600' : 'text-muted-foreground'}`}
          >
            <span className={`w-2 h-2 rounded-full mr-1.5 ${wsConnected ? 'bg-green-500' : 'bg-gray-400'}`}></span>
            {wsConnected ? 'Tempo real' : 'Offline'}
          </Badge>
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Linha 1: Top Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-cyan-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.servers}</p>
                <p className="text-sm text-muted-foreground uppercase tracking-wider">Total Servidores</p>
              </div>
              <HardDrive className="w-8 h-8 text-cyan-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{gitleaksStats?.servers_with_files || 0}</p>
                <p className="text-sm text-muted-foreground uppercase tracking-wider">Serv. com Arquivos</p>
              </div>
              <Download className="w-8 h-8 text-green-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{gitleaksStats?.total_findings || 0}</p>
                <p className="text-sm text-muted-foreground uppercase tracking-wider">Leaks Detectados</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.credentials}</p>
                <p className="text-sm text-muted-foreground uppercase tracking-wider">Credenciais</p>
              </div>
              <ShieldKeyIcon className="w-8 h-8 text-purple-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Linha 2: Overall Risk Score + Risk by Severity + Extensions Spider */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Overall Risk Score Card */}
        <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white">
          <CardHeader className="pb-1">
            <CardTitle className="text-lg text-white/90 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Índice de Risco Geral
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-center">
              <p className="text-5xl font-bold">{riskScore}</p>
              <p className="text-white/70 mt-1 text-sm">RISCO</p>
            </div>
            
            {/* Mini sparkline */}
            <div className="h-12 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={riskOverTimeData}>
                  <Area 
                    type="monotone" 
                    dataKey="risk" 
                    stroke="rgba(255,255,255,0.8)" 
                    fill="rgba(255,255,255,0.2)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Risk by Severity Donut Chart */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg">Risco por Severidade</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[180px]">
              {severityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={60}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {severityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1a1a1a', 
                        border: '1px solid #333',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={30}
                      formatter={(value) => (
                        <span style={{ color: '#999', fontSize: '11px' }}>{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Shield className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">Nenhum leak detectado</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Extensions Spider/Radar Chart */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileWarning className="w-5 h-5 text-red-500" />
              Leaks por Extensão
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[180px]">
              {extensionStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={extensionStats}>
                    <PolarGrid stroke="#333" />
                    <PolarAngleAxis 
                      dataKey="extension" 
                      tick={{ fill: '#999', fontSize: 10 }}
                    />
                    <PolarRadiusAxis 
                      angle={30} 
                      domain={[0, 'auto']}
                      tick={{ fill: '#666', fontSize: 9 }}
                    />
                    <Radar
                      name="Leaks"
                      dataKey="vulnerabilities"
                      stroke="#EF4444"
                      fill="#EF4444"
                      fillOpacity={0.5}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1a1a1a', 
                        border: '1px solid #333',
                        borderRadius: '8px'
                      }}
                      formatter={(value) => [`${value} leaks`, 'Leaks']}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <FileWarning className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">Sem dados de extensões</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Linha 3: Leaks vs. Tempo (linha inteira) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Leaks vs. Tempo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={riskOverTimeData}>
                <defs>
                  <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22C55E" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#22C55E" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" stroke="#666" fontSize={12} />
                <YAxis stroke="#666" fontSize={12} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1a1a1a', 
                    border: '1px solid #333',
                    borderRadius: '8px'
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="risk" 
                  stroke="#22C55E" 
                  fill="url(#riskGradient)"
                  strokeWidth={2}
                  dot={{ fill: '#22C55E', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Linha 4: Status do Scan (linha inteira) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Status do Scan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-8">
            <div className="text-center flex-shrink-0">
              <p className="text-5xl font-bold text-green-500">{scanProgress}%</p>
              <p className="text-xs text-muted-foreground mt-1">Progresso</p>
            </div>
            <Progress value={scanProgress} className="flex-1 h-3" />
          </div>
          
          <div className="grid grid-cols-4 gap-4 text-center pt-4 border-t">
            <div>
              <p className="text-2xl font-bold">{gitleaksStats?.jobs?.total || 0}</p>
              <p className="text-xs text-muted-foreground">Total de Scans</p>
            </div>
            <div>
              <Badge variant="outline" className="text-lg px-4 py-1">
                {gitleaksStats?.jobs?.running || 0}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">Executando</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{gitleaksStats?.jobs?.completed || 0}</p>
              <p className="text-xs text-muted-foreground">Concluídos</p>
            </div>
            <div>
              <Button 
                onClick={handleScanAllServers} 
                disabled={scanningAll}
                size="sm"
              >
                {scanningAll ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Escanear Todos
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linha 5: Monitoramento de Jobs em Tempo Real */}
      <Card data-testid="jobs-monitor">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              Monitoramento de Jobs
            </CardTitle>
            <div className="flex items-center gap-2">
              {jobsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              <Badge variant="outline" className="text-xs">
                {downloadJobs.filter(j => j.status === 'downloading').length + 
                 scanJobs.filter(s => s.status === 'scanning').length +
                 ocrJobs.filter(o => o.status === 'running' || o.status === 'pending').length +
                 gitleaksJobs.filter(g => g.status === 'running').length} ativos
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Downloads Ativos */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Download className="w-4 h-4" />
                Downloads
                <Badge variant="secondary" className="ml-auto text-xs">
                  {downloadJobs.filter(j => j.status === 'downloading' || j.status === 'pending').length}
                </Badge>
              </div>
              
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                {downloadJobs.filter(j => ['downloading', 'pending'].includes(j.status)).length === 0 ? (
                  <div className="text-center py-3 text-muted-foreground text-xs">
                    <Download className="w-6 h-6 mx-auto mb-1 opacity-30" />
                    Nenhum ativo
                  </div>
                ) : (
                  downloadJobs
                    .filter(j => ['downloading', 'pending'].includes(j.status))
                    .slice(0, 3)
                    .map(job => (
                      <div 
                        key={job.id} 
                        className={cn(
                          "p-2 rounded border text-xs",
                          job.status === 'downloading' ? "border-blue-500/50 bg-blue-500/10" : "border-border bg-muted/30"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {job.status === 'downloading' ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                          )}
                          <span className="truncate flex-1" title={job.file_name || job.file_path}>
                            {job.file_name || job.file_path?.split('\\').pop() || 'Arquivo'}
                          </span>
                        </div>
                        {job.status === 'downloading' && (
                          <Progress value={job.progress || 0} className="h-1 mt-1" />
                        )}
                      </div>
                    ))
                )}
                {downloadJobs.filter(j => ['downloading', 'pending'].includes(j.status)).length > 3 && (
                  <p className="text-xs text-center text-muted-foreground">
                    +{downloadJobs.filter(j => ['downloading', 'pending'].includes(j.status)).length - 3} mais
                  </p>
                )}
              </div>
            </div>
            
            {/* Scans de Diretório */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FolderSearch className="w-4 h-4" />
                Scans Dir
                <Badge variant="secondary" className="ml-auto text-xs">
                  {scanJobs.filter(s => s.status === 'scanning' || s.status === 'pending').length}
                </Badge>
              </div>
              
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                {scanJobs.filter(s => ['scanning', 'pending'].includes(s.status)).length === 0 ? (
                  <div className="text-center py-3 text-muted-foreground text-xs">
                    <FolderSearch className="w-6 h-6 mx-auto mb-1 opacity-30" />
                    Nenhum ativo
                  </div>
                ) : (
                  scanJobs
                    .filter(s => ['scanning', 'pending'].includes(s.status))
                    .slice(0, 3)
                    .map(scan => (
                      <div 
                        key={scan.id} 
                        className={cn(
                          "p-2 rounded border text-xs",
                          scan.status === 'scanning' ? "border-blue-500/50 bg-blue-500/10" : "border-border bg-muted/30"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {scan.status === 'scanning' ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                          )}
                          <span className="truncate flex-1" title={scan.path}>
                            {scan.path?.split('\\').pop() || 'Diretório'}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-0.5">
                          Nível {scan.depth || 0}/{scan.max_depth || 0}
                        </p>
                      </div>
                    ))
                )}
                {scanJobs.filter(s => ['scanning', 'pending'].includes(s.status)).length > 3 && (
                  <p className="text-xs text-center text-muted-foreground">
                    +{scanJobs.filter(s => ['scanning', 'pending'].includes(s.status)).length - 3} mais
                  </p>
                )}
              </div>
            </div>
            
            {/* OCR Jobs */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Eye className="w-4 h-4" />
                OCR
                <Badge variant="secondary" className="ml-auto text-xs">
                  {ocrJobs.filter(o => o.status === 'running' || o.status === 'pending').length}
                </Badge>
              </div>
              
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                {ocrJobs.filter(o => ['running', 'pending'].includes(o.status)).length === 0 ? (
                  <div className="text-center py-3 text-muted-foreground text-xs">
                    <Eye className="w-6 h-6 mx-auto mb-1 opacity-30" />
                    Nenhum ativo
                  </div>
                ) : (
                  ocrJobs
                    .filter(o => ['running', 'pending'].includes(o.status))
                    .slice(0, 3)
                    .map(job => (
                      <div 
                        key={job.id} 
                        className={cn(
                          "p-2 rounded border text-xs",
                          job.status === 'running' ? "border-purple-500/50 bg-purple-500/10" : "border-border bg-muted/30"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {job.status === 'running' ? (
                            <Loader2 className="w-3 h-3 animate-spin text-purple-500 flex-shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                          )}
                          <span className="truncate flex-1" title={job.file_name || job.file_path}>
                            {job.file_name || job.file_path?.split('/').pop() || 'Arquivo'}
                          </span>
                        </div>
                      </div>
                    ))
                )}
                {ocrJobs.filter(o => ['running', 'pending'].includes(o.status)).length > 3 && (
                  <p className="text-xs text-center text-muted-foreground">
                    +{ocrJobs.filter(o => ['running', 'pending'].includes(o.status)).length - 3} mais
                  </p>
                )}
              </div>
            </div>
            
            {/* GitLeaks Jobs */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ScanSearch className="w-4 h-4" />
                GitLeaks
                <Badge variant="secondary" className="ml-auto text-xs">
                  {gitleaksJobs.filter(g => g.status === 'running').length}
                </Badge>
              </div>
              
              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                {gitleaksJobs.filter(g => g.status === 'running').length === 0 ? (
                  <div className="text-center py-3 text-muted-foreground text-xs">
                    <ScanSearch className="w-6 h-6 mx-auto mb-1 opacity-30" />
                    Nenhum ativo
                  </div>
                ) : (
                  gitleaksJobs
                    .filter(g => g.status === 'running')
                    .slice(0, 3)
                    .map(job => (
                      <div 
                        key={job.job_id || job.id} 
                        className="p-2 rounded border text-xs border-orange-500/50 bg-orange-500/10"
                      >
                        <div className="flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin text-orange-500 flex-shrink-0" />
                          <span className="truncate flex-1">
                            {job.server_name || `Servidor ${job.server_id}`}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-0.5">
                          {job.files_scanned || 0} arquivos
                        </p>
                      </div>
                    ))
                )}
                {gitleaksJobs.filter(g => g.status === 'running').length > 3 && (
                  <p className="text-xs text-center text-muted-foreground">
                    +{gitleaksJobs.filter(g => g.status === 'running').length - 3} mais
                  </p>
                )}
              </div>
            </div>
          </div>
          
          {/* Jobs Recentes */}
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-muted-foreground mb-3">Jobs Recentes</p>
            <div className="flex flex-wrap gap-2">
              {[
                ...downloadJobs.map(j => ({ ...j, _type: 'download' })),
                ...scanJobs.map(j => ({ ...j, _type: 'scan' })),
                ...ocrJobs.map(j => ({ ...j, _type: 'ocr' })),
                ...gitleaksJobs.map(j => ({ ...j, _type: 'gitleaks' }))
              ]
                .filter(j => ['completed', 'failed', 'finished'].includes(j.status))
                .sort((a, b) => new Date(b.completed_at || b.finished_at || b.created_at) - new Date(a.completed_at || a.finished_at || a.created_at))
                .slice(0, 10)
                .map((job, idx) => {
                  let name = '';
                  let icon = null;
                  const isSuccess = job.status === 'completed' || job.status === 'finished';
                  
                  switch(job._type) {
                    case 'download':
                      name = job.file_name || job.file_path?.split('\\').pop() || 'Download';
                      icon = <Download className="w-3 h-3 mr-1" />;
                      break;
                    case 'scan':
                      name = job.path?.split('\\').pop() || 'Scan';
                      icon = <FolderSearch className="w-3 h-3 mr-1" />;
                      break;
                    case 'ocr':
                      name = job.file_name || 'OCR';
                      icon = <Eye className="w-3 h-3 mr-1" />;
                      break;
                    case 'gitleaks':
                      name = job.server_name || `GL-${job.server_id}`;
                      icon = <ScanSearch className="w-3 h-3 mr-1" />;
                      break;
                    default:
                      name = 'Job';
                  }
                  
                  return (
                    <Badge
                      key={`${job._type}-${job.id || job.job_id}-${idx}`}
                      variant="outline"
                      className={cn(
                        "text-xs",
                        isSuccess ? "border-green-600/50 text-green-500" : "border-red-600/50 text-red-500"
                      )}
                    >
                      {isSuccess ? (
                        <CheckCircle className="w-3 h-3 mr-1" />
                      ) : (
                        <XCircle className="w-3 h-3 mr-1" />
                      )}
                      {icon}
                      <span className="max-w-[80px] truncate">{name}</span>
                    </Badge>
                  );
                })}
              {[...downloadJobs, ...scanJobs, ...ocrJobs, ...gitleaksJobs].filter(j => ['completed', 'failed', 'finished'].includes(j.status)).length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum job recente</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo / Quick Stats */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Resumo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{stats.downloadedFiles}</p>
              <p className="text-xs text-muted-foreground">Arquivos Baixados</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{gitleaksStats?.total_files_affected || 0}</p>
              <p className="text-xs text-muted-foreground">Arquivos com Leaks</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{stats.dbConnections}</p>
              <p className="text-xs text-muted-foreground">Conexões SQL</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{stats.proxyServers}</p>
              <p className="text-xs text-muted-foreground">Servidores Proxy</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{stats.soapApis}</p>
              <p className="text-xs text-muted-foreground">SOAP APIs</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Controls */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="offline-mode-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {offlineMode ? <WifiOff className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
              Modo Offline
            </CardTitle>
            <CardDescription>
              Quando ativado, o sistema utiliza apenas o cache local
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Switch 
                id="offline-mode" 
                checked={offlineMode} 
                onCheckedChange={toggleOfflineMode}
                data-testid="offline-mode-switch"
              />
              <Label htmlFor="offline-mode">
                {offlineMode ? 'Ativado' : 'Desativado'}
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="cache-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-5 h-5" />
              Cache
            </CardTitle>
            <CardDescription>
              {stats.cacheEntries} entradas no cache
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              variant="destructive" 
              onClick={clearCache}
              data-testid="clear-cache-btn"
              size="sm"
            >
              Limpar Cache
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
