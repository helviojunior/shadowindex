import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Code, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const BeautifyTest = () => {
  const [rawContent, setRawContent] = useState('');
  const [displayContent, setDisplayContent] = useState('');
  const [beautified, setBeautified] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  // Formata XML com indentação adequada
  const formatXml = (xml) => {
    let formatted = '';
    let indent = '';
    const tab = '  ';
    
    // Remover espaços extras e quebras de linha
    xml = xml.replace(/>\s*</g, '><').trim();
    
    xml.split(/(<[^>]+>)/g).forEach((node) => {
      if (!node.trim()) return;
      
      if (node.match(/^<\/\w/)) {
        indent = indent.substring(tab.length);
        formatted += indent + node + '\n';
      } else if (node.match(/^<\w[^>]*[^\/]>$/)) {
        formatted += indent + node + '\n';
        indent += tab;
      } else if (node.match(/^<\w[^>]*\/>$/)) {
        formatted += indent + node + '\n';
      } else if (node.match(/^<\?/)) {
        formatted += node + '\n';
      } else if (node.match(/^<!/)) {
        formatted += indent + node + '\n';
      } else {
        if (node.trim()) {
          formatted += indent + node.trim() + '\n';
        }
      }
    });
    
    return formatted.trim();
  };

  // Aplica syntax highlighting ao conteúdo usando tokens
  const applySyntaxHighlight = (rawXml) => {
    // Cores para cada tipo de elemento
    const colors = {
      declaration: '#c084fc', // roxo - <?xml ?>
      comment: '#6b7280',     // cinza - <!-- -->
      tagName: '#60a5fa',     // azul - nomes de tags
      attrName: '#facc15',    // amarelo - nomes de atributos
      attrValue: '#4ade80',   // verde - valores
      bracket: '#60a5fa',     // azul - < > />
    };

    // Escapar HTML primeiro
    let result = rawXml
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    
    // Aplicar cores usando marcadores temporários que não conflitam com HTML
    // Declaração XML
    result = result.replace(
      /(&lt;\?xml)(.*?)(\?&gt;)/gi,
      `[SPAN_START:${colors.declaration}]$1$2$3[SPAN_END]`
    );
    
    // Comentários
    result = result.replace(
      /(&lt;!--)([\s\S]*?)(--&gt;)/g,
      `[SPAN_START:${colors.comment}]$1$2$3[SPAN_END]`
    );
    
    // Tags de fechamento </tag>
    result = result.replace(
      /(&lt;\/)([\w:-]+)(&gt;)/g,
      `[SPAN_START:${colors.bracket}]$1[SPAN_END][SPAN_START:${colors.tagName}]$2[SPAN_END][SPAN_START:${colors.bracket}]$3[SPAN_END]`
    );
    
    // Tags com atributos <tag attr="value" /> ou <tag attr="value">
    result = result.replace(
      /(&lt;)([\w:-]+)([\s][^&]*?)(\/?&gt;)/g,
      (match, open, tag, attrs, close) => {
        // Processar atributos
        const processedAttrs = attrs.replace(
          /([\w:-]+)(=)(&quot;)([^&]*)(&quot;)/g,
          `[SPAN_START:${colors.attrName}]$1[SPAN_END]$2[SPAN_START:${colors.attrValue}]$3$4$5[SPAN_END]`
        );
        return `[SPAN_START:${colors.bracket}]${open}[SPAN_END][SPAN_START:${colors.tagName}]${tag}[SPAN_END]${processedAttrs}[SPAN_START:${colors.bracket}]${close}[SPAN_END]`;
      }
    );
    
    // Tags simples <tag>
    result = result.replace(
      /(&lt;)([\w:-]+)(&gt;)/g,
      `[SPAN_START:${colors.bracket}]$1[SPAN_END][SPAN_START:${colors.tagName}]$2[SPAN_END][SPAN_START:${colors.bracket}]$3[SPAN_END]`
    );
    
    // Converter marcadores para HTML real
    result = result
      .replace(/\[SPAN_START:(#[\w]+)\]/g, '<span style="color: $1;">')
      .replace(/\[SPAN_END\]/g, '</span>');
    
    return result;
  };

  const loadSampleXml = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/test/xml-sample`);
      const content = response.data.content;
      setRawContent(content);
      
      // Fazer beautify automaticamente
      try {
        const formatted = formatXml(content);
        const highlighted = applySyntaxHighlight(formatted);
        setDisplayContent(highlighted);
        setBeautified(true);
        toast.success('XML carregado e formatado');
      } catch (beautifyError) {
        console.warn('Beautify failed:', beautifyError);
        setDisplayContent(content);
        setBeautified(false);
        toast.success('XML carregado (raw)');
      }
    } catch (error) {
      toast.error('Erro ao carregar XML de exemplo');
    } finally {
      setLoading(false);
    }
  };

  const showRawContent = () => {
    if (!rawContent) return;
    setDisplayContent(rawContent);
    setBeautified(false);
  };

  const showBeautifiedContent = () => {
    if (!rawContent) return;
    
    try {
      const formatted = formatXml(rawContent);
      const highlighted = applySyntaxHighlight(formatted);
      setDisplayContent(highlighted);
      setBeautified(true);
    } catch (error) {
      toast.error('Erro ao formatar');
    }
  };

  const copyRaw = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(rawContent);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = rawContent;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      toast.success('Conteúdo RAW copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Erro ao copiar');
    }
  };

  return (
    <div className="space-y-6" data-testid="beautify-test-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Teste de Beautify</h1>
        <p className="text-muted-foreground mt-2">Teste a formatação XML com syntax highlighting</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>XML Beautify Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={loadSampleXml} disabled={loading}>
              {loading ? 'Carregando...' : 'Carregar XML de Exemplo'}
            </Button>
            {beautified ? (
              <Button 
                variant="outline" 
                onClick={showRawContent}
                disabled={!rawContent}
              >
                <Code className="w-4 h-4 mr-2" />
                Raw Content
              </Button>
            ) : (
              <Button 
                variant="outline" 
                onClick={showBeautifiedContent}
                disabled={!rawContent}
              >
                <Code className="w-4 h-4 mr-2" />
                Beautify
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={copyRaw}
              disabled={!rawContent}
            >
              {copied ? (
                <Check className="w-4 h-4 mr-2 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 mr-2" />
              )}
              Copiar
            </Button>
          </div>

          {displayContent && (
            <div className="mt-4">
              <h3 className="text-sm font-medium mb-2">
                {beautified ? 'Conteúdo Formatado (com cores):' : 'Conteúdo Original (RAW):'}
              </h3>
              {beautified ? (
                <pre 
                  className="p-4 bg-zinc-900 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto max-h-[500px] overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: displayContent }}
                />
              ) : (
                <pre className="p-4 bg-muted/50 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto max-h-[500px] overflow-y-auto">
                  {displayContent}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BeautifyTest;
