import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Network, Plus, ChevronUp, Trash2, FolderTree, Upload, Loader2, CheckCircle, XCircle, Server, Hash, Plug, Radar, Zap, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const STATUS_META = {
  pending: { labelKey: 'status.queued', cls: 'text-muted-foreground', icon: Loader2 },
  running: { labelKey: 'status.importing', cls: 'text-blue-400', icon: Loader2 },
  completed: { labelKey: 'common:status.completed', cls: 'text-green-500', icon: CheckCircle },
  failed: { labelKey: 'common:status.failed', cls: 'text-red-500', icon: XCircle },
  cancelled: { labelKey: 'common:status.cancelled', cls: 'text-amber-500', icon: XCircle },
};

const AdDomains = () => {
  const { t } = useTranslation('ad-domains');
  const navigate = useNavigate();
  const [domains, setDomains] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputs = useRef({});

  // Configuração de conexão LDAP
  const [credentials, setCredentials] = useState([]);
  const [configId, setConfigId] = useState(null);
  const [cfg, setCfg] = useState({});
  const [savingCfg, setSavingCfg] = useState(false);
  const [dcs, setDcs] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const loadDomains = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/ad/domains`);
      setDomains(data);
    } catch (e) {
      console.error('Error loading AD domains:', e);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/ad/jobs`);
      setJobs(data);
    } catch (e) {
      // silencioso
    }
  }, []);

  const loadCredentials = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/credentials`);
      setCredentials((data || []).filter((c) => ['user_password', 'kerberos'].includes(c.credential_type)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadDomains();
    loadJobs();
    loadCredentials();
  }, [loadDomains, loadJobs, loadCredentials]);

  const openConfig = (dom) => {
    if (configId === dom.id) { setConfigId(null); return; }
    setConfigId(dom.id);
    setDcs([]);
    setTestResult(null);
    setCfg({
      auth_method: dom.auth_method || 'user_password',
      credential_id: dom.credential_id ? String(dom.credential_id) : '',
      use_ldaps: dom.use_ldaps !== false,
      dc_discovery: dom.dc_discovery !== false,
      dc_hosts: dom.dc_hosts || '',
      client_cert: dom.client_cert || '',
      client_key: dom.client_key || '',
      selected_dc: dom.selected_dc || '',
    });
  };

  const saveConfig = async (domId) => {
    setSavingCfg(true);
    try {
      await axios.put(`${API}/ad/domains/${domId}`, {
        auth_method: cfg.auth_method,
        credential_id: cfg.credential_id ? parseInt(cfg.credential_id) : null,
        use_ldaps: cfg.use_ldaps,
        dc_discovery: cfg.dc_discovery,
        dc_hosts: cfg.dc_hosts || null,
        client_cert: cfg.client_cert || null,
        client_key: cfg.client_key || null,
        selected_dc: cfg.selected_dc || null,
      });
      loadDomains();
      return true;
    } catch {
      toast.error(t('toast.saveConfigError'));
      return false;
    } finally {
      setSavingCfg(false);
    }
  };

  const discover = async (domId) => {
    if (!(await saveConfig(domId))) return;
    setDiscovering(true);
    setDcs([]);
    try {
      const { data } = await axios.post(`${API}/ad/domains/${domId}/discover-dcs`, {});
      setDcs(data.dcs || []);
      if (data.fastest) {
        setCfg((p) => ({ ...p, selected_dc: data.fastest }));
        toast.success(t('toast.fastestDc', { dc: data.fastest }));
      } else {
        toast.warning(t('toast.noDcFound'));
      }
    } catch (e) {
      const m = e.response?.data?.detail || e.message;
      toast.error(t('toast.discoverFailed', { error: typeof m === 'string' ? m : JSON.stringify(m) }));
    } finally {
      setDiscovering(false);
    }
  };

  const testConn = async (domId) => {
    if (!(await saveConfig(domId))) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await axios.post(`${API}/ad/domains/${domId}/test-connection`, { host: cfg.selected_dc || undefined });
      setTestResult(data);
      if (data.success) toast.success(t('toast.connOk', { server: data.server }));
      else toast.error(t('toast.connFailed', { error: data.error }));
    } catch (e) {
      const m = e.response?.data?.detail || e.message;
      const msg = typeof m === 'string' ? m : JSON.stringify(m);
      toast.error(t('toast.testFailed', { error: msg }));
      setTestResult({ success: false, error: msg });
    } finally {
      setTesting(false);
    }
  };

  const startScan = async (domId) => {
    if (!(await saveConfig(domId))) return;
    if (!window.confirm(t('confirm.startScan'))) return;
    try {
      await axios.post(`${API}/ad/domains/${domId}/scan`, { host: cfg.selected_dc || undefined });
      toast.success(t('toast.scanStarted'));
      loadJobs();
    } catch (e) {
      const m = e.response?.data?.detail || e.message;
      toast.error(t('toast.scanStartFailed', { error: typeof m === 'string' ? m : JSON.stringify(m) }));
    }
  };

  // Auto-refresh enquanto houver job ativo
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'pending');
    if (!hasActive) return;
    const t = setInterval(() => {
      loadJobs();
      loadDomains();
    }, 2500);
    return () => clearInterval(t);
  }, [jobs, loadJobs, loadDomains]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newDomain.trim()) return toast.error(t('toast.domainRequired'));
    setCreating(true);
    try {
      await axios.post(`${API}/ad/domains`, { name: newDomain.trim() });
      toast.success(t('toast.domainCreated'));
      setNewDomain('');
      setShowAddForm(false);
      loadDomains();
    } catch (error) {
      const msg = error.response?.data?.detail || t('toast.domainCreateError');
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('confirm.deleteDomain'))) return;
    try {
      await axios.delete(`${API}/ad/domains/${id}`);
      toast.success(t('toast.domainRemoved'));
      loadDomains();
      loadJobs();
    } catch {
      toast.error(t('toast.domainRemoveError'));
    }
  };

  const handleUpload = async (domainId, files) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    setUploadingId(domainId);
    try {
      await axios.post(`${API}/ad/domains/${domainId}/import`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(t('toast.uploadDone'));
      loadJobs();
    } catch (error) {
      const msg = error.response?.data?.detail || error.message;
      toast.error(t('toast.uploadFailed', { error: typeof msg === 'string' ? msg : JSON.stringify(msg) }));
    } finally {
      setUploadingId(null);
      if (fileInputs.current[domainId]) fileInputs.current[domainId].value = '';
    }
  };

  const jobsFor = (domainId) => jobs.filter((j) => j.domain_id === domainId);

  return (
    <div className="space-y-6" data-testid="ad-domains-page">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Network className="w-7 h-7 text-indigo-400 shrink-0" />
            AD Explorer
          </h1>
          <p className="text-muted-foreground mt-2">
            {t('intro')}
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'default'} data-testid="toggle-add-domain">
          {showAddForm ? <><ChevronUp className="w-4 h-4 mr-2" />{t('common:actions.close')}</> : <><Plus className="w-4 h-4 mr-2" />{t('newDomain')}</>}
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('form.title')}</CardTitle>
            <CardDescription>{t('form.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex items-end gap-3">
              <div className="space-y-2 flex-1 max-w-md">
                <Label htmlFor="domain-name">{t('form.domainLabel')}</Label>
                <Input id="domain-name" placeholder={t('form.domainPlaceholder')} value={newDomain} onChange={(e) => setNewDomain(e.target.value)} data-testid="ad-domain-input" />
              </div>
              <Button type="submit" disabled={creating} data-testid="create-domain-btn">
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {t('form.create')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {domains.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">{t('empty')}</CardContent></Card>
        )}
        {domains.map((dom) => {
          const domJobs = jobsFor(dom.id);
          const activeJob = domJobs.find((j) => j.status === 'running' || j.status === 'pending');
          return (
            <Card key={dom.id} data-testid={`ad-domain-${dom.id}`}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Network className="w-5 h-5 text-indigo-400 shrink-0" />
                      <span className="text-lg font-semibold truncate">{dom.name}</span>
                      {dom.domain_sid && <Badge variant="outline" className="gap-1 font-mono text-xs max-w-full truncate"><Hash className="w-3 h-3 shrink-0" />{dom.domain_sid}</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Server className="w-3.5 h-3.5 shrink-0" />{t('objects', { count: dom.object_count || 0, val: (dom.object_count || 0).toLocaleString() })}</span>
                      {dom.last_scan_at && <span>{t('lastImport', { date: new Date(dom.last_scan_at).toLocaleString() })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <Button onClick={() => navigate(`/ad/${dom.id}/browse`)} disabled={!dom.object_count && domJobs.length === 0} data-testid={`explore-${dom.id}`}>
                      <FolderTree className="w-4 h-4 mr-2" />{t('explore')}
                    </Button>
                    <input
                      ref={(el) => (fileInputs.current[dom.id] = el)}
                      type="file"
                      multiple
                      accept=".json,.zip"
                      className="hidden"
                      onChange={(e) => handleUpload(dom.id, e.target.files)}
                    />
                    <Button variant="outline" disabled={uploadingId === dom.id || !!activeJob} onClick={() => fileInputs.current[dom.id]?.click()} data-testid={`import-${dom.id}`}>
                      {uploadingId === dom.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                      {t('importBloodhound')}
                    </Button>
                    <Button variant={configId === dom.id ? 'secondary' : 'outline'} onClick={() => openConfig(dom)} data-testid={`config-${dom.id}`}>
                      <Plug className="w-4 h-4 mr-2" />{t('ldapConnection')}
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(dom.id)} data-testid={`delete-domain-${dom.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Jobs de importação */}
                {domJobs.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-border pt-4">
                    {domJobs.slice(0, 3).map((job) => {
                      const meta = STATUS_META[job.status] || STATUS_META.pending;
                      const Icon = meta.icon;
                      const spinning = job.status === 'running' || job.status === 'pending';
                      return (
                        <div key={job.id} className="text-sm">
                          <div className="flex items-center justify-between">
                            <span className={`flex items-center gap-2 ${meta.cls}`}>
                              <Icon className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} />
                              {job.status === 'running'
                                ? (job.job_type === 'ldap' ? t('status.scanning') : t('status.importing'))
                                : t(meta.labelKey)}
                              {job.current_step && <span className="text-muted-foreground">— {job.current_step}</span>}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs">
                              {t('objects', { count: job.processed_objects || 0, val: (job.processed_objects || 0).toLocaleString() })}
                            </span>
                          </div>
                          {spinning && <Progress value={job.processed_objects > 0 ? 100 : 10} className="h-1.5 mt-1 animate-pulse" />}
                          {job.status === 'failed' && job.error_message && (
                            <div className="text-xs text-red-400 mt-1 truncate">{job.error_message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Configuração de conexão LDAP */}
                {configId === dom.id && (
                  <div className="mt-4 border-t border-border pt-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('cfg.authMethod')}</Label>
                        <Select value={cfg.auth_method} onValueChange={(v) => setCfg((p) => ({ ...p, auth_method: v }))}>
                          <SelectTrigger data-testid={`auth-method-${dom.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user_password">{t('cfg.authUserPassword')}</SelectItem>
                            <SelectItem value="kerberos">{t('cfg.authKerberos')}</SelectItem>
                            <SelectItem value="cert">{t('cfg.authCert')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {(cfg.auth_method === 'user_password' || cfg.auth_method === 'kerberos') && (
                        <div className="space-y-2">
                          <Label>{t('cfg.credential')}</Label>
                          <Select value={cfg.credential_id} onValueChange={(v) => setCfg((p) => ({ ...p, credential_id: v }))}>
                            <SelectTrigger data-testid={`cred-${dom.id}`}><SelectValue placeholder={t('cfg.select')} /></SelectTrigger>
                            <SelectContent>
                              {credentials.filter((c) => (cfg.auth_method === 'kerberos' ? c.credential_type === 'kerberos' : c.credential_type === 'user_password')).map((c) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.name || `${c.domain ? c.domain + '\\' : ''}${c.username}`} ({c.credential_type})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {cfg.auth_method === 'cert' && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>{t('cfg.clientCert')}</Label>
                          <Textarea rows={4} className="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" value={cfg.client_cert} onChange={(e) => setCfg((p) => ({ ...p, client_cert: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('cfg.clientKey')}</Label>
                          <Textarea rows={4} className="font-mono text-xs" placeholder="-----BEGIN PRIVATE KEY-----" value={cfg.client_key} onChange={(e) => setCfg((p) => ({ ...p, client_key: e.target.value }))} />
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Switch checked={cfg.use_ldaps} onCheckedChange={(v) => setCfg((p) => ({ ...p, use_ldaps: v }))} id={`ldaps-${dom.id}`} />
                        <Label htmlFor={`ldaps-${dom.id}`} className="cursor-pointer">LDAPS (636)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={cfg.dc_discovery} onCheckedChange={(v) => setCfg((p) => ({ ...p, dc_discovery: v }))} id={`disc-${dom.id}`} />
                        <Label htmlFor={`disc-${dom.id}`} className="cursor-pointer">{t('cfg.discoverSrv')}</Label>
                      </div>
                    </div>

                    {!cfg.dc_discovery && (
                      <div className="space-y-2">
                        <Label>{t('cfg.dcHostsManual')}</Label>
                        <Input placeholder="dc01.empresa.local, 10.0.0.10" value={cfg.dc_hosts} onChange={(e) => setCfg((p) => ({ ...p, dc_hosts: e.target.value }))} />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => discover(dom.id)} disabled={discovering}>
                        {discovering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Radar className="w-4 h-4 mr-2" />}
                        {t('cfg.discoverDcs')}
                      </Button>
                      <Button variant="outline" onClick={() => testConn(dom.id)} disabled={testing}>
                        {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                        {t('cfg.testConnection')}
                      </Button>
                      <Button onClick={() => saveConfig(dom.id).then((ok) => ok && toast.success(t('toast.configSaved')))} disabled={savingCfg}>
                        {savingCfg ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        {t('common:actions.save')}
                      </Button>
                      <Button variant="default" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => startScan(dom.id)} disabled={testing || discovering || !!activeJob}>
                        <Network className="w-4 h-4 mr-2" />{t('cfg.ldapScan')}
                      </Button>
                      {cfg.selected_dc && <Badge variant="secondary" className="gap-1"><Zap className="w-3 h-3" />DC: {cfg.selected_dc}</Badge>}
                    </div>

                    {testResult && (
                      <div className={`text-sm rounded-lg p-3 ${testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {testResult.success
                          ? <>✓ {t('cfg.connOkAt', { server: testResult.server, port: testResult.port, ctx: testResult.info?.defaultNamingContext || '' })}</>
                          : <>✗ {testResult.error}</>}
                      </div>
                    )}

                    {dcs.length > 0 && (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/40">{t('cfg.dcByLatency')}</div>
                        <div className="divide-y divide-border">
                          {dcs.map((dc) => (
                            <div key={dc.host} className={`flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40 ${cfg.selected_dc === dc.host ? 'bg-primary/10' : ''}`} onClick={() => setCfg((p) => ({ ...p, selected_dc: dc.host }))}>
                              <span className="flex items-center gap-2 min-w-0">
                                <Server className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{dc.host}</span>
                                {dc.ip && <span className="text-xs text-muted-foreground font-mono shrink-0">{dc.ip}</span>}
                              </span>
                              <span className="shrink-0">
                                {dc.reachable
                                  ? <Badge variant="outline" className="gap-1 text-green-400 border-green-500/40">{dc.latency_ms} ms</Badge>
                                  : <Badge variant="outline" className="text-red-400 border-red-500/40">{t('cfg.unreachable')}</Badge>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdDomains;
