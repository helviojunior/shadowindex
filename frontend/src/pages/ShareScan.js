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
import { useTranslation } from 'react-i18next';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const API_V2 = `${BACKEND_URL}/api/v2`;

const ShareScanServerCard = ({ server }) => {
  const { t } = useTranslation('share-scan');
  return (
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
        {t('serverList.shares', { count: server.shares_count })}
      </span>
    )}
  </div>
  );
};

const ShareScan = () => {
  const { t } = useTranslation('share-scan');
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
      toast.error(t('toast.previewError'));
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
      toast.success(response.data.message || t('toast.startSuccess'));
      navigate('/jobs/share-scan');
    } catch (error) {
      console.error('Error starting scan:', error);
      toast.error(error.response?.data?.detail || t('toast.startError'));
    } finally {
      if (isMounted.current) setStarting(false);
    }
  };

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
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('subtitle')}
        </p>
      </div>

      {/* No pools */}
      {pools.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-lg font-medium mb-2">{t('noPools.title')}</p>
            <p className="text-sm text-muted-foreground mb-4">
              {t('noPools.description')}
            </p>
            <Link to="/settings/scan-pools">
              <Button>
                <Settings className="w-4 h-4 mr-2" />
                {t('noPools.configure')}
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
                {t('selectPool.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Select
                  value={selectedPoolId ? String(selectedPoolId) : undefined}
                  onValueChange={(val) => setSelectedPoolId(val)}
                >
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue placeholder={t('selectPool.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {pools.map((pool) => (
                      <SelectItem key={pool.id} value={String(pool.id)}>
                        {pool.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="lg"
                  onClick={handleStartScan}
                  disabled={starting || !selectedPoolId || !preview?.servers?.length}
                >
                  {starting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {t('selectPool.start')}{preview ? ` (${preview.filtered_count})` : ''}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Pool details + preview */}
          {selectedPoolId && preview && (
            <>
              {/* Pool parameters - single card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    {t('poolParams.title', { name: preview.pool.name })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Numeric params */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border p-3">
                      <p className="text-2xl font-bold">{preview.pool.simultaneous_scanners}</p>
                      <p className="text-xs text-muted-foreground uppercase">{t('poolParams.simultaneousScanners')}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-2xl font-bold">{preview.pool.request_delay_min}<span className="text-sm font-normal text-muted-foreground">ms</span></p>
                      <p className="text-xs text-muted-foreground uppercase">{t('poolParams.minDelay')}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-2xl font-bold">{preview.pool.request_delay_max}<span className="text-sm font-normal text-muted-foreground">ms</span></p>
                      <p className="text-xs text-muted-foreground uppercase">{t('poolParams.maxDelay')}</p>
                    </div>
                  </div>

                  {/* Include/Exclude rules */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground uppercase mb-1.5">{t('poolParams.includeServers')}</p>
                      {preview.pool.include_servers ? (
                        <div className="flex flex-wrap gap-1">
                          {preview.pool.include_servers.split(',').map((s, i) => s.trim() && (
                            <Badge key={i} variant="secondary" className="text-xs bg-green-500/10 text-green-500 border-green-500/30">
                              {s.trim()}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">{t('poolParams.emptyIncludeServers')}</p>
                      )}
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground uppercase mb-1.5">{t('poolParams.excludeServers')}</p>
                      {preview.pool.exclude_servers ? (
                        <div className="flex flex-wrap gap-1">
                          {preview.pool.exclude_servers.split(',').map((s, i) => s.trim() && (
                            <Badge key={i} variant="secondary" className="text-xs bg-red-500/10 text-red-500 border-red-500/30">
                              {s.trim()}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">{t('poolParams.emptyExcludeServers')}</p>
                      )}
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground uppercase mb-1.5">{t('poolParams.includeIps')}</p>
                      {preview.pool.include_ips ? (
                        <div className="flex flex-wrap gap-1">
                          {preview.pool.include_ips.split(',').map((s, i) => s.trim() && (
                            <Badge key={i} variant="secondary" className="text-xs bg-green-500/10 text-green-500 border-green-500/30 font-mono">
                              {s.trim()}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">{t('poolParams.emptyIncludeIps')}</p>
                      )}
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground uppercase mb-1.5">{t('poolParams.excludeIps')}</p>
                      {preview.pool.exclude_ips ? (
                        <div className="flex flex-wrap gap-1">
                          {preview.pool.exclude_ips.split(',').map((s, i) => s.trim() && (
                            <Badge key={i} variant="secondary" className="text-xs bg-red-500/10 text-red-500 border-red-500/30 font-mono">
                              {s.trim()}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">{t('poolParams.emptyExcludeIps')}</p>
                      )}
                    </div>
                  </div>

                  {/* Warning for multiple scanners */}
                  {preview.pool.simultaneous_scanners > 1 && (
                    <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/5 p-3 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-500 text-sm">{t('warning.title')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('warning.description', { count: preview.pool.simultaneous_scanners })}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Server list */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Server className="w-5 h-5" />
                    {t('serverList.title')}
                    <Badge variant="secondary" className="ml-2">
                      {t('serverList.count', { filtered: preview.filtered_count, total: preview.total_servers })}
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
                      <p>{t('serverList.empty')}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
                      {preview.servers.map((server) => (
                        <ShareScanServerCard key={server.id} server={server} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

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
