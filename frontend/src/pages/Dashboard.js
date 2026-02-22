import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Database, Server, Globe, FileText, Wifi, WifiOff, HardDrive, Download,
  AlertTriangle, Shield, Activity, Search, RefreshCw, Play, FileWarning
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';
import { ShieldKeyIcon } from '@/components/icons';
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [creds, dbs, proxies, soaps, cache, servers, gitleaks, findings] = await Promise.all([
        axios.get(`${API}/credentials`),
        axios.get(`${API}/db-connections`),
        axios.get(`${API}/proxy-servers`),
        axios.get(`${API}/soap-apis`),
        axios.get(`${API}/cache/stats`),
        axios.get(`${API}/servers`),
        axios.get(`${API_V2}/gitleaks/stats`).catch(() => ({ data: null })),
        axios.get(`${API_V2}/gitleaks/findings`).catch(() => ({ data: { files: [] } }))
      ]);

      const totalDownloads = servers.data.reduce((acc, server) => acc + (server.downloaded_files_count || 0), 0);

      setStats({
        credentials: creds.data.length,
        dbConnections: dbs.data.length,
        proxyServers: proxies.data.length,
        soapApis: soaps.data.length,
        cacheEntries: cache.data.total_entries || 0,
        servers: servers.data.length,
        downloadedFiles: totalDownloads
      });

      if (gitleaks.data) {
        setGitleaksStats(gitleaks.data);
      }

      // Processar extensões de arquivos com vulnerabilidades
      if (findings.data && findings.data.files) {
        const extensionCounts = {};
        findings.data.files.forEach(file => {
          const filePath = file.file || '';
          const ext = filePath.split('.').pop()?.toLowerCase() || 'other';
          const extension = ext.length <= 10 ? `.${ext}` : 'other';
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
      toast.error('Erro ao carregar dados do dashboard');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Visão geral de segurança e assets</p>
        </div>
        <Button variant="outline" onClick={loadData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
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
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-white/90 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Índice de Risco Geral
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <p className="text-6xl font-bold">{riskScore}</p>
              <p className="text-white/70 mt-2">RISK</p>
            </div>
            
            {/* Mini sparkline */}
            <div className="h-16 mt-4">
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
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Risco por Severidade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {severityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
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
                      height={36}
                      formatter={(value) => (
                        <span style={{ color: '#999', fontSize: '12px' }}>{value}</span>
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
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileWarning className="w-5 h-5 text-red-500" />
              Leaks por Extensão
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
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

      {/* Linha 3: Status do Scan + Risk vs. Time (lado a lado) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Scan Status Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Status do Scan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-5xl font-bold text-green-500">{scanProgress}%</p>
              <Progress value={scanProgress} className="mt-4 h-3" />
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center pt-4 border-t">
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
            </div>

            <div className="pt-4 border-t">
              <Button 
                onClick={handleScanAllServers} 
                disabled={scanningAll}
                className="w-full"
              >
                {scanningAll ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Escanear todos os arquivos baixados
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Risk vs Time Area Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Leaks vs. Tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
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
      </div>

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
