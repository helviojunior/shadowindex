import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  HardDrive,
  Loader2,
  Play,
  Settings,
  AlertTriangle,
  Server,
  Search as SearchIcon,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const API_V2 = `${BACKEND_URL}/api/v2`;

const ShareScan = () => {
  const navigate = useNavigate();
  const [pools, setPools] = useState([]);
  const [selectedPoolId, setSelectedPoolId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loadingPools, setLoadingPools] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const isMounted = useRef(true);

  const loadPools = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/scan-pools`);
      if (isMounted.current) {
        setPools(response.data || []);
      }
    } catch (error) {
      console.error('Error loading scan pools:', error);
    } finally {
      if (isMounted.current) setLoadingPools(false);
    }
  }, []);

  const loadPreview = useCallback(async (poolId) => {
    if (!poolId) return;
    setLoadingPreview(true);
    try {
      const response = await axios.get(`${API_V2}/share-scan/preview/${poolId}`);
      if (isMounted.current) {
        setPreview(response.data);
      }
    } catch (error) {
      console.error('Error loading preview:', error);
      toast.error('Erro ao carregar preview dos servidores');
    } finally {
      if (isMounted.current) setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    loadPools();
    return () => { isMounted.current = false; };
  }, [loadPools]);

  useEffect(() => {
    if (selectedPoolId) {
      loadPreview(selectedPoolId);
    } else {
      setPreview(null);
    }
  }, [selectedPoolId, loadPreview]);

  const handleStartScan = async () => {
    if (!selectedPoolId) return;
    setStarting(true);
    try {
      const response = await axios.post(`${API_V2}/share-scan/start`, {
        scan_pool_id: parseInt(selectedPoolId),
      });
      toast.success(response.data.message || 'Scan iniciado com sucesso');
      navigate('/jobs/share-scan');
    } catch (error) {
      console.error('Error starting scan:', error);
      toast.error(error.response?.data?.detail || 'Erro ao iniciar scan');
    } finally {
      if (isMounted.current) setStarting(false);
    }
  };

  const ServerCardCompact = ({ server }) => (
    <div className="h-full p-2 flex flex-col items-center text-center rounded-lg transition-all duration-200 hover:bg-muted/30">
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center mb-1.5">
        <HardDrive className="w-4 h-4 text-blue-500" />
      </div>
      <h3 className="font-medium text-[11px] truncate w-full mb-0.5" title={server.name}>
        {server.name}
      </h3>
      <p className="text-[9px] text-muted-foreground font-mono truncate w-full" title={server.ip}>
        {server.ip}
      </p>
      {server.shares_count > 0 && (
        <span className="mt-1 text-[8px] text-muted-foreground/70">
          {server.shares_count} shares
        </span>
      )}
    </div>
  );

  if (loadingPools) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Share Scan</h1>
        <p className="text-muted-foreground mt-1">
          Iniciar scan de shares nos servidores cadastrados
        </p>
      </div>

      {/* No pools */}
      {pools.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-lg font-medium mb-2">Nenhum Scan Pool configurado</p>
            <p className="text-sm text-muted-foreground mb-4">
              Crie um Scan Pool antes de iniciar um scan de shares.
            </p>
            <Link to="/settings/scan-pools">
              <Button>
                <Settings className="w-4 h-4 mr-2" />
                Configurar Scan Pools
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Pool selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <SearchIcon className="w-5 h-5" />
                Selecionar Scan Pool
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedPoolId ? String(selectedPoolId) : undefined}
                onValueChange={(val) => setSelectedPoolId(val)}
              >
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Selecione um Scan Pool..." />
                </SelectTrigger>
                <SelectContent>
                  {pools.map((pool) => (
                    <SelectItem key={pool.id} value={String(pool.id)}>
                      {pool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Pool details + preview */}
          {selectedPoolId && preview && (
            <>
              {/* Pool parameters */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4 pb-3">
                    <p className="text-2xl font-bold">{preview.pool.simultaneous_scanners}</p>
                    <p className="text-xs text-muted-foreground uppercase">Scanners Simultâneos</p>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-cyan-500">
                  <CardContent className="pt-4 pb-3">
                    <p className="text-2xl font-bold">{preview.pool.request_delay_min}ms</p>
                    <p className="text-xs text-muted-foreground uppercase">Delay Mínimo</p>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-cyan-500">
                  <CardContent className="pt-4 pb-3">
                    <p className="text-2xl font-bold">{preview.pool.request_delay_max}ms</p>
                    <p className="text-xs text-muted-foreground uppercase">Delay Máximo</p>
                  </CardContent>
                </Card>
              </div>

              {/* Warning for multiple scanners */}
              {preview.pool.simultaneous_scanners > 1 && (
                <Card className="border-yellow-500/50 bg-yellow-500/5">
                  <CardContent className="pt-4 pb-3 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-500">Atenção: Múltiplos Scanners</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Com {preview.pool.simultaneous_scanners} scanners simultâneos, as requisições podem disparar alertas
                        em sistemas de defesa (IDS/IPS, EDR, etc).
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Server list */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Server className="w-5 h-5" />
                    Servidores
                    <Badge variant="secondary" className="ml-2">
                      {preview.filtered_count} de {preview.total_servers}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingPreview ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : preview.servers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Server className="w-12 h-12 opacity-30 mb-4" />
                      <p>Nenhum servidor encontrado com os filtros deste pool</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
                      {preview.servers.map((server) => (
                        <ServerCardCompact key={server.id} server={server} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Start button */}
              <div className="flex justify-end">
                <Button
                  size="lg"
                  onClick={handleStartScan}
                  disabled={starting || !preview.servers.length}
                >
                  {starting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Iniciar Scan ({preview.filtered_count} servidores)
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {/* Loading preview */}
          {selectedPoolId && loadingPreview && !preview && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ShareScan;
