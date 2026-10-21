import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Network, Search, ChevronRight, ChevronDown, Loader2,
  Folder, FolderOpen, Users, User, Monitor, FileText, Box, Shield, Building2, Database, Radio, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const TYPE_META = {
  Domain: { icon: Network, color: 'text-indigo-400' },
  OU: { icon: Building2, color: 'text-amber-400' },
  Container: { icon: Box, color: 'text-amber-300' },
  GPO: { icon: Shield, color: 'text-purple-400' },
  Group: { icon: Users, color: 'text-emerald-400' },
  User: { icon: User, color: 'text-blue-400' },
  Computer: { icon: Monitor, color: 'text-cyan-400' },
};
const typeIcon = (type) => (TYPE_META[type]?.icon || FileText);
const typeColor = (type) => (TYPE_META[type]?.color || 'text-muted-foreground');
const nodeKey = (n) => n.distinguished_name || String(n.id);

const TreeNode = ({ node, depth, selectedKey, onSelect, fetchChildren }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const Icon = typeIcon(node.object_type);

  const toggle = async () => {
    if (!node.has_children) return;
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoading(true);
      try {
        setChildren(await fetchChildren(node));
      } catch {
        toast.error('Erro ao carregar filhos');
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted/50 ${selectedKey === nodeKey(node) ? 'bg-primary/10' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onSelect(node)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          className={`w-4 h-4 flex items-center justify-center shrink-0 ${node.has_children ? 'text-muted-foreground' : 'invisible'}`}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {node.has_children ? (expanded ? <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" /> : <Folder className="w-4 h-4 text-amber-400 shrink-0" />) : <Icon className={`w-4 h-4 shrink-0 ${typeColor(node.object_type)}`} />}
        <span className="truncate text-sm">{node.name || node.object_id}</span>
        {node.object_type && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1 shrink-0">{node.object_type}</Badge>}
        {node.child_count > 0 && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{node.child_count}</span>}
      </div>
      {expanded && children && children.map((c) => (
        <TreeNode key={nodeKey(c)} node={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} fetchChildren={fetchChildren} />
      ))}
    </div>
  );
};

const AdBrowse = () => {
  const { domainId } = useParams();
  const navigate = useNavigate();
  const [domain, setDomain] = useState(null);
  const [mode, setMode] = useState('db'); // 'db' (importado) | 'live' (LDAP)
  const [roots, setRoots] = useState([]);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [treeKey, setTreeKey] = useState(0); // força remontar a árvore ao trocar de modo
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const loadRoots = useCallback(async (m) => {
    setLoadingRoots(true);
    setRoots([]);
    setSelected(null);
    setDetail(null);
    try {
      if (m === 'live') {
        const { data } = await axios.get(`${API}/ad/domains/${domainId}/ldap-browse`);
        setRoots(data);
      } else {
        const { data } = await axios.get(`${API}/ad/domains/${domainId}/tree`);
        setRoots(data);
      }
      setTreeKey((k) => k + 1);
    } catch (e) {
      const msg = e.response?.data?.detail || 'Erro ao carregar a árvore';
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoadingRoots(false);
    }
  }, [domainId]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/ad/domains/${domainId}`);
        setDomain(data);
      } catch { /* ignore */ }
    })();
  }, [domainId]);

  useEffect(() => { loadRoots(mode); }, [mode, loadRoots]);

  const fetchChildren = useCallback(async (node) => {
    if (mode === 'live') {
      const { data } = await axios.get(`${API}/ad/domains/${domainId}/ldap-browse`, { params: { dn: node.distinguished_name } });
      return data;
    }
    const { data } = await axios.get(`${API}/ad/domains/${domainId}/tree`, { params: { parent_dn: node.distinguished_name } });
    return data;
  }, [mode, domainId]);

  const selectNode = useCallback(async (node) => {
    setSelected(node);
    if (mode === 'live') {
      // Nó ao vivo já traz as properties
      setDetail(node);
      return;
    }
    setLoadingDetail(true);
    try {
      const { data } = await axios.get(`${API}/ad/objects/${node.id}`);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [mode, domainId]);

  const runSearch = async (e) => {
    e?.preventDefault();
    const term = searchTerm.trim();
    if (term.length < 2) return toast.error('Informe ao menos 2 caracteres');
    setSearching(true);
    try {
      const { data } = await axios.get(`${API}/ad/domains/${domainId}/search`, { params: { q: term } });
      setSearchResults(data);
    } catch (error) {
      const msg = error.response?.data?.detail || 'Erro na busca';
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => { setSearchTerm(''); setSearchResults(null); };

  return (
    <div className="space-y-4" data-testid="ad-browse-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate('/ad')}><ArrowLeft className="w-4 h-4 mr-1" />Domínios</Button>
        <h1 className="text-2xl font-bold flex items-center gap-2 min-w-0">
          <Network className="w-6 h-6 text-indigo-400 shrink-0" />
          <span className="truncate">{domain?.name || `Domínio ${domainId}`}</span>
        </h1>
        {domain?.object_count != null && <Badge variant="outline">{domain.object_count.toLocaleString()} objetos</Badge>}
        <Button variant="ghost" size="sm" onClick={() => loadRoots(mode)} title="Atualizar árvore">
          <RefreshCw className={`w-4 h-4 ${loadingRoots ? 'animate-spin' : ''}`} />
        </Button>
        {/* Alternador de modo */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button onClick={() => setMode('db')} className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm ${mode === 'db' ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'}`} data-testid="mode-db">
            <Database className="w-3.5 h-3.5" />Importado
          </button>
          <button onClick={() => setMode('live')} className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm ${mode === 'live' ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'}`} data-testid="mode-live">
            <Radio className="w-3.5 h-3.5" />LDAP ao vivo
          </button>
        </div>
      </div>

      {/* Busca (apenas no modo importado) */}
      {mode === 'db' && (
        <form onSubmit={runSearch} className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por nome, samAccountName, DN, descrição ou SID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="ad-search-input" />
          </div>
          <Button type="submit" disabled={searching} data-testid="ad-search-btn">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
          {searchResults !== null && <Button type="button" variant="ghost" onClick={clearSearch}>Limpar</Button>}
        </form>
      )}
      {mode === 'live' && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Radio className="w-4 h-4 text-indigo-400" />
          Navegação ao vivo via LDAP — os filhos de cada OU/container são buscados sob demanda ao expandir. (A busca global usa os dados importados.)
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="min-h-[400px]">
          <CardContent className="p-2 max-h-[70vh] overflow-auto">
            {mode === 'db' && searchResults !== null ? (
              <div>
                <div className="px-2 py-1 text-xs text-muted-foreground">{searchResults.length} resultado(s)</div>
                {searchResults.map((r) => {
                  const Icon = typeIcon(r.object_type);
                  return (
                    <div key={r.id} className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-muted/50 ${selected?.id === r.id ? 'bg-primary/10' : ''}`} onClick={() => selectNode(r)}>
                      <Icon className={`w-4 h-4 shrink-0 ${typeColor(r.object_type)}`} />
                      <span className="truncate text-sm">{r.name || r.object_id}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto shrink-0">{r.object_type}</Badge>
                    </div>
                  );
                })}
                {searchResults.length === 0 && <div className="p-4 text-center text-muted-foreground text-sm">Nenhum objeto encontrado</div>}
              </div>
            ) : loadingRoots ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : roots.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {mode === 'live' ? 'Nada retornado do LDAP — verifique a conexão do domínio.' : 'Árvore vazia — importe os arquivos do BloodHound ou use o modo "LDAP ao vivo".'}
              </div>
            ) : (
              <div key={treeKey}>
                {roots.map((n) => <TreeNode key={nodeKey(n)} node={n} depth={0} selectedKey={selected ? nodeKey(selected) : null} onSelect={selectNode} fetchChildren={fetchChildren} />)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-[400px]">
          <CardContent className="p-4 max-h-[70vh] overflow-auto">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : !detail ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Selecione um objeto para ver os detalhes.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => { const Icon = typeIcon(detail.object_type); return <Icon className={`w-5 h-5 shrink-0 ${typeColor(detail.object_type)}`} />; })()}
                  <span className="text-lg font-semibold break-all">{detail.name || detail.object_id}</span>
                  <Badge variant="outline">{detail.object_type}</Badge>
                  {detail.highvalue && <Badge variant="destructive">High Value</Badge>}
                  {detail.enabled === false && <Badge variant="secondary">Desabilitado</Badge>}
                </div>
                <div className="grid grid-cols-1 gap-1 text-sm">
                  <DetailRow label="Object ID" value={detail.object_id} mono />
                  <DetailRow label="Distinguished Name" value={detail.distinguished_name} mono />
                  {detail.samaccountname && <DetailRow label="samAccountName" value={detail.samaccountname} mono />}
                  {detail.description && <DetailRow label="Descrição" value={detail.description} />}
                  {detail.child_count > 0 && <DetailRow label="Filhos" value={String(detail.child_count)} />}
                </div>
                {detail.properties && Object.keys(detail.properties).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Propriedades (BloodHound v6)</div>
                    <div className="rounded border border-border divide-y divide-border">
                      {Object.entries(detail.properties).map(([k, v]) => (
                        <div key={k} className="flex gap-3 px-3 py-1.5 text-sm">
                          <span className="text-muted-foreground w-48 shrink-0 font-mono text-xs">{k}</span>
                          <span className="break-all">{formatVal(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const DetailRow = ({ label, value, mono }) => (
  value ? (
    <div className="flex gap-3">
      <span className="text-muted-foreground w-44 shrink-0">{label}</span>
      <span className={`break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  ) : null
);

const formatVal = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export default AdBrowse;
