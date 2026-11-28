import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Server, Plus, RefreshCw, Trash2, CheckCircle, XCircle, User } from 'lucide-react';
import OriginLogo from '@/components/OriginLogo';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Mapeia a plataforma da instância para o logo da OriginLogo.
export function logoPlatform(platform) {
  const p = (platform || '').toLowerCase();
  if (p.startsWith('github')) return 'github';
  if (p === 'gitlab') return 'gitlab';
  if (p === 'azure_devops') return 'azure';
  if (p === 'bitbucket') return 'bitbucket';
  return null; // gitea / unknown -> ícone genérico
}

export default function GitInstances() {
  const { t } = useTranslation('git-instances');
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/git/instances`);
      setRows(res.data || []);
    } catch (e) {
      toast.error(t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Recarrega ao voltar o foco (ex.: após cadastrar numa nova janela).
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const openAdd = () => navigate('/git/instances/new');

  const remove = async (e, guid) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/git/instances/${guid}`);
      toast.success(t('toast.removed'));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Server className="w-7 h-7" />
          <div>
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={load}>
            <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          </Button>
          <Button onClick={openAdd} data-testid="git-add-instance">
            <Plus className="w-4 h-4 mr-2" />{t('actions.add')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">{t('list.title')} · {rows.length}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.platform')}</TableHead>
                <TableHead>{t('fields.url')}</TableHead>
                <TableHead>{t('fields.user')}</TableHead>
                <TableHead>{t('fields.status')}</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{t('list.empty')}</TableCell></TableRow>
              ) : rows.map((i) => (
                <TableRow key={i.guid} className="cursor-pointer" data-testid="git-instance-row"
                          onClick={() => navigate(`/git/instances/${i.guid}`)}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <OriginLogo platform={logoPlatform(i.platform)} className="w-4 h-4 flex-shrink-0" />
                      <div>
                        <div className="font-medium">{i.name || i.platform_label}</div>
                        <div className="text-xs text-muted-foreground">{i.platform_label}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{i.base_url}</TableCell>
                  <TableCell>
                    {i.whoami?.login ? (
                      <span className="inline-flex items-center gap-1 text-sm"><User className="w-3 h-3" />{i.whoami.login}</span>
                    ) : i.clone_auth === 'anonymous'
                      ? <span className="text-muted-foreground text-xs italic">{t('detail.anon')}</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell>
                    {i.status === 'ok' ? (
                      <Badge variant="outline" className="text-green-500 border-green-500/50 gap-1"><CheckCircle className="w-3 h-3" />OK</Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-500 border-red-500/50 gap-1" title={i.error || ''}><XCircle className="w-3 h-3" />{t('status.failed')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={(e) => remove(e, i.guid)} data-testid="git-instance-remove">
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
