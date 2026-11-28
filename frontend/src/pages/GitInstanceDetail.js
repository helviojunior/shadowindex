import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft, Loader2, DownloadCloud, ListTree, RefreshCw, User, Lock, Search, CheckCircle, XCircle,
} from 'lucide-react';
import OriginLogo from '@/components/OriginLogo';
import { logoPlatform } from './GitInstances';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function GitInstanceDetail() {
  const { t } = useTranslation('git-instances');
  const { guid } = useParams();
  const navigate = useNavigate();

  const [inst, setInst] = useState(null);
  const [projects, setProjects] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [retesting, setRetesting] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState({}); // full_name -> bool

  const loadInstance = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/instances/${guid}`);
      setInst(res.data);
    } catch (e) { toast.error(t('toast.loadError')); }
  }, [guid, t]);
  useEffect(() => { loadInstance(); }, [loadInstance]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await axios.get(`${API}/git/instances/${guid}/projects`);
      setProjects(res.data?.projects || []);
      if (res.data?.instance) setInst(res.data.instance);
    } catch (e) {
      toast.error(e.response?.data?.detail || t('toast.projectsError'));
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, [guid, t]);

  const retest = async () => {
    setRetesting(true);
    try {
      const res = await axios.post(`${API}/git/instances/${guid}/retest`);
      setInst(res.data);
      toast[res.data?.status === 'ok' ? 'success' : 'error'](res.data?.status === 'ok' ? t('toast.testOk') : (res.data?.error || t('toast.testFail')));
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setRetesting(false); }
  };

  const visible = useMemo(() => {
    const list = projects || [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => (p.full_name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [projects, filter]);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allVisibleSelected = visible.length > 0 && visible.every(p => selected[p.full_name]);

  const toggleAll = () => {
    const next = { ...selected };
    const target = !allVisibleSelected;
    visible.forEach(p => { next[p.full_name] = target; });
    setSelected(next);
  };

  const enqueueClone = async () => {
    const repos = (projects || []).filter(p => selected[p.full_name]);
    if (repos.length === 0) { toast.error(t('toast.noSelection')); return; }
    setCloning(true);
    try {
      const res = await axios.post(`${API}/git/instances/${guid}/clone`, { repos });
      toast.success(t('toast.queued', { count: res.data?.queued ?? 0 }), {
        action: { label: t('actions.goToJobs'), onClick: () => navigate('/jobs/git') },
      });
      setSelected({});
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setCloning(false);
    }
  };

  if (!inst) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

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
      </div>

      {/* Info da instância */}
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
          <div>
            <div className="text-xs text-muted-foreground">whoami</div>
            {inst.whoami?.login
              ? <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" />{inst.whoami.login}{inst.whoami.name ? ` (${inst.whoami.name})` : ''}</span>
              : '—'}
          </div>
          {inst.whoami && (inst.whoami.is_admin || inst.whoami.site_admin) && (
            <div><div className="text-xs text-muted-foreground">{t('detail.admin')}</div><Badge className="bg-red-600 text-white">admin</Badge></div>
          )}
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={loadProjects} disabled={loadingProjects} data-testid="instance-list-projects">
          {loadingProjects ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ListTree className="w-4 h-4 mr-2" />}
          {t('detail.listProjects')}
        </Button>
        <Button variant="outline" onClick={retest} disabled={retesting}>
          {retesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {t('detail.retest')}
        </Button>
      </div>

      {/* Projetos */}
      {projects !== null && (
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <CardTitle className="text-lg">{t('detail.projects')} · {projects.length}</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 w-64" placeholder={t('detail.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <Button onClick={enqueueClone} disabled={cloning || selectedCount === 0} data-testid="instance-clone-selected">
                {cloning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
                {t('detail.cloneSelected', { count: selectedCount })}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t('detail.noProjects')}</p>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2 px-2 py-1 border-b border-border">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} data-testid="instance-select-all" />
                  <span className="text-xs text-muted-foreground">{t('detail.selectAll')} ({visible.length})</span>
                </div>
                <div className="max-h-[55vh] overflow-auto">
                  {visible.map((p) => (
                    <label key={p.full_name} className="flex items-start gap-3 px-2 py-2 hover:bg-muted/40 rounded cursor-pointer">
                      <Checkbox checked={!!selected[p.full_name]}
                        onCheckedChange={(v) => setSelected(s => ({ ...s, [p.full_name]: !!v }))} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{p.full_name}</span>
                          {p.private && <Lock className="w-3 h-3 text-amber-500" />}
                          {p.default_branch && <Badge variant="secondary" className="text-[10px]">{p.default_branch}</Badge>}
                        </div>
                        {p.description && <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
