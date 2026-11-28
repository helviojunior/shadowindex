import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Radio, RefreshCw, Search, ChevronRight, ChevronDown, ChevronLeft, AlertTriangle,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PAGE = 100;

const methodColor = (m) => ({
  GET: 'text-blue-400', POST: 'text-green-400', PUT: 'text-amber-400',
  DELETE: 'text-red-400', PATCH: 'text-purple-400',
}[m] || 'text-muted-foreground');

const statusColor = (s, err) => {
  if (err || (s && s >= 500)) return 'text-red-500';
  if (s && s >= 400) return 'text-amber-500';
  if (s && s >= 200 && s < 300) return 'text-green-500';
  return 'text-muted-foreground';
};

function Json({ data }) {
  if (data == null) return <span className="text-muted-foreground text-xs">—</span>;
  let txt;
  try { txt = typeof data === 'string' ? data : JSON.stringify(data, null, 2); }
  catch (e) { txt = String(data); }
  return <pre className="text-[11px] font-mono bg-muted/50 p-2 rounded overflow-auto max-h-64 whitespace-pre-wrap break-words">{txt}</pre>;
}

export default function ExternalCalls() {
  const { t } = useTranslation('audit');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [filterInput, setFilterInput] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async (off = 0, query = '', errs = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(off) });
      if (query) params.set('q', query);
      if (errs) params.set('errors_only', 'true');
      const res = await axios.get(`${API}/audit/external-calls?${params.toString()}`);
      setRows(res.data?.calls || []);
      setTotal(res.data?.total || 0);
      setOffset(off);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(0, '', false); }, [load]);

  const applyFilter = () => { setQ(filterInput.trim()); load(0, filterInput.trim(), errorsOnly); };
  const toggleErrors = (v) => { setErrorsOnly(v); load(0, q, v); };

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-6" data-testid="external-calls-page">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radio className="w-7 h-7" />
          <div>
            <h1 className="text-2xl font-bold">{t('external.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('external.subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => load(offset, q, errorsOnly)}>
          <RefreshCw className={loading ? 'w-4 h-4 mr-2 animate-spin' : 'w-4 h-4 mr-2'} />{t('external.refresh')}
        </Button>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />{t('external.notice')}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t('external.searchPlaceholder')} value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilter(); }} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={errorsOnly} onCheckedChange={toggleErrors} id="errors-only" />
          <Label htmlFor="errors-only" className="cursor-pointer text-sm">{t('external.errorsOnly')}</Label>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6"></TableHead>
                <TableHead>{t('external.when')}</TableHead>
                <TableHead>{t('external.provider')}</TableHead>
                <TableHead>{t('external.context')}</TableHead>
                <TableHead>{t('external.method')}</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>{t('external.remoteIp')}</TableHead>
                <TableHead className="text-right">{t('external.status')}</TableHead>
                <TableHead className="text-right">{t('external.duration')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">{t('external.empty')}</TableCell></TableRow>
              ) : rows.map((c) => {
                const open = !!expanded[c.id];
                return [
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setExpanded(s => ({ ...s, [c.id]: !s[c.id] }))} data-testid="external-call-row">
                    <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</TableCell>
                    <TableCell className="font-medium">{c.provider || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.context || '—'}</TableCell>
                    <TableCell className={`font-mono font-medium ${methodColor(c.method)}`}>{c.method}</TableCell>
                    <TableCell className="font-mono text-xs max-w-md truncate" title={c.url}>{c.url}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.remote_ip || '—'}</TableCell>
                    <TableCell className={`text-right font-mono ${statusColor(c.status_code, c.error)}`}>{c.error ? t('external.failed') : (c.status_code ?? '—')}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{c.duration_ms != null ? c.duration_ms : '—'}</TableCell>
                  </TableRow>,
                  open && (
                    <TableRow key={`${c.id}-d`} className="bg-muted/20">
                      <TableCell colSpan={9}>
                        <div className="grid md:grid-cols-2 gap-4 p-2">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground">{t('external.reqHeaders')}</div>
                            <Json data={c.request_headers} />
                            <div className="text-xs font-semibold text-muted-foreground">{t('external.reqBody')}</div>
                            <Json data={c.request_payload} />
                          </div>
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground">{t('external.respBody')}</div>
                            <Json data={c.response_payload} />
                            {c.error && (<>
                              <div className="text-xs font-semibold text-red-500">{t('external.error')}</div>
                              <pre className="text-[11px] font-mono bg-red-500/10 text-red-400 p-2 rounded whitespace-pre-wrap">{c.error}</pre>
                            </>)}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>

          {total > PAGE && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-muted-foreground">{t('external.pageOf', { page, pages })} · {total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset <= 0 || loading} onClick={() => load(offset - PAGE, q, errorsOnly)}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" disabled={offset + PAGE >= total || loading} onClick={() => load(offset + PAGE, q, errorsOnly)}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
