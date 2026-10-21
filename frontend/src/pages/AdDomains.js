import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  pending: { label: 'Na fila', cls: 'text-muted-foreground', icon: Loader2 },
  running: { label: 'Importando', cls: 'text-blue-400', icon: Loader2 },
  completed: { label: 'Concluído', cls: 'text-green-500', icon: CheckCircle },
  failed: { label: 'Falhou', cls: 'text-red-500', icon: XCircle },
  cancelled: { label: 'Cancelado', cls: 'text-amber-500', icon: XCircle },
};

const AdDomains = () => {
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
      toast.error('Erro ao salvar configuração');
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
        toast.success(`DC mais rápido: ${data.fastest}`);
      } else {
        toast.warning('Nenhum DC acessível encontrado');
      }
    } catch (e) {
      const m = e.response?.data?.detail || e.message;
      toast.error(`Descoberta falhou: ${typeof m === 'string' ? m : JSON.stringify(m)}`);
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
      if (data.success) toast.success(`Conexão OK (${data.server})`);
      else toast.error(`Falhou: ${data.error}`);
    } catch (e) {
      const m = e.response?.data?.detail || e.message;
      const msg = typeof m === 'string' ? m : JSON.stringify(m);
      toast.error(`Teste falhou: ${msg}`);
      setTestResult({ success: false, error: msg });
    } finally {
      setTesting(false);
    }
  };

  const startScan = async (domId) => {
    if (!(await saveConfig(domId))) return;
    if (!window.confirm('Iniciar a varredura LDAP recursiva da árvore do domínio? Isso percorre todo o AD e pode levar alguns minutos.')) return;
    try {
      await axios.post(`${API}/ad/domains/${domId}/scan`, { host: cfg.selected_dc || undefined });
      toast.success('Varredura LDAP iniciada em background');
      loadJobs();
    } catch (e) {
      const m = e.response?.data?.detail || e.message;
      toast.error(`Falha ao iniciar varredura: ${typeof m === 'string' ? m : JSON.stringify(m)}`);
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
    if (!newDomain.trim()) return toast.error('Informe o domínio (FQDN)');
    setCreating(true);
    try {
      await axios.post(`${API}/ad/domains`, { name: newDomain.trim() });
      toast.success('Domínio criado');
      setNewDomain('');
      setShowAddForm(false);
      loadDomains();
    } catch (error) {
      const msg = error.response?.data?.detail || 'Erro ao criar domínio';
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover este domínio e toda a árvore importada?')) return;
    try {
      await axios.delete(`${API}/ad/domains/${id}`);
      toast.success('Domínio removido');
      loadDomains();
      loadJobs();
    } catch {
      toast.error('Erro ao remover domínio');
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
      toast.success('Upload concluído — importação iniciada em background');
      loadJobs();
    } catch (error) {
      const msg = error.response?.data?.detail || error.message;
      toast.error(`Falha no upload: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
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
            Explore a árvore do Active Directory por domínio. Importe dados do BloodHound (v6)
            para montar e navegar a árvore completa.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'default'} data-testid="toggle-add-domain">
          {showAddForm ? <><ChevronUp className="w-4 h-4 mr-2" />Fechar</> : <><Plus className="w-4 h-4 mr-2" />Novo Domínio</>}
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Novo domínio</CardTitle>
            <CardDescription>Informe o FQDN do domínio (ex.: empresa.local). A base do AD Explorer é o domínio, não um servidor.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex items-end gap-3">
              <div className="space-y-2 flex-1 max-w-md">
                <Label htmlFor="domain-name">Domínio (FQDN) *</Label>
                <Input id="domain-name" placeholder="empresa.local" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} data-testid="ad-domain-input" />
              </div>
              <Button type="submit" disabled={creating} data-testid="create-domain-btn">
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Criar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {domains.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhum domínio cadastrado. Crie um e importe os arquivos do BloodHound.</CardContent></Card>
        )}
        {domains.map((dom) => {
          const domJobs = jobsFor(dom.id);
          const activeJob = domJobs.find((j) => j.status === 'running' || j.status === 'pending');
          return (
            <Card key={dom.id} data-testid={`ad-domain-${dom.id}`}>
              <CardContent className="py-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Network className="w-5 h-5 text-indigo-400 shrink-0" />
                      <span className="text-lg font-semibold truncate">{dom.name}</span>
                      {dom.domain_sid && <Badge variant="outline" className="gap-1 font-mono text-xs max-w-full truncate"><Hash className="w-3 h-3 shrink-0" />{dom.domain_sid}</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Server className="w-3.5 h-3.5 shrink-0" />{dom.object_count?.toLocaleString() || 0} objetos</span>
                      {dom.last_scan_at && <span>Última importação: {new Date(dom.last_scan_at).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <Button onClick={() => navigate(`/ad/${dom.id}/browse`)} disabled={!dom.object_count} data-testid={`explore-${dom.id}`}>
                      <FolderTree className="w-4 h-4 mr-2" />Explorar
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
                      Importar BloodHound
                    </Button>
                    <Button variant={configId === dom.id ? 'secondary' : 'outline'} onClick={() => openConfig(dom)} data-testid={`config-${dom.id}`}>
                      <Plug className="w-4 h-4 mr-2" />Conexão LDAP
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
                              {meta.label}
                              {job.current_step && <span className="text-muted-foreground">— {job.current_step}</span>}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs">
                              {job.processed_objects?.toLocaleString() || 0} objetos
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
                        <Label>Método de autenticação</Label>
                        <Select value={cfg.auth_method} onValueChange={(v) => setCfg((p) => ({ ...p, auth_method: v }))}>
                          <SelectTrigger data-testid={`auth-method-${dom.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user_password">Usuário e Senha (NTLM)</SelectItem>
                            <SelectItem value="kerberos">Kerberos (ccache)</SelectItem>
                            <SelectItem value="cert">Certificado digital (LDAPS mTLS)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {(cfg.auth_method === 'user_password' || cfg.auth_method === 'kerberos') && (
                        <div className="space-y-2">
                          <Label>Credencial</Label>
                          <Select value={cfg.credential_id} onValueChange={(v) => setCfg((p) => ({ ...p, credential_id: v }))}>
                            <SelectTrigger data-testid={`cred-${dom.id}`}><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
                          <Label>Certificado cliente (PEM)</Label>
                          <Textarea rows={4} className="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" value={cfg.client_cert} onChange={(e) => setCfg((p) => ({ ...p, client_cert: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Chave privada (PEM)</Label>
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
                        <Label htmlFor={`disc-${dom.id}`} className="cursor-pointer">Descobrir DCs por DNS SRV</Label>
                      </div>
                    </div>

                    {!cfg.dc_discovery && (
                      <div className="space-y-2">
                        <Label>Controladores de domínio (manuais, separados por vírgula)</Label>
                        <Input placeholder="dc01.empresa.local, 10.0.0.10" value={cfg.dc_hosts} onChange={(e) => setCfg((p) => ({ ...p, dc_hosts: e.target.value }))} />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => discover(dom.id)} disabled={discovering}>
                        {discovering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Radar className="w-4 h-4 mr-2" />}
                        Descobrir DCs
                      </Button>
                      <Button variant="outline" onClick={() => testConn(dom.id)} disabled={testing}>
                        {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                        Testar conexão
                      </Button>
                      <Button onClick={() => saveConfig(dom.id).then((ok) => ok && toast.success('Configuração salva'))} disabled={savingCfg}>
                        {savingCfg ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Salvar
                      </Button>
                      <Button variant="default" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => startScan(dom.id)} disabled={testing || discovering || !!activeJob}>
                        <Network className="w-4 h-4 mr-2" />Varredura LDAP
                      </Button>
                      {cfg.selected_dc && <Badge variant="secondary" className="gap-1"><Zap className="w-3 h-3" />DC: {cfg.selected_dc}</Badge>}
                    </div>

                    {testResult && (
                      <div className={`text-sm rounded-lg p-3 ${testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {testResult.success
                          ? <>✓ Conexão OK em {testResult.server}:{testResult.port} — {testResult.info?.defaultNamingContext || ''}</>
                          : <>✗ {testResult.error}</>}
                      </div>
                    )}

                    {dcs.length > 0 && (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/40">Controladores de domínio (ordenados por latência)</div>
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
                                  : <Badge variant="outline" className="text-red-400 border-red-500/40">inacessível</Badge>}
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
