import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Folder, 
  File, 
  Download, 
  ArrowLeft, 
  HardDrive,
  Loader2,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  FileCheck,
  ExternalLink,
  Eye,
  Code
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Extensões de arquivos de texto que podem ser visualizados
const TEXT_EXTENSIONS = ['.txt', '.md', '.xml', '.json', '.config', '.cfg', '.ini', '.log', '.csv', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.sh', '.bat', '.ps1', '.sql', '.env'];

// Extensões de arquivos de imagem que podem ser visualizados
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];

// Extensão PDF
const PDF_EXTENSION = '.pdf';

const ServerBrowser = () => {
  const { serverId } = useParams();
  const navigate = useNavigate();
  const { ignoreCache } = useApp();
  
  const [server, setServer] = useState(null);
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [nodeChildren, setNodeChildren] = useState({});
  const [loadingNodes, setLoadingNodes] = useState({});
  const [copiedField, setCopiedField] = useState(null);
  const [downloadedFiles, setDownloadedFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('info');
  const [fileContent, setFileContent] = useState(null);
  const [rawFileContent, setRawFileContent] = useState(null); // Conteúdo original sem formatação
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [beautified, setBeautified] = useState(false);

  useEffect(() => {
    loadServer();
    loadDownloadedFiles();
  }, [serverId]);

  useEffect(() => {
    if (server) {
      loadShares();
    }
  }, [server, ignoreCache]);

  // Reset tab quando selecionar novo item
  useEffect(() => {
    setActiveTab('info');
    setFileContent(null);
    setRawFileContent(null);
    setFilePreviewUrl(null);
    setBeautified(false);
  }, [selectedItem?.id]);

  const loadServer = async () => {
    try {
      const response = await axios.get(`${API}/servers/${serverId}`);
      setServer(response.data);
    } catch (error) {
      console.error('Error loading server:', error);
      toast.error('Erro ao carregar servidor');
    }
  };

  // Verifica se é um arquivo de texto
  const isTextFile = (filename) => {
    if (!filename) return false;
    const lowerName = filename.toLowerCase();
    return TEXT_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  };

  // Verifica se é um arquivo de imagem
  const isImageFile = (filename) => {
    if (!filename) return false;
    const lowerName = filename.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  };

  // Verifica se é um arquivo PDF
  const isPdfFile = (filename) => {
    if (!filename) return false;
    return filename.toLowerCase().endsWith(PDF_EXTENSION);
  };

  // Verifica se o arquivo pode ser visualizado (texto, imagem ou PDF)
  const canPreviewFile = (filename) => {
    return isTextFile(filename) || isImageFile(filename) || isPdfFile(filename);
  };

  // Carrega o conteúdo do arquivo para visualização
  const loadFileContent = async () => {
    if (!selectedItem || !isFileDownloaded(selectedItem.fullPath || selectedItem.serverPath)) {
      toast.error('Arquivo precisa ser sincronizado primeiro');
      return;
    }

    const filename = selectedItem.name;
    
    // Para imagens e PDFs, carregar como blob e criar URL
    if (isImageFile(filename) || isPdfFile(filename)) {
      setLoadingContent(true);
      try {
        const response = await axios.get(`${API}/servers/${serverId}/file-download`, {
          params: { 
            file_path: selectedItem.fullPath || selectedItem.serverPath,
            share_name: selectedItem.shareName
          },
          responseType: 'blob'
        });
        
        const url = window.URL.createObjectURL(new Blob([response.data]));
        setFilePreviewUrl(url);
        setFileContent(null);
      } catch (error) {
        console.error('Error loading file preview:', error);
        toast.error('Erro ao carregar preview do arquivo');
      } finally {
        setLoadingContent(false);
      }
      return;
    }

    // Para arquivos de texto
    setLoadingContent(true);
    try {
      const response = await axios.get(`${API}/servers/${serverId}/file-content`, {
        params: { 
          file_path: selectedItem.fullPath || selectedItem.serverPath,
          share_name: selectedItem.shareName
        }
      });
      const content = response.data.content;
      setRawFileContent(content); // Guardar conteúdo original
      setFilePreviewUrl(null);
      
      // Tentar fazer beautify automaticamente
      const filename = selectedItem?.name?.toLowerCase() || '';
      try {
        let beautifiedContent = content;
        let fileType = 'text';
        
        if (filename.endsWith('.json')) {
          fileType = 'json';
          beautifiedContent = JSON.stringify(JSON.parse(content), null, 2);
        } else if (filename.endsWith('.xml') || filename.endsWith('.config')) {
          fileType = 'xml';
          beautifiedContent = formatXml(content);
        }
        
        // Aplicar syntax highlighting
        const highlighted = applySyntaxHighlight(beautifiedContent, fileType);
        setFileContent(highlighted);
        setBeautified(true);
      } catch (beautifyError) {
        // Se falhar o beautify, mostrar conteúdo raw
        console.warn('Beautify failed, showing raw content:', beautifyError);
        setFileContent(content);
        setBeautified(false);
      }
    } catch (error) {
      console.error('Error loading file content:', error);
      toast.error('Erro ao carregar conteúdo do arquivo');
    } finally {
      setLoadingContent(false);
    }
  };

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
        // Tag de fechamento - reduzir indentação
        indent = indent.substring(tab.length);
        formatted += indent + node + '\n';
      } else if (node.match(/^<\w[^>]*[^\/]>$/)) {
        // Tag de abertura - adicionar e aumentar indentação
        formatted += indent + node + '\n';
        indent += tab;
      } else if (node.match(/^<\w[^>]*\/>$/)) {
        // Tag auto-fechada
        formatted += indent + node + '\n';
      } else if (node.match(/^<\?/)) {
        // Declaração XML
        formatted += node + '\n';
      } else if (node.match(/^<!/)) {
        // Comentário ou DOCTYPE
        formatted += indent + node + '\n';
      } else {
        // Conteúdo de texto
        if (node.trim()) {
          formatted += indent + node.trim() + '\n';
        }
      }
    });
    
    return formatted.trim();
  };

  // Aplica syntax highlighting ao conteúdo usando tokens
  const applySyntaxHighlight = (rawContent, fileType) => {
    // Cores para cada tipo de elemento
    const colors = {
      declaration: '#c084fc', // roxo
      comment: '#6b7280',     // cinza
      tagName: '#60a5fa',     // azul
      attrName: '#facc15',    // amarelo
      attrValue: '#4ade80',   // verde
      bracket: '#60a5fa',     // azul
      jsonKey: '#60a5fa',     // azul
      jsonString: '#4ade80',  // verde
      jsonNumber: '#fb923c',  // laranja
      jsonBool: '#c084fc',    // roxo
    };

    // Escapar HTML primeiro
    let result = rawContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    
    if (fileType === 'xml' || fileType === 'config') {
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
      
      // Tags com atributos
      result = result.replace(
        /(&lt;)([\w:-]+)([\s][^&]*?)(\/?&gt;)/g,
        (match, open, tag, attrs, close) => {
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
    } else if (fileType === 'json') {
      // Chaves JSON
      result = result.replace(
        /(&quot;)([\w-]+)(&quot;)(\s*:)/g,
        `[SPAN_START:${colors.jsonKey}]$1$2$3[SPAN_END]$4`
      );
      // Strings JSON
      result = result.replace(
        /(:\s*)(&quot;)([^&]*)(&quot;)/g,
        `$1[SPAN_START:${colors.jsonString}]$2$3$4[SPAN_END]`
      );
      // Números
      result = result.replace(
        /(:\s*)(\d+\.?\d*)/g,
        `$1[SPAN_START:${colors.jsonNumber}]$2[SPAN_END]`
      );
      // Booleanos e null
      result = result.replace(
        /\b(true|false|null)\b/g,
        `[SPAN_START:${colors.jsonBool}]$1[SPAN_END]`
      );
    }
    
    // Converter marcadores para HTML real
    result = result
      .replace(/\[SPAN_START:(#[\w]+)\]/g, '<span style="color: $1;">')
      .replace(/\[SPAN_END\]/g, '</span>');
    
    return result;
  };

  // Mostra o conteúdo RAW (sem formatação)
  const showRawContent = () => {
    if (!rawFileContent) return;
    setFileContent(rawFileContent);
    setBeautified(false);
  };

  // Mostra o conteúdo Beautified (com formatação)
  const showBeautifiedContent = () => {
    if (!rawFileContent) return;
    
    try {
      const filename = selectedItem?.name?.toLowerCase() || '';
      let beautifiedContent = rawFileContent;
      let fileType = 'text';
      
      if (filename.endsWith('.json')) {
        fileType = 'json';
        beautifiedContent = JSON.stringify(JSON.parse(rawFileContent), null, 2);
      } else if (filename.endsWith('.xml') || filename.endsWith('.config')) {
        fileType = 'xml';
        beautifiedContent = formatXml(rawFileContent);
      }
      
      const highlighted = applySyntaxHighlight(beautifiedContent, fileType);
      setFileContent(highlighted);
      setBeautified(true);
    } catch (error) {
      console.error('Beautify error:', error);
      toast.error('Erro ao formatar conteúdo');
    }
  };

  // Download do arquivo para a máquina do usuário
  const openFile = async () => {
    if (!selectedItem) return;
    
    try {
      const response = await axios.get(`${API}/servers/${serverId}/file-download`, {
        params: { 
          file_path: selectedItem.fullPath || selectedItem.serverPath,
          share_name: selectedItem.shareName
        },
        responseType: 'blob'
      });
      
      // Criar URL para download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', selectedItem.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success('Download iniciado');
    } catch (error) {
      console.error('Error downloading file:', error);
      toast.error('Erro ao baixar arquivo');
    }
  };

  const loadDownloadedFiles = async () => {
    try {
      const response = await axios.get(`${API}/servers/${serverId}/downloads`);
      setDownloadedFiles(response.data.map(f => f.file_path));
    } catch (error) {
      console.error('Error loading downloads:', error);
    }
  };

  const loadShares = async () => {
    setLoadingShares(true);
    try {
      const response = await axios.get(`${API}/servers/${serverId}/shares?refresh=${ignoreCache}`);
      setShares(response.data);
    } catch (error) {
      console.error('Error loading shares:', error);
      toast.error('Erro ao carregar compartilhamentos');
    } finally {
      setLoadingShares(false);
    }
  };

  const refreshShares = async () => {
    setLoadingShares(true);
    try {
      const response = await axios.get(`${API}/servers/${serverId}/shares?refresh=true`);
      setShares(response.data);
      toast.success(`${response.data.length} compartilhamentos encontrados`);
    } catch (error) {
      console.error('Error refreshing shares:', error);
      toast.error('Erro ao atualizar compartilhamentos');
    } finally {
      setLoadingShares(false);
    }
  };

  const buildPath = (serverIp, shareName, subPath = '') => {
    let path = `\\\\${serverIp}\\${shareName}`;
    if (subPath) {
      path += `\\${subPath}`;
    }
    return path;
  };

  const loadDirectory = async (nodeId, path, shareName = '') => {
    setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
    try {
      const response = await axios.post(
        `${API}/servers/${serverId}/browse`,
        null,
        { params: { path, ignore_cache: ignoreCache, share_name: shareName } }
      );
      
      // Verificar se houve erro de acesso negado
      if (response.data.accessDenied) {
        // Marcar o nó como tendo acesso negado (apenas o nó atual, não os pais)
        setNodeChildren(prev => ({ 
          ...prev, 
          [nodeId]: [{
            id: `${nodeId}-error`,
            type: 'AccessDenied',
            name: 'Acesso Negado',
            errorMessage: response.data.errorMessage,
            accessDenied: true
          }]
        }));
        
        // NÃO atualizar o share pai - apenas mostrar o erro no nó atual
        // O backend só marca o share como acesso negado se for no nível raiz
        
        toast.error(`Acesso negado: ${path.split('\\').pop() || shareName}`);
        return;
      }
      
      const items = response.data.items.map((item, idx) => ({
        ...item,
        id: `${nodeId}-${idx}`,
        parentPath: path,
        shareName: shareName
      }));
      
      setNodeChildren(prev => ({ ...prev, [nodeId]: items }));
      
      // Atualizar o share na lista local apenas se for o nível raiz
      if (shareName && nodeId.startsWith('share-')) {
        setShares(prev => prev.map(s => 
          s.share_name === shareName 
            ? { ...s, children_fetched: true, has_children: items.length > 0 }
            : s
        ));
      }
      
      if (items.length === 0) {
        toast.info('Diretório vazio');
      }
    } catch (error) {
      console.error('Error loading directory:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao listar diretório';
      toast.error(errorMsg);
    } finally {
      setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  const toggleNode = async (nodeId, nodeType, path, shareName = '') => {
    if (nodeType !== 'Directory' && nodeType !== 'share') {
      return;
    }

    const isExpanded = expandedNodes[nodeId];
    
    if (isExpanded) {
      setExpandedNodes(prev => ({ ...prev, [nodeId]: false }));
    } else {
      setExpandedNodes(prev => ({ ...prev, [nodeId]: true }));
      
      // Carregar filhos se ainda não carregados ou se ignoreCache está ativo
      if (!nodeChildren[nodeId] || ignoreCache) {
        await loadDirectory(nodeId, path, shareName);
      }
    }
  };

  const handleSelectItem = (item, type, path, shareName = '') => {
    setSelectedItem({
      ...item,
      itemType: type,
      serverPath: path,
      shareName: shareName,
      fetchedAt: new Date().toISOString()
    });
  };

  const handleDownload = async () => {
    if (!selectedItem || selectedItem.itemType !== 'File') return;
    
    setLoading(true);
    try {
      const response = await axios.post(
        `${API}/servers/${serverId}/download`,
        null,
        {
          params: {
            file_path: selectedItem.fullPath || selectedItem.serverPath,
            share_name: selectedItem.shareName
          }
        }
      );
      
      toast.success(`Arquivo baixado: ${response.data.size_formatted}`);
      setDownloadedFiles(prev => [...prev, selectedItem.fullPath || selectedItem.serverPath]);
      loadServer();
    } catch (error) {
      console.error('Error downloading file:', error);
      toast.error('Erro ao baixar arquivo');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast.error('Erro ao copiar');
    }
  };

  const formatSize = (size) => {
    if (size === '---' || !size) return '---';
    const bytes = parseInt(size);
    if (isNaN(bytes)) return size;
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '---';
    try {
      return new Date(dateString).toLocaleString('pt-BR');
    } catch {
      return dateString;
    }
  };

  const isFileDownloaded = (filePath) => {
    return downloadedFiles.includes(filePath);
  };

  // Renderiza um nó da árvore com linhas de hierarquia
  const renderTreeNode = (item, depth = 0, shareName = '', isLastChild = true, parentLines = []) => {
    const isShare = !!item.share_name;
    const rawNodeId = item.id || `share-${item.share_name}`;
    const nodeId = String(rawNodeId);
    const safeTestId = nodeId.replace(/\$/g, '_dollar_');
    const isExpanded = expandedNodes[nodeId];
    const isLoading = loadingNodes[nodeId];
    const children = nodeChildren[nodeId] || [];
    const hasLoadedChildren = nodeChildren[nodeId] !== undefined;
    const isDirectory = item.type === 'Directory' || isShare;
    const isFile = item.type === 'File';
    const isAccessDenied = item.access_denied || item.accessDenied || item.type === 'AccessDenied';
    const isDownloaded = isFile && isFileDownloaded(item.fullPath);
    const isSelected = selectedItem?.id === nodeId || 
                       (isShare && selectedItem?.share_name === item.share_name && selectedItem?.itemType === 'share');
    
    const path = isShare 
      ? buildPath(server.ip, item.share_name)
      : item.fullPath;
    
    const currentShareName = isShare ? item.share_name : shareName;
    
    // Para shares: usar flag do banco (children_fetched)
    // Para outros diretórios: usar estado local (hasLoadedChildren)
    const childrenFetched = isShare ? item.children_fetched : hasLoadedChildren;
    const hasChildren = isShare ? item.has_children : (children.length > 0);
    
    // Determina se o item ainda não foi carregado (fetch não realizado)
    // Usar a flag do banco para shares, e estado local para subdiretórios
    const isNotFetched = isDirectory && !childrenFetched && !isExpanded;
    
    // Cor do ícone baseada no status de acesso, download e fetch
    const getIconColor = () => {
      if (isAccessDenied) return 'text-red-500';
      if (isNotFetched) return 'text-muted-foreground';
      return 'text-blue-500';
    };
    
    const getFileIconColor = () => {
      if (isAccessDenied) return 'text-red-500';
      if (isDownloaded) return 'text-green-500';
      return 'text-muted-foreground';
    };
    
    const iconColor = getIconColor();
    const fileIconColor = getFileIconColor();
    
    // Cor do texto baseada no status de fetch
    const textColor = isAccessDenied ? 'text-red-500' : (isNotFetched ? 'text-muted-foreground' : '');
    
    return (
      <div key={nodeId}>
        <div
          className={`flex items-center cursor-pointer hover:bg-muted/50 rounded transition-colors ${
            isSelected ? 'bg-primary/10 text-primary' : ''
          } ${isAccessDenied ? 'opacity-75' : ''}`}
          style={{ paddingLeft: '8px', paddingRight: '8px', minHeight: '32px' }}
          onClick={() => {
            if (item.type === 'AccessDenied') {
              return;
            }
            if (isShare) {
              handleSelectItem(item, 'share', path, item.share_name);
            } else {
              handleSelectItem(item, item.type, path, currentShareName);
            }
          }}
          data-testid={`tree-node-${safeTestId}`}
        >
          {/* Tree Lines - Renderiza linhas verticais para cada nível de profundidade */}
          {depth > 0 && (
            <div className="flex items-stretch" style={{ height: '32px' }}>
              {/* Linhas verticais dos pais */}
              {parentLines.map((showLine, idx) => (
                <div 
                  key={idx} 
                  className="w-4 flex justify-center"
                >
                  {showLine && (
                    <div className="w-px bg-border/60" style={{ height: '100%' }} />
                  )}
                </div>
              ))}
              {/* Linha conectora do item atual */}
              <div className="w-4 flex items-center relative">
                {/* Linha vertical (metade superior ou completa dependendo se é último) */}
                <div 
                  className="absolute left-1/2 -translate-x-1/2 w-px bg-border/60" 
                  style={{ 
                    top: 0, 
                    height: isLastChild ? '50%' : '100%'
                  }} 
                />
                {/* Linha horizontal */}
                <div 
                  className="absolute bg-border/60" 
                  style={{ 
                    left: '50%', 
                    width: '50%', 
                    height: '1px',
                    top: '50%'
                  }} 
                />
              </div>
            </div>
          )}
          
          {/* Expand/Collapse Arrow */}
          {isDirectory && item.type !== 'AccessDenied' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(nodeId, isShare ? 'share' : item.type, path, currentShareName);
              }}
              className="p-0.5 hover:bg-muted rounded flex-shrink-0"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}
          
          {/* Icon */}
          <div className="mx-1 flex-shrink-0">
            {item.type === 'AccessDenied' ? (
              <File className="w-4 h-4 text-red-500" />
            ) : isShare ? (
              <HardDrive className={`w-4 h-4 ${iconColor}`} />
            ) : isDirectory ? (
              isExpanded ? (
                <FolderOpen className={`w-4 h-4 ${iconColor}`} />
              ) : (
                <Folder className={`w-4 h-4 ${iconColor}`} />
              )
            ) : isDownloaded ? (
              <FileCheck className={`w-4 h-4 ${fileIconColor}`} />
            ) : (
              <File className={`w-4 h-4 ${fileIconColor}`} />
            )}
          </div>
          
          {/* Name */}
          <span 
            className={`text-sm truncate flex-1 ${textColor}`} 
            title={isShare ? item.share_name : (item.errorMessage || item.name)}
          >
            {isShare ? String(item.share_name) : String(item.name)}
            {isAccessDenied && item.type !== 'AccessDenied' && (
              <span className="ml-2 text-xs text-red-400">(Acesso Negado)</span>
            )}
          </span>
        </div>
        
        {/* Children */}
        {isExpanded && children.length > 0 && (
          <div>
            {children.map((child, index) => {
              const isLast = index === children.length - 1;
              // Propagar as linhas para os filhos - mostrar linha se não for o último
              const newParentLines = [...parentLines, !isLastChild];
              return renderTreeNode(child, depth + 1, currentShareName, isLast, newParentLines);
            })}
          </div>
        )}
      </div>
    );
  };

  // Renderiza o painel de informações
  const renderInfoPanel = () => {
    if (!selectedItem) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p>Selecione um item para ver detalhes</p>
        </div>
      );
    }

    const isShare = selectedItem.itemType === 'share';
    const isDirectory = selectedItem.itemType === 'Directory';
    const isFile = selectedItem.itemType === 'File';
    const isAccessDenied = selectedItem.access_denied || selectedItem.accessDenied;
    const itemName = isShare ? selectedItem.share_name : selectedItem.name;
    const downloaded = isFile && isFileDownloaded(selectedItem.fullPath || selectedItem.serverPath);
    const canViewContent = isFile && downloaded && canPreviewFile(selectedItem.name);

    // Cor do ícone no header baseada no status de acesso
    const headerIconColor = isAccessDenied ? 'text-red-500' : (isShare || isDirectory ? 'text-blue-500' : (downloaded ? 'text-green-500' : 'text-muted-foreground'));

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isAccessDenied ? (
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            ) : isShare ? (
              <HardDrive className={`w-5 h-5 ${headerIconColor} flex-shrink-0`} />
            ) : isDirectory ? (
              <Folder className={`w-5 h-5 ${headerIconColor} flex-shrink-0`} />
            ) : downloaded ? (
              <FileCheck className={`w-5 h-5 ${headerIconColor} flex-shrink-0`} />
            ) : (
              <File className={`w-5 h-5 ${headerIconColor} flex-shrink-0`} />
            )}
            <h2 className={`text-lg font-semibold truncate ${isAccessDenied ? 'text-red-500' : ''}`} title={String(itemName)}>
              {String(itemName)}
            </h2>
            {isAccessDenied && (
              <Badge variant="destructive" className="ml-2 flex-shrink-0">
                Acesso Negado
              </Badge>
            )}
            {downloaded && (
              <Badge variant="outline" className="ml-2 flex-shrink-0 text-green-500 border-green-500">
                Sincronizado
              </Badge>
            )}
          </div>
          
          {/* Botões de ação */}
          {isFile && !isAccessDenied && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {downloaded && (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={openFile}
                  data-testid="open-file-button"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Abrir
                </Button>
              )}
              <Button 
                size="sm" 
                onClick={handleDownload}
                disabled={loading || downloaded}
                data-testid="sync-button"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : downloaded ? (
                  <Check className="w-4 h-4 mr-2" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                {downloaded ? 'Synced' : 'Sync'}
              </Button>
            </div>
          )}
        </div>
        
        {/* Access Denied Alert */}
        {isAccessDenied && selectedItem.error_message && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-400">
                <p className="font-medium">Erro de Acesso</p>
                <p className="text-xs mt-1 text-red-300/80">{selectedItem.error_message}</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Tabs Flat Style */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Headers - Flat Style */}
          <div className="px-4 pt-4 border-b border-border">
            <div className="flex gap-8">
              <button
                onClick={() => setActiveTab('info')}
                className={`pb-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'info' 
                    ? 'text-green-500' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Info
                {activeTab === 'info' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
                )}
              </button>
              
              {isFile && downloaded && canViewContent && (
                <button
                  onClick={() => {
                    setActiveTab('view');
                    loadFileContent();
                  }}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'view' 
                      ? 'text-green-500' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  View
                  {activeTab === 'view' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
                  )}
                </button>
              )}
            </div>
          </div>
          
          {/* Tab Content */}
          {activeTab === 'info' && (
            <ScrollArea className="flex-1">
              <div className="p-4">
                <div className="flex flex-col gap-3">
                  {/* Name */}
                  <InfoRow 
                    label="Name" 
                    value={String(itemName)}
                    onCopy={() => copyToClipboard(String(itemName), 'name')}
                    copied={copiedField === 'name'}
                  />
                  
                  {/* Server Path */}
                  <InfoRow 
                    label="Server Path" 
                    value={selectedItem.serverPath}
                    onCopy={() => copyToClipboard(selectedItem.serverPath, 'path')}
                    copied={copiedField === 'path'}
                  />
                  
                  {/* Access Status */}
                  <InfoRow 
                    label="Access Status" 
                    value={isAccessDenied ? 'Negado' : 'Permitido'}
                    valueClassName={isAccessDenied ? 'text-red-500 font-medium' : 'text-green-500'}
                  />
                  
                  {/* Fetched Date */}
                  <InfoRow 
                    label="Fetched Date" 
                    value={formatDate(selectedItem.fetchedAt)}
                  />
                  
                  {/* Last Write Time - para diretórios e arquivos */}
                  {(isDirectory || isFile) && selectedItem.modified && (
                    <InfoRow 
                      label="Last Modified" 
                      value={formatDate(selectedItem.modified)}
                    />
                  )}
                  
                  {/* Size - apenas para arquivos */}
                  {isFile && !isAccessDenied && (
                    <InfoRow 
                      label="Size" 
                      value={formatSize(selectedItem.size)}
                    />
                  )}
                  
                  {/* Sync Status - apenas para arquivos */}
                  {isFile && !isAccessDenied && (
                    <InfoRow 
                      label="Sync Status" 
                      value={downloaded ? 'Sincronizado' : 'Não sincronizado'}
                      valueClassName={downloaded ? 'text-green-500' : 'text-muted-foreground'}
                    />
                  )}
                  
                  {/* Remark - apenas para shares */}
                  {isShare && selectedItem.remark && (
                    <InfoRow 
                      label="Remark" 
                      value={selectedItem.remark}
                    />
                  )}
                  
                  {/* Type - apenas para shares */}
                  {isShare && selectedItem.share_type && (
                    <InfoRow 
                      label="Share Type" 
                      value={selectedItem.share_type}
                    />
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
          
          {/* View Content */}
          {activeTab === 'view' && (
            <ScrollArea className="flex-1">
              <div className="p-4">
                {loadingContent ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : filePreviewUrl ? (
                  // Preview de imagem ou PDF
                  <div className="space-y-4">
                    {/* Image Preview */}
                    {isImageFile(selectedItem?.name) && (
                      <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                        <img 
                          src={filePreviewUrl} 
                          alt={selectedItem?.name}
                          className="max-w-full max-h-[500px] object-contain rounded shadow-lg"
                        />
                      </div>
                    )}
                    
                    {/* PDF Preview */}
                    {isPdfFile(selectedItem?.name) && (
                      <div className="bg-muted/30 rounded-lg overflow-hidden">
                        <iframe 
                          src={filePreviewUrl}
                          title={selectedItem?.name}
                          className="w-full h-[500px] border-0"
                        />
                      </div>
                    )}
                  </div>
                ) : fileContent ? (
                  <div className="space-y-4">
                    {/* Toolbar */}
                    <div className="flex items-center gap-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={beautifyContent}
                        disabled={beautified}
                      >
                        <Code className="w-4 h-4 mr-2" />
                        {beautified ? 'Formatado' : 'Beautify'}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => copyToClipboard(rawFileContent || fileContent, 'content')}
                        title="Copiar conteúdo original (RAW)"
                      >
                        {copiedField === 'content' ? (
                          <Check className="w-4 h-4 mr-2 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4 mr-2" />
                        )}
                        Copiar RAW
                      </Button>
                    </div>
                
                    {/* Content */}
                    {beautified ? (
                      <pre 
                        className="p-4 bg-zinc-900 rounded-lg text-sm font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: fileContent }}
                      />
                    ) : (
                      <pre className="p-4 bg-muted/50 rounded-lg text-sm font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
                        {fileContent}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Eye className="w-8 h-8 mb-2" />
                    <p>Clique em "View" para carregar o conteúdo</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    );
  };

  if (!server) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col" data-testid="server-browser-page">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/servers')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{server.name}</h1>
            <p className="text-sm text-muted-foreground">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{server.ip}</code>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            <HardDrive className="w-3 h-3 mr-1" />
            {shares.length} Shares
          </Badge>
          <Badge variant="outline">
            <Download className="w-3 h-3 mr-1" />
            {server.downloaded_files_count} Downloads
          </Badge>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={refreshShares}
            disabled={loadingShares}
            data-testid="refresh-shares-btn"
          >
            {loadingShares ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Tree View */}
        <div className="w-80 border-r border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-medium text-muted-foreground">
              Compartilhamentos
            </h3>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="py-2">
              {loadingShares && shares.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : shares.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nenhum compartilhamento encontrado
                </p>
              ) : (
                shares.map((share, index) => renderTreeNode(share, 0, '', index === shares.length - 1, []))
              )}
            </div>
          </ScrollArea>
        </div>
        
        {/* Right Panel - Info */}
        <div className="flex-1 bg-background">
          {renderInfoPanel()}
        </div>
      </div>
    </div>
  );
};

// Componente auxiliar para linhas de informação
const InfoRow = ({ label, value, onCopy, copied, valueClassName = '' }) => (
  <div className="flex items-center gap-4 min-h-[32px] py-1">
    <span className="text-sm text-muted-foreground flex-shrink-0" style={{ minWidth: '25%', width: '25%' }}>{label}:</span>
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className={`text-sm break-all ${valueClassName}`}>{value}</span>
      {onCopy && (
        <button 
          onClick={onCopy}
          className="text-muted-foreground hover:text-foreground flex-shrink-0"
          title="Copiar"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  </div>
);

export default ServerBrowser;
