import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Library, Search, Star, AlertTriangle, FileText,
  Loader2, Clock, CheckCircle, XCircle, RefreshCw, ExternalLink,
  GitBranch, GitCommit, DownloadCloud,
} from 'lucide-react';
import OriginLogo from '@/components/OriginLogo';
import { cn } from '@/lib/utils';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META = {
  pending: { icon: Clock, className: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' },
  cloning: { icon: Loader2, className: 'bg-blue-500/20 text-blue-500 border-blue-500/50', spin: true },
  cloned: { icon: CheckCircle, className: 'bg-green-500/20 text-green-500 border-green-500/50' },
  failed: { icon: XCircle, className: 'bg-red-500/20 text-red-500 border-red-500/50' },
};

// Cards de estatística no mesmo padrão das outras telas (borda colorida à esquerda).
const STAT_STYLES = {
  total:   { icon: GitBranch,     text: 'text-blue-500',   border: 'border-l-blue-500' },
  pending: { icon: Clock,         text: 'text-yellow-500', border: 'border-l-yellow-500' },
  cloning: { icon: Loader2,       text: 'text-blue-500',   border: 'border-l-blue-500', spin: true },
  cloned:  { icon: DownloadCloud, text: 'text-cyan-500',   border: 'border-l-cyan-500' },
  failed:  { icon: XCircle,       text: 'text-red-500',    border: 'border-l-red-500' },
};

export default function Github() {
  const { t } = useTranslation('github');
  const navigate = useNavigate();

  const [repos, setRepos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState(null);

  const [contentQ, setContentQ] = useState('');
  const [contentHits, setContentHits] = useState(null);
  const [contentBackend, setContentBackend] = useState('');
  const [searchingContent, setSearchingContent] = useState(false);

  const loadRepos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (statusFilter !== 'all') params.set('clone_status', statusFilter);
      params.set('limit', '100');
      const res = await axios.get(`${API}/git/repos?${params.toString()}`);
      setRepos(res.data?.repos || []);
      setTotal(res.data?.total || 0);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, t]);

  const loadStats = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/repos/stats`);
      setStats(res.data);
    } catch (e) { /* noop */ }
  }, []);

  useEffect(() => { loadRepos(); loadStats(); }, [loadRepos, loadStats]);

  const runContentSearch = async () => {
    const term = contentQ.trim();
    if (!term) return;
    setSearchingContent(true);
    try {
      const res = await axios.get(`${API}/git/search/content?q=${encodeURIComponent(term)}&limit=50`);
      setContentHits(res.data?.hits || []);
      setContentBackend(res.data?.backend || '');
    } catch (e) {
      console.error(e);
      toast.error(t('toast.searchError'));
    } finally {
      setSearchingContent(false);
    }
  };

  const StatusBadge = ({ status }) => {
    const meta = STATUS_META[status] || STATUS_META.pending;
    const Icon = meta.icon;
    return (
      <Badge variant="outline" className={cn('gap-1', meta.className)}>
        <Icon className={cn('w-3 h-3', meta.spin && 'animate-spin')} />
        {t(`cloneStatus.${status}`, { defaultValue: status })}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Library className="w-7 h-7" />
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {['total', 'pending', 'cloning', 'cloned', 'failed'].map(k => {
            const cfg = STAT_STYLES[k];
            const Icon = cfg.icon;
            const count = stats[k] ?? 0;
            return (
              <Card key={k} className={cn('border-l-4 border border-transparent', cfg.border)}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className={cn('text-xs uppercase', cfg.text)}>{t(`stats.${k}`)}</p>
                    </div>
                    <Icon className={cn('w-6 h-6 opacity-60', cfg.text, cfg.spin && count > 0 && 'animate-spin')} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Content search */}
      <Card>
        <CardHeader><CardTitle className="text-lg">{t('search.contentTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={contentQ}
              onChange={(e) => setContentQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runContentSearch(); }}
              placeholder={t('search.contentPlaceholder')}
              data-testid="git-content-search"
            />
            <Button onClick={runContentSearch} disabled={searchingContent}>
              {searchingContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>
          {contentHits !== null && (
            <div className="space-y-2">
              {contentBackend && <div className="text-xs text-muted-foreground">{t('search.backend')}: {contentBackend}</div>}
              {contentHits.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('search.contentEmpty')}</p>
              ) : contentHits.map((h, i) => (
                <div key={i} className="border rounded-md p-3 text-sm cursor-pointer hover:bg-muted/50"
                     onClick={() => navigate(`/git/${h.repo_guid}`)}>
                  <div className="font-medium flex items-center gap-2">
                    <span className="text-blue-500">{h.repo_full_name}</span>
                    <span className="text-muted-foreground font-mono text-xs">{h.rel_path}</span>
                  </div>
                  {(h.highlights || []).map((hl, j) => (
                    <div key={j} className="text-xs font-mono text-muted-foreground mt-1"
                         dangerouslySetInnerHTML={{ __html: hl }} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Repo list */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
          <CardTitle className="text-lg">{t('table.repo')} · {total}</CardTitle>
          <div className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadRepos(); }}
              placeholder={t('search.placeholder')}
              className="w-64"
              data-testid="git-repo-search"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.allStatus')}</SelectItem>
                <SelectItem value="pending">{t('cloneStatus.pending')}</SelectItem>
                <SelectItem value="cloning">{t('cloneStatus.cloning')}</SelectItem>
                <SelectItem value="cloned">{t('cloneStatus.cloned')}</SelectItem>
                <SelectItem value="failed">{t('cloneStatus.failed')}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => { loadRepos(); loadStats(); }}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.repo')}</TableHead>
                <TableHead>{t('table.language')}</TableHead>
                <TableHead className="text-right">{t('table.branches')}</TableHead>
                <TableHead className="text-right">{t('table.commits')}</TableHead>
                <TableHead className="text-right">{t('table.stars')}</TableHead>
                <TableHead className="text-right">{t('table.files')}</TableHead>
                <TableHead className="text-right">{t('table.leaks')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">{t('table.empty')}</TableCell></TableRow>
              ) : repos.map(r => (
                <TableRow key={r.guid} className="cursor-pointer" data-testid="git-repo-row"
                          onClick={() => navigate(`/git/${r.guid}`)}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-2">
                      <OriginLogo repo={r} className="w-4 h-4 flex-shrink-0" />
                      <span>{r.full_name}</span>
                    </div>
                    {r.description && <div className="text-xs text-muted-foreground line-clamp-1 max-w-md ml-6">{r.description}</div>}
                    {(r.topics || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(r.topics || []).slice(0, 5).map(tp => (
                          <Badge key={tp} variant="secondary" className="text-[10px]">{tp}</Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{r.language && <Badge variant="outline">{r.language}</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><GitBranch className="w-3 h-3" />{r.branches_count ?? '—'}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><GitCommit className="w-3 h-3" />{r.commits_count ?? '—'}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1"><Star className="w-3 h-3" />{r.stars ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1"><FileText className="w-3 h-3" />{r.files_count ?? 0}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.leaks_count > 0
                      ? <span className="inline-flex items-center gap-1 text-red-500"><AlertTriangle className="w-3 h-3" />{r.leaks_count}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell><StatusBadge status={r.clone_status} /></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {r.leaks_count > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 text-red-500 hover:text-red-400"
                          title={t('table.viewLeaks')}
                          onClick={() => navigate(`/leaks?repo_guid=${r.guid}&repo=${encodeURIComponent(r.full_name)}`)}
                          data-testid="git-view-leaks">
                          <AlertTriangle className="w-3.5 h-3.5 mr-1" />{t('table.viewLeaks')}
                        </Button>
                      )}
                      {r.html_url && (
                        <a href={r.html_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
