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
import { Globe, Plus, Trash2, Pencil, Check, X, RefreshCw } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function DnsOverrides() {
  const { t } = useTranslation('dns');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ hostname: '', ip: '', enabled: true });
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

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
          <Button variant="outline" size="icon" onClick={load}>
            <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          </Button>
        </CardHeader>
        <CardContent>
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
