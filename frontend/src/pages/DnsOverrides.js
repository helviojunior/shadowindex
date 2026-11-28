import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Globe, Plus, Trash2, Pencil, Check, X, RefreshCw, Stethoscope, CheckCircle, XCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function DnsOverrides() {
  const { t } = useTranslation('dns');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ hostname: '', ip: '', enabled: true });
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [diag, setDiag] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const runDiag = async () => {
    setDiagnosing(true);
    try {
      const res = await axios.get(`${API}/dns-overrides/status`);
      setDiag(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setDiagnosing(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/dns-overrides`);
      setRows(res.data || []);
    } catch (e) {
      toast.error(t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.hostname.trim() || !form.ip.trim()) { toast.error(t('toast.required')); return; }
    try {
      await axios.post(`${API}/dns-overrides`, {
        hostname: form.hostname.trim(), ip: form.ip.trim(), enabled: form.enabled,
      });
      toast.success(t('toast.added'));
      setForm({ hostname: '', ip: '', enabled: true });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const saveEdit = async (id) => {
    try {
      await axios.put(`${API}/dns-overrides/${id}`, {
        hostname: (editData.hostname || '').trim(),
        ip: (editData.ip || '').trim(),
        enabled: editData.enabled,
      });
      toast.success(t('toast.saved'));
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const toggle = async (row) => {
    try {
      await axios.put(`${API}/dns-overrides/${row.id}`, {
        hostname: row.hostname, ip: row.ip, enabled: !row.enabled,
      });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`${API}/dns-overrides/${id}`);
      toast.success(t('toast.removed'));
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  };

  return (
    <div className="space-y-6" data-testid="dns-overrides-page">
      <div className="flex items-center gap-3">
        <Globe className="w-7 h-7" />
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
      </div>

      {/* Adicionar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('add.title')}</CardTitle>
          <CardDescription>{t('add.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>{t('fields.hostname')}</Label>
              <Input
                placeholder="gitlab.interno.local"
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                data-testid="dns-hostname"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label>{t('fields.ip')}</Label>
              <Input
                placeholder="10.0.0.5"
                value={form.ip}
                onChange={(e) => setForm({ ...form, ip: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                data-testid="dns-ip"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
              <Label className="cursor-pointer">{t('fields.enabled')}</Label>
            </div>
            <Button onClick={add} data-testid="dns-add">
              <Plus className="w-4 h-4 mr-2" />{t('actions.add')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{t('list.title')} · {rows.length}</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" onClick={runDiag} disabled={diagnosing} data-testid="dns-diag">
              {diagnosing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Stethoscope className="w-4 h-4 mr-2" />}
              {t('diag.button')}
            </Button>
            <Button variant="outline" size="icon" onClick={load}>
              <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {diag && (
            <div className="mb-4 rounded-lg border border-border p-3 text-sm space-y-2" data-testid="dns-diag-result">
              <div className="flex items-center gap-2">
                {diag.written
                  ? <span className="inline-flex items-center gap-1 text-green-500"><CheckCircle className="w-4 h-4" />{t('diag.written')}</span>
                  : <span className="inline-flex items-center gap-1 text-red-500"><XCircle className="w-4 h-4" />{t('diag.notWritten')}{diag.error ? `: ${diag.error}` : ''}</span>}
                <span className="text-xs text-muted-foreground font-mono">{diag.hosts_path}</span>
              </div>
              {Object.entries(diag.resolved || {}).map(([host, r]) => (
                <div key={host} className="flex items-center gap-2 text-xs font-mono">
                  {r.ok ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                  <span>{host} → {r.got || r.error || '—'}</span>
                  {!r.ok && r.got && <span className="text-amber-500">({t('diag.expected')} {r.expected})</span>}
                </div>
              ))}
              {Object.entries(diag.reachability || {}).map(([ip, r]) => (
                <div key={ip} className="flex items-center gap-2 text-xs font-mono">
                  {r.reachable ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                  <span>{ip}: {t('diag.tcp')} 443={String(r['443'])} · 80={String(r['80'])}</span>
                  {!r.reachable && <span className="text-red-400">{t('diag.unreachable')}</span>}
                </div>
              ))}
              {diag.managed_block && (
                <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">{diag.managed_block}</pre>
              )}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t('fields.enabled')}</TableHead>
                <TableHead>{t('fields.hostname')}</TableHead>
                <TableHead>{t('fields.ip')}</TableHead>
                <TableHead className="w-28 text-right">{t('fields.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">{t('list.empty')}</TableCell></TableRow>
              ) : rows.map((row) => {
                const editing = editingId === row.id;
                return (
                  <TableRow key={row.id} data-testid="dns-row">
                    <TableCell>
                      {editing ? (
                        <Switch checked={editData.enabled} onCheckedChange={(v) => setEditData({ ...editData, enabled: v })} />
                      ) : (
                        <Switch checked={row.enabled} onCheckedChange={() => toggle(row)} />
                      )}
                    </TableCell>
                    <TableCell className="font-mono">
                      {editing ? (
                        <Input value={editData.hostname} onChange={(e) => setEditData({ ...editData, hostname: e.target.value })} className="h-8" />
                      ) : row.hostname}
                    </TableCell>
                    <TableCell className="font-mono">
                      {editing ? (
                        <Input value={editData.ip} onChange={(e) => setEditData({ ...editData, ip: e.target.value })} className="h-8" />
                      ) : row.ip}
                    </TableCell>
                    <TableCell className="text-right">
                      {editing ? (
                        <div className="inline-flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-500" onClick={() => saveEdit(row.id)}>
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => { setEditingId(row.id); setEditData({ hostname: row.hostname, ip: row.ip, enabled: row.enabled }); }}
                            data-testid="dns-edit">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => remove(row.id)} data-testid="dns-remove">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
