import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash2, Plus, ChevronUp, Pencil, X, Check, Hash, Ticket, KeyRound, CheckCircle, XCircle, Loader2, Key, Ghost, Fingerprint, Server, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ShieldKeyIcon } from '@/components/icons';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CREDENTIAL_TYPES = {
  user_password: { label: 'Usuário e Senha/NTLM', icon: ShieldKeyIcon, color: 'text-blue-500' },
  kerberos: { label: 'Kerberos (ccache)', icon: Fingerprint, color: 'text-rose-500' },
  token: { label: 'Token', icon: Ticket, color: 'text-green-500' },
  ssh_key: { label: 'Chave SSH', icon: KeyRound, color: 'text-purple-500' },
  anonymous: { label: 'Anônima', icon: Ghost, color: 'text-amber-500' }
};

const Credentials = () => {
  const { t } = useTranslation('credentials');
  const [credentials, setCredentials] = useState([]);
  const [activeTab, setActiveTab] = useState('user_password');
  const [formData, setFormData] = useState({
    name: '',
    credential_type: 'user_password',
    domain: '',
    username: '',
    password: '',
    ntlm_hash: '',
    kerberos_ccache: '',
    kdc_host: '',
    token: '',
    token_type: 'bearer',
    ssh_private_key: '',
    ssh_passphrase: '',
    ssh_public_key: ''
  });
  const [ccacheFileName, setCcacheFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const response = await axios.get(`${API}/credentials`);
      setCredentials(response.data);
    } catch (error) {
      console.error('Error loading credentials:', error);
      // Não mostrar toast - a barra de conexão já informa
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      credential_type: activeTab,
      domain: '',
      username: '',
      password: '',
      ntlm_hash: '',
      kerberos_ccache: '',
      kdc_host: '',
      token: '',
      token_type: 'bearer',
      ssh_private_key: '',
      ssh_passphrase: '',
      ssh_public_key: ''
    });
    setCcacheFileName('');
  };

  // Lê um arquivo ccache e devolve o conteúdo em base64 (sem o prefixo data:)
  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const base64 = String(result).split(',').pop();
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleCcacheFile = async (e, setter) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsBase64(file);
      setter(base64);
      setCcacheFileName(file.name);
    } catch (err) {
      console.error('Error reading ccache file:', err);
      toast.error(t('toast.ccacheReadError'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const payload = {
        ...formData,
        credential_type: activeTab
      };
      
      // Clean up null values
      Object.keys(payload).forEach(key => {
        if (payload[key] === '') payload[key] = null;
      });
      
      await axios.post(`${API}/credentials`, payload);
      toast.success(t('toast.created'));
      resetForm();
      setShowAddForm(false);
      loadCredentials();
    } catch (error) {
      console.error('Error creating credential:', error);
      const errorMsg = error.response?.data?.detail || t('toast.createError');
      toast.error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/credentials/${id}`);
      toast.success(t('toast.removed'));
      loadCredentials();
    } catch (error) {
      console.error('Error deleting credential:', error);
      toast.error(t('toast.removeError'));
    }
  };

  const startEdit = (cred) => {
    setEditingId(cred.id);
    setEditData({ ...cred });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    try {
      const payload = { ...editData };
      Object.keys(payload).forEach(key => {
        if (payload[key] === '') payload[key] = null;
      });
      
      await axios.put(`${API}/credentials/${id}`, payload);
      toast.success(t('toast.updated'));
      setEditingId(null);
      setEditData({});
      loadCredentials();
    } catch (error) {
      console.error('Error updating credential:', error);
      const errorMsg = error.response?.data?.detail || t('toast.updateError');
      toast.error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }
  };

  const getCredentialsByType = (type) => {
    return credentials.filter(c => (c.credential_type || 'user_password') === type);
  };

  const getTypeInfo = (type) => CREDENTIAL_TYPES[type] || CREDENTIAL_TYPES.user_password;

  const renderCredentialDisplay = (cred) => {
    const type = cred.credential_type || 'user_password';
    const TypeIcon = getTypeInfo(type).icon;
    
    if (type === 'user_password') {
      return (
        <div className="flex-1 grid grid-cols-5 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.domain')}</div>
            <div className="font-medium">{cred.domain || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.username')}</div>
            <div className="font-medium">{cred.username}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.auth')}</div>
            <div className="flex items-center gap-2">
              {cred.password && (
                <Badge variant="outline" className="gap-1">
                  <Key className="w-3 h-3" />
                  {t('common:fields.password')}
                </Badge>
              )}
              {cred.ntlm_hash && (
                <Badge variant="secondary" className="gap-1">
                  <Hash className="w-3 h-3" />
                  NTLM
                </Badge>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.status')}</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                {t('display.verified')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                {t('display.notVerified')}
              </Badge>
            )}
          </div>
        </div>
      );
    } else if (type === 'kerberos') {
      return (
        <div className="flex-1 grid grid-cols-5 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.domain')}</div>
            <div className="font-medium">{cred.domain || t('display.fromCcache')}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.username')}</div>
            <div className="font-medium">{cred.username || t('display.fromCcache')}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.auth')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Fingerprint className="w-3 h-3" />
                ccache
              </Badge>
              {cred.kdc_host && (
                <Badge variant="secondary" className="gap-1">
                  <Server className="w-3 h-3" />
                  {cred.kdc_host}
                </Badge>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.ticketValidity')}</div>
            {cred.kerberos_expired === true ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t('display.expired')}
              </Badge>
            ) : cred.kerberos_expires_at ? (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />
                {new Date(cred.kerberos_expires_at).toLocaleString()}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.status')}</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                {t('display.verified')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                {t('display.notVerified')}
              </Badge>
            )}
          </div>
        </div>
      );
    } else if (type === 'token') {
      return (
        <div className="flex-1 grid grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.tokenType')}</div>
            <div className="font-medium">{cred.token_type || 'bearer'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.token')}</div>
            <div className="font-mono text-sm">{cred.token ? `${cred.token.substring(0, 20)}...` : '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.status')}</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                {t('display.verified')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                {t('display.notVerified')}
              </Badge>
            )}
          </div>
        </div>
      );
    } else if (type === 'anonymous') {
      return (
        <div className="flex-1 grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.auth')}</div>
            <Badge variant="outline" className="gap-1">
              <Ghost className="w-3 h-3" />
              {t('display.anonymousBadge')}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.status')}</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                {t('display.verified')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                {t('display.notVerified')}
              </Badge>
            )}
          </div>
        </div>
      );
    } else if (type === 'ssh_key') {
      return (
        <div className="flex-1 grid grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
            <div className="font-medium">{cred.name || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.privateKey')}</div>
            <div className="font-mono text-sm">{cred.ssh_private_key ? '********' : '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('display.passphrase')}</div>
            <div className="font-mono text-sm">{cred.ssh_passphrase ? '••••••••' : t('display.noPassphrase')}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('common:fields.status')}</div>
            {cred.verified ? (
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle className="w-3 h-3" />
                {t('display.verified')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" />
                {t('display.notVerified')}
              </Badge>
            )}
          </div>
        </div>
      );
    }
  };

  return (
    <div className="space-y-6" data-testid="credentials-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
        </div>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          data-testid="toggle-add-form-btn"
          variant={showAddForm ? "secondary" : "default"}
        >
          {showAddForm ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              {t('common:actions.close')}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              {t('addButton')}
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('form.cardTitle')}</CardTitle>
            <CardDescription>{t('form.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5 mb-6">
                <TabsTrigger value="user_password" className="gap-2">
                  <Key className="w-4 h-4" />
                  {t('tabs.user_password')}
                </TabsTrigger>
                <TabsTrigger value="kerberos" className="gap-2">
                  <Fingerprint className="w-4 h-4" />
                  {t('tabs.kerberos')}
                </TabsTrigger>
                <TabsTrigger value="token" className="gap-2">
                  <Ticket className="w-4 h-4" />
                  {t('tabs.token')}
                </TabsTrigger>
                <TabsTrigger value="ssh_key" className="gap-2">
                  <KeyRound className="w-4 h-4" />
                  {t('tabs.ssh_key')}
                </TabsTrigger>
                <TabsTrigger value="anonymous" className="gap-2">
                  <Ghost className="w-4 h-4" />
                  {t('tabs.anonymous')}
                </TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit}>
                {/* Name field - common to all types */}
                <div className="space-y-2 mb-4">
                  <Label htmlFor="name">{t('form.nameLabel')}</Label>
                  <Input
                    id="name"
                    data-testid="credential-name-input"
                    placeholder={t('form.namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <TabsContent value="user_password" className="space-y-4 mt-0">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="domain">{t('common:fields.domain')}</Label>
                      <Input
                        id="domain"
                        data-testid="credential-domain-input"
                        placeholder={t('form.userPassword.domainPlaceholder')}
                        value={formData.domain}
                        onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="username">{t('form.userPassword.usernameLabel')}</Label>
                      <Input
                        id="username"
                        data-testid="credential-username-input"
                        placeholder={t('form.userPassword.usernamePlaceholder')}
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        required={activeTab === 'user_password'}
                      />
                    </div>
                  </div>
                  
                  <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border">
                    <div className="space-y-2">
                      <Label htmlFor="password" className="flex items-center gap-2">
                        <Key className="w-4 h-4" />
                        {t('common:fields.password')}
                      </Label>
                      <Input
                        id="password"
                        data-testid="credential-password-input"
                        type="password"
                        placeholder="••••••••"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ntlm_hash" className="flex items-center gap-2">
                        <Hash className="w-4 h-4" />
                        {t('form.userPassword.ntlmLabel')}
                      </Label>
                      <Input
                        id="ntlm_hash"
                        data-testid="credential-ntlm-input"
                        placeholder={t('form.userPassword.ntlmPlaceholder')}
                        value={formData.ntlm_hash}
                        onChange={(e) => setFormData({ ...formData, ntlm_hash: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">{t('form.userPassword.ntlmHelp')}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                    <span className="text-yellow-500">⚠</span>
                    <span>{t('form.userPassword.warning')}</span>
                  </div>
                </TabsContent>

                <TabsContent value="kerberos" className="space-y-4 mt-0">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="krb-domain">{t('form.kerberos.domainLabel')}</Label>
                      <Input
                        id="krb-domain"
                        data-testid="credential-kerberos-domain-input"
                        placeholder={t('form.kerberos.domainPlaceholder')}
                        value={formData.domain}
                        onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="krb-username">{t('form.kerberos.usernameLabel')}</Label>
                      <Input
                        id="krb-username"
                        data-testid="credential-kerberos-username-input"
                        placeholder={t('form.kerberos.usernamePlaceholder')}
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="krb-kdc">{t('form.kerberos.kdcLabel')}</Label>
                    <Input
                      id="krb-kdc"
                      data-testid="credential-kerberos-kdc-input"
                      placeholder={t('form.kerberos.kdcPlaceholder')}
                      value={formData.kdc_host}
                      onChange={(e) => setFormData({ ...formData, kdc_host: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border">
                    <Label htmlFor="krb-ccache-file" className="flex items-center gap-2">
                      <Fingerprint className="w-4 h-4" />
                      {t('form.kerberos.ccacheFileLabel')}
                    </Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="krb-ccache-file"
                        data-testid="credential-kerberos-ccache-file"
                        type="file"
                        accept=".ccache,application/octet-stream,*/*"
                        onChange={(e) => handleCcacheFile(e, (b64) => setFormData({ ...formData, kerberos_ccache: b64 }))}
                        className="cursor-pointer"
                      />
                      {formData.kerberos_ccache && (
                        <Badge variant="secondary" className="gap-1 shrink-0">
                          <Check className="w-3 h-3" />
                          {ccacheFileName || t('form.kerberos.ccacheLoaded')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('form.kerberos.ccacheHelpA')}{' '}
                      <span className="font-mono">KRB5CCNAME</span>{t('form.kerberos.ccacheHelpB')}{' '}
                      <span className="font-mono">getTGT.py</span>{t('form.kerberos.ccacheHelpC')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="krb-ccache-b64">{t('form.kerberos.ccacheBase64Label')}</Label>
                    <Textarea
                      id="krb-ccache-b64"
                      data-testid="credential-kerberos-ccache-input"
                      placeholder={t('form.kerberos.ccacheBase64Placeholder')}
                      value={formData.kerberos_ccache}
                      onChange={(e) => { setFormData({ ...formData, kerberos_ccache: e.target.value }); setCcacheFileName(''); }}
                      className="font-mono text-xs"
                      rows={4}
                    />
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                    <span className="text-yellow-500">⚠</span>
                    <span>{t('form.kerberos.warning')}</span>
                  </div>
                </TabsContent>

                <TabsContent value="token" className="space-y-4 mt-0">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="token_type">{t('form.token.typeLabel')}</Label>
                      <Select 
                        value={formData.token_type} 
                        onValueChange={(value) => setFormData({ ...formData, token_type: value })}
                      >
                        <SelectTrigger data-testid="token-type-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bearer">Bearer Token</SelectItem>
                          <SelectItem value="api_key">API Key</SelectItem>
                          <SelectItem value="basic">Basic Auth</SelectItem>
                          <SelectItem value="oauth">OAuth Token</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="token">{t('form.token.label')}</Label>
                    <Textarea
                      id="token"
                      data-testid="credential-token-input"
                      placeholder={t('form.token.placeholder')}
                      value={formData.token}
                      onChange={(e) => setFormData({ ...formData, token: e.target.value })}
                      className="font-mono text-sm"
                      rows={3}
                      required={activeTab === 'token'}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="ssh_key" className="space-y-4 mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="ssh_private_key">{t('form.ssh.privateLabel')}</Label>
                    <Textarea
                      id="ssh_private_key"
                      data-testid="credential-ssh-private-input"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      value={formData.ssh_private_key}
                      onChange={(e) => setFormData({ ...formData, ssh_private_key: e.target.value })}
                      className="font-mono text-sm"
                      rows={6}
                      required={activeTab === 'ssh_key'}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ssh_passphrase">{t('form.ssh.passphraseLabel')}</Label>
                      <Input
                        id="ssh_passphrase"
                        data-testid="credential-ssh-passphrase-input"
                        type="password"
                        placeholder="••••••••"
                        value={formData.ssh_passphrase}
                        onChange={(e) => setFormData({ ...formData, ssh_passphrase: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ssh_public_key">{t('form.ssh.publicLabel')}</Label>
                    <Textarea
                      id="ssh_public_key"
                      data-testid="credential-ssh-public-input"
                      placeholder="ssh-rsa AAAA..."
                      value={formData.ssh_public_key}
                      onChange={(e) => setFormData({ ...formData, ssh_public_key: e.target.value })}
                      className="font-mono text-sm"
                      rows={3}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="anonymous" className="space-y-4 mt-0">
                  <div className="flex items-start gap-3 text-sm text-muted-foreground bg-muted/50 p-4 rounded-lg">
                    <Ghost className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{t('form.anonymous.title')}</p>
                      <p>
                        {t('form.anonymous.description')}
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <Button type="submit" disabled={loading} className="mt-4" data-testid="add-credential-btn">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  {t('form.submit')}
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* List Cards by Type */}
      <div className="space-y-10 mt-8">
        {Object.entries(CREDENTIAL_TYPES).map(([type, info]) => {
          const TypeIcon = info.icon;
          const typeCreds = getCredentialsByType(type);
          
          return (
            <Card key={type} className="mt-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TypeIcon className={`w-5 h-5 ${info.color}`} />
                  {t('types.' + type)}
                </CardTitle>
                <CardDescription>{t('list.count', { n: typeCreds.length })}</CardDescription>
              </CardHeader>
              <CardContent>
                {typeCreds.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">{t('list.empty')}</p>
                ) : (
                  <div className="space-y-3">
                    {typeCreds.map((cred) => (
                      <div
                        key={cred.id}
                        data-testid={`credential-item-${cred.id}`}
                        className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        {editingId === cred.id ? (
                          // Edit mode - simplified for now
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <Input
                                value={editData.name || ''}
                                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                                placeholder={t('common:fields.name')}
                              />
                              {type === 'user_password' && (
                                <>
                                  <Input
                                    value={editData.domain || ''}
                                    onChange={(e) => setEditData({ ...editData, domain: e.target.value })}
                                    placeholder={t('common:fields.domain')}
                                  />
                                  <Input
                                    value={editData.username || ''}
                                    onChange={(e) => setEditData({ ...editData, username: e.target.value })}
                                    placeholder={t('common:fields.username')}
                                  />
                                  <Input
                                    type="password"
                                    value={editData.password || ''}
                                    onChange={(e) => setEditData({ ...editData, password: e.target.value })}
                                    placeholder={t('edit.newPassword')}
                                  />
                                  <Input
                                    value={editData.ntlm_hash || ''}
                                    onChange={(e) => setEditData({ ...editData, ntlm_hash: e.target.value })}
                                    placeholder={t('edit.ntlmPlaceholder')}
                                    className="col-span-2 font-mono text-sm"
                                  />
                                </>
                              )}
                              {type === 'kerberos' && (
                                <>
                                  <Input
                                    value={editData.domain || ''}
                                    onChange={(e) => setEditData({ ...editData, domain: e.target.value })}
                                    placeholder={t('edit.domainOptional')}
                                  />
                                  <Input
                                    value={editData.username || ''}
                                    onChange={(e) => setEditData({ ...editData, username: e.target.value })}
                                    placeholder={t('edit.usernameOptional')}
                                  />
                                  <Input
                                    value={editData.kdc_host || ''}
                                    onChange={(e) => setEditData({ ...editData, kdc_host: e.target.value })}
                                    placeholder={t('edit.kdcPlaceholder')}
                                    className="col-span-2"
                                  />
                                  <div className="col-span-2 space-y-1">
                                    <Input
                                      type="file"
                                      accept=".ccache,application/octet-stream,*/*"
                                      onChange={(e) => handleCcacheFile(e, (b64) => setEditData({ ...editData, kerberos_ccache: b64 }))}
                                      className="cursor-pointer"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      {t('edit.ccacheReplaceHelp')}
                                    </p>
                                  </div>
                                  <Textarea
                                    value={editData.kerberos_ccache || ''}
                                    onChange={(e) => setEditData({ ...editData, kerberos_ccache: e.target.value })}
                                    placeholder={t('edit.ccacheBase64Placeholder')}
                                    className="col-span-2 font-mono text-xs"
                                    rows={4}
                                  />
                                </>
                              )}
                              {type === 'token' && (
                                <Textarea
                                  value={editData.token || ''}
                                  onChange={(e) => setEditData({ ...editData, token: e.target.value })}
                                  placeholder={t('display.token')}
                                  className="col-span-2"
                                />
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" size="sm" onClick={() => saveEdit(cred.id)}>
                                <Check className="w-4 h-4 mr-1" /> {t('common:actions.save')}
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
                                <X className="w-4 h-4 mr-1" /> {t('common:actions.cancel')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {renderCredentialDisplay(cred)}
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => startEdit(cred)}
                                data-testid={`edit-credential-${cred.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(cred.id)}
                                data-testid={`delete-credential-${cred.id}`}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Credentials;
