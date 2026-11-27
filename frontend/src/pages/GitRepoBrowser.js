import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  ArrowLeft, Search, FileText, FileCode, Star, GitFork, AlertTriangle,
  Loader2, ExternalLink, FileX, ChevronRight, ChevronDown, Folder, FolderOpen, X,
} from 'lucide-react';
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
  const arr = Array.from(node.children.values());
  arr.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
  return arr;
}

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

  const [contentQ, setContentQ] = useState('');
  const [contentHits, setContentHits] = useState(null);
  const [searchingContent, setSearchingContent] = useState(false);

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
    const isSelected = !isDirectory && selectedFile?.id === f?.id;
    const children = isDirectory ? sortedChildren(node) : [];

    const handleClick = () => {
      if (isDirectory) {
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

  return (
    <div className="p-6 space-y-4 w-full">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/git')}>
          <ArrowLeft className="w-4 h-4 mr-2" />{t('browser.back')}
        </Button>
      </div>

      {repo && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <FileCode className="w-5 h-5" />{repo.full_name}
            </h1>
            {repo.description && <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{repo.description}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              {repo.language && <Badge variant="outline">{repo.language}</Badge>}
              <span className="inline-flex items-center gap-1"><Star className="w-3 h-3" />{repo.stars ?? 0}</span>
              <span className="inline-flex items-center gap-1"><GitFork className="w-3 h-3" />{repo.forks ?? 0}</span>
              <span className="inline-flex items-center gap-1"><FileText className="w-3 h-3" />{repo.files_count ?? 0} {t('browser.files')}</span>
              {repo.leaks_count > 0 && <span className="inline-flex items-center gap-1 text-red-500"><AlertTriangle className="w-3 h-3" />{repo.leaks_count} {t('table.leaks')}</span>}
            </div>
          </div>
          {repo.html_url && (
            <a href={repo.html_url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-2" />{t('browser.openOnGithub')}</Button>
            </a>
          )}
        </div>
      )}

      {/* Busca de conteúdo */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex gap-2">
            <Input
              value={contentQ}
              onChange={(e) => setContentQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runContentSearch(); }}
              placeholder={t('search.contentPlaceholder')}
              data-testid="git-repo-content-search"
            />
            <Button onClick={runContentSearch} disabled={searchingContent}>
              {searchingContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>
          {contentHits !== null && (
            contentHits.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('search.contentEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {contentHits.map((h, i) => {
                  const f = files.find(ff => ff.rel_path === h.rel_path);
                  return (
                    <div key={i} className="border rounded-md p-2 text-sm cursor-pointer hover:bg-muted/50"
                         onClick={() => f && openFile(f)}>
                      <div className="font-mono text-xs text-blue-500">{h.rel_path}</div>
                      {(h.highlights || []).map((hl, j) => (
                        <div key={j} className="text-xs font-mono text-muted-foreground mt-1"
                             dangerouslySetInnerHTML={{ __html: hl }} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Split view: árvore à esquerda, conteúdo à direita (igual ao ServerBrowser) */}
      <div className="rounded-lg border border-border overflow-hidden h-[calc(100vh-320px)] min-h-[480px]">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Painel esquerdo - Árvore */}
          <ResizablePanel defaultSize={30} minSize={18} maxSize={55}>
            <div className="h-full border-r border-border bg-card flex flex-col">
              {/* Filtro */}
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={t('browser.searchFiles')}
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    className="w-full px-3 py-2 pr-10 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                    data-testid="git-file-filter"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    {filterQuery && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFilterQuery('')}>
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Cabeçalho da árvore */}
              <div className="p-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {t('browser.files')}
                  {filterActive && (
                    <span className="ml-2 text-xs text-primary">{visibleFiles.length}</span>
                  )}
                </h3>
              </div>

              {/* Árvore */}
              <ScrollArea className="flex-1 tree-scroll-area">
                <div className="py-2 pr-3">
                  {loading && files.length === 0 ? (
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

          {/* Painel direito - Conteúdo */}
          <ResizablePanel defaultSize={70}>
            <div className="h-full bg-background flex flex-col">
              <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                <span className="font-mono text-xs truncate">
                  {selectedFile?.rel_path || t('browser.content')}
                </span>
                {selectedFile && (
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {t('browser.size')}: {fmtSize(selectedFile.size)}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                {!selectedFile ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p className="text-sm">{t('browser.selectFile')}</p>
                  </div>
                ) : loadingContent ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : fileContent?.is_binary ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p className="text-sm">{t('browser.binary')}</p>
                  </div>
                ) : !fileContent?.content ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p className="text-sm">{t('browser.noContent')}</p>
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3" data-testid="git-file-content">{fileContent.content}</pre>
                  </ScrollArea>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
