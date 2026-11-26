import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, CheckCircle, XCircle, RefreshCw, Plus, Trash2, ChevronUp,
  Settings, Plug, Server, Star, StarOff, Power, PowerOff, Pencil, X, Check,
  Network, AlertCircle, Wifi, WifiOff
} from 'lucide-react';
import { toast } from 'sonner';
import { ShieldKeyIcon } from '@/components/icons';
import { useTranslation } from 'react-i18next';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PluginDirectConfig = () => {
  const { t } = useTranslation('plugin-direct');
  const [pluginInfo, setPluginInfo] = useState(null);
  const [instances, setInstances] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('instances');
  
  // Instance form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    config: { credential_id: null },
    is_default: false,
    proxy_id: null
  });
  
  // Edit states
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  
  // Health check states
  const [healthStatus, setHealthStatus] = useState({});
  const [checkingHealth, setCheckingHealth] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pluginRes, instancesRes, credRes, kerberosCredRes, anonCredRes, proxiesRes] = await Promise.all([
        axios.get(`${API}/plugins/direct_interaction`),
        axios.get(`${API}/plugin-instances?plugin_type=direct_interaction`),
        axios.get(`${API}/credentials/by-type/user_password`),
        axios.get(`${API}/credentials/by-type/kerberos`),
        axios.get(`${API}/credentials/by-type/anonymous`),
        axios.get(`${API}/proxy-servers`)
      ]);
      setPluginInfo(pluginRes.data);
      setInstances(instancesRes.data);
      // SMB aceita credenciais usuário/senha, Kerberos (ccache) e anônimas (null session)
      setCredentials([...credRes.data, ...kerberosCredRes.data, ...anonCredRes.data]);
      setProxies(proxiesRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error(t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const getProxyName = (proxyId) => {
    if (!proxyId) return t('instance.noProxy');
    const proxy = proxies.find(p => p.id === proxyId);
    if (!proxy) return `ID: ${proxyId}`;
    return `${proxy.name} (${proxy.ip}:${proxy.port})`;
  };

  const getCredentialLabel = (cred) => {
    if (cred.name) return cred.name;
    if (cred.credential_type === 'anonymous') return t('credential.anonymous');
    if (cred.credential_type === 'kerberos') {
      const who = `${cred.domain ? cred.domain + '\\' : ''}${cred.username || ''}`.trim();
      return who ? t('credential.kerberos', { who }) : t('credential.kerberosCcache');
    }
    return `${cred.domain ? cred.domain + '\\' : ''}${cred.username || ''}`;
  };

  const getCredentialName = (credId) => {
    if (!credId) return t('instance.noCredential');
    const cred = credentials.find(c => c.id === credId);
    if (!cred) return `ID: ${credId}`;
    return getCredentialLabel(cred);
  };

  // Instance CRUD
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const payload = {
        ...formData,
        plugin_type: 'direct_interaction',
        config: formData.config || {},
        proxy_id: formData.proxy_id || null
      };

      await axios.post(`${API}/plugin-instances`, payload);
      toast.success(t('toast.created'));
      setFormData({ name: '', description: '', config: { credential_id: null }, is_default: false, proxy_id: null });
      setShowAddForm(false);
      loadData();
    } catch (error) {
      console.error('Error creating instance:', error);
      toast.error(error.response?.data?.detail || t('toast.createError'));
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('confirm.delete'))) return;
    
    try {
      await axios.delete(`${API}/plugin-instances/${id}`);
      toast.success(t('toast.deleted'));
      loadData();
    } catch (error) {
      console.error('Error deleting instance:', error);
      toast.error(error.response?.data?.detail || t('toast.deleteError'));
    }
  };

  const startEdit = (instance) => {
    setEditingId(instance.id);
    setEditData({
      name: instance.name,
      description: instance.description || '',
      config: instance.config || { credential_id: null },
      is_default: instance.is_default,
      is_active: instance.is_active,
      proxy_id: instance.proxy_id
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    try {
      await axios.put(`${API}/plugin-instances/${id}`, editData);
      toast.success(t('toast.updated'));
      setEditingId(null);
      setEditData({});
      loadData();
    } catch (error) {
      console.error('Error updating instance:', error);
      toast.error(t('toast.updateError'));
    }
  };

  const checkHealth = async (id) => {
    setCheckingHealth(prev => ({ ...prev, [id]: true }));
    try {
      const response = await axios.post(`${API}/plugin-instances/${id}/health`);
      setHealthStatus(prev => ({ ...prev, [id]: response.data }));
      if (response.data.healthy) {
        toast.success(t('toast.healthy'));
      } else {
        toast.error(response.data.message || t('toast.unhealthy'));
      }
    } catch (error) {
      console.error('Error checking health:', error);
      setHealthStatus(prev => ({ ...prev, [id]: { healthy: false, message: t('toast.verifyError') } }));
      toast.error(t('toast.healthCheckError'));
    } finally {
      setCheckingHealth(prev => ({ ...prev, [id]: false }));
    }
  };

  const toggleDefault = async (instance) => {
    try {
      await axios.put(`${API}/plugin-instances/${instance.id}`, { is_default: !instance.is_default });
      toast.success(instance.is_default ? t('toast.defaultRemoved') : t('toast.defaultSet'));
      loadData();
    } catch (error) {
      console.error('Error toggling default:', error);
      toast.error(t('toast.statusError'));
    }
  };

  const toggleActive = async (instance) => {
    try {
      await axios.put(`${API}/plugin-instances/${instance.id}`, { is_active: !instance.is_active });
      toast.success(instance.is_active ? t('toast.deactivated') : t('toast.activated'));
      loadData();
    } catch (error) {
      console.error('Error toggling active:', error);
      toast.error(t('toast.statusError'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="plugin-direct-config-page">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
              <Server className="w-6 h-6" />
              {t('header.title')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{t('header.subtitle')}</p>
          </div>
          {activeTab === 'instances' && (
            <Button 
              onClick={() => setShowAddForm(!showAddForm)} 
              data-testid="toggle-add-instance-btn"
              variant={showAddForm ? "secondary" : "default"}
              size="sm"
            >
              {showAddForm ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-2" />
                  {t('common:actions.close')}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  {t('header.newInstance')}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs - Flat Style */}
      <div className="px-6 pt-4 border-b border-border">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('instances')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'instances' 
                ? 'text-green-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-instances"
          >
            <Plug className="w-4 h-4" />
            {t('tabs.instances')}
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{instances.length}</span>
            {activeTab === 'instances' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('info')}
            className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'info' 
                ? 'text-green-500' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-info"
          >
            <Settings className="w-4 h-4" />
            {t('tabs.info')}
            {activeTab === 'info' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
            )}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {/* Tab: Instâncias */}
          {activeTab === 'instances' && (
            <div className="space-y-6">
              {/* Form para nova instância */}
              {showAddForm && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">{t('form.title')}</CardTitle>
                    <CardDescription>{t('form.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor="name">{t('form.nameLabel')}</Label>
                          <Input
                            id="name"
                            data-testid="instance-name-input"
                            placeholder={t('form.namePlaceholder')}
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <ShieldKeyIcon className="w-4 h-4" />
                            {t('form.credentialLabel')}
                          </Label>
                          <Select
                            value={formData.config?.credential_id?.toString() || 'none'}
                            onValueChange={(value) => setFormData({
                              ...formData,
                              config: {
                                ...formData.config,
                                credential_id: value === 'none' ? null : parseInt(value)
                              }
                            })}
                          >
                            <SelectTrigger data-testid="instance-credential-select">
                              <SelectValue placeholder={t('form.selectCredential')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t('form.noAuth')}</SelectItem>
                              {credentials.map((cred) => (
                                <SelectItem key={cred.id} value={cred.id.toString()}>
                                  {getCredentialLabel(cred)}
                                  {cred.verified && ' ✓'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Wifi className="w-4 h-4" />
                            {t('form.proxyLabel')}
                          </Label>
                          <Select
                            value={formData.proxy_id?.toString() || 'none'}
                            onValueChange={(value) => setFormData({
                              ...formData,
                              proxy_id: value === 'none' ? null : parseInt(value)
                            })}
                          >
                            <SelectTrigger data-testid="instance-proxy-select">
                              <SelectValue placeholder={t('form.selectProxy')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                <span className="flex items-center gap-2">
                                  <WifiOff className="w-3 h-3" />
                                  {t('form.noProxy')}
                                </span>
                              </SelectItem>
                              {proxies.filter(p => p.proxy_type === 'socks5' || p.proxy_type === 'socks4').length > 0 && (
                                proxies.filter(p => p.proxy_type === 'socks5' || p.proxy_type === 'socks4').map((proxy) => (
                                  <SelectItem key={proxy.id} value={proxy.id.toString()}>
                                    <span className="flex items-center gap-2">
                                      <Wifi className="w-3 h-3" />
                                      {proxy.name} ({proxy.proxy_type?.toUpperCase()})
                                    </span>
                                  </SelectItem>
                                ))
                              )}
                              {proxies.filter(p => p.proxy_type !== 'socks5' && p.proxy_type !== 'socks4').map((proxy) => (
                                <SelectItem key={proxy.id} value={proxy.id.toString()} disabled>
                                  <span className="flex items-center gap-2 opacity-50">
                                    <Wifi className="w-3 h-3" />
                                    {proxy.name} ({proxy.proxy_type?.toUpperCase()}) - {t('form.requiresSocks')}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">{t('common:fields.description')}</Label>
                        <Textarea
                          id="description"
                          data-testid="instance-description-input"
                          placeholder={t('form.descriptionPlaceholder')}
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          rows={2}
                        />
                      </div>
                      <Button type="submit" disabled={formLoading} data-testid="create-instance-btn" size="sm">
                        {formLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                        {t('form.createInstance')}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )}

              {/* Lista de Instâncias */}
              {instances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Plug className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{t('empty.title')}</p>
                  <p className="text-sm mt-1">{t('empty.hint')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {instances.map((instance) => {
                    const health = healthStatus[instance.id];
                    const isEditing = editingId === instance.id;
                    
                    return (
                      <div
                        key={instance.id}
                        data-testid={`instance-item-${instance.id}`}
                        className={`p-4 border rounded-lg transition-colors ${
                          instance.is_active ? 'border-border hover:bg-muted/50' : 'border-border/50 bg-muted/30 opacity-60'
                        }`}
                      >
                        {isEditing ? (
                          // Edit mode
                          <div className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                              <div className="space-y-2">
                                <Label>{t('common:fields.name')}</Label>
                                <Input
                                  value={editData.name}
                                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t('form.credentialLabel')}</Label>
                                <Select
                                  value={editData.config?.credential_id?.toString() || 'none'}
                                  onValueChange={(value) => setEditData({
                                    ...editData,
                                    config: {
                                      ...editData.config,
                                      credential_id: value === 'none' ? null : parseInt(value)
                                    }
                                  })}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder={t('form.selectCredential')} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">{t('form.noAuth')}</SelectItem>
                                    {credentials.map((cred) => (
                                      <SelectItem key={cred.id} value={cred.id.toString()}>
                                        {getCredentialLabel(cred)}
                                        {cred.verified && ' ✓'}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label>{t('form.proxyLabel')}</Label>
                                <Select
                                  value={editData.proxy_id?.toString() || 'none'}
                                  onValueChange={(value) => setEditData({
                                    ...editData,
                                    proxy_id: value === 'none' ? null : parseInt(value)
                                  })}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">{t('form.noProxy')}</SelectItem>
                                    {proxies.filter(p => p.proxy_type === 'socks5' || p.proxy_type === 'socks4').map((proxy) => (
                                      <SelectItem key={proxy.id} value={proxy.id.toString()}>
                                        {proxy.name} ({proxy.proxy_type?.toUpperCase()})
                                      </SelectItem>
                                    ))}
                                    {proxies.filter(p => p.proxy_type !== 'socks5' && p.proxy_type !== 'socks4').map((proxy) => (
                                      <SelectItem key={proxy.id} value={proxy.id.toString()} disabled>
                                        {proxy.name} ({proxy.proxy_type?.toUpperCase()}) - {t('form.requiresSocks')}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>{t('common:fields.description')}</Label>
                              <Textarea
                                value={editData.description}
                                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                                rows={2}
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" size="sm" onClick={() => saveEdit(instance.id)}>
                                <Check className="w-4 h-4 mr-1" /> {t('common:actions.save')}
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                                <X className="w-4 h-4 mr-1" /> {t('common:actions.cancel')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // View mode
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium">{instance.name}</span>
                                {instance.is_default && (
                                  <Badge variant="secondary" className="gap-1 text-xs">
                                    <Star className="w-3 h-3" /> {t('badges.default')}
                                  </Badge>
                                )}
                                {!instance.is_active && (
                                  <Badge variant="outline" className="text-muted-foreground text-xs">{t('badges.inactive')}</Badge>
                                )}
                              </div>
                              {instance.description && (
                                <p className="text-sm text-muted-foreground mb-2">{instance.description}</p>
                              )}
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <ShieldKeyIcon className="w-3 h-3" />
                                {t('instance.credential', { name: getCredentialName(instance.config?.credential_id) })}
                              </div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                {instance.proxy_id ? (
                                  <><Wifi className="w-3 h-3" /> {t('instance.proxy', { name: getProxyName(instance.proxy_id) })}</>
                                ) : (
                                  <><WifiOff className="w-3 h-3" /> {t('instance.noProxy')}</>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {/* Health status */}
                              {health && (
                                <Badge variant={health.healthy ? "default" : "destructive"} className="mr-2 text-xs">
                                  {health.healthy ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                                  {health.healthy ? t('health.ok') : t('common:status.error')}
                                </Badge>
                              )}
                              
                              {/* Health check */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => checkHealth(instance.id)}
                                disabled={checkingHealth[instance.id]}
                                title={t('titles.checkHealth')}
                              >
                                {checkingHealth[instance.id] ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4" />
                                )}
                              </Button>
                              
                              {/* Toggle default */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => toggleDefault(instance)}
                                title={instance.is_default ? t('titles.removeDefault') : t('titles.setDefault')}
                              >
                                {instance.is_default ? (
                                  <Star className="w-4 h-4 text-yellow-500" />
                                ) : (
                                  <StarOff className="w-4 h-4" />
                                )}
                              </Button>
                              
                              {/* Toggle active */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => toggleActive(instance)}
                                title={instance.is_active ? t('titles.deactivate') : t('titles.activate')}
                              >
                                {instance.is_active ? (
                                  <Power className="w-4 h-4 text-green-500" />
                                ) : (
                                  <PowerOff className="w-4 h-4" />
                                )}
                              </Button>
                              
                              {/* Edit */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => startEdit(instance)}
                                title={t('common:actions.edit')}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              
                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(instance.id)}
                                title={t('common:actions.delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab: Info */}
          {activeTab === 'info' && (
            <div className="space-y-6">
              {/* Plugin Info Card */}
              {pluginInfo && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Plug className="w-4 h-4" />
                      {t('info.pluginInfo')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
                        <div className="font-medium text-sm">{pluginInfo.name}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">{t('common:fields.type')}</div>
                        <Badge variant="outline" className="text-xs">{pluginInfo.type}</Badge>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">{t('info.version')}</div>
                        <div className="font-medium text-sm">{pluginInfo.version}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">{t('common:fields.description')}</div>
                        <div className="text-sm text-muted-foreground">{pluginInfo.description}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Funcionalidades */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">{t('info.features')}</CardTitle>
                  <CardDescription>{t('info.featuresDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[
                      { name: t('info.feature1Name'), desc: t('info.feature1Desc'), implemented: true },
                      { name: t('info.feature2Name'), desc: t('info.feature2Desc'), implemented: true },
                      { name: t('info.feature3Name'), desc: t('info.feature3Desc'), implemented: true },
                      { name: t('info.feature4Name'), desc: t('info.feature4Desc'), implemented: true },
                      { name: t('info.feature5Name'), desc: t('info.feature5Desc'), implemented: false },
                    ].map((feat, idx) => (
                      <div key={idx} className={`flex items-center justify-between p-3 border border-border rounded-lg ${!feat.implemented ? 'opacity-60' : ''}`}>
                        <div className="flex items-center gap-3">
                          {feat.implemented ? (
                            <Network className="w-4 h-4 text-green-500" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-muted-foreground" />
                          )}
                          <div>
                            <div className="font-medium text-sm">{feat.name}</div>
                            <div className="text-xs text-muted-foreground">{feat.desc}</div>
                          </div>
                        </div>
                        <Badge 
                          variant={feat.implemented ? "default" : "outline"} 
                          className={`text-xs ${feat.implemented ? 'bg-green-500' : ''}`}
                        >
                          {feat.implemented ? t('info.implemented') : t('info.notImplemented')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Config Schema Card */}
              {pluginInfo?.config_schema && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">{t('info.configSchema')}</CardTitle>
                    <CardDescription>{t('info.configSchemaDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(pluginInfo.config_schema.properties || {}).map(([key, prop]) => (
                        <div key={key} className="flex items-start gap-3 p-3 border border-border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium">{key}</span>
                              {pluginInfo.config_schema.required?.includes(key) && (
                                <Badge variant="destructive" className="text-[10px]">{t('info.required')}</Badge>
                              )}
                              <Badge variant="outline" className="text-[10px]">{prop.type}</Badge>
                            </div>
                            {prop.description && (
                              <div className="text-xs text-muted-foreground mt-1">{prop.description}</div>
                            )}
                            {prop.enum && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {t('info.values', { values: prop.enum.join(', ') })}
                              </div>
                            )}
                          </div>
                          {prop.default !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              default: <span className="font-mono">{JSON.stringify(prop.default)}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default PluginDirectConfig;
