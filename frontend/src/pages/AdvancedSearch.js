import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Search,
  Server,
  FileText,
  FolderOpen,
  Eye,
  Shield,
  Loader2,
  Calendar,
  Download,
  ArrowLeft,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GitBranch,
} from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const TABS = [
  { key: 'items',   label: 'Arquivos',     icon: FileText, color: 'green',  activeClass: 'text-green-500',  barClass: 'bg-green-500' },
  { key: 'servers', label: 'Servidores',   icon: Server,   color: 'blue',   activeClass: 'text-blue-500',   barClass: 'bg-blue-500' },
  { key: 'git',     label: 'Git',          icon: GitBranch, color: 'purple', activeClass: 'text-purple-500', barClass: 'bg-purple-500' },
  { key: 'leaks',   label: 'Leaks',        icon: Shield,   color: 'red',    activeClass: 'text-red-500',    barClass: 'bg-red-500' },
];

const PAGE_SIZE = 50;

// Format date string to DD/MM/YYYY
const formatDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    // Handle ISO and common formats
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
};

// Get sortable value for a column
const getSortValue = (row, key) => {
  switch (key) {
    case 'title': return (row.title || '').toLowerCase();
    case 'subtitle': return (row.subtitle || '').toLowerCase();
    case 'server_name': return (row.server_name || '').toLowerCase();
    case 'modified_at': return row.modified_at ? new Date(row.modified_at).getTime() || 0 : 0;
    case 'type': return (row.type || '').toLowerCase();
    case 'downloaded': return row.downloaded ? 1 : 0;
    case 'ocr_match': return row.ocr_match ? 1 : 0;
    case 'ip': return (row.subtitle || '').toLowerCase();
    case 'mimetype': return (row.mimetype || '').toLowerCase();
    case 'rule_id': return (row.rule_id || '').toLowerCase();
    case 'server_full': return (row.server_name || '').toLowerCase();
    default: return '';
  }
};

export default function AdvancedSearch() {
  const { t } = useTranslation('advanced-search');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialQuery = searchParams.get('q') || '';
  const initialTab = searchParams.get('tab') || 'items';

  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [results, setResults] = useState([]);
  const [counts, setCounts] = useState({ servers: 0, items: 0, leaks: 0, git: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  // Filters (only for items tab)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [extension, setExtension] = useState('');
  const [itemType, setItemType] = useState('');

  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const sentinelRef = useRef(null);
  const offsetRef = useRef(0);
  const abortRef = useRef(null);
  const searchInputRef = useRef(null);

  // Fetch results
  const fetchResults = useCallback(async (q, tab, offset = 0, append = false) => {
    if (!q || q.length < 3) return;

    if (abortRef.current && !append) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    if (!append) abortRef.current = controller;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setResults([]);
    }

    try {
      const params = { q, limit: PAGE_SIZE, offset, tab };
      if (tab === 'items') {
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        if (extension) params.extension = extension;
        if (itemType) params.item_type = itemType;
      }

      const { data } = await axios.get(`${BACKEND_URL}/api/v2/search/global`, {
        params,
        signal: controller.signal,
      });

      if (append) {
        setResults(prev => [...prev, ...(data.results || [])]);
      } else {
        setResults(data.results || []);
      }
      setHasMore(data.has_more || false);
      setTotal(data.total || 0);
      offsetRef.current = offset + (data.results || []).length;

      if (data.counts && offset === 0) {
        setCounts(data.counts);
      }
    } catch (err) {
      if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') {
        if (!append) setResults([]);
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [dateFrom, dateTo, extension, itemType]);

  // Initial search on mount + when query/tab changes
  useEffect(() => {
    if (initialQuery && initialQuery.length >= 3) {
      fetchResults(initialQuery, activeTab, 0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle tab change
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setResults([]);
    offsetRef.current = 0;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams, { replace: true });
    fetchResults(query, tab, 0, false);
  }, [query, searchParams, setSearchParams, fetchResults]);

  // Handle search submit
  const handleSearch = useCallback((e) => {
    e?.preventDefault();
    if (query.length < 3) return;
    const newParams = new URLSearchParams();
    newParams.set('q', query);
    newParams.set('tab', activeTab);
    setSearchParams(newParams, { replace: true });
    offsetRef.current = 0;
    fetchResults(query, activeTab, 0, false);
  }, [query, activeTab, setSearchParams, fetchResults]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          fetchResults(query, activeTab, offsetRef.current, true);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, query, activeTab, fetchResults]);

  const handleNavigate = useCallback((result) => {
    navigate(result.navigate_to);
  }, [navigate]);

  const handleOpenNewTab = useCallback((result) => {
    window.open(window.location.origin + result.navigate_to, '_blank');
  }, []);

  // Reset sort when tab changes
  useEffect(() => {
    setSortKey(null);
    setSortDir('asc');
  }, [activeTab]);

  // Sorted results
  const sortedResults = useMemo(() => {
    if (!sortKey) return results;
    return [...results].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [results, sortKey, sortDir]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const SortIcon = ({ columnKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown size={12} className="text-muted-foreground/40" />;
    return sortDir === 'asc'
      ? <ArrowUp size={12} className="text-emerald-400" />
      : <ArrowDown size={12} className="text-emerald-400" />;
  };

  // Render table rows based on tab
  const renderResults = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{t('searching')}</span>
        </div>
      );
    }

    if (!loading && results.length === 0 && query.length >= 3) {
      return (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">{t('noResults', { query })}</p>
        </div>
      );
    }

    if (query.length < 3) {
      return (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">{t('minChars')}</p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
              {activeTab === 'servers' && (
                <>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('title')}>
                    <span className="flex items-center gap-1">{t('common:fields.name')} <SortIcon columnKey="title" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('ip')}>
                    <span className="flex items-center gap-1">{t('columns.ip')} <SortIcon columnKey="ip" /></span>
                  </th>
                </>
              )}
              {activeTab === 'items' && (
                <>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('title')}>
                    <span className="flex items-center gap-1">{t('common:fields.name')} <SortIcon columnKey="title" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('subtitle')}>
                    <span className="flex items-center gap-1">{t('columns.path')} <SortIcon columnKey="subtitle" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('server_name')}>
                    <span className="flex items-center gap-1">{t('columns.server')} <SortIcon columnKey="server_name" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('modified_at')}>
                    <span className="flex items-center gap-1">{t('columns.modified')} <SortIcon columnKey="modified_at" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('type')}>
                    <span className="flex items-center gap-1">{t('common:fields.type')} <SortIcon columnKey="type" /></span>
                  </th>
                  <th className="px-4 py-3 text-center cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('ocr_match')}>
                    <span className="flex items-center justify-center gap-1">{t('columns.ocr')} <SortIcon columnKey="ocr_match" /></span>
                  </th>
                  <th className="px-4 py-3 text-center cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('downloaded')}>
                    <span className="flex items-center justify-center gap-1">{t('columns.dl')} <SortIcon columnKey="downloaded" /></span>
                  </th>
                </>
              )}
              {activeTab === 'leaks' && (
                <>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('title')}>
                    <span className="flex items-center gap-1">{t('columns.file')} <SortIcon columnKey="title" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('rule_id')}>
                    <span className="flex items-center gap-1">{t('columns.rule')} <SortIcon columnKey="rule_id" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('server_full')}>
                    <span className="flex items-center gap-1">{t('columns.server')} <SortIcon columnKey="server_full" /></span>
                  </th>
                </>
              )}
              {activeTab === 'git' && (
                <>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('title')}>
                    <span className="flex items-center gap-1">{t('common:fields.name')} <SortIcon columnKey="title" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('repo_full_name')}>
                    <span className="flex items-center gap-1">{t('columns.repository')} <SortIcon columnKey="repo_full_name" /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('path')}>
                    <span className="flex items-center gap-1">{t('columns.path')} <SortIcon columnKey="path" /></span>
                  </th>
                  <th className="px-4 py-3 text-center cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('indexed')}>
                    <span className="flex items-center justify-center gap-1">{t('columns.indexed')} <SortIcon columnKey="indexed" /></span>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((r) => (
              <ContextMenu key={`${r.type}-${r.id}`}>
                <ContextMenuTrigger asChild>
                  <tr
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => handleNavigate(r)}
                  >
                    {activeTab === 'servers' && (
                      <>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            <Server size={14} className="text-blue-400 flex-shrink-0" />
                            {r.title}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.subtitle}</td>
                      </>
                    )}
                    {activeTab === 'items' && (
                      <>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            {r.type === 'directory'
                              ? <FolderOpen size={14} className="text-yellow-400 flex-shrink-0" />
                              : <FileText size={14} className="text-green-400 flex-shrink-0" />
                            }
                            <span className="truncate max-w-[250px]" title={r.title}>{r.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="truncate max-w-[300px] block" title={r.subtitle}>{r.subtitle}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.server_name}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {r.modified_at && (
                            <span className="flex items-center gap-1">
                              <Calendar size={11} />
                              {formatDate(r.modified_at)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            r.type === 'directory' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'
                          }`}>
                            {r.type === 'directory' ? t('badges.dir') : t('badges.file')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.ocr_match && <Eye size={14} className="text-orange-400 mx-auto" title={t('foundViaOcr')} />}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.downloaded && <Download size={14} className="text-emerald-400 mx-auto" />}
                        </td>
                      </>
                    )}
                    {activeTab === 'leaks' && (
                      <>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            <Shield size={14} className="text-red-400 flex-shrink-0" />
                            <span className="truncate max-w-[250px]" title={r.title}>{r.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{r.rule_id}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {r.server_name} {r.server_ip && <span className="text-muted-foreground/50">({r.server_ip})</span>}
                        </td>
                      </>
                    )}
                    {activeTab === 'git' && (
                      <>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            <FileText size={14} className="text-purple-400 flex-shrink-0" />
                            <span className="truncate max-w-[220px]" title={r.title}>{r.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="inline-flex items-center gap-1 text-purple-400">
                            <GitBranch size={12} className="flex-shrink-0" />
                            <span className="truncate max-w-[200px]" title={r.repo_full_name}>{r.repo_full_name}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="font-mono truncate max-w-[320px] block" title={r.path}>{r.path}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.indexed && <Eye size={14} className="text-emerald-400 mx-auto" title={t('columns.indexed')} />}
                        </td>
                      </>
                    )}
                  </tr>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => handleOpenNewTab(r)}>
                    {t('contextMenu.openNewTab')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleNavigate(r)}>
                    {t('common:actions.open')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-8 w-8">
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        {total > 0 && !loading && (
          <span className="text-xs text-muted-foreground">{t('resultsInTab', { total })}</span>
        )}
      </div>

      {/* Search + Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[250px]">
          <label className="text-xs text-muted-foreground mb-1 block">{t('fields.search')}</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {activeTab === 'items' && (
          <>
            <div className="w-[150px]">
              <label className="text-xs text-muted-foreground mb-1 block">{t('fields.dateFrom')}</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="w-[150px]">
              <label className="text-xs text-muted-foreground mb-1 block">{t('fields.dateTo')}</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">{t('fields.extension')}</label>
              <Input
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                placeholder=".pdf"
                className="h-9"
              />
            </div>
            <div className="w-[130px]">
              <label className="text-xs text-muted-foreground mb-1 block">{t('common:fields.type')}</label>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('options.all')}</option>
                <option value="File">File</option>
                <option value="Directory">Directory</option>
              </select>
            </div>
          </>
        )}

        <Button type="submit" size="sm" className="h-9">
          <Search size={14} className="mr-1" />
          {t('common:actions.search')}
        </Button>
      </form>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-8">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                activeTab === tab.key
                  ? tab.activeClass
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {t('tabs.' + tab.key)}
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {counts[tab.key] ?? '—'}
              </span>
              {activeTab === tab.key && (
                <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${tab.barClass}`} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Results Table */}
      <div className="rounded-lg border border-border bg-card">
        {renderResults()}

        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-1" />
        {loadingMore && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">{t('loadingMore')}</span>
          </div>
        )}
        {!hasMore && results.length > 0 && !loading && (
          <div className="text-center py-3 text-xs text-muted-foreground/50">
            {t('allLoaded', { total })}
          </div>
        )}
      </div>
    </div>
  );
}