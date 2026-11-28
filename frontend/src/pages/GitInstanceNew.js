import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { ShieldCheck, Loader2, CheckCircle, XCircle, Save, User, Search, RefreshCw } from 'lucide-react';
import OriginLogo from '@/components/OriginLogo';
import { logoPlatform } from './GitInstances';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Plataformas para seleção MANUAL (quando a detecção automática não identifica).
const PLATFORMS = [
  { v: 'github', k: 'GitHub' },
  { v: 'github_enterprise', k: 'GitHub Enterprise' },
  { v: 'gitlab', k: 'GitLab' },
  { v: 'gitea', k: 'Gitea' },
  { v: 'bitbucket', k: 'Bitbucket' },
  { v: 'azure_devops', k: 'Azure DevOps' },
];

export default function GitInstanceNew() {
  const { t } = useTranslation('git-instances');
  const navigate = useNavigate();

  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('authenticated');
  const [tokens, setTokens] = useState([]);
  const [credId, setCredId] = useState('');
  const [proxies, setProxies] = useState([]);
  const [proxyId, setProxyId] = useState('none');
  const [platform, setPlatform] = useState('');

  const [detecting, setDetecting] = useState(false);
  const [detectInfo, setDetectInfo] = useState(null); // {detected, platform, platform_label, api_url, ...}
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [tk, px] = await Promise.all([
        axios.get(`${API}/credentials/by-type/token`).catch(() => ({ data: [] })),
        axios.get(`${API}/proxy-servers`).catch(() => ({ data: [] })),
      ]);
      setTokens(tk.data || []);
      setProxies(px.data || []);
    } catch (e) { /* noop */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetTest = () => setResult(null);
  // Alterar a URL invalida a detecção anterior (volta a esconder os campos).
  const onUrlChange = (v) => { setUrl(v); setResult(null); setDetectInfo(null); setPlatform(''); };
  const tokenLabel = (c) => c.name || `Token #${c.id}`;
  const canTest = url.trim() && (auth === 'anonymous' || credId);
  const accessOk = result && result.ok;
  const detectDone = detectInfo !== null;          // detecção já executada
  const proxyNum = proxyId && proxyId !== 'none' ? parseInt(proxyId, 10) : null;

  const payload = () => ({
    base_url: url.trim(),
    clone_auth: auth,
    credential_id: auth === 'authenticated' ? parseInt(credId, 10) : null,
    proxy_id: proxyNum,
    platform: platform || null,
  });

  const handleDetect = async () => {
    if (!url.trim()) return;
    setDetecting(true); setResult(null);
    try {
      const res = await axios.post(`${API}/git/instances/detect`, {
        base_url: url.trim(), proxy_id: proxyNum,
      });
      setDetectInfo(res.data);
      if (res.data?.detected) {
        setPlatform(res.data.platform);
        toast.success(t('new.detectedPlatform', { name: res.data.platform_label }));
      } else {
        setPlatform('');
        toast.message(t('new.notDetected'));
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setDetecting(false);
    }
  };

  const handleTest = async () => {
    if (!canTest) return;
    setTesting(true); setResult(null);
    try {
      const res = await axios.post(`${API}/git/instances/test`, payload());
      setResult(res.data);
      if (res.data?.ok) toast.success(t('toast.testOk'));
      else toast.error(res.data?.error || t('toast.testFail'));
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!accessOk) return;
    setSaving(true);
    try {
      const res = await axios.post(`${API}/git/instances`, payload());
      toast.success(t('toast.saved'));
      navigate(`/git/instances/${res.data?.guid}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('new.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('new.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('new.cardTitle')}</CardTitle>
          <CardDescription>{t('new.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>{t('fields.url')}</Label>
            <Input
              placeholder="https://gitlab.interno.local  ·  https://dev.azure.com/org  ·  https://gitea.example.com"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              data-testid="instance-url"
            />
            <p className="text-xs text-muted-foreground">{t('new.urlHint')}</p>
          </div>

          {/* Passo 1: detectar a plataforma. Enquanto não detectar, o resto fica oculto. */}
          {!detectDone && (
            <div>
              <Button onClick={handleDetect} disabled={!url.trim() || detecting} data-testid="instance-detect">
                {detecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                {t('new.detectPlatform')}
              </Button>
            </div>
          )}

          {/* Passo 2: plataforma detectada (logo + nome) ou seletor manual se não identificada. */}
          {detectDone && (
            <div className="space-y-2">
              <Label>{t('fields.platform')}</Label>
              {detectInfo.detected ? (
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2">
                    <OriginLogo platform={logoPlatform(detectInfo.platform)} className="w-5 h-5" />
                    <span className="font-medium">{detectInfo.platform_label}</span>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleDetect} disabled={detecting} data-testid="instance-redetect">
                    {detecting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    {t('new.redetect')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-amber-500">{t('new.notDetectedSelect')}</p>
                  <div className="flex items-center gap-2">
                    <div className="max-w-xs w-full">
                      <Select value={platform} onValueChange={(v) => { setPlatform(v); resetTest(); }}>
                        <SelectTrigger data-testid="instance-platform"><SelectValue placeholder={t('new.selectPlatform')} /></SelectTrigger>
                        <SelectContent>
                          {PLATFORMS.map(p => (
                            <SelectItem key={p.v} value={p.v}>{p.k}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleDetect} disabled={detecting} data-testid="instance-redetect">
                      {detecting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                      {t('new.redetect')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {detectDone && (<>
          <div className="space-y-2">
            <Label>{t('auth.label')}</Label>
            <RadioGroup value={auth} onValueChange={(v) => { setAuth(v); resetTest(); }} className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="anonymous" id="i-anon" />
                <span className="text-sm">{t('auth.anonymous')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="authenticated" id="i-auth" />
                <span className="text-sm">{t('auth.authenticated')}</span>
              </label>
            </RadioGroup>
            {auth === 'authenticated' && (
              <div className="mt-2 max-w-md">
                <Select value={credId} onValueChange={(v) => { setCredId(v); resetTest(); }}>
                  <SelectTrigger data-testid="instance-token"><SelectValue placeholder={t('auth.tokenPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {tokens.map(c => <SelectItem key={c.id} value={String(c.id)}>{tokenLabel(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {tokens.length === 0 && <p className="text-xs text-amber-500 mt-1">{t('auth.noTokens')}</p>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('fields.proxy')}</Label>
            <div className="max-w-md">
              <Select value={proxyId} onValueChange={(v) => { setProxyId(v); resetTest(); }}>
                <SelectTrigger data-testid="instance-proxy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('proxy.none')}</SelectItem>
                  {proxies.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.proxy_type || 'http'} · {p.ip}:{p.port})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="outline" onClick={handleTest} disabled={!canTest || testing} data-testid="instance-test">
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {t('actions.test')}
            </Button>
            <Button onClick={handleSave} disabled={!accessOk || saving} data-testid="instance-save">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {t('actions.save')}
            </Button>
          </div>

          {result && (
            <div className={`rounded-lg border p-4 text-sm ${result.ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`} data-testid="instance-result">
              {result.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-green-500 font-medium"><CheckCircle className="h-4 w-4" />{t('new.detected')}</div>
                  <p><span className="text-muted-foreground">{t('fields.platform')}:</span> <span className="font-medium">{result.platform_label}</span></p>
                  {result.api_url && <p><span className="text-muted-foreground">API:</span> <span className="font-mono text-xs">{result.api_url}</span></p>}
                  {result.whoami?.login && (
                    <p className="inline-flex items-center gap-1"><User className="w-3 h-3" /><span className="text-muted-foreground">whoami:</span> <span className="font-medium">{result.whoami.login}</span>{result.whoami.name ? ` (${result.whoami.name})` : ''}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-red-500 font-medium"><XCircle className="h-4 w-4" />{t('new.failed')}</div>
                  <p className="font-mono text-xs break-words whitespace-pre-wrap">{result.error}</p>
                </div>
              )}
            </div>
          )}
          </>)}
        </CardContent>
      </Card>
    </div>
  );
}
