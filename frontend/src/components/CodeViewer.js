import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
// Gramáticas (ordem importa: dependências primeiro)
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-properties';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-hcl';
import { WrapText, AlignLeft, Copy, Check, MoreHorizontal, Link2, ExternalLink } from 'lucide-react';

const EXT_LANG = {
  '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json',
  '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript',
  '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.env': 'bash',
  '.html': 'markup', '.htm': 'markup', '.xml': 'markup', '.svg': 'markup',
  '.css': 'css', '.scss': 'css', '.sass': 'css', '.less': 'css',
  '.sql': 'sql', '.md': 'markdown', '.markdown': 'markdown',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini', '.toml': 'toml',
  '.properties': 'properties', '.go': 'go', '.java': 'java', '.rb': 'ruby',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.tf': 'hcl', '.tfvars': 'hcl', '.hcl': 'hcl',
};

function detectLanguage(filename) {
  const name = (filename || '').toLowerCase();
  if (name === 'dockerfile' || name.endsWith('.dockerfile') || name.startsWith('dockerfile.')) return 'docker';
  if (name === 'makefile') return 'bash';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  return EXT_LANG[ext] || null;
}

// Achata os tokens do Prism numa lista de folhas {types, content}, acumulando as
// classes dos pais — assim um token multi-linha preserva as classes em cada linha.
function flattenTokens(tokens, parentTypes) {
  const out = [];
  for (const tk of tokens) {
    if (typeof tk === 'string') {
      out.push({ types: parentTypes, content: tk });
    } else {
      const alias = Array.isArray(tk.alias) ? tk.alias : (tk.alias ? [tk.alias] : []);
      const types = parentTypes.concat(tk.type ? [tk.type] : []).concat(alias);
      if (typeof tk.content === 'string') out.push({ types, content: tk.content });
      else if (Array.isArray(tk.content)) out.push(...flattenTokens(tk.content, types));
      else out.push(...flattenTokens([tk.content], types));
    }
  }
  return out;
}

function splitLeavesIntoLines(leaves) {
  const lines = [[]];
  for (const leaf of leaves) {
    const parts = leaf.content.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1].push({ types: leaf.types, content: part });
    });
  }
  return lines;
}

const MAX_HIGHLIGHT_CHARS = 400 * 1024;

export default function CodeViewer({
  content, filename, highlightLine,
  copyLabel, copiedLabel, wrapLabel, unwrapLabel,
  copyLineLabel, copyUrlLabel, viewOriginLabel, urlCopiedLabel,
  getShareUrl, getOriginUrl, originLabel,
}) {
  const scrollRef = useRef(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(null); // { line, x, y }
  const [toast, setToast] = useState(null);

  const code = content || '';
  const tooBig = code.length > MAX_HIGHLIGHT_CHARS;
  const language = useMemo(() => (tooBig ? null : detectLanguage(filename)), [filename, tooBig]);
  const grammarKey = language && Prism.languages[language] ? language : null;

  const lines = useMemo(() => {
    if (!grammarKey) return code.split('\n').map((l) => [{ types: [], content: l }]);
    try {
      const toks = Prism.tokenize(code, Prism.languages[grammarKey]);
      return splitLeavesIntoLines(flattenTokens(toks, []));
    } catch (e) {
      return code.split('\n').map((l) => [{ types: [], content: l }]);
    }
  }, [code, grammarKey]);

  // Rola até a linha destacada.
  useEffect(() => {
    if (!highlightLine || !scrollRef.current) return;
    const t = setTimeout(() => {
      const el = scrollRef.current.querySelector(`[data-line="${highlightLine}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }, 60);
    return () => clearTimeout(t);
  }, [highlightLine, code, grammarKey]);

  // Fecha o menu ao clicar fora / rolar / Esc.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    const sc = scrollRef.current;
    if (sc) sc.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      if (sc) sc.removeEventListener('scroll', close);
    };
  }, [menu]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1400); };

  const doCopyAll = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* noop */ }
  };

  const lineText = useCallback((n) => {
    const arr = lines[n - 1] || [];
    return arr.map((s) => s.content).join('');
  }, [lines]);

  const openMenu = (e, n) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ line: n, x: r.left, y: r.bottom + 2 });
  };

  const menuAction = async (kind) => {
    const n = menu?.line;
    setMenu(null);
    if (n == null) return;
    if (kind === 'line') {
      try { await navigator.clipboard.writeText(lineText(n)); flash(copiedLabel || 'Copiado'); } catch (e) { /* noop */ }
    } else if (kind === 'url') {
      const url = getShareUrl ? getShareUrl(n) : `${window.location.href.split('#')[0]}#L${n}`;
      try { await navigator.clipboard.writeText(url); flash(urlCopiedLabel || 'URL copiada'); } catch (e) { /* noop */ }
    } else if (kind === 'origin') {
      const url = getOriginUrl ? getOriginUrl(n) : null;
      if (url) window.open(url, '_blank', 'noopener');
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#2d2d2d] text-[13px]" data-testid="git-code-viewer">
      {/* Barra de ações */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-black/30 bg-black/20 text-xs text-gray-300">
        <span className="font-mono truncate">{filename}{language ? ` · ${language}` : ''}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setWrap((w) => !w)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 ${wrap ? 'text-primary' : ''}`}
            title={wrap ? (unwrapLabel || 'Desativar quebra de linha') : (wrapLabel || 'Quebrar linhas')}
            data-testid="git-code-wrap">
            {wrap ? <AlignLeft className="w-3.5 h-3.5" /> : <WrapText className="w-3.5 h-3.5" />}
          </button>
          <button onClick={doCopyAll}
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10"
            title={copyLabel || 'Copiar'} data-testid="git-code-copy">
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? (copiedLabel || 'Copiado') : (copyLabel || 'Copiar')}</span>
          </button>
        </div>
      </div>

      {/* Código, linha a linha (gutter + menu de contexto por linha) */}
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono leading-5">
        <div className={wrap ? '' : 'min-w-max'}>
          {lines.map((spans, idx) => {
            const n = idx + 1;
            const isHi = highlightLine === n;
            return (
              <div key={n} data-line={n}
                className={`group flex items-start ${isHi ? 'bg-yellow-400/10' : 'hover:bg-white/5'}`}>
                {/* Gutter: botão "..." + número */}
                <div className="relative flex-shrink-0 w-[62px] pr-2 select-none text-right text-gray-500">
                  <button
                    onClick={(e) => openMenu(e, n)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute left-0.5 top-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white rounded hover:bg-white/10 px-0.5"
                    aria-label="line menu"
                    data-testid="git-line-menu-btn"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <span className={`pl-5 ${isHi ? 'text-yellow-500' : ''}`}>{n}</span>
                </div>
                {/* Código da linha */}
                <div className="flex-1 pl-3 pr-4"
                  style={wrap ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : { whiteSpace: 'pre' }}>
                  {spans.length === 0 ? ' ' : spans.map((s, i) => (
                    <span key={i} className={s.types.length ? `token ${s.types.join(' ')}` : undefined}>{s.content}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Menu de contexto da linha */}
      {menu && (
        <div
          className="fixed z-50 min-w-[190px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1 text-sm"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          data-testid="git-line-menu"
        >
          <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => menuAction('line')}>
            <Copy className="w-3.5 h-3.5" /> {copyLineLabel || 'Copiar linha'}
          </button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => menuAction('url')}>
            <Link2 className="w-3.5 h-3.5" /> {copyUrlLabel || 'Copiar URL'}
          </button>
          {getOriginUrl && getOriginUrl(menu.line) && (
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => menuAction('origin')}>
              <ExternalLink className="w-3.5 h-3.5" /> {(viewOriginLabel || 'Ver em {{platform}}').replace('{{platform}}', originLabel || 'origem')}
            </button>
          )}
        </div>
      )}

      {/* Toast de feedback (copiado) */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-md bg-black/80 text-white text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
