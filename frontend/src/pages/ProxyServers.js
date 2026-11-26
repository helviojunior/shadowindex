import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, ChevronUp, Globe, Shield, Pencil, X, Check, User, Ban, Network } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CredentialKeyIcon } from '@/components/icons/ShieldKeyIcon';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ProxyServers = () => {
  const { t } = useTranslation('proxy-servers');
  const [proxies, setProxies] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    port: '',
    proxy_type: 'http',
    credential_id: 'none',
    dns_servers: ''
  });
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    loadProxies();
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const response = await axios.get(`${API}/credentials`);
      // Filtrar apenas credenciais do tipo user_password
      const userPassCredentials = response.data.filter(c => c.credential_type === 'user_password');
      setCredentials(userPassCredentials);
    } catch (error) {
      console.error('Error loading credentials:', error);
    }
  };

  const loadProxies = async () => {
    try {
      const response = await axios.get(`${API}/proxy-servers`);
      setProxies(response.data);
    } catch (error) {
      console.error('Error loading proxies:', error);
      toast.error(t('toast.loadError'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        ip: formData.ip,
        port: parseInt(formData.port),
        proxy_type: formData.proxy_type,
        credential_id: formData.credential_id !== 'none' ? parseInt(formData.credential_id) : null,
        dns_servers: formData.dns_servers.trim() || null
      };

      await axios.post(`${API}/proxy-servers`, payload);
      toast.success(t('toast.created'));
      setFormData({ name: '', ip: '', port: '', proxy_type: 'http', credential_id: 'none', dns_servers: '' });
      setShowAddForm(false);
      loadProxies();
    } catch (error) {
      console.error('Error creating proxy:', error);
      toast.error(error.response?.data?.detail || t('toast.createError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/proxy-servers/${id}`);
      toast.success(t('toast.removed'));
      loadProxies();
    } catch (error) {
      console.error('Error deleting proxy:', error);
      toast.error(t('toast.removeError'));
    }
  };

  const startEdit = (proxy) => {
    setEditingId(proxy.id);
    setEditData({
      name: proxy.name,
      ip: proxy.ip,
      port: proxy.port.toString(),
      proxy_type: proxy.proxy_type || 'http',
      credential_id: proxy.credential_id ? proxy.credential_id.toString() : 'none',
      dns_servers: proxy.dns_servers || ''
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    try {
      const payload = {
        name: editData.name,
        ip: editData.ip,
        port: parseInt(editData.port),
        proxy_type: editData.proxy_type,
        credential_id: editData.credential_id !== 'none' ? parseInt(editData.credential_id) : null,
        dns_servers: (editData.dns_servers || '').trim() || null
      };

      await axios.put(`${API}/proxy-servers/${id}`, payload);
      toast.success(t('toast.updated'));
      setEditingId(null);
      setEditData({});
      loadProxies();
    } catch (error) {
      console.error('Error updating proxy:', error);
      toast.error(error.response?.data?.detail || t('toast.updateError'));
    }
  };

  const getProxyTypeLabel = (type) => {
    return type === 'socks5' ? 'SOCKS5' : 'HTTP';
  };

  const getProxyTypeIcon = (type) => {
    return type === 'socks5' ? <Shield className="w-4 h-4" /> : <Globe className="w-4 h-4" />;
  };

  const getCredentialName = (credentialId) => {
    if (!credentialId) return null;
    const cred = credentials.find(c => c.id === credentialId);
    if (!cred) return `ID: ${credentialId}`;
    return cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`;
  };

  return (
    <div className="space-y-6" data-testid="proxy-servers-page">
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
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-5">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('form.nameLabel')}</Label>
                  <Input
                    id="name"
                    data-testid="proxy-name-input"
                    placeholder={t('form.namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proxy_type">{t('form.typeLabel')}</Label>
                  <Select 
                    value={formData.proxy_type} 
                    onValueChange={(value) => setFormData({ ...formData, proxy_type: value })}
                  >
                    <SelectTrigger data-testid="proxy-type-select">
                      <SelectValue placeholder={t('form.typePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4" />
                          HTTP
                        </div>
                      </SelectItem>
                      <SelectItem value="socks5">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          SOCKS5
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ip">{t('form.ipLabel')}</Label>
                  <Input
                    id="ip"
                    data-testid="proxy-ip-input"
                    placeholder={t('form.ipPlaceholder')}
                    value={formData.ip}
                    onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">{t('form.portLabel')}</Label>
                  <Input
                    id="port"
                    data-testid="proxy-port-input"
                    type="number"
                    placeholder={t('form.portPlaceholder')}
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="credential_id">{t('form.authLabel')}</Label>
                  <Select 
                    value={formData.credential_id} 
                    onValueChange={(value) => setFormData({ ...formData, credential_id: value })}
                  >
                    <SelectTrigger data-testid="proxy-credential-select">
                      <SelectValue placeholder={t('form.authPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <div className="flex items-center gap-2">
                          <Ban className="w-4 h-4 text-muted-foreground" />
                          {t('form.noAuth')}
                        </div>
                      </SelectItem>
                      {credentials.map((cred) => (
                        <SelectItem key={cred.id} value={cred.id.toString()}>
                          <div className="flex items-center gap-2">
                            <CredentialKeyIcon className="w-4 h-4 text-primary" />
                            {cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dns_servers">{t('form.dnsLabel')}</Label>
                <Input
                  id="dns_servers"
                  data-testid="proxy-dns-servers-input"
                  placeholder={t('form.dnsPlaceholder')}
                  value={formData.dns_servers}
                  onChange={(e) => setFormData({ ...formData, dns_servers: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t('form.dnsHelp')}
                </p>
              </div>

              <Button type="submit" disabled={loading} data-testid="add-proxy-btn">
                <Plus className="w-4 h-4 mr-2" />
                {t('form.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.cardTitle')}</CardTitle>
          <CardDescription>{t('list.count', { n: proxies.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {proxies.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('list.empty')}</p>
          ) : (
            <div className="space-y-3">
              {proxies.map((proxy) => (
                <div
                  key={proxy.id}
                  data-testid={`proxy-item-${proxy.id}`}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {editingId === proxy.id ? (
                    // Edit mode
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-5 gap-3">
                        <Input
                          value={editData.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          placeholder={t('edit.namePlaceholder')}
                          data-testid={`edit-name-${proxy.id}`}
                        />
                        <Select 
                          value={editData.proxy_type} 
                          onValueChange={(value) => setEditData({ ...editData, proxy_type: value })}
                        >
                          <SelectTrigger data-testid={`edit-type-${proxy.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="http">HTTP</SelectItem>
                            <SelectItem value="socks5">SOCKS5</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={editData.ip}
                          onChange={(e) => setEditData({ ...editData, ip: e.target.value })}
                          placeholder={t('edit.ipPlaceholder')}
                          data-testid={`edit-ip-${proxy.id}`}
                        />
                        <Input
                          type="number"
                          value={editData.port}
                          onChange={(e) => setEditData({ ...editData, port: e.target.value })}
                          placeholder={t('edit.portPlaceholder')}
                          data-testid={`edit-port-${proxy.id}`}
                        />
                        <Select 
                          value={editData.credential_id} 
                          onValueChange={(value) => setEditData({ ...editData, credential_id: value })}
                        >
                          <SelectTrigger data-testid={`edit-credential-${proxy.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('edit.noAuth')}</SelectItem>
                            {credentials.map((cred) => (
                              <SelectItem key={cred.id} value={cred.id.toString()}>
                                {cred.name || `${cred.domain ? cred.domain + '\\' : ''}${cred.username}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        value={editData.dns_servers || ''}
                        onChange={(e) => setEditData({ ...editData, dns_servers: e.target.value })}
                        placeholder={t('edit.dnsPlaceholder')}
                        data-testid={`edit-dns-servers-${proxy.id}`}
                      />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => saveEdit(proxy.id)} data-testid={`save-edit-${proxy.id}`}>
                          <Check className="w-4 h-4 mr-1" /> {t('common:actions.save')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} data-testid={`cancel-edit-${proxy.id}`}>
                          <X className="w-4 h-4 mr-1" /> {t('common:actions.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <>
                      <div className="flex-1 grid grid-cols-5 gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
                          <div className="font-medium">{proxy.name}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('display.type')}</div>
                          <div className="font-medium flex items-center gap-2">
                            {getProxyTypeIcon(proxy.proxy_type || 'http')}
                            {getProxyTypeLabel(proxy.proxy_type || 'http')}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('display.address')}</div>
                          <div className="font-medium">{proxy.ip}:{proxy.port}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('display.auth')}</div>
                          <div className="font-medium">
                            {proxy.credential_id ? (
                              <span className="text-green-500 flex items-center gap-2">
                                <CredentialKeyIcon className="w-4 h-4" />
                                {getCredentialName(proxy.credential_id)}
                              </span>
                            ) : proxy.username ? (
                              <span className="text-yellow-500 flex items-center gap-2">
                                <User className="w-4 h-4" />
                                {t('display.legacy', { username: proxy.username })}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{t('display.noAuth')}</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('display.dns')}</div>
                          <div className="font-medium">
                            {proxy.dns_servers ? (
                              <span className="flex items-center gap-2" title={proxy.dns_servers}>
                                <Network className="w-4 h-4 text-primary shrink-0" />
                                <span className="truncate">{proxy.dns_servers}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{t('display.noDns')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEdit(proxy)}
                          data-testid={`edit-proxy-${proxy.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(proxy.id)}
                          data-testid={`delete-proxy-${proxy.id}`}
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
    </div>
  );
};

export default ProxyServers;
