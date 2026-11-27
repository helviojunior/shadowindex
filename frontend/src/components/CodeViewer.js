import { useEffect, useRef, useState, useMemo } from 'react';
import Prism from 'prismjs';
// Plugins: numeração de linhas + realce de linha
import 'prismjs/plugins/line-numbers/prism-line-numbers';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';
import 'prismjs/plugins/line-highlight/prism-line-highlight';
import 'prismjs/plugins/line-highlight/prism-line-highlight.css';
import 'prismjs/themes/prism-tomorrow.css';
// Gramáticas (ordem importa: dependências primeiro)
import 'prismjs/components/prism-markup';       // html/xml (base p/ jsx/tsx/php)
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
import { WrapText, AlignLeft, Copy, Check } from 'lucide-react';

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

// Limite de tamanho para aplicar o highlight do Prism (acima disso, só texto + nº de linha).
const MAX_HIGHLIGHT_CHARS = 200 * 1024;

export default function CodeViewer({ content, filename, highlightLine, copyLabel, copiedLabel, wrapLabel, unwrapLabel }) {
  const codeRef = useRef(null);
  const preRef = useRef(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = content || '';
  const tooBig = code.length > MAX_HIGHLIGHT_CHARS;
  const language = useMemo(() => (tooBig ? null : detectLanguage(filename)), [filename, tooBig]);
  const grammarKey = language && Prism.languages[language] ? language : null;

  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    // O conteúdo do <code> é gerenciado aqui (não via JSX), p/ o React não brigar
    // com o Prism pela innerHTML.
    el.textContent = code;
    if (grammarKey && !wrap) {
      // Sem quebra: usa os plugins (nº de linha + realce da linha).
      try { Prism.highlightElement(el); } catch (e) { /* noop */ }
    } else if (grammarKey && wrap) {
      // Com quebra: só highlight de sintaxe (plugins de linha não alinham).
      try { el.innerHTML = Prism.highlight(code, Prism.languages[grammarKey], grammarKey); } catch (e) { /* noop */ }
    }
  }, [code, grammarKey, wrap, highlightLine]);

  // Rola até a linha destacada (leak) depois do highlight.
  useEffect(() => {
    if (!highlightLine || wrap || !preRef.current) return;
    const t = setTimeout(() => {
      const el = preRef.current.querySelector('.line-highlight');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [highlightLine, code, grammarKey, wrap]);

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* noop */ }
  };

  const showGutter = !wrap; // line-numbers só alinham sem wrap

  return (
    <div className="h-full flex flex-col bg-[#2d2d2d] text-[13px]" data-testid="git-code-viewer">
      {/* Barra de ações */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-black/30 bg-black/20 text-xs text-gray-300">
        <span className="font-mono truncate">
          {filename}{language ? ` · ${language}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWrap((w) => !w)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 ${wrap ? 'text-primary' : ''}`}
            title={wrap ? (unwrapLabel || 'Desativar quebra de linha') : (wrapLabel || 'Quebrar linhas')}
            data-testid="git-code-wrap"
          >
            {wrap ? <AlignLeft className="w-3.5 h-3.5" /> : <WrapText className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={doCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10"
            title={copyLabel || 'Copiar'}
            data-testid="git-code-copy"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? (copiedLabel || 'Copiado') : (copyLabel || 'Copiar')}</span>
          </button>
        </div>
      </div>

      {/* Código */}
      <div className="flex-1 overflow-auto">
        <pre
          ref={preRef}
          data-line={(!wrap && highlightLine) ? String(highlightLine) : undefined}
          className={`${showGutter ? 'line-numbers' : ''} !m-0 !rounded-none !bg-transparent text-[13px] leading-5`}
          style={wrap ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : undefined}
        >
          <code ref={codeRef} className={grammarKey ? `language-${grammarKey}` : 'language-none'} />
        </pre>
      </div>
    </div>
  );
}
