import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  ArrowLeft, FileText, FileCheck, File, Star, GitFork, AlertTriangle,
  Loader2, ExternalLink, FileX, ChevronRight, ChevronDown, Folder, FolderOpen, X, Code,
  Copy, Check, ShieldAlert, ScanText, GitCommit, History, Files, KeyRound, Workflow, RefreshCw,
} from 'lucide-react';
import { ShieldKeyIcon } from '@/components/icons';
import CodeViewer from '@/components/CodeViewer';
import OriginLogo from '@/components/OriginLogo';
import { formatDateTime } from '@/lib/datetime';
import { cn } from '@/lib/utils';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ---------------------------------------------------------------------------
// Monta uma árvore de diretórios a partir da lista plana de arquivos (rel_path).
// Nós de diretório são sintéticos; arquivos são folhas.
// ---------------------------------------------------------------------------
function buildTree(files) {
  const root = { name: '', path: '', type: 'dir', children: new Map() };
  for (const f of files) {
    const rel = f.rel_path || f.name || '';
    const parts = rel.split('/').filter(Boolean);
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        node.children.set(`f:${part}`, { name: part, path: acc, type: 'file', file: f });
      } else {
        const key = `d:${part}`;
        let child = node.children.get(key);
        if (!child) {
          child = { name: part, path: acc, type: 'dir', children: new Map() };
          node.children.set(key, child);
        }
        node = child;
      }
    }
  }
  return root;
}

// Ordena: diretórios primeiro, depois alfabético (case-insensitive) — estilo Explorer.
function sortedChildren(node) {
  if (!node || !node.children) return [];
  const arr = Array.from(node.children.values());
  arr.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
  return arr;
}

// Localiza um nó da árvore pelo caminho (para resolver a seleção após re-render).
function findNode(root, path) {
  if (!path) return root;
  const parts = path.split('/').filter(Boolean);
  let node = root;
  for (const part of parts) {
    if (!node || node.type !== 'dir') return null;
    node = node.children.get(`d:${part}`) || node.children.get(`f:${part}`);
  }
  return node || null;
}

// Árvore dos logs de pipeline: <id do pipeline>/<step>/<arquivo>.
function PipeTreeNode({ node, expanded, toggle, onOpen, depth = 0 }) {
  return (
    <div>
      {sortedChildren(node).map((c) => {
        const pad = { paddingLeft: `${depth * 12 + 8}px` };
        if (c.type === 'dir') {
          const open = expanded[c.path] !== false; // aberto por padrão
          return (
            <div key={c.path}>
              <div className="flex items-center gap-1 py-1 text-xs cursor-pointer hover:bg-muted/40 rounded"
                   style={pad} onClick={() => toggle(c.path)}>
                {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> : <Folder className="w-3.5 h-3.5 text-amber-500" />}
                <span className="font-mono truncate">{c.name}</span>
              </div>
              {open && <PipeTreeNode node={c} expanded={expanded} toggle={toggle} onOpen={onOpen} depth={depth + 1} />}
            </div>
          );
        }
        return (
          <div key={c.path} className="flex items-center gap-1 py-1 text-xs cursor-pointer hover:bg-muted/50 rounded"
               style={pad} onClick={() => onOpen(c.file)}>
            <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            <span className="font-mono text-blue-500 break-all">{c.name}</span>
            {c.file?.status && <span className="text-[10px] text-muted-foreground">· {c.file.status}</span>}
          </div>
        );
      })}
    </div>
  );
}

// Extensões cujo conteúdo normalmente vem de extração/OCR (doc/imagem/pdf).
const OCR_EXTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
]);

export default function GitRepoBrowser() {
  const { t } = useTranslation('github');
  const { guid } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileParam = searchParams.get('file'); // rel_path a abrir (deep-link, ex.: vindo de /leaks)
  const commitParam = searchParams.get('commit'); // commit (hash) a abrir p/ o arquivo do deep-link
  const location = useLocation();
  // Linha a destacar: hash estilo GitHub (#L173) tem prioridade; cai p/ ?line=.
  const hashLine = (location.hash.match(/^#L(\d+)/) || [])[1];
  const deepLine = hashLine || searchParams.get('line') || null;

  const [repo, setRepo] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [filterQuery, setFilterQuery] = useState('');

  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [viewerLine, setViewerLine] = useState(null); // linha a destacar no viewer (deep-link de leak)
  // Versionamento por commit: todas as versões do caminho aberto + a versão atual.
  const [versions, setVersions] = useState(null);
  const [currentVersionId, setCurrentVersionId] = useState(null);
  const [showHistory, setShowHistory] = useState(false); // inclui arquivos de commits antigos/removidos

  // Navegação por commit (estilo GitHub):
  // - panelMode: 'files' (árvore) | 'commits' (lista de commits)
  // - commitTree: quando setado, a árvore mostra os arquivos COMO ESTAVAM naquele commit
  const [panelMode, setPanelMode] = useState('files');
  const [commits, setCommits] = useState(null);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [commitTree, setCommitTree] = useState(null); // { commit, files, commit_url }

  // Seleção da árvore (pasta ou arquivo) + aba ativa do painel de detalhe.
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedKind, setSelectedKind] = useState(null); // 'dir' | 'file'
  const [activeTab, setActiveTab] = useState('info'); // 'info' | 'view' | 'ocr' | 'objetos'
  const [copiedField, setCopiedField] = useState(null);

  const [contentQ, setContentQ] = useState('');
  const [contentHits, setContentHits] = useState(null);
  const [searchingContent, setSearchingContent] = useState(false);
  const [searchMode, setSearchMode] = useState('filter'); // 'filter' | 'content'

  // Abas do painel esquerdo: Arquivos | Secrets | Pipeline
  const [leftTab, setLeftTab] = useState('files');
  const [secrets, setSecrets] = useState(null);
  const [secretsNote, setSecretsNote] = useState(null);
  const [secretsExposes, setSecretsExposes] = useState(false);
  const [pfiles, setPfiles] = useState(null);
  const [pnote, setPnote] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [pExpanded, setPExpanded] = useState({}); // pastas da árvore de pipelines

  // Modal "Identificar credencial vazada".
  const [showLeakModal, setShowLeakModal] = useState(false);
  const [leakTypes, setLeakTypes] = useState([]);
  const [manualLeak, setManualLeak] = useState({ secret_type: 'password', match_text: '', line_number: null, description: '' });
  const [submittingLeak, setSubmittingLeak] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '5000');
      if (showHistory) params.set('include_history', 'true');
      const res = await axios.get(`${API}/git/repos/${guid}/files?${params.toString()}`);
      setRepo(res.data?.repo || null);
      setFiles(res.data?.files || []);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadRepoError'));
    } finally {
      setLoading(false);
    }
  }, [guid, t, showHistory]);

  useEffect(() => { loadFiles(); /* eslint-disable-next-line */ }, [guid, showHistory]);

  const [reindexing, setReindexing] = useState(false);
  const reindexRepo = useCallback(async () => {
    setReindexing(true);
    try {
      const res = await axios.post(`${API}/git/repos/${guid}/reindex`);
      const mode = res.data?.mode;
      toast.success(mode === 'reclone' ? t('toast.reindexReclone') : t('toast.reindexQueued'));
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setReindexing(false);
    }
  }, [guid, t]);

  // Busca as versões (commits) de um caminho. Retorna a lista.
  const fetchVersions = useCallback(async (relPath) => {
    try {
      const res = await axios.get(
        `${API}/git/repos/${guid}/files/by-path?path=${encodeURIComponent(relPath)}`
      );
      return res.data?.versions || [];
    } catch (e) {
      return [];
    }
  }, [guid]);

  // Carrega o conteúdo de uma versão específica (file_id) no painel de detalhe.
  const loadVersionContent = useCallback(async (fileId) => {
    setCurrentVersionId(fileId);
    setFileContent(null);
    setLoadingContent(true);
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/files/${fileId}`);
      setFileContent(res.data);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadFileError'));
    } finally {
      setLoadingContent(false);
    }
  }, [guid, t]);

  // Monta a nota a exibir: estado do último job (em andamento/falha) tem prioridade
  // sobre a nota da coleta, para o usuário entender por que está vazio.
  const jobNote = (data, fallbackNote) => {
    const lj = data?.last_job;
    if (lj?.running) return t('ci.collectRunning');
    if (lj?.status === 'failed') return `${t('ci.collectFailed')}: ${lj.error || ''}`;
    return fallbackNote || null;
  };

  // --- CI: Secrets e Pipelines deste repo ---
  const loadSecrets = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/secrets`);
      setSecrets(res.data?.secrets || []);
      setSecretsNote(jobNote(res.data, res.data?.note));
      setSecretsExposes(!!res.data?.exposes_values);
    } catch (e) { setSecrets([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guid, t]);

  const loadPipelineFiles = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/pipeline-files`);
      setPfiles(res.data?.files || []);
      setPnote(jobNote(res.data, res.data?.note));
    } catch (e) { setPfiles([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guid, t]);

  const collect = useCallback(async (taskKind, more = false) => {
    setCollecting(true);
    try {
      const res = await axios.post(`${API}/git/repos/${guid}/collect`, { task: taskKind, more });
      if (res.data?.queued) {
        toast.success(t('ci.collectQueued'));
        // A coleta roda em BACKGROUND — faz polling para refletir o resultado assim
        // que o job terminar (sem precisar recarregar a página).
        const reload = taskKind === 'secrets' ? loadSecrets : loadPipelineFiles;
        let n = 0;
        const iv = setInterval(async () => {
          n += 1;
          await reload();
          if (n >= 18) clearInterval(iv); // ~90s (18 x 5s)
        }, 5000);
      } else {
        toast.message(res.data?.reason || t('ci.collectBusy'));
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setCollecting(false); }
  }, [guid, t, loadSecrets, loadPipelineFiles]);

  // Recarrega SEMPRE que a aba é aberta (não só na 1ª vez) — para refletir coletas
  // em background feitas desde a última visita.
  useEffect(() => {
    if (leftTab === 'secrets') loadSecrets();
    if (leftTab === 'pipeline') loadPipelineFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftTab]);

  // Conteúdo de um blob que não foi indexado como versão (ex.: binário/grande),
  // lido direto do clone no commit indicado.
  const loadBlobContent = useCallback(async (sha, relPath) => {
    setCurrentVersionId(null);
    setFileContent(null);
    setLoadingContent(true);
    try {
      const params = new URLSearchParams();
      if (sha) params.set('commit', sha);
      if (relPath) params.set('path', relPath);
      const res = await axios.get(`${API}/git/repos/${guid}/blob?${params.toString()}`);
      setFileContent(res.data);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadFileError'));
    } finally {
      setLoadingContent(false);
    }
  }, [guid, t]);

  // Lista de commits do repositório (tela "Commits", estilo GitHub).
  const loadCommits = useCallback(async () => {
    setLoadingCommits(true);
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/commits?limit=300`);
      setCommits(res.data?.commits || []);
      if (res.data?.repo) setRepo(res.data.repo);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadCommitsError'));
      setCommits([]);
    } finally {
      setLoadingCommits(false);
    }
  }, [guid, t]);

  // Entra no modo "árvore no commit": a árvore passa a mostrar os arquivos COMO
  // estavam naquele commit (git ls-tree), igual ao /tree/<sha> do GitHub.
  const enterCommitTree = useCallback(async (sha, openPath, openLine) => {
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/tree?commit=${encodeURIComponent(sha)}`);
      const data = res.data || {};
      setCommitTree({ commit: data.commit || { hash: sha, short: (sha || '').slice(0, 7) }, files: data.files || [], commit_url: data.commit_url });
      setPanelMode('files');
      setSelectedFile(null); setSelectedPath(null); setSelectedKind(null);
      setFileContent(null); setVersions(null); setViewerLine(null);
      setFilterQuery(''); setExpandedNodes({});
      if (data.repo) setRepo(data.repo);
      if (openPath) {
        const entry = (data.files || []).find((f) => f.rel_path === openPath);
        if (entry) {
          const commitSha = data.commit?.hash || sha;
          setSelectedFile(entry); setSelectedPath(entry.rel_path); setSelectedKind('file');
          setViewerLine(openLine ? parseInt(openLine, 10) : null);
          setActiveTab(openLine ? 'view' : 'info');
          const parts = (entry.rel_path || '').split('/').filter(Boolean);
          if (parts.length > 1) {
            const anc = {}; let acc = '';
            for (let i = 0; i < parts.length - 1; i++) { acc = acc ? `${acc}/${parts[i]}` : parts[i]; anc[acc] = true; }
            setExpandedNodes(anc);
          }
          fetchVersions(entry.rel_path).then(setVersions);
          if (entry.id) loadVersionContent(entry.id);
          else loadBlobContent(commitSha, entry.rel_path);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadTreeError'));
    }
  }, [guid, t, fetchVersions, loadVersionContent, loadBlobContent]);

  const exitCommitTree = useCallback(() => {
    setCommitTree(null);
    setSelectedFile(null); setSelectedPath(null); setSelectedKind(null);
    setFileContent(null); setVersions(null); setExpandedNodes({});
  }, []);

  // Tipos de credencial para o modal de identificação manual.
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/v2/gitleaks/leak-types`);
        setLeakTypes(res.data || []);
      } catch (e) {
        setLeakTypes([]);
      }
    })();
  }, []);

  const filterActive = filterQuery.trim() !== '';

  // Fonte da árvore: os arquivos do commit (quando navegando um commit) ou os atuais.
  const sourceFiles = commitTree ? commitTree.files : files;

  // Lista filtrada client-side por caminho; a árvore é remontada sobre ela.
  const visibleFiles = useMemo(() => {
    if (!filterActive) return sourceFiles;
    const q = filterQuery.trim().toLowerCase();
    return sourceFiles.filter(f => (f.rel_path || '').toLowerCase().includes(q));
  }, [sourceFiles, filterQuery, filterActive]);

  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

  const toggleNode = (path) => {
    setExpandedNodes(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const openFile = useCallback(async (f, opts = {}) => {
    setSelectedFile(f);
    setSelectedPath(f.rel_path);
    setSelectedKind('file');
    setViewerLine(opts.line ? parseInt(opts.line, 10) : null);
    setActiveTab((prev) => (opts.line ? 'view' : (prev === 'objetos' ? 'info' : prev)));
    setVersions(null);
    setFileContent(null);
    // Expandir diretórios ancestrais para o arquivo ficar visível na árvore.
    const parts = (f.rel_path || '').split('/').filter(Boolean);
    if (parts.length > 1) {
      const anc = {};
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        anc[acc] = true;
      }
      setExpandedNodes(prev => ({ ...prev, ...anc }));
    }
    // Carrega as versões do caminho (para o seletor de versões).
    const vs = await fetchVersions(f.rel_path);
    setVersions(vs);
    // Conteúdo: se há file_id (blob indexado) usa-o; senão lê o blob no commit.
    if (f.id) {
      await loadVersionContent(f.id);
    } else if (opts.commit || commitTree) {
      await loadBlobContent(opts.commit || commitTree?.commit?.hash, f.rel_path);
    } else if (vs[0]) {
      await loadVersionContent(vs[0].id);
    }
  }, [fetchVersions, loadVersionContent, loadBlobContent, commitTree]);

  // Abre um resultado de busca de conteúdo — pode ser uma versão histórica
  // (arquivo que só existe num commit antigo e não está na árvore atual).
  const openContentHit = useCallback((h) => {
    if (h.file_id) {
      const base = { rel_path: h.rel_path, id: h.file_id, name: h.name || (h.rel_path || '').split('/').pop() };
      openFile(base, h.commit_hash ? { commit: h.commit_hash } : {});
      return;
    }
    const f = files.find((ff) => ff.rel_path === h.rel_path);
    if (f) openFile(f);
  }, [files, openFile]);

  // Deep-link:
  // - ?commit=<hash> (ex.: vindo de um leak): abre a ÁRVORE INTEIRA naquele commit
  //   (estilo GitHub /tree/<sha>) e, se houver ?file=, já abre esse arquivo.
  // - só ?file=<rel_path>: abre o arquivo na árvore atual.
  useEffect(() => {
    if (autoOpened) return;
    if (commitParam) {
      enterCommitTree(commitParam, fileParam || undefined, deepLine || undefined);
      setAutoOpened(true);
      return;
    }
    if (!fileParam || files.length === 0) return;
    const target = files.find((f) => f.rel_path === fileParam);
    if (target) {
      openFile(target, deepLine ? { line: deepLine } : {});
      setAutoOpened(true);
    }
  }, [files, fileParam, commitParam, deepLine, autoOpened, openFile, enterCommitTree]);

  // Carrega os commits ao entrar na aba "Commits".
  useEffect(() => {
    if (panelMode === 'commits' && commits === null && !loadingCommits) loadCommits();
  }, [panelMode, commits, loadingCommits, loadCommits]);

  // Seleciona uma PASTA (mostra os Objetos no painel direito) e a expande.
  const selectDir = useCallback((path) => {
    setSelectedPath(path);
    setSelectedKind('dir');
    setActiveTab('objetos');
    if (path) setExpandedNodes(prev => ({ ...prev, [path]: true }));
  }, []);

  const copyToClipboard = useCallback(async (text, field) => {
    try {
      await navigator.clipboard.writeText(String(text ?? ''));
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch (e) { /* ignore */ }
  }, []);

  const submitManualLeak = useCallback(async () => {
    if (!selectedFile) return;
    if (!selectedFile.id) { toast.error(t('leakModal.notIndexed')); return; }
    setSubmittingLeak(true);
    try {
      const res = await axios.post(`${API}/git/repos/${guid}/files/${selectedFile.id}/manual-leak`, {
        secret_type: manualLeak.secret_type,
        match_text: manualLeak.match_text || null,
        line_number: manualLeak.line_number || null,
        description: manualLeak.description || null,
      });
      if (res.data?.success !== false) {
        toast.success(t('leakModal.success'));
        setShowLeakModal(false);
        setManualLeak({ secret_type: 'password', match_text: '', line_number: null, description: '' });
        loadFiles(); // atualiza leaks_count do repo no header
      } else {
        toast.error(res.data?.message || t('leakModal.error'));
      }
    } catch (e) {
      console.error(e);
      toast.error(t('leakModal.error'));
    } finally {
      setSubmittingLeak(false);
    }
  }, [guid, selectedFile, manualLeak, loadFiles, t]);

  const runContentSearch = async () => {
    const term = contentQ.trim();
    if (!term) return;
    setSearchingContent(true);
    try {
      const res = await axios.get(`${API}/git/search/content?q=${encodeURIComponent(term)}&repo_guid=${guid}&limit=50`);
      setContentHits(res.data?.hits || []);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.searchError'));
    } finally {
      setSearchingContent(false);
    }
  };

  const fmtSize = (n) => {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const fmtDate = (s) => formatDateTime(s);

  const changeTypeLabel = (ct) => {
    const map = { A: t('changeType.added'), M: t('changeType.modified'), D: t('changeType.deleted'), R: t('changeType.renamed') };
    return map[ct] || ct || '—';
  };

  // Plataforma de origem para os links "ver na origem" e o botão de abrir.
  const originInfo = useMemo(() => {
    const html = repo?.html_url || '';
    const s = `${html} ${repo?.clone_url || ''} ${repo?.source || ''}`.toLowerCase();
    let key = null, label = null;
    if (s.includes('github')) { key = 'github'; label = 'GitHub'; }
    else if (s.includes('gitlab')) { key = 'gitlab'; label = 'GitLab'; }
    else if (s.includes('bitbucket')) { key = 'bitbucket'; label = 'Bitbucket'; }
    else if (s.includes('dev.azure') || s.includes('visualstudio') || s.includes('azure')) { key = 'azure'; label = 'Azure DevOps'; }
    else if (s.includes('gitea')) { key = 'gitea'; label = 'Gitea'; }
    return { html, key, label };
  }, [repo]);

  // Commit do conteúdo exibido (árvore-no-commit, versão do arquivo, ou HEAD).
  const currentCommitSha = commitTree?.commit?.hash || fileContent?.commit_hash || null;

  // URL compartilhável interna, com #L<linha> (estilo GitHub).
  const buildShareUrl = useCallback((line) => {
    const params = new URLSearchParams();
    if (selectedFile?.rel_path) params.set('file', selectedFile.rel_path);
    if (currentCommitSha) params.set('commit', currentCommitSha);
    const qs = params.toString();
    return `${window.location.origin}/git/${guid}${qs ? `?${qs}` : ''}#L${line}`;
  }, [guid, selectedFile, currentCommitSha]);

  // URL do arquivo na plataforma de origem, apontando para a linha.
  const buildOriginUrl = useCallback((line) => {
    const html = originInfo.html;
    const path = selectedFile?.rel_path;
    if (!html || !path || !originInfo.key) return null;  // sem plataforma (ex.: git-dump) -> sem link
    const ref = currentCommitSha || repo?.default_branch || 'HEAD';
    if (originInfo.key === 'gitlab') return `${html}/-/blob/${ref}/${path}#L${line}`;
    if (originInfo.key === 'bitbucket') return `${html}/src/${ref}/${path}#lines-${line}`;
    return `${html}/blob/${ref}/${path}#L${line}`;
  }, [originInfo, currentCommitSha, selectedFile, repo]);

  // -------------------------------------------------------------------------
  // Renderização recursiva da árvore — mesmo visual do ServerBrowser:
  // linhas-guia por profundidade, chevron, ícone de pasta/arquivo, hover/seleção.
  // -------------------------------------------------------------------------
  const renderTreeNode = (node, depth = 0, isLastChild = true, parentLines = []) => {
    if (depth > 60) return null;
    const isDirectory = node.type === 'dir';
    const isExpanded = filterActive || !!expandedNodes[node.path];
    const f = node.file;
    const isSelected = selectedPath === node.path && selectedKind === (isDirectory ? 'dir' : 'file');
    const children = isDirectory ? sortedChildren(node) : [];

    const handleClick = () => {
      if (isDirectory) {
        setSelectedPath(node.path);
        setSelectedKind('dir');
        setActiveTab('objetos');
        toggleNode(node.path);
      } else if (f) {
        openFile(f);
      }
    };

    return (
      <div key={`${node.type}:${node.path}`}>
        <div
          className={cn(
            'group flex items-center cursor-pointer hover:bg-muted/50 rounded transition-colors',
            isSelected ? 'bg-primary/10 text-primary' : ''
          )}
          style={{ paddingLeft: '8px', paddingRight: '8px', minHeight: '32px' }}
          onClick={handleClick}
          data-testid={isDirectory ? 'git-tree-folder' : 'git-file-row'}
          data-item-path={node.path}
        >
          {/* Linhas-guia da árvore */}
          {depth > 0 && (
            <div className="flex items-stretch" style={{ height: '32px' }}>
              {parentLines.map((showLine, idx) => (
                <div key={idx} className="w-4 flex justify-center">
                  {showLine && <div className="w-px bg-border/60" style={{ height: '100%' }} />}
                </div>
              ))}
              <div className="w-4 flex items-center relative">
                <div
                  className="absolute left-1/2 -translate-x-1/2 w-px bg-border/60"
                  style={{ top: 0, height: isLastChild ? '50%' : '100%' }}
                />
                <div
                  className="absolute bg-border/60"
                  style={{ left: '50%', width: isDirectory ? '50%' : 'calc(50% + 20px)', height: '1px', top: '50%' }}
                />
              </div>
            </div>
          )}

          {/* Chevron expand/collapse */}
          {isDirectory ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleNode(node.path); }}
              className="p-0.5 hover:bg-muted rounded flex-shrink-0"
            >
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}

          {/* Ícone */}
          <div className="mx-1 flex-shrink-0">
            {isDirectory ? (
              isExpanded
                ? <FolderOpen className="w-4 h-4 text-blue-500" />
                : <Folder className="w-4 h-4 text-blue-500" />
            ) : f?.is_binary ? (
              <FileX className="w-4 h-4 text-gray-500" />
            ) : (
              <FileText className="w-4 h-4 text-gray-500" />
            )}
          </div>

          {/* Nome */}
          <span
            className={cn('text-sm truncate flex-1 font-mono', isDirectory ? 'text-blue-400' : '')}
            title={node.path}
          >
            {node.name}
          </span>

          {/* Badge indexado (somente arquivos) */}
          {!isDirectory && f?.indexed && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1 flex-shrink-0">
              {t('browser.indexed')}
            </Badge>
          )}
        </div>

        {/* Filhos */}
        {isDirectory && isExpanded && children.length > 0 && (
          <div>
            {children.map((child, index, arr) => {
              const isLast = index === arr.length - 1;
              const newParentLines = [...parentLines, !isLastChild];
              return renderTreeNode(child, depth + 1, isLast, newParentLines);
            })}
          </div>
        )}
      </div>
    );
  };

  const rootChildren = sortedChildren(tree);

  // Pasta atualmente selecionada, resolvida na árvore (para a aba "Objetos").
  const selectedDirNode = useMemo(
    () => (selectedKind === 'dir' ? findNode(tree, selectedPath) : null),
    [tree, selectedKind, selectedPath]
  );

  const blobUrl = (relPath) => {
    if (!repo?.html_url) return null;
    const branch = repo.default_branch || 'HEAD';
    return `${repo.html_url}/blob/${branch}/${(relPath || '').split('/').map(encodeURIComponent).join('/')}`;
  };

  const fileExt = (f) => (f?.extension || (f?.name || '').split('.').pop() || '').toLowerCase();
  const isOcrFile = (f) => OCR_EXTS.has(fileExt(f));

  // -------------------------------------------------------------------------
  // Painel direito de detalhe (igual ao ServerBrowser):
  //  - pasta selecionada  -> aba Objetos (tabela de filhos)
  //  - arquivo selecionado -> abas Info / View / OCR + ações
  // -------------------------------------------------------------------------
  const renderDetailPanel = () => {
    if (!selectedPath && !selectedFile) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t('browser.selectItem')}</p>
        </div>
      );
    }

    // --- Pasta selecionada: tabela de Objetos ---
    if (selectedKind === 'dir') {
      const name = selectedPath ? selectedPath.split('/').pop() : repo?.full_name;
      const children = sortedChildren(selectedDirNode);
      return (
        <div className="h-full flex flex-col">
          <div className="flex items-center gap-2 p-4 border-b border-border min-w-0">
            <Folder className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <h2 className="text-lg font-semibold truncate" title={selectedPath}>{name}</h2>
          </div>
          <div className="px-4 pt-4 border-b border-border">
            <div className="flex gap-8">
              <span className="pb-3 text-sm font-medium text-green-500 relative">
                {t('tabs.objects')}
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {children.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Folder className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">{t('objects.empty')}</p>
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="git-objetos-table">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium border-b border-border">{t('objects.name')}</th>
                    <th className="px-4 py-2 text-left font-medium border-b border-border w-24">{t('objects.type')}</th>
                    <th className="px-4 py-2 text-right font-medium border-b border-border w-28">{t('objects.size')}</th>
                    <th className="px-4 py-2 text-left font-medium border-b border-border w-32">{t('objects.modified')}</th>
                  </tr>
                </thead>
                <tbody>
                  {children.map((child) => {
                    const childIsDir = child.type === 'dir';
                    return (
                      <tr
                        key={`${child.type}:${child.path}`}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => (childIsDir ? selectDir(child.path) : child.file && openFile(child.file))}
                      >
                        <td className="px-4 py-2 border-b border-border">
                          <div className="flex items-center gap-2 min-w-0">
                            {childIsDir
                              ? <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              : child.file?.is_binary
                                ? <FileX className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                : <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                            <span className="truncate text-blue-400 hover:underline">{child.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 border-b border-border text-muted-foreground">
                          {childIsDir ? t('objects.folder') : t('objects.file')}
                        </td>
                        <td className="px-4 py-2 border-b border-border text-right text-muted-foreground font-mono text-xs">
                          {childIsDir ? '—' : fmtSize(child.file?.size)}
                        </td>
                        <td className="px-4 py-2 border-b border-border text-muted-foreground text-xs">—</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    }

    // --- Arquivo selecionado: Info / View / OCR ---
    const ocrApplicable = isOcrFile(selectedFile);
    const tabBtn = (key, label, icon) => (
      <button
        onClick={() => setActiveTab(key)}
        data-testid={`git-file-${key}-tab`}
        className={cn(
          'pb-3 text-sm font-medium transition-colors relative flex items-center gap-1.5',
          activeTab === key ? 'text-green-500' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {icon}{label}
        {activeTab === key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />}
      </button>
    );

    return (
      <div className="h-full flex flex-col">
        {/* Header do arquivo + ações */}
        <div className="flex items-center justify-between p-4 border-b border-border gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selectedFile?.is_binary
              ? <FileX className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              : <FileCheck className="w-5 h-5 text-green-500 flex-shrink-0" />}
            <h2 className="text-lg font-semibold truncate" title={selectedFile?.rel_path}>{selectedFile?.name}</h2>
            {(fileContent?.indexed ?? selectedFile?.indexed) && (
              <Badge variant="outline" className="ml-1 flex-shrink-0 text-green-500 border-green-500">
                {t('browser.indexed')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10"
              onClick={() => setShowLeakModal(true)}
              data-testid="git-identify-credential-button"
              title={t('actions.identify')}
            >
              <ShieldKeyIcon className="w-4 h-4 mr-1" />
              {t('actions.identify')}
            </Button>
            {blobUrl(selectedFile?.rel_path) && (
              <a href={blobUrl(selectedFile?.rel_path)} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline" className="h-7">
                  <ExternalLink className="w-4 h-4 mr-2" />{t('actions.open')}
                </Button>
              </a>
            )}
          </div>
        </div>

        {/* Seletor de versões (commits) do arquivo */}
        {versions && versions.length > 1 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30" data-testid="git-version-bar">
            <GitCommit className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground flex-shrink-0">{t('versions.label')}</span>
            <div className="min-w-0 flex-1 max-w-md">
              <Select
                value={currentVersionId ? String(currentVersionId) : ''}
                onValueChange={(v) => loadVersionContent(parseInt(v, 10))}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="git-version-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)} className="text-xs">
                      {(v.is_head ? '● ' : '') + (v.commit_short || '—') + ' · ' + changeTypeLabel(v.change_type) + ' · ' + fmtDate(v.commit_date)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="secondary" className="text-xs flex-shrink-0">{versions.length} {t('versions.count')}</Badge>
          </div>
        )}

        {/* Abas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-4 border-b border-border">
            <div className="flex gap-8">
              {tabBtn('info', t('tabs.info'), null)}
              {tabBtn('view', t('tabs.view'), null)}
              {tabBtn('ocr', t('tabs.ocr'), <ScanText className="w-3.5 h-3.5" />)}
            </div>
          </div>

          {/* Info */}
          {activeTab === 'info' && (
            <ScrollArea className="flex-1">
              <div className="p-4 flex flex-col gap-3">
                <InfoRow label={t('info.name')} value={selectedFile?.name}
                  onCopy={() => copyToClipboard(selectedFile?.name, 'name')} copied={copiedField === 'name'} />
                <InfoRow label={t('info.path')} value={selectedFile?.rel_path} valueClassName="font-mono text-xs"
                  onCopy={() => copyToClipboard(selectedFile?.rel_path, 'path')} copied={copiedField === 'path'} />
                <InfoRow label={t('info.size')} value={fmtSize(fileContent?.size ?? selectedFile?.size)} />
                <InfoRow label={t('info.mime')} value={fileContent?.mimetype || '—'} valueClassName="font-mono text-xs" />
                <InfoRow label={t('info.extension')} value={fileExt(selectedFile) ? `.${fileExt(selectedFile)}` : '—'} valueClassName="font-mono text-xs" />
                <InfoRow label={t('info.sha1')} value={fileContent?.sha1 || '—'} valueClassName="font-mono text-xs"
                  onCopy={fileContent?.sha1 ? () => copyToClipboard(fileContent.sha1, 'sha1') : undefined} copied={copiedField === 'sha1'} />
                <InfoRow label={t('info.indexed')}
                  value={(fileContent?.indexed ?? selectedFile?.indexed) ? t('info.yes') : t('info.no')}
                  valueClassName={(fileContent?.indexed ?? selectedFile?.indexed) ? 'text-green-500' : 'text-muted-foreground'} />

                {/* Dados do commit (indexação de histórico) */}
                {fileContent?.commit_short && (
                  <>
                    <div className="pt-2 mt-1 border-t border-border flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                      <GitCommit className="w-3.5 h-3.5" /> {t('info.commitSection')}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <InfoRow label={t('info.commit')} value={fileContent.commit_short} valueClassName="font-mono text-xs"
                        onCopy={() => copyToClipboard(fileContent.commit_hash, 'commit')} copied={copiedField === 'commit'} />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap -mt-1">
                      {fileContent.commit_hash && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => enterCommitTree(fileContent.commit_hash, fileContent.rel_path)}
                          data-testid="git-view-tree-at-commit"
                        >
                          <GitCommit className="w-3.5 h-3.5 mr-1" /> {t('commits.browseTree')}
                        </Button>
                      )}
                      {fileContent.commit_url && (
                        <a href={fileContent.commit_url} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-500 inline-flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> {t('info.viewCommit')}
                        </a>
                      )}
                    </div>
                    {/* Arquivo removido: abrir a árvore no commit anterior (onde ainda existia) */}
                    {fileContent.change_type === 'D' && fileContent.parent_commit && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs flex items-center gap-2 flex-wrap">
                        <span className="text-amber-600 dark:text-amber-400">{t('info.deletedHint')}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => enterCommitTree(fileContent.parent_commit, fileContent.rel_path)}
                          data-testid="git-view-tree-parent-commit"
                        >
                          <GitCommit className="w-3.5 h-3.5 mr-1" />
                          {t('info.viewParentTree', { short: fileContent.parent_short })}
                        </Button>
                      </div>
                    )}
                    <InfoRow label={t('info.branch')} value={fileContent.branch || '—'} valueClassName="font-mono text-xs" />
                    <InfoRow label={t('info.author')} value={fileContent.author || '—'} />
                    <InfoRow label={t('info.commitDate')} value={fmtDate(fileContent.commit_date)} />
                    <InfoRow label={t('info.changeType')} value={changeTypeLabel(fileContent.change_type)}
                      valueClassName={fileContent.change_type === 'D' ? 'text-red-500' : ''} />
                    <InfoRow label={t('info.isHead')}
                      value={fileContent.is_head ? t('info.yes') : t('info.no')}
                      valueClassName={fileContent.is_head ? 'text-green-500' : 'text-amber-500'} />
                    {fileContent.versions_count > 1 && (
                      <InfoRow label={t('info.versions')} value={fileContent.versions_count} />
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          )}

          {/* View */}
          {activeTab === 'view' && (
            <div className="flex-1 overflow-hidden">
              {loadingContent ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : fileContent?.is_binary ? (
                <div className="flex items-center justify-center h-full text-muted-foreground"><p className="text-sm">{t('browser.binary')}</p></div>
              ) : !fileContent?.content ? (
                <div className="flex items-center justify-center h-full text-muted-foreground"><p className="text-sm">{t('browser.noContent')}</p></div>
              ) : (
                <CodeViewer
                  content={fileContent.content}
                  filename={selectedFile?.name || fileContent?.name}
                  highlightLine={viewerLine}
                  copyLabel={t('view.copy')}
                  copiedLabel={t('view.copied')}
                  wrapLabel={t('view.wrap')}
                  unwrapLabel={t('view.unwrap')}
                  copyLineLabel={t('view.copyLine')}
                  copyUrlLabel={t('view.copyUrl')}
                  viewOriginLabel={t('view.viewOrigin')}
                  urlCopiedLabel={t('view.urlCopied')}
                  getShareUrl={buildShareUrl}
                  getOriginUrl={buildOriginUrl}
                  originLabel={originInfo.label}
                />
              )}
            </div>
          )}

          {/* OCR */}
          {activeTab === 'ocr' && (
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <ScanText className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium">{t('ocr.title')}</span>
                  {loadingContent && <Loader2 className="w-4 h-4 animate-spin" />}
                </div>
                {!ocrApplicable ? (
                  <div className="p-6 text-center border border-dashed border-border rounded-lg">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-muted-foreground">{t('ocr.notApplicable')}</p>
                  </div>
                ) : fileContent?.content ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t('ocr.extracted')}</span>
                      <Button size="sm" variant="outline" onClick={() => copyToClipboard(fileContent.content, 'ocr')}>
                        <Copy className="w-3 h-3 mr-1" />{t('ocr.copy')}
                      </Button>
                    </div>
                    <pre className="p-4 bg-muted rounded-lg text-xs font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">{fileContent.content}</pre>
                  </div>
                ) : (
                  <div className="p-6 text-center border border-dashed border-border rounded-lg">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-muted-foreground">{fileContent?.content_error || t('ocr.notProcessed')}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    );
  };

  // Tela "Commits" (estilo GitHub): lista de commits; clicar abre a árvore no commit.
  const renderCommitsPanel = () => (
    <div className="flex-1 overflow-hidden flex flex-col" data-testid="git-commits-panel">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <GitCommit className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{t('commits.title')}</h3>
        {commits && <span className="text-xs text-primary">{commits.length}</span>}
        {loadingCommits && <Loader2 className="w-4 h-4 animate-spin" />}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2 max-w-4xl mx-auto">
          {loadingCommits && !commits ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (commits || []).length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">{t('commits.empty')}</div>
          ) : (
            (commits || []).map((c) => (
              <div key={c.hash} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3 hover:bg-muted/40 transition-colors">
                <div className="min-w-0">
                  <button
                    onClick={() => enterCommitTree(c.hash)}
                    className="text-left font-medium hover:text-primary truncate block max-w-full"
                    title={c.subject}
                  >
                    {c.subject || c.short}
                  </button>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {c.author} · {fmtDate(c.date)}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <code className="text-xs font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{c.short}</code>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={t('commits.copyHash')}
                    onClick={() => copyToClipboard(c.hash, `c:${c.short}`)}>
                    {copiedField === `c:${c.short}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={t('commits.browseTree')}
                    onClick={() => enterCommitTree(c.hash)} data-testid="git-commit-browse">
                    <Code className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col relative w-full" data-testid="git-repo-browser-page">
      {/* Header compacto (igual ao ServerBrowser) */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate('/git')}>
            <ArrowLeft className="w-4 h-4 mr-2" />{t('browser.back')}
          </Button>
          {repo && (
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <OriginLogo repo={repo} className="w-5 h-5 flex-shrink-0" />
                <h1 className="text-xl font-semibold truncate" title={repo.full_name}>{repo.full_name}</h1>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {repo.language && <Badge variant="secondary" className="text-xs">{repo.language}</Badge>}
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Star className="w-3 h-3" />{repo.stars ?? 0}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><GitFork className="w-3 h-3" />{repo.forks ?? 0}</span>
                {repo.leaks_count > 0 && <span className="inline-flex items-center gap-1 text-xs text-red-500"><AlertTriangle className="w-3 h-3" />{repo.leaks_count} {t('table.leaks')}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Alternância Arquivos | Commits */}
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setPanelMode('files')}
              className={cn('px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1',
                panelMode === 'files' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
              data-testid="git-view-files"
            >
              <FileText className="w-3.5 h-3.5" />{t('browser.files')}
            </button>
            <button
              onClick={() => setPanelMode('commits')}
              className={cn('px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 border-l border-border',
                panelMode === 'commits' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
              data-testid="git-view-commits"
            >
              <GitCommit className="w-3.5 h-3.5" />{t('commits.title')}
              {repo?.commits_count != null && <span className="opacity-70">({repo.commits_count})</span>}
            </button>
          </div>
          {repo && (
            <Badge
              variant="outline"
              className={cn('text-xs gap-1', repo.history_indexed ? 'text-green-500 border-green-500/50' : 'text-amber-500 border-amber-500/50')}
              title={repo.history_indexed ? t('history.indexedOn') : t('history.indexedOff')}
            >
              <History className="w-3 h-3" />
              {repo.history_indexed ? t('history.on') : t('history.off')}
            </Badge>
          )}
          {repo?.leaks_count > 0 && (
            <Button variant="outline" size="sm" className="text-red-500 border-red-500/40 hover:bg-red-500/10"
              onClick={() => navigate(`/leaks?repo_guid=${repo.guid}&repo=${encodeURIComponent(repo.full_name)}`)}
              data-testid="git-browser-view-leaks">
              <AlertTriangle className="w-4 h-4 mr-2" />{t('table.viewLeaks')} ({repo.leaks_count})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={reindexRepo} disabled={reindexing} title={t('history.reindexTitle')}>
            {reindexing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <History className="w-4 h-4 mr-2" />}
            {t('history.reindex')}
          </Button>
          {repo?.html_url && (
            <a href={repo.html_url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-2" />
                {originInfo.label ? t('browser.openOn', { platform: originInfo.label }) : t('browser.openUrl')}
              </Button>
            </a>
          )}
        </div>
      </div>

      {panelMode === 'commits' ? (
        renderCommitsPanel()
      ) : (
       <>
      {/* Banner: navegando os arquivos como estavam em um commit específico */}
      {commitTree && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-amber-500/10 text-amber-600 dark:text-amber-400" data-testid="git-commit-tree-banner">
          <GitCommit className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm min-w-0 truncate">
            {t('commits.viewingTree')}{' '}
            <span className="font-mono">{commitTree.commit?.short}</span>
            {commitTree.commit?.subject ? ` · ${commitTree.commit.subject}` : ''}
          </span>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {commitTree.commit_url && (
              <a href={commitTree.commit_url} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 hover:underline">
                <ExternalLink className="w-3 h-3" />GitHub
              </a>
            )}
            <Button size="sm" variant="outline" className="h-7" onClick={exitCommitTree} data-testid="git-exit-commit-tree">
              <X className="w-3.5 h-3.5 mr-1" />{t('commits.exitTree')}
            </Button>
          </div>
        </div>
      )}

      {/* Split view: árvore à esquerda, conteúdo à direita (igual ao ServerBrowser) */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Painel esquerdo - Árvore */}
          <ResizablePanel defaultSize={30} minSize={18} maxSize={55}>
            <div className="h-full border-r border-border bg-card flex flex-col">
              {/* Abas: Arquivos | Secrets | Pipeline */}
              <div className="p-2 border-b border-border flex items-center gap-1">
                {[['files', t('ci.tabFiles'), Files], ['secrets', t('ci.tabSecrets'), KeyRound], ['pipeline', t('ci.tabPipeline'), Workflow]].map(([k, label, Icon]) => (
                  <button key={k} onClick={() => setLeftTab(k)}
                    data-testid={`repo-tab-${k}`}
                    className={cn('flex-1 inline-flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded transition-colors',
                      leftTab === k ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                    <Icon className="w-3.5 h-3.5" />{label}
                  </button>
                ))}
              </div>

              {leftTab === 'files' && (<>
              {/* Busca: filtra por caminho OU busca no conteúdo (toggle <>) */}
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={searchMode === 'content' ? t('search.contentPlaceholder') : t('browser.searchFiles')}
                    value={searchMode === 'content' ? contentQ : filterQuery}
                    onChange={(e) => (searchMode === 'content' ? setContentQ(e.target.value) : setFilterQuery(e.target.value))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && searchMode === 'content') runContentSearch(); }}
                    className="w-full px-3 py-2 pr-20 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                    data-testid={searchMode === 'content' ? 'git-repo-content-search' : 'git-file-filter'}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {(loading || searchingContent) && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    {(searchMode === 'content' ? contentQ : filterQuery) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          if (searchMode === 'content') { setContentQ(''); setContentHits(null); }
                          else setFilterQuery('');
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      variant={searchMode === 'content' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setSearchMode((m) => (m === 'content' ? 'filter' : 'content'))}
                      title={t('search.contentToggle')}
                    >
                      <Code className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Cabeçalho da árvore */}
              <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {searchMode === 'content' ? t('search.contentTitle') : t('browser.files')}
                  {searchMode === 'content' && contentHits !== null && (
                    <span className="ml-2 text-xs text-primary">{contentHits.length}</span>
                  )}
                  {searchMode !== 'content' && filterActive && (
                    <span className="ml-2 text-xs text-primary">{visibleFiles.length}</span>
                  )}
                </h3>
                {searchMode !== 'content' && (
                  <button
                    onClick={() => setShowHistory((v) => !v)}
                    title={t('history.toggleTitle')}
                    data-testid="git-history-toggle"
                    className={cn(
                      'inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors flex-shrink-0',
                      showHistory ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <History className="w-3 h-3" /> {t('history.label')}
                  </button>
                )}
              </div>

              {/* Árvore (ou resultados de busca de conteúdo) */}
              <ScrollArea className="flex-1 tree-scroll-area">
                <div className="py-2 pr-3">
                  {searchMode === 'content' && contentHits !== null ? (
                    contentHits.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-sm text-muted-foreground">{t('search.contentEmpty')}</p>
                      </div>
                    ) : (
                      <div className="space-y-2 px-2">
                        {contentHits.map((h, i) => {
                          return (
                            <div
                              key={i}
                              className="border rounded-md p-2 text-sm cursor-pointer hover:bg-muted/50"
                              onClick={() => openContentHit(h)}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-mono text-xs text-blue-500 break-all">{h.rel_path}</div>
                                {h.commit_short && (
                                  <span className={cn(
                                    'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono',
                                    h.is_head ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'
                                  )}>
                                    <GitCommit className="w-2.5 h-2.5" />{h.commit_short}
                                  </span>
                                )}
                              </div>
                              {(h.highlights || []).map((hl, j) => (
                                <div
                                  key={j}
                                  className="text-xs font-mono text-muted-foreground mt-1"
                                  dangerouslySetInnerHTML={{ __html: hl }}
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : loading && files.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : rootChildren.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">{t('browser.noContent')}</p>
                    </div>
                  ) : (
                    rootChildren.map((child, index, arr) =>
                      renderTreeNode(child, 0, index === arr.length - 1, [])
                    )
                  )}
                </div>
              </ScrollArea>
              </>)}

              {/* Aba SECRETS */}
              {leftTab === 'secrets' && (
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-muted-foreground">{t('ci.secretsTitle')} · {secrets?.length || 0}</span>
                      <Button size="sm" variant="outline" disabled={collecting} onClick={() => collect('secrets')} data-testid="collect-secrets">
                        {collecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}{t('ci.collect')}
                      </Button>
                    </div>
                    {secretsNote && <div className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded p-2">{secretsNote}</div>}
                    {!secretsExposes && (secrets?.length > 0) && <div className="text-xs text-muted-foreground">{t('ci.valuesHidden')}</div>}
                    {(secrets || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">{t('ci.secretsEmpty')}</p>
                    ) : secrets.map((s) => (
                      <div key={s.guid} className="border rounded p-2 text-sm">
                        <div className="font-mono text-xs text-blue-500 break-all flex items-center gap-1.5 flex-wrap">
                          {s.name}
                          {s.is_jwt && <Badge variant="outline" className="text-[10px]">JWT</Badge>}
                          {s.protected && <Badge variant="outline" className="text-[10px]">protected</Badge>}
                        </div>
                        <div className="font-mono text-xs break-all mt-1">
                          {s.value_exposed ? (s.value || '""') : <span className="text-muted-foreground italic">{t('ci.notExposed')}</span>}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">{t('ci.obtainedWith')}: {s.obtained_with || '—'}{s.scope ? ` · ${s.scope}` : ''}</div>
                        {s.decoded_claims && <pre className="text-[10px] bg-muted/40 rounded p-1 mt-1 whitespace-pre-wrap break-all">{s.decoded_claims}</pre>}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* Aba PIPELINE */}
              {leftTab === 'pipeline' && (
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-muted-foreground">{t('ci.pipelinesTitle')} · {new Set((pfiles || []).map((f) => f.pipeline_ref).filter(Boolean)).size || (pfiles?.length || 0)}</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={collecting} onClick={() => collect('pipelines')} data-testid="collect-pipelines">
                          {collecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}{t('ci.collect')}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={collecting} onClick={() => collect('pipelines', true)} title={t('ci.collectMoreHint')}>
                          {t('ci.collectMore')}
                        </Button>
                      </div>
                    </div>
                    {pnote && <div className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded p-2">{pnote}</div>}
                    {(pfiles || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">{t('ci.pipelinesEmpty')}</p>
                    ) : (
                      <PipeTreeNode
                        node={buildTree((pfiles || []).map((f) => {
                          // Caminho de EXIBIÇÃO: troca o UUID interno (1º segmento) pelo
                          // ID real do pipeline (pipeline_ref). O conteúdo abre por f.id.
                          const parts = (f.rel_path || '').replace(/^__pipelines__\//, '').split('/').filter(Boolean);
                          if (parts.length && f.pipeline_ref) parts[0] = f.pipeline_ref;
                          return { ...f, rel_path: parts.join('/') };
                        }))}
                        expanded={pExpanded}
                        toggle={(p) => setPExpanded((e) => ({ ...e, [p]: e[p] === false ? true : false }))}
                        onOpen={(f) => { setSelectedFile({ rel_path: f.rel_path, name: f.name, id: f.id }); setSelectedKind('file'); setActiveTab('view'); loadVersionContent(f.id); }}
                      />
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Painel direito - Detalhe (Objetos / Info / View / OCR) */}
          <ResizablePanel defaultSize={70}>
            <div className="h-full bg-background flex flex-col" data-testid="git-detail-panel">
              {renderDetailPanel()}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
       </>
      )}

      {/* Modal: Identificar credencial vazada */}
      <Dialog open={showLeakModal} onOpenChange={setShowLeakModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-yellow-500" />
              {t('leakModal.title')}
            </DialogTitle>
            <DialogDescription>{t('leakModal.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('leakModal.file')}</Label>
              <div className="p-2 bg-muted/50 rounded text-sm font-mono break-all">
                {selectedFile?.rel_path || selectedFile?.name || '—'}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git-leak-type">{t('leakModal.credentialType')}</Label>
              <Select
                value={manualLeak.secret_type}
                onValueChange={(value) => setManualLeak((prev) => ({ ...prev, secret_type: value }))}
              >
                <SelectTrigger id="git-leak-type">
                  <SelectValue placeholder={t('leakModal.selectType')} />
                </SelectTrigger>
                <SelectContent>
                  {leakTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <span>{type.label}</span>
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] px-1 py-0',
                            type.severity === 'critical' ? 'border-red-500 text-red-500'
                              : type.severity === 'high' ? 'border-orange-500 text-orange-500'
                                : type.severity === 'medium' ? 'border-yellow-500 text-yellow-500'
                                  : 'border-muted-foreground text-muted-foreground')}
                        >
                          {type.severity}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git-match-text">{t('leakModal.matchText')}</Label>
              <Input
                id="git-match-text"
                placeholder={t('leakModal.matchPlaceholder')}
                value={manualLeak.match_text}
                onChange={(e) => setManualLeak((prev) => ({ ...prev, match_text: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t('leakModal.matchHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git-line-number">{t('leakModal.lineNumber')}</Label>
              <Input
                id="git-line-number"
                type="number"
                min="1"
                placeholder={t('leakModal.linePlaceholder')}
                value={manualLeak.line_number || ''}
                onChange={(e) => setManualLeak((prev) => ({ ...prev, line_number: e.target.value ? parseInt(e.target.value) : null }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="git-leak-desc">{t('leakModal.descriptionLabel')}</Label>
              <Textarea
                id="git-leak-desc"
                placeholder={t('leakModal.descPlaceholder')}
                value={manualLeak.description}
                onChange={(e) => setManualLeak((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeakModal(false)}>{t('leakModal.cancel')}</Button>
            <Button
              onClick={submitManualLeak}
              disabled={submittingLeak || !selectedFile}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {submittingLeak ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldKeyIcon className="w-4 h-4 mr-2" />}
              {t('leakModal.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Linha rótulo/valor para a aba Info (estilo ServerBrowser).
function InfoRow({ label, value, onCopy, copied, valueClassName = '' }) {
  return (
    <div className="flex items-center gap-4 min-h-[32px] py-1">
      <span className="text-sm text-muted-foreground flex-shrink-0" style={{ minWidth: '25%', width: '25%' }}>{label}:</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={cn('text-sm break-all', valueClassName)}>{value}</span>
        {onCopy && (
          <button onClick={onCopy} className="text-muted-foreground hover:text-foreground flex-shrink-0">
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
