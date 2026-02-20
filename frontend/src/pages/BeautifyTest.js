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

  // Aplica syntax highlighting ao conteúdo
  const applySyntaxHighlight = (content) => {
    return content
      // Declaração XML - <?xml ... ?>
      .replace(/(&lt;\?xml[^?]*\?&gt;)/gi, '<span style="color: #c084fc;">$1</span>')
      // Comentários - <!-- ... -->
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color: #6b7280; font-style: italic;">$1</span>')
      // Tags de fechamento - </tagname>
      .replace(/(&lt;\/)([\w:-]+)(&gt;)/g, '<span style="color: #60a5fa;">$1$2$3</span>')
      // Tags auto-fechadas - <tagname ... />
      .replace(/(&lt;)([\w:-]+)([^&]*?)(\/&gt;)/g, '<span style="color: #60a5fa;">$1$2</span>$3<span style="color: #60a5fa;">$4</span>')
      // Tags de abertura - <tagname>
      .replace(/(&lt;)([\w:-]+)(&gt;)/g, '<span style="color: #60a5fa;">$1$2$3</span>')
      // Tags de abertura com atributos - <tagname attr="value">
      .replace(/(&lt;)([\w:-]+)(\s)/g, '<span style="color: #60a5fa;">$1$2</span>$3')
      // Nomes de atributos
      .replace(/\s([\w:-]+)(=)/g, ' <span style="color: #facc15;">$1</span>$2')
      // Valores de atributos entre aspas
      .replace(/(=)(&quot;)([^&]*)(&quot;)/g, '$1<span style="color: #4ade80;">$2$3$4</span>')
      // Fechamento de tag >
      .replace(/([^-])(&gt;)(?!<\/span>)/g, '$1<span style="color: #60a5fa;">$2</span>');
  };

  const loadSampleXml = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/test/xml-sample`);
      setRawContent(response.data.content);
      setDisplayContent(response.data.content);
      setBeautified(false);
      toast.success('XML de exemplo carregado');
    } catch (error) {
      toast.error('Erro ao carregar XML de exemplo');
    } finally {
      setLoading(false);
    }
  };

  const beautifyContent = () => {
    if (!rawContent) return;
    
    try {
      // Formatar XML
      const formatted = formatXml(rawContent);
      
      // Escapar HTML e aplicar syntax highlighting
      const escaped = formatted
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      
      const highlighted = applySyntaxHighlight(escaped);
      
      setDisplayContent(highlighted);
      setBeautified(true);
      toast.success('XML formatado com syntax highlighting');
    } catch (error) {
      toast.error('Erro ao formatar');
    }
  };

  const copyRaw = () => {
    navigator.clipboard.writeText(rawContent);
    setCopied(true);
    toast.success('Conteúdo RAW copiado');
    setTimeout(() => setCopied(false), 2000);
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
            <Button 
              variant="outline" 
              onClick={beautifyContent}
              disabled={!rawContent || beautified}
            >
              <Code className="w-4 h-4 mr-2" />
              {beautified ? 'Formatado' : 'Beautify'}
            </Button>
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
              Copiar RAW
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
