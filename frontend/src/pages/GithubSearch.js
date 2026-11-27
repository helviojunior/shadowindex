import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Github, Search, Download, X, Loader2, CheckCircle, XCircle, ListTodo,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ALL_TYPES = ['repositories', 'code'];

export default function GithubSearch() {
  const { t } = useTranslation('github-search');
  const navigate = useNavigate();

  const [termInput, setTermInput] = useState('');
  const [terms, setTerms] = useState([]);
  const [types, setTypes] = useState(['repositories']);
  const [exact, setExact] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [apiCredId, setApiCredId] = useState('');
  const [cloneAuth, setCloneAuth] = useState('anonymous');
  const [cloneCredId, setCloneCredId] = useState('');

  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState({}); // key -> bool
  const [indexStatus, setIndexStatus] = useState(null);

  const loadTokens = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/credentials/by-type/token`);
      setTokens(res.data || []);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadTokensError'));
    }
  }, [t]);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  useEffect(() => {
    axios.get(`${API}/git/status`).then(r => setIndexStatus(r.data?.opensearch)).catch(() => {});
  }, []);

  const addTerm = () => {
    const v = termInput.trim();
    if (!v) return;
    if (!terms.includes(v)) setTerms([...terms, v]);
    setTermInput('');
  };
  const removeTerm = (v) => setTerms(terms.filter(x => x !== v));

  const toggleType = (ty) => {
    setTypes(prev => prev.includes(ty) ? prev.filter(x => x !== ty) : [...prev, ty]);
  };

  const rowKey = (r) => `${r.term}::${r.type}`;
  const selectableRows = (results?.results || []).filter(r => r.status === 'ok' && r.count > 0);
  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selected[rowKey(r)]);
  const anySelected = selectableRows.some(r => selected[rowKey(r)]);

  const toggleAll = () => {
    if (allSelected) { setSelected({}); return; }
    const next = {};
    selectableRows.forEach(r => { next[rowKey(r)] = true; });
    setSelected(next);
  };

  const runSearch = async () => {
    if (terms.length === 0) { toast.error(t('toast.needTerm')); return; }
    if (types.length === 0) { toast.error(t('toast.needType')); return; }
    if (!apiCredId) { toast.error(t('toast.needToken')); return; }
    setSearching(true);
    setResults(null);
    setSelected({});
    try {
      const res = await axios.post(`${API}/git/search/count`, {
        terms, types, exact, api_credential_id: parseInt(apiCredId, 10),
      });
      setResults(res.data);
      // preselect all ok rows with count>0
      const next = {};
      (res.data?.results || []).forEach(r => {
        if (r.status === 'ok' && r.count > 0) next[`${r.term}::${r.type}`] = true;
      });
      setSelected(next);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || t('toast.searchError'));
    } finally {
      setSearching(false);
    }
  };

  const runDownload = async () => {
    const conditions = selectableRows
      .filter(r => selected[rowKey(r)])
      .map(r => ({ term: r.term, type: r.type }));
    if (conditions.length === 0) { toast.error(t('toast.noSelection')); return; }
    if (!apiCredId) { toast.error(t('toast.needToken')); return; }
    if (cloneAuth === 'authenticated' && !cloneCredId) { toast.error(t('toast.needCloneToken')); return; }
    setDownloading(true);
    try {
      const res = await axios.post(`${API}/git/search/enqueue`, {
        conditions,
        exact,
        api_credential_id: parseInt(apiCredId, 10),
        clone_auth: cloneAuth,
        clone_credential_id: cloneAuth === 'authenticated' ? parseInt(cloneCredId, 10) : null,
        depth: null,
      });
      const queued = res.data?.queued ?? 0;
      toast.success(t('toast.queued', { count: queued }), {
        action: { label: t('actions.goToJobs'), onClick: () => navigate('/jobs/git') },
      });
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || t('toast.enqueueError'));
    } finally {
      setDownloading(false);
    }
  };

  const tokenLabel = (c) => c.name || `Token #${c.id}`;

  const indexBadge = () => {
    if (!indexStatus) return null;
    if (!indexStatus.enabled) return <Badge variant="outline" className="text-muted-foreground">{t('indexNote.disabled')}</Badge>;
    if (!indexStatus.available) return <Badge variant="outline" className="text-red-500 border-red-500/50">{t('indexNote.unavailable')}</Badge>;
    return <Badge variant="outline" className="text-green-500 border-green-500/50">{t('indexNote.available', { status: indexStatus.status })}</Badge>;
  };

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Github className="w-7 h-7 text-foreground" />
          <div>
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          </div>
        </div>
        {indexBadge()}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Terms */}
          <div className="space-y-2">
            <Label>{t('terms.label')}</Label>
            <div className="flex gap-2">
              <Input
                data-testid="git-term-input"
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTerm(); } }}
                placeholder={t('terms.placeholder')}
              />
              <Button type="button" variant="secondary" onClick={addTerm}>+</Button>
            </div>
            <div className="flex flex-wrap gap-2 min-h-[28px]">
              {terms.length === 0 && <span className="text-xs text-muted-foreground">{t('terms.empty')}</span>}
              {terms.map(term => (
                <Badge key={term} variant="secondary" className="gap-1 pr-1" data-testid="git-term-chip">
                  {term}
                  <button type="button" onClick={() => removeTerm(term)} className="ml-1 hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Types */}
            <div className="space-y-2">
              <Label>{t('types.label')}</Label>
              <div className="flex flex-col gap-2">
                {ALL_TYPES.map(ty => (
                  <label key={ty} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={types.includes(ty)}
                      onCheckedChange={() => toggleType(ty)}
                      data-testid={`git-type-${ty}`}
                    />
                    <span className="text-sm">{t(`types.${ty}`)}</span>
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <Switch checked={exact} onCheckedChange={setExact} data-testid="git-exact" />
                <span className="text-sm">{t('exact.label')}</span>
              </label>
              <p className="text-xs text-muted-foreground">{t('exact.hint')}</p>
            </div>

            {/* Tokens + clone auth */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('apiToken.label')} *</Label>
                <Select value={apiCredId} onValueChange={setApiCredId}>
                  <SelectTrigger data-testid="git-api-token">
                    <SelectValue placeholder={t('apiToken.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {tokens.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{tokenLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tokens.length === 0 && <p className="text-xs text-amber-500">{t('apiToken.none')}</p>}
              </div>

              <div className="space-y-2">
                <Label>{t('cloneAuth.label')}</Label>
                <RadioGroup value={cloneAuth} onValueChange={setCloneAuth} className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="anonymous" id="auth-anon" data-testid="git-auth-anon" />
                    <span className="text-sm">{t('cloneAuth.anonymous')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="authenticated" id="auth-auth" data-testid="git-auth-auth" />
                    <span className="text-sm">{t('cloneAuth.authenticated')}</span>
                  </label>
                </RadioGroup>
                {cloneAuth === 'authenticated' && (
                  <Select value={cloneCredId} onValueChange={setCloneCredId}>
                    <SelectTrigger data-testid="git-clone-token">
                      <SelectValue placeholder={t('cloneAuth.tokenPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {tokens.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{tokenLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={runSearch} disabled={searching} data-testid="git-search-btn">
              {searching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              {searching ? t('actions.searching') : t('actions.search')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{t('results.title')}</CardTitle>
          <Button
            onClick={runDownload}
            disabled={!anySelected || downloading}
            data-testid="git-download-btn"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
            {downloading ? t('actions.downloading') : t('actions.download')}
          </Button>
        </CardHeader>
        <CardContent>
          {!results ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{t('results.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t('actions.selectAll')} />
                  </TableHead>
                  <TableHead>{t('results.term')}</TableHead>
                  <TableHead>{t('results.type')}</TableHead>
                  <TableHead className="text-right">{t('results.count')}</TableHead>
                  <TableHead>{t('results.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.results.map((r) => {
                  const k = rowKey(r);
                  const selectable = r.status === 'ok' && r.count > 0;
                  return (
                    <TableRow key={k} data-testid="git-result-row">
                      <TableCell>
                        <Checkbox
                          checked={!!selected[k]}
                          disabled={!selectable}
                          onCheckedChange={(v) => setSelected(s => ({ ...s, [k]: !!v }))}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{r.term}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{t(`types.${r.type}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.count}</TableCell>
                      <TableCell>
                        {r.status === 'ok' ? (
                          <Badge variant="outline" className="gap-1 bg-green-500/20 text-green-500 border-green-500/50">
                            <CheckCircle className="w-3 h-3" /> {t('results.ok')}
                          </Badge>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="gap-1 bg-red-500/20 text-red-500 border-red-500/50 cursor-help">
                                  <XCircle className="w-3 h-3" /> {t('results.error')}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm">{r.error}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="pt-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/jobs/git')}>
              <ListTodo className="w-4 h-4 mr-2" /> {t('actions.goToJobs')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
