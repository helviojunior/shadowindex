import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, ChevronUp, Pencil, X, Check, Server, Network, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';

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
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    const val = inputValue.trim();
    if (!val) return;
    if (validateIp && !isValidIpEntry(val)) {
      toast.error('IP inválido. Use IPv4 (ex: 192.168.1.1) ou CIDR (ex: 10.0.0.0/24)');
      return;
    }
    if (items.includes(val)) {
      toast.warning('Item já existe na lista');
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
            Adicionar
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
            <p className="text-sm text-muted-foreground">Nenhum item configurado</p>
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

const PoolForm = ({ data, setData, onSubmit, submitLabel, submitIcon: SubmitIcon, isEdit, onCancel, loading }) => (
  <form onSubmit={onSubmit} className="space-y-6">
    {/* Basic settings */}
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-purple-500" />
          <CardTitle>Configurações Básicas</CardTitle>
        </div>
        <CardDescription>Nome da pool e parâmetros de performance do scan</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Nome *</Label>
            <Input
              placeholder="Minha Pool"
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
              required
              data-testid="pool-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label>Scanners simultâneos</Label>
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
            <Label>Delay mín. (ms)</Label>
            <Input
              type="number"
              min="0"
              value={data.request_delay_min}
              onChange={(e) => setData({ ...data, request_delay_min: e.target.value })}
              data-testid="pool-delay-min-input"
            />
          </div>
          <div className="space-y-2">
            <Label>Delay máx. (ms)</Label>
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
      title="Incluir Hostnames"
      description="Hostnames que serão incluídos no scan. Suporta wildcards (ex: SRV-*, *-DB-*)."
      items={data.include_servers}
      onAdd={(val) => updateFormList(setData, data, 'include_servers', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'include_servers', 'remove', val)}
      placeholder="Ex: SRV-WEB-* ou hostname exato"
      testIdPrefix="include-servers"
      infoItems={[
        'Adicione hostnames que devem ser incluídos no scan',
        '<strong>Wildcards:</strong> Use <code class="bg-green-500/20 px-1 rounded">SRV-*</code> para incluir todos que começam com SRV-',
        'Se a lista estiver vazia, todos os hostnames serão considerados',
      ]}
    />

    {/* Exclude Servers */}
    <ListSection
      icon={ShieldX}
      iconColor="text-red-500"
      title="Excluir Hostnames"
      description="Hostnames que serão excluídos do scan. A exclusão sempre tem precedência sobre a inclusão. Suporta wildcards."
      items={data.exclude_servers}
      onAdd={(val) => updateFormList(setData, data, 'exclude_servers', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'exclude_servers', 'remove', val)}
      placeholder="Ex: SRV-DEV-* ou hostname exato"
      testIdPrefix="exclude-servers"
      infoItems={[
        'Hostnames nesta lista serão <strong>sempre ignorados</strong>, mesmo que estejam na lista de inclusão',
        '<strong>Wildcards:</strong> Use <code class="bg-red-500/20 px-1 rounded">*-DEV-*</code> para excluir hostnames de desenvolvimento',
        'A lista de exclusão sempre terá precedência sobre a de inclusão',
      ]}
    />

    {/* Include IPs */}
    <ListSection
      icon={Network}
      iconColor="text-blue-500"
      title="Incluir IP/Subnet"
      description="IPs ou subnets que serão incluídos no scan. Suporta notação CIDR."
      items={data.include_ips}
      onAdd={(val) => updateFormList(setData, data, 'include_ips', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'include_ips', 'remove', val)}
      placeholder="Ex: 192.168.1.1 ou 10.0.0.0/24"
      testIdPrefix="include-ips"
      validateIp
      infoItems={[
        'Adicione IPs individuais (ex: <code class="bg-blue-500/20 px-1 rounded">192.168.1.1</code>) ou subnets em notação CIDR (ex: <code class="bg-blue-500/20 px-1 rounded">10.0.0.0/24</code>)',
        'Se a lista estiver vazia, todos os IPs serão considerados',
      ]}
    />

    {/* Exclude IPs */}
    <ListSection
      icon={ShieldX}
      iconColor="text-red-500"
      title="Excluir IP/Subnet"
      description="IPs ou subnets que serão excluídos do scan. A exclusão sempre tem precedência sobre a inclusão."
      items={data.exclude_ips}
      onAdd={(val) => updateFormList(setData, data, 'exclude_ips', 'add', val)}
      onRemove={(val) => updateFormList(setData, data, 'exclude_ips', 'remove', val)}
      placeholder="Ex: 10.0.0.5 ou 172.16.0.0/12"
      testIdPrefix="exclude-ips"
      validateIp
      infoItems={[
        'IPs e subnets nesta lista serão <strong>sempre ignorados</strong>, mesmo que estejam na lista de inclusão',
        'Use CIDR para excluir subnets inteiras (ex: <code class="bg-red-500/20 px-1 rounded">192.168.99.0/24</code>)',
        'A lista de exclusão sempre terá precedência sobre a de inclusão',
      ]}
    />

    <div className="flex gap-2">
      <Button type="submit" disabled={loading} data-testid="pool-submit-btn">
        {SubmitIcon && <SubmitIcon className="w-4 h-4 mr-2" />}
        {submitLabel}
      </Button>
      {isEdit && (
        <Button type="button" variant="ghost" onClick={onCancel} data-testid="pool-cancel-btn">
          <X className="w-4 h-4 mr-1" /> Cancelar
        </Button>
      )}
    </div>
  </form>
);

const ScanPools = () => {
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
      toast.error('Erro ao carregar scan pools');
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
      toast.error('Nome é obrigatório');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API}/scan-pools`, buildPayload(formData));
      toast.success('Scan pool criado com sucesso');
      setFormData({ ...emptyForm });
      setShowAddForm(false);
      loadPools();
    } catch (error) {
      console.error('Error creating scan pool:', error);
      toast.error('Erro ao criar scan pool');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/scan-pools/${id}`);
      toast.success('Scan pool removido com sucesso');
      loadPools();
    } catch (error) {
      console.error('Error deleting scan pool:', error);
      toast.error('Erro ao remover scan pool');
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
      toast.error('Nome é obrigatório');
      return;
    }
    try {
      await axios.put(`${API}/scan-pools/${id}`, buildPayload(editData));
      toast.success('Scan pool atualizado com sucesso');
      setEditingId(null);
      setEditData({});
      loadPools();
    } catch (error) {
      console.error('Error updating scan pool:', error);
      toast.error('Erro ao atualizar scan pool');
    }
  };

  return (
    <div className="space-y-6" data-testid="scan-pools-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scan Pool</h1>
          <p className="text-muted-foreground mt-2">Gerencie pools de configuração para scans de shares</p>
        </div>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          data-testid="toggle-add-form-btn"
          variant={showAddForm ? "secondary" : "default"}
        >
          {showAddForm ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              Fechar
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              Nova Pool
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
          submitLabel="Criar Pool"
          submitIcon={Plus}
          isEdit={false}
          loading={loading}
        />
      )}

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>Pools Cadastradas</CardTitle>
          <CardDescription>{pools.length} pool{pools.length !== 1 ? 's' : ''} no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {pools.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma scan pool cadastrada</p>
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
                        submitLabel="Salvar"
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
                          <div className="text-xs text-muted-foreground mb-1">Nome</div>
                          <div className="font-medium">{pool.name}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Scanners</div>
                          <div className="font-medium">{pool.simultaneous_scanners}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Delay (ms)</div>
                          <div className="font-medium">{pool.request_delay_min} - {pool.request_delay_max}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Regras</div>
                          <div className="flex flex-wrap gap-1">
                            {parseList(pool.include_servers).length > 0 && (
                              <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                                +{parseList(pool.include_servers).length} host
                              </Badge>
                            )}
                            {parseList(pool.exclude_servers).length > 0 && (
                              <Badge variant="outline" className="text-xs text-red-500 border-red-500/30">
                                -{parseList(pool.exclude_servers).length} host
                              </Badge>
                            )}
                            {parseList(pool.include_ips).length > 0 && (
                              <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                                +{parseList(pool.include_ips).length} IP
                              </Badge>
                            )}
                            {parseList(pool.exclude_ips).length > 0 && (
                              <Badge variant="outline" className="text-xs text-red-500 border-red-500/30">
                                -{parseList(pool.exclude_ips).length} IP
                              </Badge>
                            )}
                            {!parseList(pool.include_servers).length && !parseList(pool.exclude_servers).length && !parseList(pool.include_ips).length && !parseList(pool.exclude_ips).length && (
                              <span className="text-xs text-muted-foreground">Sem filtros</span>
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
