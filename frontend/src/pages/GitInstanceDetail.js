import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Loader2, DownloadCloud, ListTree, RefreshCw, User, Lock, Search,
  CheckCircle, XCircle, ChevronLeft, ChevronRight, UserX, Pencil, Save,
} from 'lucide-react';
import OriginLogo from '@/components/OriginLogo';
import { logoPlatform } from './GitInstances';
import { formatDateTime } from '@/lib/datetime';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PAGE = 200;

export default function GitInstanceDetail() {
  const { t } = useTranslation('git-instances');
  const { guid } = useParams();
  const navigate = useNavigate();

  const [inst, setInst] = useState(null);
  const [listed, setListed] = useState(false);     // já clicou em "Listar projetos"
  const [projects, setProjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');          // filtro aplicado
  const [filterInput, setFilterInput] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [retesting, setRetesting] = useState(false);
  const [selected, setSelected] = useState({});    // full_name -> bool (página atual)

  // Edição da instância (Nome / modo de autenticação)
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [eName, setEName] = useState('');
  const [eAuth, setEAuth] = useState('authenticated');
  const [eCredId, setECredId] = useState('');
  const [eProxyId, setEProxyId] = useState('none');

  const loadInstance = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/instances/${guid}`);
      setInst(res.data);
    } catch (e) { toast.error(t('toast.loadError')); }
  }, [guid, t]);
  useEffect(() => { loadInstance(); }, [loadInstance]);

  // Abre o diálogo de edição com os valores atuais da instância.
  const openEdit = async () => {
    setEName(inst?.name || '');
    setEAuth(inst?.clone_auth || 'authenticated');
    setECredId(inst?.credential_id ? String(inst.credential_id) : '');
    setEProxyId(inst?.proxy_id ? String(inst.proxy_id) : 'none');
    setEditOpen(true);
    // Carrega tokens/proxies para os seletores (apenas na primeira abertura).
    if (tokens.length === 0 && proxies.length === 0) {
      const [tk, px] = await Promise.all([
        axios.get(`${API}/credentials/by-type/token`).catch(() => ({ data: [] })),
        axios.get(`${API}/proxy-servers`).catch(() => ({ data: [] })),
      ]);
      setTokens(tk.data || []);
      setProxies(px.data || []);
    }
  };

  const saveEdit = async () => {
    if (eAuth === 'authenticated' && !eCredId) {
      toast.error(t('auth.tokenPlaceholder'));
      return;
    }
    setSavingEdit(true);
    try {
      await axios.put(`${API}/git/instances/${guid}`, {
        name: eName.trim() || null,
        clone_auth: eAuth,
        credential_id: eAuth === 'authenticated' ? parseInt(eCredId, 10) : null,
        proxy_id: eProxyId && eProxyId !== 'none' ? parseInt(eProxyId, 10) : null,
      });
      toast.success(t('toast.saved'));
      setEditOpen(false);
      loadInstance();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const loadProjects = useCallback(async (off = 0, q = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(off) });
      if (q) params.set('q', q);
      const res = await axios.get(`${API}/git/instances/${guid}/projects?${params.toString()}`);
      setProjects(res.data?.projects || []);
      setTotal(res.data?.total || 0);
      setOffset(off);
      setRefreshedAt(res.data?.refreshed_at || null);
      setSelected({});
      return res.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || t('toast.projectsError'));
      return null;
    } finally { setLoading(false); }
  }, [guid, t]);

  // Ao abrir: carrega a listagem JÁ persistida (buscada previamente). Se existir,
  // exibe-a e mantém os botões "Listar projetos"/"Retestar acesso" ocultos.
  useEffect(() => {
    (async () => {
      const data = await loadProjects(0, '');
      if (data && (data.refreshed_at || (data.total || 0) > 0)) {
        setListed(true);
      }
    })();
  }, [loadProjects]);

  // "Listar projetos": SEMPRE busca fresh na plataforma (sem cache). A paginação
  // e o filtro usam a cópia persistida no DB, mas o clique aqui sempre re-consulta.
  const onListProjects = async () => {
    setListed(true);
    await doRefresh();
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await axios.post(`${API}/git/instances/${guid}/projects/refresh`);
      toast.success(t('toast.refreshed', { count: res.data?.count ?? 0 }));
      setListed(true);
      setQuery(''); setFilterInput('');
      await loadProjects(0, '');
      loadInstance();
    } catch (e) {
      toast.error(e.response?.data?.detail || t('toast.projectsError'));
    } finally { setRefreshing(false); }
  };

  const applyFilter = () => { setQuery(filterInput.trim()); loadProjects(0, filterInput.trim()); };
  const retest = async () => {
    setRetesting(true);
    try {
      const res = await axios.post(`${API}/git/instances/${guid}/retest`);
      setInst(res.data);
      toast[res.data?.status === 'ok' ? 'success' : 'error'](res.data?.status === 'ok' ? t('toast.testOk') : (res.data?.error || t('toast.testFail')));
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setRetesting(false); }
  };

  const selectedNames = Object.keys(selected).filter(k => selected[k]);
  const pageAllSelected = projects.length > 0 && projects.every(p => selected[p.full_name]);
  const togglePage = () => {
    const next = { ...selected };
    const target = !pageAllSelected;
    projects.forEach(p => { next[p.full_name] = target; });
    setSelected(next);
  };

  // Monta o toast de enfileiramento, informando os pulados por dedup (já baixados
  // ou em andamento — inclusive vindos de outra instância do mesmo servidor).
  const queuedMsg = (res) => {
    const q = res.data?.queued ?? 0;
    const s = res.data?.skipped ?? 0;
    return s > 0 ? t('toast.queuedDedup', { count: q, skipped: s }) : t('toast.queued', { count: q });
  };

  const cloneSelected = async () => {
    if (selectedNames.length === 0) return;
    setCloning(true);
    try {
      const res = await axios.post(`${API}/git/instances/${guid}/clone`, { full_names: selectedNames });
      toast.success(queuedMsg(res), {
        action: { label: t('actions.goToJobs'), onClick: () => navigate('/jobs/git') },
      });
      setSelected({});
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setCloning(false); }
  };

  const cloneAll = async () => {
    setCloning(true);
    try {
      const res = await axios.post(`${API}/git/instances/${guid}/clone`, { all: true, q: query || null });
      toast.success(queuedMsg(res), {
        action: { label: t('actions.goToJobs'), onClick: () => navigate('/jobs/git') },
      });
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setCloning(false); }
  };

  if (!inst) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const whoamiNode = inst.whoami?.login
    ? <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" />{inst.whoami.login}{inst.whoami.name ? ` (${inst.whoami.name})` : ''}</span>
    : (inst.clone_auth === 'anonymous'
        ? <span className="inline-flex items-center gap-1 text-muted-foreground italic"><UserX className="w-3.5 h-3.5" />{t('detail.anon')}</span>
        : '—');

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  // Já existe uma listagem persistida? Então exibimos a lista e ocultamos os
  // botões "Listar projetos" / "Retestar acesso".
  const hasListing = !!refreshedAt || total > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/git/instances')}>
          <ArrowLeft className="w-4 h-4 mr-2" />{t('actions.back')}
        </Button>
        <OriginLogo platform={logoPlatform(inst.platform)} className="w-6 h-6" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">{inst.name || inst.platform_label}</h1>
          <p className="text-xs text-muted-foreground font-mono truncate">{inst.base_url}</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={openEdit} data-testid="instance-edit">
          <Pencil className="w-4 h-4 mr-2" />{t('actions.edit')}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">{t('detail.info')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">{t('fields.platform')}</div><div className="font-medium">{inst.platform_label}</div></div>
          <div><div className="text-xs text-muted-foreground">API</div><div className="font-mono text-xs truncate" title={inst.api_url}>{inst.api_url || '—'}</div></div>
          <div>
            <div className="text-xs text-muted-foreground">{t('fields.status')}</div>
            {inst.status === 'ok'
              ? <span className="inline-flex items-center gap-1 text-green-500"><CheckCircle className="w-3.5 h-3.5" />OK</span>
              : <span className="inline-flex items-center gap-1 text-red-500" title={inst.error || ''}><XCircle className="w-3.5 h-3.5" />{t('status.failed')}</span>}
          </div>
          <div><div className="text-xs text-muted-foreground">whoami</div>{whoamiNode}</div>
        </CardContent>
      </Card>

      {!hasListing && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onListProjects} disabled={loading} data-testid="instance-list-projects">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ListTree className="w-4 h-4 mr-2" />}
            {t('detail.listProjects')}
          </Button>
          <Button variant="outline" onClick={retest} disabled={retesting}>
            {retesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {t('detail.retest')}
          </Button>
        </div>
      )}

      {(listed || hasListing) && (
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <CardTitle className="text-lg">
              {t('detail.projects')} · {total}
              {refreshedAt && <span className="ml-2 text-xs text-muted-foreground font-normal">{t('detail.refreshedAt')}: {formatDateTime(refreshedAt)}</span>}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 w-56" placeholder={t('detail.filter')} value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyFilter(); }} />
              </div>
              <Button variant="outline" onClick={doRefresh} disabled={refreshing} title={t('detail.refreshHint')}>
                {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {t('detail.refresh')}
              </Button>
              <Button variant="outline" onClick={cloneSelected} disabled={cloning || selectedNames.length === 0}>
                <DownloadCloud className="w-4 h-4 mr-2" />{t('detail.cloneSelected', { count: selectedNames.length })}
              </Button>
              <Button onClick={cloneAll} disabled={cloning || total === 0} data-testid="instance-clone-all">
                {cloning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
                {t('detail.cloneAll', { count: total })}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={pageAllSelected} onCheckedChange={togglePage} aria-label={t('detail.selectAll')} />
                  </TableHead>
                  <TableHead>{t('detail.project')}</TableHead>
                  <TableHead>{t('fields.platform')}</TableHead>
                  <TableHead className="text-right">{t('detail.visibility')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>
                ) : projects.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">{t('detail.noProjects')}</TableCell></TableRow>
                ) : projects.map((p) => (
                  <TableRow key={p.full_name} data-testid="instance-project-row">
                    <TableCell>
                      <Checkbox checked={!!selected[p.full_name]}
                        onCheckedChange={(v) => setSelected(s => ({ ...s, [p.full_name]: !!v }))} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{p.full_name}</div>
                      {p.description && <div className="text-xs text-muted-foreground line-clamp-1 max-w-xl">{p.description}</div>}
                    </TableCell>
                    <TableCell>
                      {p.default_branch && <Badge variant="secondary" className="text-[10px]">{p.default_branch}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.private
                        ? <span className="inline-flex items-center gap-1 text-amber-500 text-xs"><Lock className="w-3 h-3" />{t('detail.private')}</span>
                        : <span className="text-muted-foreground text-xs">{t('detail.public')}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {total > PAGE && (
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-muted-foreground">{t('detail.pageOf', { page, pages })}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={offset <= 0 || loading} onClick={() => loadProjects(offset - PAGE, query)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={offset + PAGE >= total || loading} onClick={() => loadProjects(offset + PAGE, query)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edição: Nome e/ou modo de autenticação */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('edit.title')}</DialogTitle>
            <DialogDescription>{t('edit.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('edit.name')}</Label>
              <Input value={eName} onChange={(e) => setEName(e.target.value)}
                placeholder={inst.platform_label} data-testid="instance-edit-name" />
            </div>

            <div className="space-y-2">
              <Label>{t('auth.label')}</Label>
              <RadioGroup value={eAuth} onValueChange={setEAuth} className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="anonymous" id="e-anon" />
                  <span className="text-sm">{t('auth.anonymous')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="authenticated" id="e-auth" />
                  <span className="text-sm">{t('auth.authenticated')}</span>
                </label>
              </RadioGroup>
              {eAuth === 'authenticated' && (
                <div className="mt-1">
                  <Select value={eCredId} onValueChange={setECredId}>
                    <SelectTrigger data-testid="instance-edit-token"><SelectValue placeholder={t('auth.tokenPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {tokens.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name || `Token #${c.id}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {tokens.length === 0 && <p className="text-xs text-amber-500 mt-1">{t('auth.noTokens')}</p>}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('fields.proxy')}</Label>
              <Select value={eProxyId} onValueChange={setEProxyId}>
                <SelectTrigger data-testid="instance-edit-proxy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('proxy.none')}</SelectItem>
                  {proxies.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.proxy_type || 'http'} · {p.ip}:{p.port})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">{t('edit.retestHint')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={savingEdit}>{t('deleteConfirm.cancel')}</Button>
            <Button onClick={saveEdit} disabled={savingEdit} data-testid="instance-edit-save">
              {savingEdit ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
