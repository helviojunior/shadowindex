import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import {
  Search,
  ArrowUp,
  ArrowDown,
  X,
  Server,
  FileText,
  FolderOpen,
  Shield,
  Eye,
  HardDrive,
} from 'lucide-react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const TYPE_CONFIG = {
  server:    { icon: Server,    label: 'Servidor',   color: 'text-blue-400' },
  item:      { icon: FileText,  label: 'Arquivo',    color: 'text-green-400' },
  directory: { icon: FolderOpen,label: 'Diretório',  color: 'text-yellow-400' },
  file:      { icon: HardDrive, label: 'Download',   color: 'text-purple-400' },
  ocr:       { icon: Eye,       label: 'OCR',        color: 'text-orange-400' },
  leak:      { icon: Shield,    label: 'Leak',       color: 'text-red-400' },
};

export default function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  // Reset and focus when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q) => {
    if (q.length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${BACKEND_URL}/api/v2/search/global`, {
        params: { q, limit: 30 },
      });
      setResults(data.results || []);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${selectedIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result) => {
    navigate(result.navigate_to);
    onClose();
  }, [navigate, onClose]);

  const handleOpenInNewTab = useCallback((result) => {
    window.open(window.location.origin + result.navigate_to, '_blank');
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, results, selectedIndex, handleSelect, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[998] flex items-start justify-center pt-16"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative z-[999] w-[520px] flex flex-col rounded-lg border border-white/15 shadow-2xl bg-zinc-900/95 backdrop-blur-sm max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 p-2">
          <Search size={18} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar servidores, arquivos, leaks..."
            className="flex-1 text-sm text-white bg-transparent border-none outline-none placeholder:text-white/30"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin flex-shrink-0" />
          )}
          <button
            onClick={() => setSelectedIndex(i => Math.max(i - 1, 0))}
            disabled={results.length === 0}
            className="p-1 hover:bg-white/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Anterior (Shift+Enter)"
          >
            <ArrowUp size={18} className="text-gray-400" />
          </button>
          <button
            onClick={() => setSelectedIndex(i => Math.min(i + 1, results.length - 1))}
            disabled={results.length === 0}
            className="p-1 hover:bg-white/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Próximo (Enter)"
          >
            <ArrowDown size={18} className="text-gray-400" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Fechar (Esc)"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <>
            <div className="h-px bg-white/10" />
            <div ref={listRef} className="overflow-y-auto">
              {results.map((result, idx) => {
                const cfg = TYPE_CONFIG[result.type] || TYPE_CONFIG.item;
                const Icon = cfg.icon;
                return (
                  <ContextMenu key={`${result.type}-${result.id}`}>
                    <ContextMenuTrigger asChild>
                      <button
                        data-idx={idx}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                          idx === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <Icon size={16} className={`mt-0.5 flex-shrink-0 ${cfg.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-white truncate">{result.title}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded bg-white/10 ${cfg.color} flex-shrink-0`}>
                              {cfg.label}
                            </span>
                          </div>
                          {result.subtitle && (
                            <div className="text-xs text-white/40 truncate">{result.subtitle}</div>
                          )}
                          {result.server_name && result.type !== 'server' && (
                            <div className="text-xs text-white/25 truncate">
                              {result.server_name} · {result.server_ip}
                            </div>
                          )}
                        </div>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="z-[1000]">
                      <ContextMenuItem onClick={() => handleOpenInNewTab(result)}>
                        Abrir em nova aba
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleSelect(result)}>
                        Abrir
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
            <div className="h-px bg-white/10" />
            <div className="px-3 py-1.5 text-xs text-white/25 flex justify-between">
              <span>{results.length} resultado{results.length !== 1 ? 's' : ''}</span>
              <span>↑↓ navegar · Enter selecionar · Esc fechar</span>
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && query.length >= 3 && results.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-white/40">
            Nenhum resultado para "{query}"
          </div>
        )}

        {/* Hint */}
        {query.length < 3 && (
          <div className="px-4 py-3 text-xs text-white/30 text-center">
            Digite ao menos 3 caracteres para buscar
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
