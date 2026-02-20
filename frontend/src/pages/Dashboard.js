import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Key, Database, Server, Globe, FileText, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Dashboard = () => {
  const [stats, setStats] = useState({
    credentials: 0,
    dbConnections: 0,
    proxyServers: 0,
    soapApis: 0,
    cacheEntries: 0
  });
  const [offlineMode, setOfflineMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [creds, dbs, proxies, soaps, cache, config] = await Promise.all([
        axios.get(`${API}/credentials`),
        axios.get(`${API}/db-connections`),
        axios.get(`${API}/proxy-servers`),
        axios.get(`${API}/soap-apis`),
        axios.get(`${API}/cache/stats`),
        axios.get(`${API}/config`)
      ]);

      setStats({
        credentials: creds.data.length,
        dbConnections: dbs.data.length,
        proxyServers: proxies.data.length,
        soapApis: soaps.data.length,
        cacheEntries: cache.data.total_entries || 0
      });

      const offlineConfig = config.data.find(c => c.key === 'offline_mode');
      setOfflineMode(offlineConfig?.value === 'true');
      setLoading(false);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast.error('Erro ao carregar dados do dashboard');
      setLoading(false);
    }
  };

  const toggleOfflineMode = async () => {
    try {
      const newValue = !offlineMode;
      await axios.put(`${API}/config`, {
        key: 'offline_mode',
        value: newValue.toString()
      });
      setOfflineMode(newValue);
      toast.success(`Modo ${newValue ? 'offline' : 'online'} ativado`);
    } catch (error) {
      console.error('Error toggling offline mode:', error);
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

  const statCards = [
    { title: 'Credenciais', value: stats.credentials, icon: Key, color: 'from-blue-600 to-blue-700' },
    { title: 'Conexões DB', value: stats.dbConnections, icon: Database, color: 'from-emerald-600 to-emerald-700' },
    { title: 'Proxy Servers', value: stats.proxyServers, icon: Server, color: 'from-violet-600 to-violet-700' },
    { title: 'SOAP APIs', value: stats.soapApis, icon: Globe, color: 'from-amber-600 to-amber-700' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Visão geral do sistema de integração</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="card-hover" data-testid={`stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-lg bg-gradient-to-br ${stat.color}`}>
                  <Icon className="w-4 h-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* System Controls */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="offline-mode-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
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
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Gerenciar Cache
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
            >
              Limpar Cache
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>Sobre o Sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• O cache de consultas SOAP é válido por 24 horas</p>
          <p>• Em modo offline, apenas dados em cache estão disponíveis</p>
          <p>• Use a opção "Ignorar Cache" nas operações SOAP para forçar uma nova consulta</p>
          <p>• Todas as requisições e respostas são armazenadas em formato RAW</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;