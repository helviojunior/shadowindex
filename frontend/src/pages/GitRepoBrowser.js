import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft, Search, FileText, FileCode, Star, GitFork, AlertTriangle,
  Loader2, ExternalLink, FileX,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function GitRepoBrowser() {
  const { t } = useTranslation('github');
  const { guid } = useParams();
  const navigate = useNavigate();

  const [repo, setRepo] = useState(null);
  const [files, setFiles] = useState([]);
  const [fileQ, setFileQ] = useState('');
  const [loading, setLoading] = useState(false);
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
      if (fileQ) params.set('q', fileQ);
      params.set('limit', '2000');
      const res = await axios.get(`${API}/git/repos/${guid}/files?${params.toString()}`);
      setRepo(res.data?.repo || null);
      setFiles(res.data?.files || []);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadRepoError'));
    } finally {
      setLoading(false);
    }
  }, [guid, fileQ, t]);

  useEffect(() => { loadFiles(); /* eslint-disable-next-line */ }, [guid]);

  const openFile = async (f) => {
    setSelectedFile(f);
    setFileContent(null);
    setLoadingContent(true);
    try {
      const res = await axios.get(`${API}/git/repos/${guid}/files/${f.id}`);
      setFileContent(res.data);
    } catch (e) {
      console.error(e);
      toast.error(t('toast.loadFileError'));
    } finally {
      setLoadingContent(false);
    }
  };

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

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
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

      {/* Content search */}
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* File list */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('browser.files')}</CardTitle>
            <div className="flex gap-2 pt-2">
              <Input
                value={fileQ}
                onChange={(e) => setFileQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadFiles(); }}
                placeholder={t('browser.searchFiles')}
                className="h-8"
              />
              <Button size="sm" variant="outline" onClick={loadFiles} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
              <div className="px-2 pb-2">
                {files.map(f => (
                  <button
                    key={f.id}
                    onClick={() => openFile(f)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 hover:bg-muted/60',
                      selectedFile?.id === f.id && 'bg-muted'
                    )}
                    data-testid="git-file-row"
                  >
                    {f.is_binary ? <FileX className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                 : <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <span className="font-mono text-xs truncate flex-1">{f.rel_path}</span>
                    {f.indexed && <Badge variant="secondary" className="text-[9px] px-1 py-0">{t('browser.indexed')}</Badge>}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Content viewer */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="font-mono text-xs truncate">{selectedFile?.rel_path || t('browser.content')}</span>
              {selectedFile && <span className="text-xs text-muted-foreground">{t('browser.size')}: {fmtSize(selectedFile.size)}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedFile ? (
              <p className="text-sm text-muted-foreground py-16 text-center">{t('browser.selectFile')}</p>
            ) : loadingContent ? (
              <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
            ) : fileContent?.is_binary ? (
              <p className="text-sm text-muted-foreground py-16 text-center">{t('browser.binary')}</p>
            ) : !fileContent?.content ? (
              <p className="text-sm text-muted-foreground py-16 text-center">{t('browser.noContent')}</p>
            ) : (
              <ScrollArea className="h-[480px]">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words p-2" data-testid="git-file-content">{fileContent.content}</pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
