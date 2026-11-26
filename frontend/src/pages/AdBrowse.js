import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Network, Search, ChevronRight, ChevronDown, Loader2,
  Folder, FolderOpen, Users, User, Monitor, FileText, Box, Shield, Building2,
  Database, Radio, RefreshCw, X, Code2, FileDown, Focus,
  ExternalLink, Link2, Lock, Unlock, KeyRound, UserPlus, FolderPlus
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

// Tipos que podem conter objetos filhos na hierarquia de DN
const CONTAINER_TYPES = new Set(['Domain', 'OU', 'Container', 'GPO', 'Group']);
const isContainerNode = (n) => !!n && (n.has_children === true || CONTAINER_TYPES.has(n.object_type));
const TYPE_RANK = { Domain: 0, OU: 1, Container: 2, GPO: 3, Group: 4, User: 5, Computer: 6 };
const isGroup = (n) => n && n.object_type === 'Group';

const TYPE_OPTIONS = ['Domain', 'OU', 'Container', 'GPO', 'Group', 'User', 'Computer'];

// epoch (segundos) -> data/hora local pt-BR
const fmtDateTime = (epoch) => {
  if (epoch === null || epoch === undefined || epoch === '' || Number(epoch) <= 0) return '—';
  try {
    return new Date(Number(epoch) * 1000).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

// --- Utilidades de DN (para expandir a árvore até um objeto) ---
const splitDN = (dn) => {
  const out = [];
  let cur = '';
  for (let i = 0; i < dn.length; i++) {
    const ch = dn[i];
    if (ch === '\\') { cur += ch + (dn[i + 1] || ''); i++; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
// Cadeia de DNs do topo (filho da base) até o alvo (inclusive)
const dnChain = (targetDn, baseDn) => {
  if (!targetDn) return [];
  const parts = splitDN(targetDn);
  const baseLen = baseDn ? splitDN(baseDn).length : 0;
  const chain = [];
  for (let i = parts.length - baseLen - 1; i >= 0; i--) chain.push(parts.slice(i).join(','));
  return chain;
};

const apiErr = (e, fallback) => {
  const msg = e?.response?.data?.detail || fallback;
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
};

const CREATE_CONTAINER_TYPES = new Set(['OU', 'Container']);

// Menu de contexto por objeto. Ações que dependem de LDAP ficam desabilitadas
// (muted) quando o domínio não tem LDAP configurado (só BloodHound).
const ObjectMenu = ({ node, ldapConfigured, onAction, children }) => {
  const { t } = useTranslation('ad-browse');
  const objType = node.object_type;
  const Item = ({ label, kind, icon, ldap }) => (
    <ContextMenuItem
      disabled={ldap && !ldapConfigured}
      onClick={() => onAction(kind, node)}
      title={ldap && !ldapConfigured ? t('menu.requiresLdap') : undefined}
    >
      {icon}
      {label}
    </ContextMenuItem>
  );
  const showCreate = CREATE_CONTAINER_TYPES.has(objType);
  const showGroup = objType === 'Group';
  const showUser = objType === 'User';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <Item label={t('menu.openTab')} kind="open-tab" icon={<ExternalLink className="w-4 h-4 mr-2" />} />
        <Item label={t('menu.copyLink')} kind="copy-link" icon={<Link2 className="w-4 h-4 mr-2" />} />
        {(showCreate || showGroup || showUser) && <ContextMenuSeparator />}
        {showCreate && <Item label={t('menu.createUser')} kind="create-user" icon={<UserPlus className="w-4 h-4 mr-2" />} ldap />}
        {showCreate && <Item label={t('menu.createGroup')} kind="create-group" icon={<FolderPlus className="w-4 h-4 mr-2" />} ldap />}
        {showGroup && <Item label={t('menu.addMember')} kind="add-member" icon={<UserPlus className="w-4 h-4 mr-2" />} ldap />}
        {showUser && <Item label={t('menu.block')} kind="block" icon={<Lock className="w-4 h-4 mr-2" />} ldap />}
        {showUser && <Item label={t('menu.unblock')} kind="unblock" icon={<Unlock className="w-4 h-4 mr-2" />} ldap />}
        {showUser && <Item label={t('menu.resetPassword')} kind="reset-password" icon={<KeyRound className="w-4 h-4 mr-2" />} ldap />}
        {showUser && <Item label={t('menu.addToGroup')} kind="add-to-group" icon={<Users className="w-4 h-4 mr-2" />} ldap />}
      </ContextMenuContent>
    </ContextMenu>
  );
};

// Árvore controlada: expansão e filhos vivem no componente pai (permite expandir
// programaticamente até um objeto vindo da busca).
const TreeNode = ({ node, depth, selectedKey, onSelect, expanded, nodeChildren, nodeLoading, onToggle, menu, focus }) => {
  const dn = nodeKey(node);
  const isExp = !!expanded[dn];
  const kids = nodeChildren[dn];
  const loading = !!nodeLoading[dn];
  const Icon = typeIcon(node.object_type);
  // Grupos usam o ícone de "usuários" mesmo expandidos (seus filhos são membros)
  const showFolder = node.has_children && !isGroup(node);

  return (
    <div>
      <ObjectMenu node={node} ldapConfigured={menu.ldapConfigured} onAction={menu.onAction}>
        <div
          data-dn={dn}
          className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted/50 ${selectedKey === dn ? 'bg-primary/10' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={() => onSelect(node)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); if (node.has_children) onToggle(node); }}
            className={`w-4 h-4 flex items-center justify-center shrink-0 ${node.has_children ? 'text-muted-foreground' : 'invisible'}`}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {showFolder
            ? (isExp ? <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" /> : <Folder className="w-4 h-4 text-amber-400 shrink-0" />)
            : <Icon className={`w-4 h-4 shrink-0 ${typeColor(node.object_type)}`} />}
          <span className="truncate text-sm">{node.name || node.object_id}</span>
          {node.child_count > 0 && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{node.child_count}</span>}
        </div>
      </ObjectMenu>
      {isExp && kids && (() => {
        // Em modo foco, nós fora do caminho mostram só os filhos que levam ao focado;
        // o próprio nó focado mostra toda a sua subárvore.
        const list = (focus?.key && dn !== focus.key) ? kids.filter((c) => focus.onPath(c)) : kids;
        return list.map((c) => (
          <TreeNode
            key={nodeKey(c)} node={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect}
            expanded={expanded} nodeChildren={nodeChildren} nodeLoading={nodeLoading} onToggle={onToggle} menu={menu} focus={focus}
          />
        ));
      })()}
    </div>
  );
};

const AdBrowse = () => {
  const { t } = useTranslation('ad-browse');
  const { domainId } = useParams();
  const navigate = useNavigate();
  const [domain, setDomain] = useState(null);
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState('db');
  const [roots, setRoots] = useState([]);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [treeKey, setTreeKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [menuAction, setMenuAction] = useState(null); // { kind, node }
  const pendingObjRef = useRef(searchParams.get('obj'));

  // LDAP configurado = tem DC + credencial e não é auth por certificado
  const ldapConfigured = !!(domain && domain.credential_id &&
    (domain.selected_dc || domain.dc_hosts) && domain.auth_method !== 'cert');

  // Busca (estilo navegador de arquivos: card de resultados separado da árvore)
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    object_type: '', enabled: '', highvalue: '',
    created_from: '', created_to: '', pwd_from: '', pwd_to: '',
  });

  // Árvore controlada (expansão + cache de filhos no pai)
  const [expanded, setExpanded] = useState({});
  const [nodeChildren, setNodeChildren] = useState({});
  const [nodeLoading, setNodeLoading] = useState({});
  const [focusedKey, setFocusedKey] = useState(null); // modo foco: isola o item selecionado
  const [focusedNode, setFocusedNode] = useState(null);
  const nodeChildrenRef = useRef({});
  const baseDnRef = useRef('');
  const treeScrollRef = useRef(null);

  // Painel direito: abas Info / Objetos
  const [rightTab, setRightTab] = useState('info');
  const [objChildren, setObjChildren] = useState(null);
  const [loadingObj, setLoadingObj] = useState(false);
  const [objSort, setObjSort] = useState({ key: 'name', direction: 'asc' });

  const loadRoots = useCallback(async (m) => {
    setLoadingRoots(true);
    setRoots([]);
    setSelected(null);
    setDetail(null);
    setExpanded({});
    setNodeChildren({});
    setNodeLoading({});
    setFocusedKey(null);
    setFocusedNode(null);
    nodeChildrenRef.current = {};
    baseDnRef.current = '';
    try {
      const url = m === 'live'
        ? `${API}/ad/domains/${domainId}/ldap-browse`
        : `${API}/ad/domains/${domainId}/tree`;
      const { data } = await axios.get(url);
      // Domínio único: oculta o nó raiz e exibe seus filhos diretamente no topo
      let display = data;
      if (Array.isArray(data) && data.length === 1 && data[0]?.has_children && data[0]?.distinguished_name) {
        try {
          const childUrl = m === 'live'
            ? `${API}/ad/domains/${domainId}/ldap-browse`
            : `${API}/ad/domains/${domainId}/tree`;
          const param = m === 'live' ? { dn: data[0].distinguished_name } : { parent_dn: data[0].distinguished_name };
          const { data: kids } = await axios.get(childUrl, { params: param });
          if (Array.isArray(kids) && kids.length) {
            display = kids;
            baseDnRef.current = data[0].distinguished_name; // base = DN do domínio oculto
          }
        } catch { /* mantém o nó raiz em caso de falha */ }
      }
      setRoots(display);
      setTreeKey((k) => k + 1);
    } catch (e) {
      const msg = e.response?.data?.detail || t('toast.loadTreeError');
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoadingRoots(false);
    }
  }, [domainId, t]);

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
    // Grupos: os "filhos" são os membros diretos (relação memberOf, não DN)
    if (isGroup(node)) {
      if (mode === 'live') {
        const { data } = await axios.get(`${API}/ad/domains/${domainId}/ldap-members`, { params: { dn: node.distinguished_name } });
        return data;
      }
      const { data } = await axios.get(`${API}/ad/objects/${node.id}/members`);
      return data;
    }
    if (mode === 'live') {
      const { data } = await axios.get(`${API}/ad/domains/${domainId}/ldap-browse`, { params: { dn: node.distinguished_name } });
      return data;
    }
    const { data } = await axios.get(`${API}/ad/domains/${domainId}/tree`, { params: { parent_dn: node.distinguished_name } });
    return data;
  }, [mode, domainId]);

  const selectNode = useCallback(async (node) => {
    setSelected(node);
    setRightTab('info');
    setObjChildren(null);
    if (mode === 'live') {
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
  }, [mode]);

  // Carrega (e cacheia) os filhos de um nó da árvore
  const loadNode = useCallback(async (node) => {
    const dn = node.distinguished_name;
    if (!dn) return [];
    if (nodeChildrenRef.current[dn]) return nodeChildrenRef.current[dn];
    setNodeLoading((p) => ({ ...p, [dn]: true }));
    try {
      const kids = await fetchChildren(node);
      nodeChildrenRef.current = { ...nodeChildrenRef.current, [dn]: kids };
      setNodeChildren(nodeChildrenRef.current);
      return kids;
    } catch {
      nodeChildrenRef.current = { ...nodeChildrenRef.current, [dn]: [] };
      setNodeChildren(nodeChildrenRef.current);
      toast.error(t('toast.loadChildrenError'));
      return [];
    } finally {
      setNodeLoading((p) => { const n = { ...p }; delete n[dn]; return n; });
    }
  }, [fetchChildren, t]);

  const toggleNode = useCallback(async (node) => {
    const dn = node.distinguished_name;
    if (!dn) return;
    const willExpand = !expanded[dn];
    setExpanded((p) => ({ ...p, [dn]: willExpand }));
    if (willExpand && !nodeChildrenRef.current[dn]) await loadNode(node);
  }, [expanded, loadNode]);

  // Navega até um objeto expandindo a árvore pela cadeia de DN e rolando até ele
  const revealInTree = useCallback(async (target) => {
    await selectNode(target);
    const dn = target?.distinguished_name;
    if (!dn) return;
    const chain = dnChain(dn, baseDnRef.current);
    const next = { ...expanded };
    for (const adn of chain.slice(0, -1)) {
      next[adn] = true;
      if (!nodeChildrenRef.current[adn]) {
        // eslint-disable-next-line no-await-in-loop
        await loadNode({ distinguished_name: adn });
      }
    }
    setExpanded(next);
    setTimeout(() => {
      try {
        const el = treeScrollRef.current?.querySelector(`[data-dn="${CSS.escape(dn)}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { /* ignore */ }
    }, 180);
  }, [expanded, loadNode, selectNode]);

  // --- Modo foco (isola o item selecionado na árvore, como em /servers/:id/browse) ---
  // Caminha os filhos realmente carregados para saber se o nó focado é descendente.
  const hasFocusedDescendant = useCallback((dn, focusDn, visited) => {
    const seen = visited || new Set();
    const kids = nodeChildren[dn] || [];
    for (const c of kids) {
      const ck = nodeKey(c);
      if (seen.has(ck)) continue;
      seen.add(ck);
      if (ck === focusDn) return true;
      if (hasFocusedDescendant(ck, focusDn, seen)) return true;
    }
    return false;
  }, [nodeChildren]);

  const onFocusPath = useCallback((node) => {
    if (!focusedKey) return true;
    const k = nodeKey(node);
    return k === focusedKey || hasFocusedDescendant(k, focusedKey);
  }, [focusedKey, hasFocusedDescendant]);

  const toggleFocus = useCallback(() => {
    if (focusedKey) {
      const dn = focusedKey;
      setFocusedKey(null);
      setFocusedNode(null);
      setTimeout(() => {
        try {
          const el = treeScrollRef.current?.querySelector(`[data-dn="${CSS.escape(dn)}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch { /* ignore */ }
      }, 100);
    } else if (selected?.distinguished_name) {
      setFocusedKey(nodeKey(selected));
      setFocusedNode(selected);
    }
  }, [focusedKey, selected]);

  // Link direto para um objeto (deep-link reaberto via ?obj=<pk>)
  const objLink = useCallback((node) => {
    const base = `${window.location.origin}/ad/${domainId}/browse`;
    return node?.id != null ? `${base}?obj=${node.id}` : base;
  }, [domainId]);

  // Invalida/recarrega os filhos de um container após uma escrita
  const refreshContainer = useCallback(async (node) => {
    const dn = node?.distinguished_name;
    if (dn && nodeChildrenRef.current[dn]) {
      const { [dn]: _drop, ...rest } = nodeChildrenRef.current;
      nodeChildrenRef.current = rest;
      setNodeChildren(rest);
      if (expanded[dn]) await loadNode(node);
    }
    if (selected && selected.id === node?.id) setObjChildren(null);
  }, [expanded, loadNode, selected]);

  const setEnabled = useCallback(async (node, enabled) => {
    try {
      await axios.post(`${API}/ad/domains/${domainId}/objects/${node.id}/set-enabled`, { enabled });
      toast.success(enabled ? t('toast.accountUnblocked') : t('toast.accountBlocked'));
      if (detail && detail.id === node.id) setDetail({ ...detail, enabled });
    } catch (e) {
      toast.error(apiErr(e, t('toast.accountChangeFailed')));
    }
  }, [domainId, detail, t]);

  // Despacha as ações do menu de contexto
  const onMenuAction = useCallback((kind, node) => {
    if (kind === 'open-tab') { window.open(objLink(node), '_blank'); return; }
    if (kind === 'copy-link') {
      navigator.clipboard?.writeText(objLink(node)).then(
        () => toast.success(t('toast.linkCopied')),
        () => toast.error(t('toast.copyFailed')),
      );
      return;
    }
    if (!ldapConfigured) { toast.error(t('toast.ldapNotConfigured')); return; }
    if (kind === 'unblock') { setEnabled(node, true); return; }
    // demais ações abrem diálogo (bloquear pede confirmação; criar/senha/grupo pedem dados)
    setMenuAction({ kind, node });
  }, [objLink, ldapConfigured, setEnabled, t]);

  // Confirmação/submit dos diálogos
  const onMenuConfirm = useCallback(async (kind, node, values) => {
    const dom = `${API}/ad/domains/${domainId}`;
    try {
      if (kind === 'block') {
        await axios.post(`${dom}/objects/${node.id}/set-enabled`, { enabled: false });
        toast.success(t('toast.accountBlocked'));
        if (detail && detail.id === node.id) setDetail({ ...detail, enabled: false });
      } else if (kind === 'reset-password') {
        await axios.post(`${dom}/objects/${node.id}/reset-password`, { password: values.password });
        toast.success(t('toast.passwordChanged'));
      } else if (kind === 'create-user') {
        const r = await axios.post(`${dom}/containers/${node.id}/create-user`, { name: values.name, sam: values.sam, password: values.password || null });
        toast.success(r.data?.note || t('toast.userCreated'));
        refreshContainer(node);
      } else if (kind === 'create-group') {
        await axios.post(`${dom}/containers/${node.id}/create-group`, { name: values.name, sam: values.sam });
        toast.success(t('toast.groupCreated'));
        refreshContainer(node);
      } else if (kind === 'add-member') {
        await axios.post(`${dom}/groups/${node.id}/add-member`, { member_pk: values.picked?.id });
        toast.success(t('toast.memberAdded'));
        refreshContainer(node);
      } else if (kind === 'add-to-group') {
        await axios.post(`${dom}/objects/${node.id}/add-to-group`, { group_pk: values.picked?.id });
        toast.success(t('toast.userAddedToGroup'));
      }
    } catch (e) {
      toast.error(apiErr(e, t('toast.operationFailed')));
      throw e; // mantém o diálogo aberto em caso de erro
    }
  }, [domainId, detail, refreshContainer, t]);

  const loadObjChildren = useCallback(async (node) => {
    if (!node) return;
    setLoadingObj(true);
    try {
      setObjChildren(await fetchChildren(node));
    } catch {
      toast.error(t('toast.loadObjChildrenError'));
      setObjChildren([]);
    } finally {
      setLoadingObj(false);
    }
  }, [fetchChildren, t]);

  // Deep-link: ?obj=<pk> abre e revela o objeto assim que a árvore carrega
  useEffect(() => {
    const pk = pendingObjRef.current;
    if (!pk || loadingRoots || roots.length === 0) return;
    pendingObjRef.current = null;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/ad/objects/${pk}`);
        await revealInTree(data);
      } catch { /* objeto não encontrado */ }
    })();
  }, [loadingRoots, roots, revealInTree]);

  // Carrega os filhos ao abrir a aba Objetos
  useEffect(() => {
    if (rightTab === 'objetos' && selected && objChildren === null && !loadingObj) {
      loadObjChildren(selected);
    }
  }, [rightTab, selected, objChildren, loadingObj, loadObjChildren]);

  const runSearch = async (e) => {
    e?.preventDefault();
    const term = searchTerm.trim();
    const hasFilter = filters.object_type || filters.enabled || filters.highvalue ||
      filters.created_from || filters.created_to || filters.pwd_from || filters.pwd_to;
    if (term.length < 2 && !hasFilter) return toast.error(t('toast.searchMinChars'));
    setSearching(true);
    try {
      const params = {};
      if (term.length >= 2) params.q = term;
      if (filters.object_type) params.object_type = filters.object_type;
      if (filters.enabled) params.enabled = filters.enabled;
      if (filters.highvalue) params.highvalue = filters.highvalue;
      if (filters.created_from) params.created_from = filters.created_from;
      if (filters.created_to) params.created_to = filters.created_to;
      if (filters.pwd_from) params.pwd_from = filters.pwd_from;
      if (filters.pwd_to) params.pwd_to = filters.pwd_to;
      const { data } = await axios.get(`${API}/ad/domains/${domainId}/search`, { params });
      setSearchResults(data);
    } catch (error) {
      const msg = error.response?.data?.detail || t('toast.searchError');
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSearchResults(null);
    setFilters({ object_type: '', enabled: '', highvalue: '', created_from: '', created_to: '', pwd_from: '', pwd_to: '' });
  };

  const exportResults = () => {
    if (!searchResults?.length) return;
    const blob = new Blob([JSON.stringify(searchResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ad-busca-${domain?.name || domainId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setF = (k, v) => setFilters((prev) => ({ ...prev, [k]: v }));

  // Agrupa resultados por tipo (ordem Domain → Computer)
  const groupedResults = () => {
    if (!searchResults) return [];
    const map = {};
    for (const r of searchResults) (map[r.object_type] = map[r.object_type] || []).push(r);
    return Object.entries(map).sort((a, b) => (TYPE_RANK[a[0]] ?? 9) - (TYPE_RANK[b[0]] ?? 9));
  };

  const ModeToggle = () => (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <button onClick={() => setMode('db')} className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm ${mode === 'db' ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'}`} data-testid="mode-db">
        <Database className="w-3.5 h-3.5" />{t('mode.imported')}
      </button>
      <button onClick={() => setMode('live')} className={`flex items-center gap-1.5 px-3 py-1 rounded text-sm ${mode === 'live' ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'}`} data-testid="mode-live">
        <Radio className="w-3.5 h-3.5" />{t('mode.live')}
      </button>
    </div>
  );

  const selField = "h-9 rounded-md border border-border bg-background px-2 text-sm";

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col relative" data-testid="ad-browse-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate('/ad')}>
            <ArrowLeft className="w-4 h-4 mr-2" />{t('common:nav.ad-domains')}
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Network className="w-5 h-5 text-indigo-400 shrink-0" />
            <h1 className="text-xl font-semibold truncate">{domain?.name || t('domainN', { id: domainId })}</h1>
            {domain?.object_count != null && <Badge variant="outline" className="shrink-0">{t('objects', { count: domain.object_count, val: domain.object_count.toLocaleString() })}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadRoots(mode)} title={t('refreshTree')}>
            <RefreshCw className={`w-4 h-4 ${loadingRoots ? 'animate-spin' : ''}`} />
          </Button>
          <ModeToggle />
        </div>
      </div>

      {/* Split View */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Painel esquerdo - busca + árvore */}
        <ResizablePanel defaultSize={32} minSize={18} maxSize={55}>
          <div className="h-full border-r border-border bg-card flex flex-col">
            {mode === 'db' ? (
              <div className="p-3 border-b border-border space-y-2">
                <form onSubmit={runSearch} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9 h-9" placeholder={t('searchPlaceholder')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="ad-search-input" />
                    {(searchTerm || searchResults !== null) && (
                      <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <Button type="button" size="sm" variant={showFilters ? 'default' : 'outline'} onClick={() => setShowFilters((v) => !v)} title={t('advancedFilters')}>
                    <Code2 className="w-4 h-4" />
                  </Button>
                  <Button type="submit" size="sm" disabled={searching} data-testid="ad-search-btn">
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </form>

                {showFilters && (
                  <div className="rounded-md border border-border p-3 space-y-2 bg-background/40">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">{t('common:fields.type')}</label>
                        <select className={selField} value={filters.object_type} onChange={(e) => setF('object_type', e.target.value)}>
                          <option value="">{t('filters.allTypes')}</option>
                          {TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">{t('common:fields.status')}</label>
                        <select className={selField} value={filters.enabled} onChange={(e) => setF('enabled', e.target.value)}>
                          <option value="">{t('filters.all')}</option>
                          <option value="true">{t('filters.enabled')}</option>
                          <option value="false">{t('filters.disabled')}</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">High Value</label>
                        <select className={selField} value={filters.highvalue} onChange={(e) => setF('highvalue', e.target.value)}>
                          <option value="">{t('filters.all')}</option>
                          <option value="true">{t('common:actions.yes')}</option>
                          <option value="false">{t('common:actions.no')}</option>
                        </select>
                      </div>
                      <div />
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">{t('filters.createdFrom')}</label>
                        <Input type="date" className="h-9" value={filters.created_from} onChange={(e) => setF('created_from', e.target.value)} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">{t('filters.createdTo')}</label>
                        <Input type="date" className="h-9" value={filters.created_to} onChange={(e) => setF('created_to', e.target.value)} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">{t('filters.pwdFrom')}</label>
                        <Input type="date" className="h-9" value={filters.pwd_from} onChange={(e) => setF('pwd_from', e.target.value)} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-muted-foreground">{t('filters.pwdTo')}</label>
                        <Input type="date" className="h-9" value={filters.pwd_to} onChange={(e) => setF('pwd_to', e.target.value)} />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="button" size="sm" onClick={runSearch} disabled={searching}>
                        {searching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}{t('common:actions.search')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 border-b border-border text-xs text-muted-foreground flex items-center gap-2">
                <Radio className="w-4 h-4 text-indigo-400 shrink-0" />
                {t('liveHint')}
              </div>
            )}

            {/* Cabeçalho da árvore com ações */}
            <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('tree')}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant={focusedKey ? 'default' : 'ghost'} size="icon" className="h-7 w-7"
                  disabled={!focusedKey && (!selected || !selected.distinguished_name)}
                  onClick={toggleFocus}
                  title={focusedKey ? t('focus.showAll') : t('focus.focusSelected')}
                  data-testid="ad-focus-btn"
                >
                  {focusedKey ? <X className="w-4 h-4" /> : <Focus className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadRoots(mode)} disabled={loadingRoots} title={t('refreshTree')}>
                  <RefreshCw className={`w-4 h-4 ${loadingRoots ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            {/* Indicador de foco */}
            {focusedKey && (
              <div className="px-3 py-1.5 bg-primary/10 border-b border-border flex items-center justify-between">
                <span className="text-xs text-primary truncate">
                  {t('focus.focusedOn')} <strong>{focusedNode?.name || focusedNode?.object_id}</strong>
                </span>
                <Button variant="ghost" size="sm" className="h-5 text-xs px-2 shrink-0" onClick={toggleFocus}>
                  {t('focus.showAll')}
                </Button>
              </div>
            )}

            {/* Área rolável: card de resultados + árvore (a busca NÃO substitui a árvore) */}
            <div className="flex-1 overflow-auto" ref={treeScrollRef}>
              {mode === 'db' && searchResults !== null && (
                <div className="m-2 rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border">
                    <span className="text-sm text-muted-foreground">{t('resultsFound', { count: searchResults.length })}</span>
                    <button onClick={exportResults} disabled={!searchResults.length} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40" title={t('exportJson')}>
                      <FileDown className="w-4 h-4" />{t('common:actions.export')}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-auto">
                    {searchResults.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground text-sm">{t('noObjectsFound')}</div>
                    ) : groupedResults().map(([type, items]) => (
                      <div key={type}>
                        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">{type} ({items.length})</div>
                        {items.map((r) => {
                          const Icon = typeIcon(r.object_type);
                          return (
                            <ObjectMenu key={r.id} node={r} ldapConfigured={ldapConfigured} onAction={onMenuAction}>
                              <div className={`flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/50 ${selected?.id === r.id ? 'bg-primary/10' : ''}`} onClick={() => revealInTree(r)}>
                                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${typeColor(r.object_type)}`} />
                                <div className="min-w-0">
                                  <div className="truncate text-sm">{r.name || r.object_id}</div>
                                  {r.distinguished_name && <div className="truncate text-[11px] text-muted-foreground">{r.distinguished_name}</div>}
                                </div>
                              </div>
                            </ObjectMenu>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-1">
                {loadingRoots ? (
                  <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : roots.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    {mode === 'live' ? t('emptyLive') : t('emptyTree')}
                  </div>
                ) : (
                  <div key={treeKey}>
                    {(focusedKey ? roots.filter(onFocusPath) : roots).map((n) => (
                      <TreeNode
                        key={nodeKey(n)} node={n} depth={0}
                        selectedKey={selected ? nodeKey(selected) : null}
                        onSelect={selectNode}
                        expanded={expanded} nodeChildren={nodeChildren} nodeLoading={nodeLoading} onToggle={toggleNode}
                        menu={{ ldapConfigured, onAction: onMenuAction }}
                        focus={{ key: focusedKey, onPath: onFocusPath }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Painel direito - detalhe (abas Info / Objetos) */}
        <ResizablePanel defaultSize={68}>
          <div className="h-full flex flex-col overflow-hidden">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : !detail ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">{t('selectObject')}</div>
            ) : (
              <>
                {/* Cabeçalho do objeto */}
                <div className="px-4 pt-4 flex items-center gap-2 flex-wrap">
                  {(() => { const Icon = typeIcon(detail.object_type); return <Icon className={`w-5 h-5 shrink-0 ${typeColor(detail.object_type)}`} />; })()}
                  <span className="text-lg font-semibold break-all">{detail.name || detail.object_id}</span>
                  <Badge variant="outline">{detail.object_type}</Badge>
                  {detail.highvalue && <Badge variant="destructive">High Value</Badge>}
                  {detail.enabled === false && <Badge variant="secondary">{t('filters.disabled')}</Badge>}
                </div>

                {/* Abas */}
                <div className="px-4 pt-3 border-b border-border">
                  <div className="flex gap-8">
                    <button
                      onClick={() => setRightTab('info')}
                      className={`pb-3 text-sm font-medium transition-colors relative ${rightTab === 'info' ? 'text-green-500' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Info
                      {rightTab === 'info' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />}
                    </button>
                    {isContainerNode(detail) && (
                      <button
                        onClick={() => setRightTab('objetos')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${rightTab === 'objetos' ? 'text-green-500' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {t('tab.objects')}
                        {detail.child_count > 0 && <span className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded">{detail.child_count}</span>}
                        {rightTab === 'objetos' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Conteúdo da aba */}
                {rightTab === 'info' ? (
                  <div className="flex-1 overflow-auto p-4 space-y-4">
                    <div className="grid grid-cols-1 gap-1 text-sm">
                      <DetailRow label="Object ID" value={detail.object_id} mono />
                      <DetailRow label="Distinguished Name" value={detail.distinguished_name} mono />
                      {detail.samaccountname && <DetailRow label="samAccountName" value={detail.samaccountname} mono />}
                      {detail.description && <DetailRow label={t('common:fields.description')} value={detail.description} />}
                      {detail.whencreated ? <DetailRow label={t('common:fields.createdAt')} value={fmtDateTime(detail.whencreated)} /> : null}
                      {detail.child_count > 0 && <DetailRow label={isGroup(detail) ? t('detail.members') : t('detail.children')} value={String(detail.child_count)} />}
                    </div>
                    {detail.properties && Object.keys(detail.properties).length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">{t('detail.properties')}</div>
                        <div className="rounded border border-border divide-y divide-border">
                          {Object.entries(detail.properties).map(([k, v]) => (
                            <div key={k} className="flex gap-3 px-3 py-1.5 text-sm">
                              <span className="text-muted-foreground w-48 shrink-0 font-mono text-xs">{k}</span>
                              <span className="break-all">{formatProp(k, v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <ObjectsTab
                    loading={loadingObj}
                    items={objChildren}
                    sort={objSort}
                    setSort={setObjSort}
                    onSelect={selectNode}
                    isGroupContainer={isGroup(detail)}
                    ldapConfigured={ldapConfigured}
                    onMenuAction={onMenuAction}
                  />
                )}
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <ActionDialog action={menuAction} domainId={domainId} onClose={() => setMenuAction(null)} onConfirm={onMenuConfirm} />
    </div>
  );
};

// Diálogo das ações do menu de contexto (bloquear, senha, criar, add a grupo)
const ActionDialog = ({ action, domainId, onClose, onConfirm }) => {
  const { t } = useTranslation('ad-browse');
  const [form, setForm] = useState({ name: '', sam: '', password: '' });
  const [picker, setPicker] = useState({ q: '', results: [], picked: null, loading: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ name: '', sam: '', password: '' });
    setPicker({ q: '', results: [], picked: null, loading: false });
    setBusy(false);
  }, [action]);

  if (!action) return null;
  const { kind, node } = action;
  const name = node?.name || node?.object_id || '';

  const TITLES = {
    block: t('dialog.block'),
    'reset-password': t('dialog.resetPassword'),
    'create-user': t('dialog.createUser'),
    'create-group': t('dialog.createGroup'),
    'add-member': t('dialog.addMember'),
    'add-to-group': t('dialog.addToGroup'),
  };
  const pickerType = kind === 'add-member' ? 'User' : kind === 'add-to-group' ? 'Group' : null;

  const doSearch = async () => {
    const q = picker.q.trim();
    if (q.length < 2) return;
    setPicker((p) => ({ ...p, loading: true }));
    try {
      const { data } = await axios.get(`${API}/ad/domains/${domainId}/search`, { params: { q, object_type: pickerType, limit: 25 } });
      setPicker((p) => ({ ...p, results: data, loading: false }));
    } catch (e) {
      toast.error(apiErr(e, t('toast.searchError')));
      setPicker((p) => ({ ...p, loading: false }));
    }
  };

  const valid = (() => {
    if (kind === 'reset-password') return form.password.length >= 1;
    if (kind === 'create-user') return form.name.trim() && form.sam.trim();
    if (kind === 'create-group') return form.name.trim() && form.sam.trim();
    if (pickerType) return !!picker.picked;
    return true; // block
  })();

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(kind, node, { ...form, picked: picker.picked });
      onClose();
    } catch { /* mantém aberto */ } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[kind] || t('dialog.action')}</DialogTitle>
          <DialogDescription className="break-all">{name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {kind === 'block' && (
            <p className="text-sm text-muted-foreground">
              {t('dialog.blockConfirmPre')} <strong className="text-foreground">{t('dialog.blockConfirmStrong')}</strong> {t('dialog.blockConfirmPost')}
            </p>
          )}

          {kind === 'reset-password' && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('dialog.newPassword')}</label>
              <Input type="password" autoFocus value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={t('dialog.newPassword')} />
              <p className="text-[11px] text-muted-foreground">{t('dialog.requiresLdaps')}</p>
            </div>
          )}

          {(kind === 'create-user' || kind === 'create-group') && (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('dialog.nameCn')}</label>
                <Input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('dialog.namePlaceholder')} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">samAccountName</label>
                <Input value={form.sam} onChange={(e) => setForm((f) => ({ ...f, sam: e.target.value }))} placeholder="samAccountName" />
              </div>
              {kind === 'create-user' && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t('dialog.passwordOptional')}</label>
                  <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={t('dialog.passwordHint')} />
                  <p className="text-[11px] text-muted-foreground">{t('dialog.createUserHint')}</p>
                </div>
              )}
            </>
          )}

          {pickerType && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                {pickerType === 'User' ? t('dialog.selectUser') : t('dialog.selectGroup')}
              </label>
              <form onSubmit={(e) => { e.preventDefault(); doSearch(); }} className="flex gap-2">
                <Input value={picker.q} onChange={(e) => setPicker((p) => ({ ...p, q: e.target.value }))} placeholder={pickerType === 'User' ? t('dialog.searchUser') : t('dialog.searchGroup')} />
                <Button type="submit" size="sm" disabled={picker.loading}>
                  {picker.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </form>
              <div className="max-h-56 overflow-auto rounded border border-border divide-y divide-border">
                {picker.results.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">{t('dialog.noResults')}</div>
                ) : picker.results.map((r) => {
                  const Icon = typeIcon(r.object_type);
                  const sel = picker.picked?.id === r.id;
                  return (
                    <div key={r.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/50 ${sel ? 'bg-primary/10' : ''}`} onClick={() => setPicker((p) => ({ ...p, picked: r }))}>
                      <Icon className={`w-4 h-4 shrink-0 ${typeColor(r.object_type)}`} />
                      <div className="min-w-0">
                        <div className="truncate text-sm">{r.name || r.object_id}</div>
                        {r.distinguished_name && <div className="truncate text-[11px] text-muted-foreground">{r.distinguished_name}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common:actions.cancel')}</Button>
          <Button onClick={submit} disabled={busy || !valid} variant={kind === 'block' ? 'destructive' : 'default'}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {kind === 'block' ? t('menu.block') : t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Aba "Objetos": lista filhos (ou membros, p/ grupos) em tabela ordenável
const ObjectsTab = ({ loading, items, sort, setSort, onSelect, isGroupContainer, ldapConfigured, onMenuAction }) => {
  const { t } = useTranslation('ad-browse');
  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Folder className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-sm">{isGroupContainer ? t('objectsTab.noMembers') : t('objectsTab.noChildren')}</p>
      </div>
    );
  }

  const handleSort = (key) => setSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  const SortIcon = ({ columnKey }) => {
    if (sort.key !== columnKey) return <ChevronRight className="w-3 h-3 opacity-30" />;
    return sort.direction === 'asc' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3 rotate-[-90deg]" />;
  };

  const sorted = [...items].sort((a, b) => {
    // Containers primeiro, depois ordenação pela coluna
    const ac = isContainerNode(a) ? 0 : 1;
    const bc = isContainerNode(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    let av, bv;
    switch (sort.key) {
      case 'type': av = TYPE_RANK[a.object_type] ?? 9; bv = TYPE_RANK[b.object_type] ?? 9; break;
      case 'sam': av = (a.samaccountname || '').toLowerCase(); bv = (b.samaccountname || '').toLowerCase(); break;
      case 'created': av = Number(a.whencreated) || 0; bv = Number(b.whencreated) || 0; break;
      case 'name':
      default: av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
    }
    if (av < bv) return sort.direction === 'asc' ? -1 : 1;
    if (av > bv) return sort.direction === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted sticky top-0">
          <tr>
            <th className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80" onClick={() => handleSort('name')}>
              <div className="flex items-center gap-1">{t('common:fields.name')} <SortIcon columnKey="name" /></div>
            </th>
            <th className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80 w-28" onClick={() => handleSort('type')}>
              <div className="flex items-center gap-1">{t('common:fields.type')} <SortIcon columnKey="type" /></div>
            </th>
            <th className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80 w-48" onClick={() => handleSort('sam')}>
              <div className="flex items-center gap-1">samAccountName <SortIcon columnKey="sam" /></div>
            </th>
            <th className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80 w-44" onClick={() => handleSort('created')}>
              <div className="flex items-center gap-1">{t('objectsTab.created')} <SortIcon columnKey="created" /></div>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, idx) => {
            const Icon = typeIcon(item.object_type);
            return (
              <ObjectMenu key={item.id ?? idx} node={item} ldapConfigured={ldapConfigured} onAction={onMenuAction}>
                <tr className="hover:bg-muted/50 cursor-pointer" onClick={() => onSelect(item)}>
                  <td className="px-4 py-2 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 shrink-0 ${typeColor(item.object_type)}`} />
                      <span className="truncate text-blue-400 hover:underline">{item.name || item.object_id}</span>
                      {item.enabled === false && <Badge variant="secondary" className="text-[10px] py-0">off</Badge>}
                      {item.highvalue && <Badge variant="destructive" className="text-[10px] py-0">HV</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2 border-b border-border text-muted-foreground">{item.object_type}</td>
                  <td className="px-4 py-2 border-b border-border text-muted-foreground font-mono text-xs truncate">{item.samaccountname || '—'}</td>
                  <td className="px-4 py-2 border-b border-border text-muted-foreground text-xs">{fmtDateTime(item.whencreated)}</td>
                </tr>
              </ObjectMenu>
            );
          })}
        </tbody>
      </table>
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

// Propriedades BH que são epoch -> exibidas como data/hora
const EPOCH_PROPS = new Set(['whencreated', 'lastlogon', 'lastlogontimestamp', 'pwdlastset']);
const formatProp = (key, v) => {
  if (EPOCH_PROPS.has(String(key).toLowerCase()) && (typeof v === 'number' || /^\d+$/.test(String(v)))) {
    const n = Number(v);
    if (n > 0) return fmtDateTime(n);
  }
  return formatVal(v);
};

const formatVal = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export default AdBrowse;
