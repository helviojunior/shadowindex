import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlayCircle, Loader2, Copy, Check, Plug, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation, Trans } from 'react-i18next';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SoapOperations = () => {
  const { t } = useTranslation('soap-operations');
  const [activeTab, setActiveTab] = useState('resolve');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const { ignoreCache } = useApp();

  // SOAP API selection
  const [soapApis, setSoapApis] = useState([]);
  const [selectedSoapApi, setSelectedSoapApi] = useState('');
  const [loadingApis, setLoadingApis] = useState(true);

  // Form states for each operation
  const [resolveForm, setResolveForm] = useState({ s1: '' });
  const [sharesForm, setSharesForm] = useState({ s1: '' });
  const [execForm, setExecForm] = useState({ connStr: '', query: '' });
  const [exec4Form, setExec4Form] = useState({ s1: '' });
  const [exec5Form, setExec5Form] = useState({ s1: '' });
  
  // DB Connections for Exec
  const [dbConnections, setDbConnections] = useState([]);

  useEffect(() => {
    loadDbConnections();
    loadSoapApis();
  }, []);

  const loadSoapApis = async () => {
    setLoadingApis(true);
    try {
      const response = await axios.get(`${API}/soap-apis`);
      setSoapApis(response.data);
      // Select first API by default
      if (response.data.length > 0) {
        setSelectedSoapApi(response.data[0].id.toString());
      }
    } catch (error) {
      console.error('Error loading SOAP APIs:', error);
    } finally {
      setLoadingApis(false);
    }
  };

  const loadDbConnections = async () => {
    try {
      const response = await axios.get(`${API}/db-connections`);
      setDbConnections(response.data);
    } catch (error) {
      console.error('Error loading DB connections:', error);
    }
  };

  const handleOperation = async (operation, data) => {
    if (!selectedSoapApi) {
      toast.error(t('toast.selectApiFirst'));
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await axios.post(`${API}/soap/${operation}`, {
        ...data,
        ignore_cache: ignoreCache,
        soap_api_id: parseInt(selectedSoapApi)
      });
      
      setResult({
        success: true,
        operation: response.data.operation,
        data: response.data.result,
        fromCache: response.data.from_cache && !ignoreCache
      });
      
      // Operação executada (sem toast de sucesso)
    } catch (error) {
      console.error('Error executing SOAP operation:', error);
      const errorMsg = error.response?.data?.detail || t('toast.operationError');
      setResult({
        success: false,
        error: errorMsg
      });
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const copyResult = async () => {
    if (result?.data) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(result.data);
        } else {
          // Fallback para HTTP
          const textArea = document.createElement('textarea');
          textArea.value = result.data;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success(t('toast.copied'));
      } catch (error) {
        toast.error(t('toast.copyError'));
      }
    }
  };

  const formatXml = (xml) => {
    if (!xml) return '';
    try {
      // Tenta formatar como XML
      const formatted = xml
        .replace(/></g, '>\n<')
        .replace(/(<[^>]+>)/g, (match) => {
          return match;
        });
      return formatted;
    } catch {
      return xml;
    }
  };

  return (
    <div className="space-y-6" data-testid="soap-operations-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('header.title')}</h1>
        <p className="text-muted-foreground mt-2">{t('header.subtitle')}</p>
      </div>

      {/* SOAP API Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plug className="w-5 h-5" />
            {t('selector.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingApis ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('selector.loading')}
            </div>
          ) : soapApis.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <Trans t={t} i18nKey="selector.noApi">
                  No SOAP API configured. Configure one under <a href="/plugins/soap" className="underline font-medium">Plugins → SOAP Plugin</a>.
                </Trans>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex items-center gap-4">
              <Select
                value={selectedSoapApi}
                onValueChange={setSelectedSoapApi}
              >
                <SelectTrigger className="w-[350px]" data-testid="soap-api-selector">
                  <SelectValue placeholder={t('selector.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {soapApis.map((api) => (
                    <SelectItem key={api.id} value={api.id.toString()}>
                      <span className="flex items-center gap-2">
                        <Plug className="w-3 h-3" />
                        {api.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSoapApi && (
                <span className="text-sm text-muted-foreground font-mono">
                  {soapApis.find(a => a.id.toString() === selectedSoapApi)?.uri}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operations Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>{t('operations.title')}</CardTitle>
          <CardDescription>{t('operations.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="resolve" data-testid="tab-resolve">{t('tabs.resolve')}</TabsTrigger>
              <TabsTrigger value="shares" data-testid="tab-shares">{t('tabs.shares')}</TabsTrigger>
              <TabsTrigger value="exec" data-testid="tab-exec">{t('tabs.exec')}</TabsTrigger>
              <TabsTrigger value="exec4" data-testid="tab-exec4">{t('tabs.exec4')}</TabsTrigger>
              <TabsTrigger value="exec5" data-testid="tab-exec5">{t('tabs.exec5')}</TabsTrigger>
            </TabsList>

            {/* Resolve Tab */}
            <TabsContent value="resolve" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">{t('resolve.title')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('resolve.description')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resolve-s1">{t('resolve.label')}</Label>
                  <Input
                    id="resolve-s1"
                    data-testid="resolve-s1-input"
                    placeholder={t('resolve.placeholder')}
                    value={resolveForm.s1}
                    onChange={(e) => setResolveForm({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('resolve', resolveForm)} 
                  disabled={loading || !resolveForm.s1}
                  data-testid="execute-resolve-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  {t('resolve.execute')}
                </Button>
              </div>
            </TabsContent>

            {/* Shares Tab */}
            <TabsContent value="shares" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">{t('shares.title')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('shares.description')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shares-s1">{t('shares.label')}</Label>
                  <Input
                    id="shares-s1"
                    data-testid="shares-s1-input"
                    placeholder={t('shares.placeholder')}
                    value={sharesForm.s1}
                    onChange={(e) => setSharesForm({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('shares', sharesForm)} 
                  disabled={loading || !sharesForm.s1}
                  data-testid="execute-shares-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  {t('shares.execute')}
                </Button>
              </div>
            </TabsContent>

            {/* Exec Tab */}
            <TabsContent value="exec" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">{t('exec.title')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('exec.description')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-connStr">{t('exec.connectionLabel')}</Label>
                  <Select
                    value={execForm.connStr}
                    onValueChange={(value) => setExecForm({ ...execForm, connStr: value })}
                  >
                    <SelectTrigger data-testid="exec-connection-select">
                      <SelectValue placeholder={t('exec.connectionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {dbConnections.length === 0 ? (
                        <SelectItem value="_none" disabled>
                          {t('exec.noConnection')}
                        </SelectItem>
                      ) : (
                        dbConnections.map((conn) => (
                          <SelectItem key={conn.id} value={conn.connection_string}>
                            {conn.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-query">{t('exec.queryLabel')}</Label>
                  <Textarea
                    id="exec-query"
                    data-testid="exec-query-input"
                    placeholder={t('exec.queryPlaceholder')}
                    value={execForm.query}
                    onChange={(e) => setExecForm({ ...execForm, query: e.target.value })}
                    rows={4}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('exec', execForm)} 
                  disabled={loading || !execForm.connStr || !execForm.query}
                  data-testid="execute-exec-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  {t('exec.execute')}
                </Button>
              </div>
            </TabsContent>

            {/* Exec4 Tab */}
            <TabsContent value="exec4" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">{t('exec4.title')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('exec4.description')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec4-s1">{t('exec4.label')}</Label>
                  <Input
                    id="exec4-s1"
                    data-testid="exec4-s1-input"
                    placeholder={t('exec4.placeholder')}
                    value={exec4Form.s1}
                    onChange={(e) => setExec4Form({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('exec4', exec4Form)} 
                  disabled={loading || !exec4Form.s1}
                  data-testid="execute-exec4-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  {t('exec4.execute')}
                </Button>
              </div>
            </TabsContent>

            {/* Exec5 Tab */}
            <TabsContent value="exec5" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">{t('exec5.title')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('exec5.description')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec5-s1">{t('exec5.label')}</Label>
                  <Input
                    id="exec5-s1"
                    data-testid="exec5-s1-input"
                    placeholder={t('exec5.placeholder')}
                    value={exec5Form.s1}
                    onChange={(e) => setExec5Form({ s1: e.target.value })}
                  />
                </div>
                <Button 
                  onClick={() => handleOperation('exec5', exec5Form)} 
                  disabled={loading || !exec5Form.s1}
                  data-testid="execute-exec5-btn"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  {t('exec5.execute')}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Result Card */}
      {result && (
        <Card data-testid="soap-result-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{t('result.title')}</span>
              <div className="flex items-center gap-2">
                {result.success && result.fromCache && (
                  <span className="text-sm font-normal text-muted-foreground bg-muted px-3 py-1 rounded-full">
                    {t('result.fromCache')}
                  </span>
                )}
                {result.success && (
                  <Button variant="ghost" size="sm" onClick={copyResult}>
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.success ? (
              <ScrollArea className="h-[400px] w-full rounded-md border">
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap break-all" data-testid="soap-result-output">
                  {formatXml(result.data)}
                </pre>
              </ScrollArea>
            ) : (
              <div className="p-4 bg-destructive/10 text-destructive rounded-lg" data-testid="soap-error-output">
                <strong>{t('result.errorLabel')}</strong> {result.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SoapOperations;