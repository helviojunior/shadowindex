import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  ArrowLeft, FileText, FileCode, FileCheck, File, Star, GitFork, AlertTriangle,
  Loader2, ExternalLink, FileX, ChevronRight, ChevronDown, Folder, FolderOpen, X, Code,
  Copy, Check, ShieldAlert, ScanText,
} from 'lucide-react';
import { ShieldKeyIcon } from '@/components/icons';
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

// Extensões cujo conteúdo normalmente vem de extração/OCR (doc/imagem/pdf).
const OCR_EXTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
]);

export default function GitRepoBrowser() {
  const { t } = useTranslation('github');
  const { guid } = useParams();
  const navigate = useNavigate();

  const [repo, setRepo] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [filterQuery, setFilterQuery] = useState('');

  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Seleção da árvore (pasta ou arquivo) + aba ativa do painel de detalhe.
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedKind, setSelectedKind] = useState(null); // 'dir' | 'file'
  const [activeTab, setActiveTab] = useState('info'); // 'info' | 'view' | 'ocr' | 'objetos'
  const [copiedField, setCopiedField] = useState(null);

  const [contentQ, setContentQ] = useState('');
  const [contentHits, setContentHits] = useState(null);
  const [searchingContent, setSearchingContent] = useState(false);
  const [searchMode, setSearchMode] = useState('filter'); // 'filter' | 'content'

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
      const res = await axios.get(`${API}/git/repos/${guid}/files?${params.toString()}`);
      setRepo(res.data?.repo || null);
      setFiles(res.data?.files || []);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadRepoError'));
    } finally {
      setLoading(false);
    }
  }, [guid, t]);

  useEffect(() => { loadFiles(); /* eslint-disable-next-line */ }, [guid]);

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

  // Lista filtrada client-side por caminho; a árvore é remontada sobre ela.
  const visibleFiles = useMemo(() => {
    if (!filterActive) return files;
    const q = filterQuery.trim().toLowerCase();
    return files.filter(f => (f.rel_path || '').toLowerCase().includes(q));
  }, [files, filterQuery, filterActive]);

  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

  const toggleNode = (path) => {
    setExpandedNodes(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const openFile = useCallback(async (f) => {
    setSelectedFile(f);
    setSelectedPath(f.rel_path);
    setSelectedKind('file');
    setActiveTab((prev) => (prev === 'objetos' ? 'info' : prev));
    setFileContent(null);
    setLoadingContent(true);
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
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/files/${f.id}`);
      setFileContent(res.data);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadFileError'));
    } finally {
      setLoadingContent(false);
    }
  }, [guid, t]);

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
                <ScrollArea className="h-full">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3" data-testid="git-file-content">{fileContent.content}</pre>
                </ScrollArea>
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
                <FileCode className="w-5 h-5 flex-shrink-0" />
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
          <Badge variant="outline">
            <FileText className="w-3 h-3 mr-1" />{repo?.files_count ?? 0} {t('browser.files')}
          </Badge>
          {repo?.html_url && (
            <a href={repo.html_url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-2" />{t('browser.openOnGithub')}</Button>
            </a>
          )}
        </div>
      </div>

      {/* Split view: árvore à esquerda, conteúdo à direita (igual ao ServerBrowser) */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Painel esquerdo - Árvore */}
          <ResizablePanel defaultSize={30} minSize={18} maxSize={55}>
            <div className="h-full border-r border-border bg-card flex flex-col">
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
              <div className="p-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {searchMode === 'content' ? t('search.contentTitle') : t('browser.files')}
                  {searchMode === 'content' && contentHits !== null && (
                    <span className="ml-2 text-xs text-primary">{contentHits.length}</span>
                  )}
                  {searchMode !== 'content' && filterActive && (
                    <span className="ml-2 text-xs text-primary">{visibleFiles.length}</span>
                  )}
                </h3>
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
                          const f = files.find((ff) => ff.rel_path === h.rel_path);
                          return (
                            <div
                              key={i}
                              className="border rounded-md p-2 text-sm cursor-pointer hover:bg-muted/50"
                              onClick={() => f && openFile(f)}
                            >
                              <div className="font-mono text-xs text-blue-500 break-all">{h.rel_path}</div>
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
