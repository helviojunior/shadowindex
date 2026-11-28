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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  GitBranch, ShieldCheck, Loader2, CheckCircle, XCircle, ListTodo, Zap,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function RequestClone() {
  const { t } = useTranslation('request-clone');
  const navigate = useNavigate();

  const [url, setUrl] = useState('');
  const [cloneAuth, setCloneAuth] = useState('anonymous');
  const [tokens, setTokens] = useState([]);
  const [credId, setCredId] = useState('');
  const [proxies, setProxies] = useState([]);
  const [proxyId, setProxyId] = useState('none');

  const [testing, setTesting] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const [testResult, setTestResult] = useState(null); // {ok, default_branch, ref_count, error, repo}

  const loadTokens = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/credentials/by-type/token`);
      setTokens(res.data || []);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadTokensError'));
    }
  }, [t]);

  const loadProxies = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/proxy-servers`);
      setProxies(res.data || []);
    } catch (e) { setProxies([]); }
  }, []);

  useEffect(() => { loadTokens(); loadProxies(); }, [loadTokens, loadProxies]);

  // Qualquer alteração nos parâmetros invalida o teste anterior.
  const resetTest = () => setTestResult(null);

  const tokenLabel = (c) => c.name || `Token #${c.id}`;
  const canTest = url.trim() && (cloneAuth === 'anonymous' || credId);
  const accessOk = testResult && testResult.ok;

  const payload = () => ({
    repo_url: url.trim(),
    clone_auth: cloneAuth,
    credential_id: cloneAuth === 'authenticated' ? parseInt(credId, 10) : null,
    proxy_id: proxyId && proxyId !== 'none' ? parseInt(proxyId, 10) : null,
  });

  const handleTest = async () => {
    if (!canTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post(`${API}/git/clone/test-access`, payload());
      setTestResult(res.data);
      if (res.data?.ok) toast.success(t('toast.testOk'));
      else toast.error(t('toast.testFail'));
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleEnqueue = async () => {
    if (!accessOk) return;
    setEnqueuing(true);
    try {
      const res = await axios.post(`${API}/git/clone/enqueue-url`, payload());
      if (res.data?.reprioritized) {
        toast.success(t('toast.reprioritized', { priority: res.data.priority }));
      } else {
        toast.success(t('toast.enqueued', { priority: res.data?.priority }));
      }
      navigate('/jobs/git');
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setEnqueuing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="h-6 w-6" /> {t('title')}
        </h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('card.title')}</CardTitle>
          <CardDescription>{t('card.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="repo-url">{t('url.label')}</Label>
            <Input
              id="repo-url"
              data-testid="request-clone-url"
              placeholder={t('url.placeholder')}
              value={url}
              onChange={(e) => { setUrl(e.target.value); resetTest(); }}
            />
            <p className="text-xs text-muted-foreground">{t('url.hint')}</p>
          </div>

          {/* Modo de autenticação */}
          <div className="space-y-2">
            <Label>{t('auth.label')}</Label>
            <RadioGroup
              value={cloneAuth}
              onValueChange={(v) => { setCloneAuth(v); resetTest(); }}
              className="flex flex-col gap-2"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="anonymous" id="rc-anon" data-testid="request-clone-anon" />
                <span className="text-sm">{t('auth.anonymous')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="authenticated" id="rc-auth" data-testid="request-clone-auth" />
                <span className="text-sm">{t('auth.authenticated')}</span>
              </label>
            </RadioGroup>
            {cloneAuth === 'authenticated' && (
              <div className="mt-2 max-w-md">
                <Select value={credId} onValueChange={(v) => { setCredId(v); resetTest(); }}>
                  <SelectTrigger data-testid="request-clone-token">
                    <SelectValue placeholder={t('auth.tokenPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {tokens.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{tokenLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tokens.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">{t('auth.noTokens')}</p>
                )}
              </div>
            )}
          </div>

          {/* Proxy */}
          <div className="space-y-2">
            <Label>{t('proxy.label')}</Label>
            <div className="max-w-md">
              <Select value={proxyId} onValueChange={(v) => { setProxyId(v); resetTest(); }}>
                <SelectTrigger data-testid="request-clone-proxy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('proxy.none')}</SelectItem>
                  {proxies.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} ({p.proxy_type || 'http'} · {p.ip}:{p.port})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Ações */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={!canTest || testing}
              data-testid="request-clone-test"
            >
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {t('actions.test')}
            </Button>

            <Button
              onClick={handleEnqueue}
              disabled={!accessOk || enqueuing}
              data-testid="request-clone-enqueue"
            >
              {enqueuing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ListTodo className="h-4 w-4 mr-2" />}
              {t('actions.enqueue')}
            </Button>

            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" /> {t('actions.highPriority')}
            </Badge>
          </div>

          {/* Resultado do teste */}
          {testResult && (
            <div
              className={`rounded-lg border p-4 text-sm ${
                testResult.ok
                  ? 'border-green-500/40 bg-green-500/5'
                  : 'border-red-500/40 bg-red-500/5'
              }`}
              data-testid="request-clone-result"
            >
              {testResult.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-green-500 font-medium">
                    <CheckCircle className="h-4 w-4" /> {t('result.ok')}
                  </div>
                  {testResult.repo?.full_name && (
                    <p><span className="text-muted-foreground">{t('result.repo')}:</span> <span className="font-mono">{testResult.repo.full_name}</span></p>
                  )}
                  {testResult.default_branch && (
                    <p><span className="text-muted-foreground">{t('result.defaultBranch')}:</span> <span className="font-mono">{testResult.default_branch}</span></p>
                  )}
                  {typeof testResult.ref_count === 'number' && (
                    <p><span className="text-muted-foreground">{t('result.refs')}:</span> {testResult.ref_count}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-red-500 font-medium">
                    <XCircle className="h-4 w-4" /> {t('result.fail')}
                  </div>
                  <p className="font-mono text-xs break-words whitespace-pre-wrap">{testResult.error}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
