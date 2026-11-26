import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, ChevronUp, Pencil, X, Check, Server, Network, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const parseList = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean);
const joinList = (arr) => arr.join(',');

const emptyForm = {
  name: '',
  simultaneous_scanners: '3',
  request_delay_min: '100',
  request_delay_max: '500',
  include_servers: [],
  exclude_servers: [],
  include_ips: [],
  exclude_ips: [],
};

// Validates IPv4 or IPv4/CIDR (no wildcards)
const isValidIpEntry = (value) => {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

  if (cidrRegex.test(value)) {
    const [ip, mask] = value.split('/');
    const maskNum = parseInt(mask);
    if (maskNum < 0 || maskNum > 32) return false;
    return ip.split('.').every(o => { const n = parseInt(o); return n >= 0 && n <= 255; });
  }

  if (ipRegex.test(value)) {
    return value.split('.').every(o => { const n = parseInt(o); return n >= 0 && n <= 255; });
  }

  return false;
};

// Card section for a list field (same pattern as GeneralSettings ignored extensions)
const ListSection = ({ icon: Icon, iconColor, title, description, items, onAdd, onRemove, placeholder, infoItems, testIdPrefix, validateIp }) => {
  const { t } = useTranslation('scan-pools');
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    const val = inputValue.trim();
    if (!val) return;
    if (validateIp && !isValidIpEntry(val)) {
      toast.error(t('toast.invalidIp'));
      return;
    }
    if (items.includes(val)) {
      toast.warning(t('toast.itemExists'));
      return;
    }
    onAdd(val);
    setInputValue('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${iconColor}`} />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add input */}
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
            className="max-w-xs"
            data-testid={`${testIdPrefix}-input`}
          />
          <Button type="button" variant="outline" onClick={handleAdd} data-testid={`${testIdPrefix}-add-btn`}>
            <Plus className="w-4 h-4 mr-2" />
            {t('common:actions.add')}
          </Button>
        </div>

        {/* Items list */}
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <Badge
              key={item}
              variant="secondary"
              className="px-3 py-1.5 text-sm flex items-center gap-2"
            >
              {item}
              <button
                onClick={() => onRemove(item)}
                className="hover:bg-destructive/20 rounded-full p-0.5"
                data-testid={`${testIdPrefix}-remove-${item}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('listSectionEmpty')}</p>
          )}
        </div>

        {/* Info box */}
        {infoItems && infoItems.length > 0 && (
          <div className={`rounded-lg ${iconColor.includes('green') ? 'bg-green-500/10 border-green-500/30' : iconColor.includes('red') ? 'bg-red-500/10 border-red-500/30' : iconColor.includes('blue') ? 'bg-blue-500/10 border-blue-500/30' : 'bg-orange-500/10 border-orange-500/30'} border p-4 mt-4`}>
            <ul className={`text-xs ${iconColor.includes('green') ? 'text-green-300/80' : iconColor.includes('red') ? 'text-red-300/80' : iconColor.includes('blue') ? 'text-blue-300/80' : 'text-orange-300/80'} space-y-1`}>
              {infoItems.map((info, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: `• ${info}` }} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const updateFormList = (setter, data, field, action, value) => {
  if (action === 'add') {
    setter({ ...data, [field]: [...data[field], value] });
  } else {
    setter({ ...data, [field]: data[field].filter(i => i !== value) });
  }
};

const PoolForm = ({ data, setData, onSubmit, submitLabel, submitIcon: SubmitIcon, isEdit, onCancel, loading }) => {
  const { t } = useTranslation('scan-pools');
  return (
  <form onSubmit={onSubmit} className="space-y-6">
    {/* Basic settings */}
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-purple-500" />
          <CardTitle>{t('form.basicTitle')}</CardTitle>
        </div>
        <CardDescription>{t('form.basicDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>{t('form.nameLabel')}</Label>
            <Input
              placeholder={t('form.namePlaceholder')}
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
              required
              data-testid="pool-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('form.scannersLabel')}</Label>
            <Input
              type="number"
              min="1"
              max="10"
              value={data.simultaneous_scanners}
              onChange={(e) => setData({ ...data, simultaneous_scanners: e.target.value })}
              data-testid="pool-scanners-input"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('form.delayMinLabel')}</Label>
            <Input
              type="number"
              min="0"
              value={data.request_delay_min}
              onChange={(e) => setData({ ...data, request_delay_min: e.target.value })}
              data-testid="pool-delay-min-input"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('form.delayMaxLabel')}</Label>
            <Input
              type="number"
              min="0"
              value={data.request_delay_max}
              onChange={(e) => setData({ ...data, request_delay_max: e.target.value })}
              data-testid="pool-delay-max-input"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Include Servers */}
    <ListSection
      icon={ShieldCheck}
      iconColor="text-green-500"
      title={t('includeServers.title')}
      description={t('includeServers.description')}
      items={data.include_servers}
      onAdd={(val) => updateFormList(setData, data, 'include_servers', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'include_servers', 'remove', val)}
      placeholder={t('includeServers.placeholder')}
      testIdPrefix="include-servers"
      infoItems={[
        t('includeServers.info1'),
        t('includeServers.info2'),
        t('includeServers.info3'),
      ]}
    />

    {/* Exclude Servers */}
    <ListSection
      icon={ShieldX}
      iconColor="text-red-500"
      title={t('excludeServers.title')}
      description={t('excludeServers.description')}
      items={data.exclude_servers}
      onAdd={(val) => updateFormList(setData, data, 'exclude_servers', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'exclude_servers', 'remove', val)}
      placeholder={t('excludeServers.placeholder')}
      testIdPrefix="exclude-servers"
      infoItems={[
        t('excludeServers.info1'),
        t('excludeServers.info2'),
        t('excludeServers.info3'),
      ]}
    />

    {/* Include IPs */}
    <ListSection
      icon={Network}
      iconColor="text-blue-500"
      title={t('includeIps.title')}
      description={t('includeIps.description')}
      items={data.include_ips}
      onAdd={(val) => updateFormList(setData, data, 'include_ips', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'include_ips', 'remove', val)}
      placeholder={t('includeIps.placeholder')}
      testIdPrefix="include-ips"
      validateIp
      infoItems={[
        t('includeIps.info1'),
        t('includeIps.info2'),
      ]}
    />

    {/* Exclude IPs */}
    <ListSection
      icon={ShieldX}
      iconColor="text-red-500"
      title={t('excludeIps.title')}
      description={t('excludeIps.description')}
      items={data.exclude_ips}
      onAdd={(val) => updateFormList(setData, data, 'exclude_ips', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'exclude_ips', 'remove', val)}
      placeholder={t('excludeIps.placeholder')}
      testIdPrefix="exclude-ips"
      validateIp
      infoItems={[
        t('excludeIps.info1'),
        t('excludeIps.info2'),
        t('excludeIps.info3'),
      ]}
    />

    <div className="flex gap-2">
      <Button type="submit" disabled={loading} data-testid="pool-submit-btn">
        {SubmitIcon && <SubmitIcon className="w-4 h-4 mr-2" />}
        {submitLabel}
      </Button>
      {isEdit && (
        <Button type="button" variant="ghost" onClick={onCancel} data-testid="pool-cancel-btn">
          <X className="w-4 h-4 mr-1" /> {t('common:actions.cancel')}
        </Button>
      )}
    </div>
  </form>
  );
};

const ScanPools = () => {
  const { t } = useTranslation('scan-pools');
  const [pools, setPools] = useState([]);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  useEffect(() => {
    loadPools();
  }, []);

  const loadPools = async () => {
    try {
      const response = await axios.get(`${API}/scan-pools`);
      setPools(response.data);
    } catch (error) {
      console.error('Error loading scan pools:', error);
      toast.error(t('toast.loadError'));
    }
  };

  const buildPayload = (data) => ({
    name: data.name,
    simultaneous_scanners: parseInt(data.simultaneous_scanners) || 3,
    request_delay_min: parseInt(data.request_delay_min) || 100,
    request_delay_max: parseInt(data.request_delay_max) || 500,
    include_servers: joinList(data.include_servers),
    exclude_servers: joinList(data.exclude_servers),
    include_ips: joinList(data.include_ips),
    exclude_ips: joinList(data.exclude_ips),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API}/scan-pools`, buildPayload(formData));
      toast.success(t('toast.createSuccess'));
      setFormData({ ...emptyForm });
      setShowAddForm(false);
      loadPools();
    } catch (error) {
      console.error('Error creating scan pool:', error);
      toast.error(t('toast.createError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/scan-pools/${id}`);
      toast.success(t('toast.deleteSuccess'));
      loadPools();
    } catch (error) {
      console.error('Error deleting scan pool:', error);
      toast.error(t('toast.deleteError'));
    }
  };

  const startEdit = (pool) => {
    setEditingId(pool.id);
    setEditData({
      name: pool.name,
      simultaneous_scanners: pool.simultaneous_scanners.toString(),
      request_delay_min: pool.request_delay_min.toString(),
      request_delay_max: pool.request_delay_max.toString(),
      include_servers: parseList(pool.include_servers),
      exclude_servers: parseList(pool.exclude_servers),
      include_ips: parseList(pool.include_ips),
      exclude_ips: parseList(pool.exclude_ips),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (id) => {
    if (!editData.name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    try {
      await axios.put(`${API}/scan-pools/${id}`, buildPayload(editData));
      toast.success(t('toast.updateSuccess'));
      setEditingId(null);
      setEditData({});
      loadPools();
    } catch (error) {
      console.error('Error updating scan pool:', error);
      toast.error(t('toast.updateError'));
    }
  };

  return (
    <div className="space-y-6" data-testid="scan-pools-page">
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
              {t('newPool')}
            </>
          )}
        </Button>
      </div>

      {/* Create Form */}
      {showAddForm && (
        <PoolForm
          data={formData}
          setData={setFormData}
          onSubmit={handleSubmit}
          submitLabel={t('createPool')}
          submitIcon={Plus}
          isEdit={false}
          loading={loading}
        />
      )}

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          <CardDescription>{t('list.count', { count: pools.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {pools.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('list.empty')}</p>
          ) : (
            <div className="space-y-3">
              {pools.map((pool) => (
                <div
                  key={pool.id}
                  data-testid={`pool-item-${pool.id}`}
                  className="border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {editingId === pool.id ? (
                    <div className="p-4">
                      <PoolForm
                        data={editData}
                        setData={setEditData}
                        onSubmit={(e) => { e.preventDefault(); saveEdit(pool.id); }}
                        submitLabel={t('common:actions.save')}
                        submitIcon={Check}
                        isEdit={true}
                        onCancel={cancelEdit}
                        loading={loading}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-4">
                      <div className="flex-1 grid grid-cols-4 gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('common:fields.name')}</div>
                          <div className="font-medium">{pool.name}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('list.scanners')}</div>
                          <div className="font-medium">{pool.simultaneous_scanners}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('list.delay')}</div>
                          <div className="font-medium">{pool.request_delay_min} - {pool.request_delay_max}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('list.rules')}</div>
                          <div className="flex flex-wrap gap-1">
                            {parseList(pool.include_servers).length > 0 && (
                              <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                                {t('list.hostIncludeBadge', { count: parseList(pool.include_servers).length })}
                              </Badge>
                            )}
                            {parseList(pool.exclude_servers).length > 0 && (
                              <Badge variant="outline" className="text-xs text-red-500 border-red-500/30">
                                {t('list.hostExcludeBadge', { count: parseList(pool.exclude_servers).length })}
                              </Badge>
                            )}
                            {parseList(pool.include_ips).length > 0 && (
                              <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                                {t('list.ipIncludeBadge', { count: parseList(pool.include_ips).length })}
                              </Badge>
                            )}
                            {parseList(pool.exclude_ips).length > 0 && (
                              <Badge variant="outline" className="text-xs text-red-500 border-red-500/30">
                                {t('list.ipExcludeBadge', { count: parseList(pool.exclude_ips).length })}
                              </Badge>
                            )}
                            {!parseList(pool.include_servers).length && !parseList(pool.exclude_servers).length && !parseList(pool.include_ips).length && !parseList(pool.exclude_ips).length && (
                              <span className="text-xs text-muted-foreground">{t('list.noFilters')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEdit(pool)}
                          data-testid={`edit-pool-${pool.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(pool.id)}
                          data-testid={`delete-pool-${pool.id}`}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
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

export default ScanPools;
