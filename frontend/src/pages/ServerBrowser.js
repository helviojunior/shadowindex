import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Code,
  XCircle,
  CheckCircle,
  Clock,
  Ban,
  Focus,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Extensões de arquivos de texto que podem ser visualizados
const TEXT_EXTENSIONS = ['.txt', '.md', '.xml', '.json', '.config', '.cfg', '.ini', '.log', '.csv', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.sh', '.bat', '.ps1', '.sql', '.env', '.reg', '.asp', '.aspx', '.asmx', '.conf', '.asa', '.asax', '.inc'];

// Extensões de arquivos de imagem que podem ser visualizados
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];

// Extensões de certificados digitais
const CERTIFICATE_EXTENSIONS = ['.cer', '.crt', '.pem', '.der', '.p7b', '.p7c', '.pfx', '.p12'];

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
  const [downloadedFilesInfo, setDownloadedFilesInfo] = useState({}); // Info completa dos arquivos baixados
  const [fileVersions, setFileVersions] = useState([]); // Versões do arquivo selecionado
  const [activeTab, setActiveTab] = useState('info');
  const [fileContent, setFileContent] = useState(null);
  const [rawFileContent, setRawFileContent] = useState(null); // Conteúdo original sem formatação
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [beautified, setBeautified] = useState(false);
  const [itemsSortConfig, setItemsSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [focusedItem, setFocusedItem] = useState(null); // Item focado (oculta os demais) - {nodeId, shareName, path}
  const [pfxPassword, setPfxPassword] = useState(''); // Senha para arquivos PFX
  const [singleDownloadProgress, setSingleDownloadProgress] = useState(null); // Progresso do download individual (0-100)
  const singleDownloadCancelledRef = useRef(false); // Ref para cancelamento do sync individual
  
  // Estados para download recursivo
  const [bulkDownloadConfig, setBulkDownloadConfig] = useState({ depth: 2, maxSize: 10 }); // maxSize em MB
  const [bulkDownloadActive, setBulkDownloadActive] = useState(false);
  const [bulkDownloadItems, setBulkDownloadItems] = useState([]); // Lista de itens a baixar
  const [bulkDownloadStats, setBulkDownloadStats] = useState({ total: 0, completed: 0, failed: 0, skipped: 0 });
  const bulkDownloadCancelledRef = useRef(false); // Ref para cancelamento síncrono

  useEffect(() => {
    loadServer();
    loadDownloadedFiles();
  }, [serverId]);

  useEffect(() => {
    if (server) {
      loadShares();
    }
  }, [server, ignoreCache]);

  // Reset tab quando selecionar novo item e carregar versões
  useEffect(() => {
    // Se download em massa está ativo, NÃO mudar de aba
    if (bulkDownloadActive) {
      return;
    }
    
    // Definir aba padrão baseado no tipo de item
    const isShare = selectedItem?.itemType === 'share';
    const isDirectory = selectedItem?.itemType === 'Directory';
    const isFile = selectedItem?.itemType === 'File';
    const isAccessDenied = selectedItem?.accessDenied || selectedItem?.access_denied;
    
    // Limpar dados de download ao mudar de diretório/share (apenas se não estiver baixando)
    if (isShare || isDirectory) {
      setBulkDownloadItems([]);
      setBulkDownloadStats({ total: 0, completed: 0, failed: 0, skipped: 0 });
    }
    
    setFileContent(null);
    setRawFileContent(null);
    setFilePreviewUrl(null);
    setBeautified(false);
    setFileVersions([]);
    
    // Se acesso negado, mostrar apenas Info
    if (isAccessDenied) {
      setActiveTab('info');
    } else if (isShare || isDirectory) {
      setActiveTab('objetos');
    } else if (isFile) {
      const filePath = selectedItem.fullPath || selectedItem.serverPath;
      const isDownloaded = downloadedFiles.includes(filePath);
      const canView = canPreviewFile(selectedItem.name);
      
      // Se arquivo já baixado e pode ser visualizado, abrir na aba View
      if (isDownloaded && canView) {
        setActiveTab('view');
      } else {
        setActiveTab('info');
      }
      
      // Carregar versões se estiver sincronizado
      if (isDownloaded) {
        loadFileVersions(filePath);
      }
    } else {
      setActiveTab('info');
    }
  }, [selectedItem?.id, downloadedFiles, bulkDownloadActive]);

  // Carregar conteúdo automaticamente quando aba View for selecionada
  useEffect(() => {
    // Só executar se estiver na aba view e for um arquivo
    if (activeTab !== 'view' || selectedItem?.itemType !== 'File') {
      return;
    }
    
    // Se já tem conteúdo ou está carregando, não fazer nada
    if (fileContent || filePreviewUrl || loadingContent) {
      return;
    }
    
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    const isDownloaded = downloadedFiles.includes(filePath);
    const canView = canPreviewFile(selectedItem.name);
    
    if (isDownloaded && canView) {
      loadFileContent();
    }
  }, [activeTab, selectedItem?.id, fileContent, filePreviewUrl, loadingContent, downloadedFiles]);

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
    if (!filename) return false;
    return isTextFile(filename) || isImageFile(filename) || isPdfFile(filename) || isCertificateFile(filename);
  };
  
  const isCertificateFile = (filename) => {
    if (!filename) return false;
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return CERTIFICATE_EXTENSIONS.includes(ext);
  };

  // Carrega o conteúdo do arquivo para visualização
  const loadFileContent = async () => {
    if (!selectedItem || !isFileDownloaded(selectedItem.fullPath || selectedItem.serverPath)) {
      toast.error('Arquivo precisa ser sincronizado primeiro');
      return;
    }

    const filename = selectedItem.name;
    
    // Para certificados, carregar informações parseadas
    if (isCertificateFile(filename)) {
      setLoadingContent(true);
      try {
        const requestBody = {
          file_path: selectedItem.fullPath || selectedItem.serverPath,
          share_name: selectedItem.shareName
        };
        
        // Só adicionar password se tiver valor
        if (pfxPassword && pfxPassword.trim()) {
          requestBody.password = pfxPassword.trim();
        }
        
        console.log('Loading certificate with body:', requestBody);
        const response = await axios.post(`${API}/servers/${serverId}/certificate-info`, requestBody);
        console.log('Certificate response:', response.data);
        setFileContent(response.data);
        setRawFileContent(JSON.stringify(response.data, null, 2));
        setFilePreviewUrl(null);
        
        // Se obteve sucesso com senha, limpar o campo
        if (response.data.password_used) {
          setPfxPassword('');
        }
      } catch (error) {
        console.error('Error loading certificate:', error);
        toast.error('Erro ao carregar informações do certificado');
        setFileContent({ error: error.response?.data?.detail || error.message });
      } finally {
        setLoadingContent(false);
      }
      return;
    }
    
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
      
      // Guardar metadados (encoding, BOM) junto com o conteúdo
      const fileMetadata = {
        content: content,
        encoding: response.data.encoding,
        has_bom: response.data.has_bom
      };
      
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
        setFileContent({ ...fileMetadata, content: highlighted });
        setBeautified(true);
      } catch (beautifyError) {
        // Se falhar o beautify, mostrar conteúdo raw
        console.warn('Beautify failed, showing raw content:', beautifyError);
        setFileContent(fileMetadata);
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
      // Criar mapa de informações por file_path
      const infoMap = {};
      response.data.forEach(f => {
        infoMap[f.file_path] = f;
      });
      setDownloadedFilesInfo(infoMap);
    } catch (error) {
      console.error('Error loading downloads:', error);
    }
  };

  // Carregar versões do arquivo selecionado
  const loadFileVersions = async (filePath) => {
    try {
      const response = await axios.get(`${API}/servers/${serverId}/file-versions`, {
        params: { file_path: filePath }
      });
      setFileVersions(response.data);
    } catch (error) {
      console.error('Error loading file versions:', error);
      setFileVersions([]);
    }
  };

  const loadShares = async () => {
    setLoadingShares(true);
    try {
      // Usar o novo endpoint que retorna shares com filhos do banco
      const response = await axios.get(`${API}/servers/${serverId}/shares-tree`);
      const { shares, items_by_path } = response.data;
      
      // Definir os shares
      setShares(shares);
      
      // NÃO expandir automaticamente - apenas definir os shares
      // Os filhos serão carregados do banco quando o usuário expandir manualmente
      
    } catch (error) {
      console.error('Error loading shares:', error);
      // Fallback para o endpoint antigo
      try {
        const fallbackResponse = await axios.get(`${API}/servers/${serverId}/shares?refresh=${ignoreCache}`);
        setShares(fallbackResponse.data);
      } catch (fallbackError) {
        toast.error('Erro ao carregar compartilhamentos');
      }
    } finally {
      setLoadingShares(false);
    }
  };

  const refreshShares = async () => {
    setLoadingShares(true);
    try {
      // Salvar estado atual de expansão e filhos antes do refresh
      const prevExpandedNodes = { ...expandedNodes };
      const prevNodeChildren = { ...nodeChildren };
      
      const response = await axios.get(`${API}/servers/${serverId}/shares?refresh=true`);
      
      // Atualizar shares preservando o estado de expansão
      // Criar mapa de shares antigos para comparar
      const oldSharesMap = {};
      shares.forEach(s => {
        oldSharesMap[s.share_name] = s;
      });
      
      // Mesclar dados novos com estado de expansão
      const updatedShares = response.data.map(newShare => {
        const oldShare = oldSharesMap[newShare.share_name];
        // Preservar children_fetched se já estava marcado no share antigo
        if (oldShare && oldShare.children_fetched) {
          return { ...newShare, children_fetched: true };
        }
        return newShare;
      });
      
      setShares(updatedShares);
      
      // Restaurar estado de expansão e filhos
      // Só manter nós que ainda existem nos novos shares
      const newShareNames = new Set(response.data.map(s => s.share_name));
      const validExpandedNodes = {};
      const validNodeChildren = {};
      
      Object.keys(prevExpandedNodes).forEach(nodeId => {
        // Verificar se o nó ainda é válido
        if (nodeId.startsWith('share-')) {
          const shareName = nodeId.replace('share-', '');
          if (newShareNames.has(shareName)) {
            validExpandedNodes[nodeId] = prevExpandedNodes[nodeId];
            if (prevNodeChildren[nodeId]) {
              validNodeChildren[nodeId] = prevNodeChildren[nodeId];
            }
          }
        } else {
          // Nós filhos - manter se o pai ainda existir
          validExpandedNodes[nodeId] = prevExpandedNodes[nodeId];
          if (prevNodeChildren[nodeId]) {
            validNodeChildren[nodeId] = prevNodeChildren[nodeId];
          }
        }
      });
      
      setExpandedNodes(validExpandedNodes);
      setNodeChildren(validNodeChildren);
      
      toast.success(`${response.data.length} compartilhamentos atualizados`);
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

  const loadDirectory = async (nodeId, path, shareName = '', forceRefresh = false) => {
    setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
    try {
      // Passo 1: Se não estiver forçando refresh, tentar carregar do banco primeiro
      if (!forceRefresh && !ignoreCache) {
        try {
          const cachedResponse = await axios.get(
            `${API}/servers/${serverId}/items`,
            { params: { parent_path: path } }
          );
          
          if (cachedResponse.data.items && cachedResponse.data.items.length > 0) {
            // Encontrou dados em cache no banco
            const items = cachedResponse.data.items.map((item, idx) => ({
              ...item,
              id: `${nodeId}-${item.id || idx}`,
              parentPath: path,
              shareName: shareName,
              hasChildren: item.hasChildren,
              childrenFetched: item.childrenFetched
            }));
            
            setNodeChildren(prev => ({ ...prev, [nodeId]: items }));
            console.log(`[Cache] Loaded ${items.length} items from database for: ${path}`);
            return; // Retornar sem fazer chamada SOAP
          }
        } catch (cacheError) {
          // Se falhar ao buscar do cache, continua para buscar via SOAP
          console.log('[Cache] No cached data, will fetch from SOAP');
        }
      }
      
      // Passo 2: Buscar via SOAP (se não encontrou em cache ou forceRefresh)
      const response = await axios.post(
        `${API}/servers/${serverId}/browse`,
        null,
        { params: { path, ignore_cache: ignoreCache, share_name: shareName } }
      );
      
      // Verificar se houve erro de acesso negado
      if (response.data.accessDenied) {
        // Não criar nó filho - apenas mostrar toast e marcar como vazio
        // O status de acesso negado já foi salvo no backend
        setNodeChildren(prev => ({ 
          ...prev, 
          [nodeId]: []  // Sem filhos - diretório marcado como acesso negado
        }));
        
        const errorMsg = response.data.errorMessage || 'Acesso negado';
        
        // Detectar se é um share pelo path (formato: \\IP\ShareName - sem subpastas adicionais)
        // Um share tem exatamente 4 partes quando dividido por \: ['', '', 'IP', 'ShareName']
        const pathParts = path.split('\\').filter(p => p !== '');
        const isSharePath = pathParts.length === 2; // IP + ShareName
        
        console.log('[AccessDenied] path:', path, 'pathParts:', pathParts, 'isSharePath:', isSharePath, 'shareName:', shareName);
        
        // Atualizar o share na lista local se for um share
        if (isSharePath || nodeId.startsWith('share-')) {
          // Extrair o nome do share do path ou do nodeId
          const shareNameToFind = isSharePath ? pathParts[1] : (nodeId.startsWith('share-') ? nodeId.substring(6) : shareName);
          
          console.log('[AccessDenied] Atualizando share. shareNameToFind:', shareNameToFind);
          
          // Atualizar usando função síncrona para garantir que o estado anterior é o mais recente
          setShares(prevShares => {
            console.log('[AccessDenied] prevShares:', prevShares.map(s => s.share_name));
            
            let foundMatch = false;
            const newShares = prevShares.map(s => {
              // Comparar pelo nome do share
              if (s.share_name === shareNameToFind) {
                console.log('[AccessDenied] ✓ Match por share_name:', s.share_name);
                foundMatch = true;
                return { 
                  ...s, 
                  access_denied: true,
                  accessDenied: true,
                  error_message: errorMsg,
                  children_fetched: true,
                  has_children: false
                };
              }
              return s;
            });
            
            if (!foundMatch) {
              console.log('[AccessDenied] ✗ Nenhum match encontrado para:', shareNameToFind);
            }
            
            return newShares;
          });
        } else {
          // É um diretório - atualizar o item em TODOS os nodeChildren
          // Buscar pelo fullPath para garantir que encontramos o item correto
          
          console.log('[AccessDenied] Atualizando diretório com path:', path);
          
          setNodeChildren(prev => {
            const newState = { ...prev };
            let found = false;
            
            // Percorrer todos os nodeChildren para encontrar e atualizar o item
            for (const parentKey of Object.keys(newState)) {
              const children = newState[parentKey];
              if (!children || !Array.isArray(children)) continue;
              
              const updatedChildren = children.map(child => {
                // Comparar pelo fullPath ou pelo id
                if (child.fullPath === path || child.id === nodeId) {
                  console.log('[AccessDenied] Item encontrado em', parentKey, '- child:', child.name);
                  found = true;
                  return { 
                    ...child, 
                    access_denied: true,
                    accessDenied: true,
                    error_message: errorMsg,
                    children_fetched: true,
                    has_children: false
                  };
                }
                return child;
              });
              
              if (found) {
                newState[parentKey] = [...updatedChildren];
                break;
              }
            }
            
            if (!found) {
              console.log('[AccessDenied] Item não encontrado em nenhum nodeChildren');
            }
            
            return newState;
          });
        }
        
        // Atualizar o selectedItem
        setSelectedItem(prev => {
          if (!prev) return prev;
          
          // Detectar se é share pelo path
          const pathParts = path.split('\\').filter(p => p !== '');
          const isSharePath = pathParts.length === 2;
          const shareNameToFind = isSharePath ? pathParts[1] : (nodeId.startsWith('share-') ? nodeId.substring(6) : shareName);
          
          // Verificar se é o item selecionado (share ou diretório)
          const isSelectedShare = prev.itemType === 'share' && (prev.share_name === shareNameToFind || prev.serverPath === path);
          const isSelectedDir = prev.fullPath === path || prev.serverPath === path || prev.id === nodeId;
          
          if (isSelectedShare || isSelectedDir) {
            console.log('[AccessDenied] Atualizando selectedItem');
            return { 
              ...prev, 
              access_denied: true,
              accessDenied: true,
              error_message: errorMsg,
              children_fetched: true,
              has_children: false
            };
          }
          return prev;
        });
        
        // Mudar para aba Info quando acesso negado
        setActiveTab('info');
        
        // Toast removido - o status de acesso negado é exibido na UI
        return;
      }
      
      const items = response.data.items.map((item, idx) => ({
        ...item,
        id: `${nodeId}-${idx}`,
        parentPath: path,
        shareName: shareName
      }));
      
      setNodeChildren(prev => ({ ...prev, [nodeId]: items }));
      
      // Detectar se é um share pelo path (formato: \\IP\ShareName - sem subpastas)
      const pathParts = path.split('\\').filter(p => p !== '');
      const isSharePath = pathParts.length === 2; // IP + ShareName
      const shareNameFromPath = isSharePath ? pathParts[1] : shareName;
      
      // Atualizar o share na lista local se for o nível raiz
      if (isSharePath || nodeId.startsWith('share-')) {
        console.log('[LoadDirectory] Atualizando share após carregar filhos:', shareNameFromPath);
        
        // Atualizar estado local imediatamente
        setShares(prev => prev.map(s => 
          s.share_name === shareNameFromPath 
            ? { ...s, children_fetched: true, has_children: items.length > 0 }
            : s
        ));
        
        // Persistir no banco de dados (não esperar resposta para UI)
        axios.patch(`${API}/servers/${serverId}/shares/${encodeURIComponent(shareNameFromPath)}`, {
          children_fetched: true,
          has_children: items.length > 0
        }).catch(err => {
          console.error('Error updating share flags:', err);
        });
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
    // Definir o item selecionado para mostrar no painel Info
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
    setSingleDownloadProgress(0);
    singleDownloadCancelledRef.current = false;
    
    try {
      const fileSize = parseInt(selectedItem.size) || 0;
      const filePath = selectedItem.fullPath || selectedItem.serverPath;
      const shareName = selectedItem.shareName;
      const CHUNK_SIZE = 512000; // 512KB
      const useChunks = fileSize > CHUNK_SIZE;
      
      let response;
      
      if (useChunks) {
        // Download em chunks para arquivos grandes
        let offset = 0;
        let allChunks = [];
        let totalBytesReceived = 0;
        
        while (true) {
          // Verificar cancelamento
          if (singleDownloadCancelledRef.current) {
            toast.info('Download cancelado');
            return;
          }
          
          const chunkResponse = await axios.post(
            `${API}/servers/${serverId}/download-chunk`,
            null,
            {
              params: {
                file_path: filePath,
                share_name: shareName,
                offset: offset,
                chunk_size: CHUNK_SIZE
              }
            }
          );
          
          // Verificar cancelamento após resposta
          if (singleDownloadCancelledRef.current) {
            toast.info('Download cancelado');
            return;
          }
          
          if (chunkResponse.data.content_base64) {
            allChunks.push(chunkResponse.data.content_base64);
          }
          
          const chunkSize = chunkResponse.data.chunk_size || 0;
          totalBytesReceived += chunkSize;
          offset += chunkSize;
          
          // Calcular progresso - usar o maior valor entre fileSize informado e bytes recebidos
          const estimatedTotal = Math.max(fileSize, totalBytesReceived);
          const progress = chunkResponse.data.is_last_chunk 
            ? 100 
            : Math.min(99, Math.round((totalBytesReceived / estimatedTotal) * 100));
          setSingleDownloadProgress(progress);
          
          if (chunkResponse.data.is_last_chunk || chunkSize === 0) {
            break;
          }
        }
        
        // Verificar cancelamento antes de salvar
        if (singleDownloadCancelledRef.current) {
          toast.info('Download cancelado');
          return;
        }
        
        // Enviar para salvar no servidor
        const combinedBase64 = allChunks.join('');
        response = await axios.post(
          `${API}/servers/${serverId}/download`,
          { content_base64: combinedBase64 },
          {
            params: {
              file_path: filePath,
              share_name: shareName,
              expected_size: totalBytesReceived
            }
          }
        );
      } else {
        // Download normal para arquivos pequenos
        response = await axios.post(
          `${API}/servers/${serverId}/download`,
          null,
          {
            params: {
              file_path: filePath,
              share_name: shareName,
              expected_size: fileSize
            }
          }
        );
      }
      
      setSingleDownloadProgress(100);
      
      // Mostrar mensagem baseada no status
      const { status, message, sha1_hash, version } = response.data;
      
      if (status === 'unchanged') {
        toast.info(`${message} (v${version})`);
      } else if (status === 'updated') {
        toast.success(`${message} (v${version})`);
      } else {
        toast.success(`${message}: ${response.data.size_formatted}`);
      }
      
      // Atualizar lista de downloads
      if (!downloadedFiles.includes(filePath)) {
        setDownloadedFiles(prev => [...prev, filePath]);
      }
      
      // Atualizar info do arquivo
      setDownloadedFilesInfo(prev => ({
        ...prev,
        [filePath]: {
          ...prev[filePath],
          sha1_hash: sha1_hash,
          file_size: response.data.size,
          downloaded_at: new Date().toISOString()
        }
      }));
      
      // Recarregar versões
      loadFileVersions(filePath);
      loadServer();
    } catch (error) {
      console.error('Error downloading file:', error);
      // Extrair mensagem de erro do response do backend
      const errorDetail = error.response?.data?.detail;
      const errorMessage = errorDetail || error.message || 'Erro ao baixar arquivo';
      
      // Mostrar mensagem específica baseada no código de status
      if (error.response?.status === 403) {
        toast.error(`Acesso Negado: ${errorMessage}`);
      } else if (error.response?.status === 404) {
        toast.error(`Arquivo não encontrado: ${errorMessage}`);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setLoading(false);
      setTimeout(() => setSingleDownloadProgress(null), 1000);
    }
  };

  // Função para processar download de um diretório (incremental)
  const processDirectoryDownload = async (path, shareName, currentDepth, maxDepth, maxSizeBytes) => {
    if (currentDepth > maxDepth || bulkDownloadCancelledRef.current) return;
    
    try {
      // Buscar conteúdo do diretório
      const response = await axios.post(
        `${API}/servers/${serverId}/browse`,
        null,
        { params: { path, ignore_cache: false, share_name: shareName } }
      );
      
      if (response.data.accessDenied) return;
      
      const items = response.data.items || [];
      
      // Atualizar o ícone azul na árvore (marcar como fetched)
      const nodeId = path === `\\\\${server?.ip}\\${shareName}` 
        ? `share-${shareName}` 
        : String(items[0]?.id || path).replace(/[^a-zA-Z0-9]/g, '_');
      
      // Atualizar nodeChildren para mostrar na árvore
      setNodeChildren(prev => ({ ...prev, [nodeId]: items }));
      
      // Marcar share como fetched se for o nível raiz
      if (currentDepth === 1) {
        setShares(prev => prev.map(s => 
          s.share_name === shareName 
            ? { ...s, children_fetched: true, has_children: items.length > 0 }
            : s
        ));
      }
      
      // Separar arquivos e diretórios
      const files = items.filter(i => i.type === 'File');
      const directories = items.filter(i => i.type === 'Directory');
      
      // 1. Primeiro: Baixar todos os arquivos do diretório atual
      for (const file of files) {
        if (bulkDownloadCancelledRef.current) break;
        
        // Verificar se o arquivo já foi baixado - se sim, ignorar
        if (downloadedFiles.includes(file.fullPath)) {
          continue; // Pular arquivo já sincronizado
        }
        
        // O size vem como número do SOAP (campo length)
        const fileSize = parseInt(file.size) || 0;
        
        if (fileSize > maxSizeBytes) {
          // Arquivo muito grande - adicionar como skipped
          setBulkDownloadItems(prev => [{
            ...file,
            shareName,
            fileSize,
            status: 'skipped',
            error: `Tamanho excede limite (${formatSize(fileSize)})`
          }, ...prev]);
          setBulkDownloadStats(prev => ({ 
            ...prev, 
            total: prev.total + 1, 
            skipped: prev.skipped + 1 
          }));
          continue;
        }
        
        // Adicionar à lista com status downloading (no início) - sem progresso até primeiro retorno
        setBulkDownloadItems(prev => [{
          ...file,
          shareName,
          fileSize,
          status: 'downloading',
          progress: null,  // null = aguardando primeiro chunk
          error: null
        }, ...prev]);
        setBulkDownloadStats(prev => ({ ...prev, total: prev.total + 1 }));
        
        const CHUNK_SIZE = 512000; // 512KB
        const useChunks = fileSize > CHUNK_SIZE;
        
        try {
          if (useChunks) {
            // Download em chunks para arquivos grandes
            let offset = 0;
            let allChunks = [];
            let totalBytesReceived = 0;
            
            while (true) {
              if (bulkDownloadCancelledRef.current) break;
              
              // Verificar se o item foi cancelado individualmente
              const currentItems = await new Promise(resolve => {
                setBulkDownloadItems(prev => {
                  resolve(prev);
                  return prev;
                });
              });
              const currentItem = currentItems.find(it => it.fullPath === file.fullPath);
              if (currentItem?.status === 'cancelled') break;
              
              const chunkResponse = await axios.post(
                `${API}/servers/${serverId}/download-chunk`,
                null,
                {
                  params: {
                    file_path: file.fullPath,
                    share_name: shareName,
                    offset: offset,
                    chunk_size: CHUNK_SIZE
                  }
                }
              );
              
              if (chunkResponse.data.content_base64) {
                allChunks.push(chunkResponse.data.content_base64);
              }
              
              const chunkSize = chunkResponse.data.chunk_size || 0;
              totalBytesReceived += chunkSize;
              offset += chunkSize;
              
              // Calcular progresso - usar o maior valor entre fileSize informado e bytes recebidos
              const estimatedTotal = Math.max(fileSize, totalBytesReceived);
              const progress = chunkResponse.data.is_last_chunk 
                ? 100 
                : Math.min(99, Math.round((totalBytesReceived / estimatedTotal) * 100));
              
              // Atualizar progresso
              setBulkDownloadItems(prev => prev.map((it) => 
                it.fullPath === file.fullPath && it.status === 'downloading'
                  ? { ...it, progress } 
                  : it
              ));
              
              if (chunkResponse.data.is_last_chunk || chunkSize === 0) {
                break;
              }
            }
            
            // Verificar se foi cancelado
            const finalItems = await new Promise(resolve => {
              setBulkDownloadItems(prev => {
                resolve(prev);
                return prev;
              });
            });
            const finalItem = finalItems.find(it => it.fullPath === file.fullPath);
            if (finalItem?.status === 'cancelled' || bulkDownloadCancelledRef.current) {
              continue;
            }
            
            // Combinar chunks e salvar
            const combinedBase64 = allChunks.join('');
            await axios.post(
              `${API}/servers/${serverId}/download`,
              { content_base64: combinedBase64 },
              {
                params: {
                  file_path: file.fullPath,
                  share_name: shareName,
                  expected_size: fileSize
                }
              }
            );
          } else {
            // Download normal para arquivos pequenos
            await axios.post(
              `${API}/servers/${serverId}/download`,
              null,
              {
                params: {
                  file_path: file.fullPath,
                  share_name: shareName,
                  expected_size: fileSize
                }
              }
            );
          }
          
          // Atualizar para completed
          setBulkDownloadItems(prev => prev.map((it) => 
            it.fullPath === file.fullPath && it.status === 'downloading'
              ? { ...it, status: 'completed', progress: 100 } 
              : it
          ));
          setBulkDownloadStats(prev => ({ ...prev, completed: prev.completed + 1 }));
          
          // Atualizar lista de downloads
          if (!downloadedFiles.includes(file.fullPath)) {
            setDownloadedFiles(prev => [...prev, file.fullPath]);
          }
        } catch (error) {
          // Extrair mensagem de erro do response do backend
          const errorDetail = error.response?.data?.detail;
          let errorMessage = errorDetail || error.message || 'Erro desconhecido';
          
          // Mensagem amigável para erros comuns
          if (error.response?.status === 403) {
            errorMessage = 'Acesso Negado';
          } else if (error.response?.status === 404) {
            errorMessage = 'Não encontrado';
          }
          
          // Atualizar para failed com mensagem de erro adequada
          setBulkDownloadItems(prev => prev.map((it) => 
            it.fullPath === file.fullPath && it.status === 'downloading'
              ? { ...it, status: 'failed', error: errorMessage } 
              : it
          ));
          setBulkDownloadStats(prev => ({ ...prev, failed: prev.failed + 1 }));
        }
      }
      
      // 2. Depois: Entrar em cada subdiretório recursivamente
      if (currentDepth < maxDepth) {
        for (const dir of directories) {
          if (bulkDownloadCancelledRef.current) break;
          
          // Expandir o nó na árvore
          const dirNodeId = String(dir.id || dir.fullPath).replace(/[^a-zA-Z0-9]/g, '_');
          setExpandedNodes(prev => ({ ...prev, [dirNodeId]: true }));
          
          // Processar subdiretório
          await processDirectoryDownload(
            dir.fullPath,
            shareName,
            currentDepth + 1,
            maxDepth,
            maxSizeBytes
          );
        }
      }
    } catch (error) {
      console.error('Error processing directory:', error);
    }
  };

  // Iniciar download em massa (versão incremental)
  const startBulkDownload = async () => {
    if (!selectedItem) return;
    
    const isShare = selectedItem.itemType === 'share';
    const shareName = isShare ? selectedItem.share_name : selectedItem.shareName;
    const path = selectedItem.serverPath;
    const maxSizeBytes = bulkDownloadConfig.maxSize * 1024 * 1024;
    
    // Resetar estados
    setBulkDownloadActive(true);
    bulkDownloadCancelledRef.current = false;
    setBulkDownloadItems([]);
    setBulkDownloadStats({ total: 0, completed: 0, failed: 0, skipped: 0 });
    setActiveTab('download');
    
    toast.info('Iniciando download...');
    
    // Processar diretório de forma incremental
    await processDirectoryDownload(path, shareName, 1, bulkDownloadConfig.depth, maxSizeBytes);
    
    setBulkDownloadActive(false);
    loadServer();
    loadDownloadedFiles();
    
    if (bulkDownloadCancelledRef.current) {
      toast.info('Download cancelado');
    } else {
      toast.success('Download em massa concluído');
    }
  };

  // Cancelar download em massa
  const cancelBulkDownload = () => {
    bulkDownloadCancelledRef.current = true;
    toast.info('Cancelando downloads...');
  };

  // Cancelar sync individual
  const cancelSingleDownload = () => {
    singleDownloadCancelledRef.current = true;
  };

  // Cancelar item específico
  const cancelBulkDownloadItem = (index) => {
    setBulkDownloadItems(prev => prev.map((item, idx) => 
      idx === index && (item.status === 'pending' || item.status === 'downloading') 
        ? { ...item, status: 'cancelled' } 
        : item
    ));
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
  const renderTreeNode = (item, depth = 0, shareName = '', isLastChild = true, parentLines = [], focusedNodeId = null) => {
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
    const isAccessDenied = item.access_denied || item.accessDenied;
    const isDownloaded = isFile && isFileDownloaded(item.fullPath);
    const isSelected = selectedItem?.id === nodeId || 
                       (isShare && selectedItem?.share_name === item.share_name && selectedItem?.itemType === 'share');
    
    // Se há um foco e este nó é o focado, mostrar apenas ele
    const isFocusedNode = focusedNodeId && nodeId === focusedNodeId;
    
    const path = isShare 
      ? buildPath(server.ip, item.share_name)
      : item.fullPath;
    
    const currentShareName = isShare ? item.share_name : shareName;
    
    // Para shares: usar flag do banco (children_fetched)
    // Para diretórios: usar flag do item que vem do banco (item.childrenFetched)
    // Fallback para hasLoadedChildren se não houver flag do banco
    const childrenFetched = isShare 
      ? item.children_fetched 
      : (item.childrenFetched === true || hasLoadedChildren);
    
    // Determina se o item ainda não teve seus filhos carregados
    // Um diretório é considerado "não carregado" se nunca fizemos fetch dos filhos
    const isNotFetched = isDirectory && !childrenFetched;
    
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
    
    // Handler para clique no item - seleciona e expande se for diretório
    const handleNodeClick = async () => {
      // Selecionar o item
      if (isShare) {
        handleSelectItem(item, 'share', path, item.share_name);
      } else {
        handleSelectItem(item, item.type, path, currentShareName);
      }
      
      // Se for diretório/share e não estiver expandido, expandir
      if (isDirectory && !isExpanded) {
        setExpandedNodes(prev => ({ ...prev, [nodeId]: true }));
        if (!nodeChildren[nodeId] || ignoreCache) {
          await loadDirectory(nodeId, path, currentShareName);
        }
      }
    };
    
    return (
      <div key={`${nodeId}-${isAccessDenied ? 'denied' : 'ok'}`}>
        <div
          className={`flex items-center cursor-pointer hover:bg-muted/50 rounded transition-colors ${
            isSelected ? 'bg-primary/10 text-primary' : ''
          } ${isAccessDenied ? 'opacity-75' : ''}`}
          style={{ paddingLeft: '8px', paddingRight: '8px', minHeight: '32px' }}
          onClick={handleNodeClick}
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
          {isDirectory ? (
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
            {isShare ? (
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
            {isAccessDenied && (
              <span className="ml-2 text-xs text-red-400">(Acesso Negado)</span>
            )}
          </span>
        </div>
        
        {/* Children */}
        {isExpanded && children.length > 0 && (
          <div>
            {(() => {
              // Se este nó é o focado ou estamos dentro do item focado, mostrar todos os filhos
              if (isFocusedNode || !focusedNodeId) {
                return children.map((child, index) => {
                  const isLast = index === children.length - 1;
                  const newParentLines = [...parentLines, !isLastChild];
                  // Passar null como focusedNodeId para mostrar todos os descendentes
                  return renderTreeNode(child, depth + 1, currentShareName, isLast, newParentLines, null);
                });
              }
              
              // Se há um foco mas este não é o item focado, filtrar filhos para mostrar apenas o caminho até o item focado
              const filteredChildren = children.filter(child => {
                const childNodeId = String(child.id || `share-${child.share_name}`);
                // Mostrar se é o nó focado
                if (childNodeId === focusedNodeId) return true;
                // Verificar se o nó focado está nos filhos deste child
                const hasFocusedDescendant = (nodes, targetId) => {
                  for (const node of nodes) {
                    const nId = String(node.id || `share-${node.share_name}`);
                    if (nId === targetId) return true;
                    const nc = nodeChildren[nId] || [];
                    if (nc.length > 0 && hasFocusedDescendant(nc, targetId)) return true;
                  }
                  return false;
                };
                const childChildren = nodeChildren[childNodeId] || [];
                return hasFocusedDescendant(childChildren, focusedNodeId);
              });
              
              return filteredChildren.map((child, index) => {
                const isLast = index === filteredChildren.length - 1;
                const newParentLines = [...parentLines, !isLastChild];
                return renderTreeNode(child, depth + 1, currentShareName, isLast, newParentLines, focusedNodeId);
              });
            })()}
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
    
    // Determinar status de acesso
    // - Para shares: children_fetched indica que foi verificado
    // - Para diretórios: childrenFetched indica que foi verificado
    // - Para arquivos: se foi baixado, acesso é permitido
    const childrenFetched = isShare ? selectedItem.children_fetched : selectedItem.childrenFetched;
    const accessVerified = isAccessDenied || childrenFetched || downloaded;
    const accessStatus = isAccessDenied ? 'Negado' : (accessVerified ? 'Permitido' : 'Desconhecido');
    const accessStatusColor = isAccessDenied ? 'text-red-500 font-medium' : (accessVerified ? 'text-green-500' : 'text-muted-foreground');

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
              <>
                <Badge variant="outline" className="ml-2 flex-shrink-0 text-green-500 border-green-500">
                  Sincronizado
                </Badge>
                {fileVersions.length > 1 && (
                  <Select
                    value={fileVersions.find(v => v.is_current)?.id?.toString() || ''}
                    onValueChange={async (versionId) => {
                      try {
                        await axios.post(`${API}/servers/${serverId}/file-versions/${versionId}/set-current`);
                        const filePath = selectedItem.fullPath || selectedItem.serverPath;
                        loadFileVersions(filePath);
                        loadDownloadedFiles();
                        toast.success('Versão alterada');
                      } catch (error) {
                        toast.error('Erro ao alterar versão');
                      }
                    }}
                  >
                    <SelectTrigger className="w-auto min-w-[140px] h-7 ml-2 mr-4">
                      <SelectValue placeholder="Versão" />
                    </SelectTrigger>
                    <SelectContent>
                      {fileVersions.map((v) => (
                        <SelectItem key={v.id} value={v.id.toString()}>
                          v{v.version_number} - {new Date(v.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} {v.is_current && '✓'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            )}
          </div>
          
          {/* Botões de ação para arquivos */}
          {isFile && !isAccessDenied && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {downloaded && (
                <Button 
                  size="sm" 
                  variant="outline"
                  className="h-7"
                  onClick={openFile}
                  data-testid="open-file-button"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Abrir
                </Button>
              )}
              
              {/* Barra de progresso à esquerda do botão Sync */}
              {singleDownloadProgress !== null && (
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${singleDownloadProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8">{singleDownloadProgress}%</span>
                </div>
              )}
              
              <Button 
                size="sm" 
                className="h-7"
                onClick={handleDownload}
                disabled={loading}
                variant={downloaded ? "outline" : "default"}
                data-testid="sync-button"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Sync
              </Button>
              
              {/* Botão Cancelar Sync */}
              {loading && singleDownloadProgress !== null && (
                <Button 
                  size="sm" 
                  variant="destructive"
                  className="h-7"
                  onClick={cancelSingleDownload}
                  data-testid="cancel-sync-button"
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Cancelar
                </Button>
              )}
            </div>
          )}
          
          {/* Botões de ação para diretórios/shares */}
          {(isShare || isDirectory) && !isAccessDenied && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Seletor de profundidade */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Níveis:</span>
                <Select
                  value={bulkDownloadConfig.depth.toString()}
                  onValueChange={(val) => setBulkDownloadConfig(prev => ({ ...prev, depth: parseInt(val) }))}
                  disabled={bulkDownloadActive}
                >
                  <SelectTrigger className="w-16 h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 10].map((n) => (
                      <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Seletor de tamanho máximo */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Max:</span>
                <Select
                  value={bulkDownloadConfig.maxSize.toString()}
                  onValueChange={(val) => setBulkDownloadConfig(prev => ({ ...prev, maxSize: parseInt(val) }))}
                  disabled={bulkDownloadActive}
                >
                  <SelectTrigger className="w-20 h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 5, 10, 25, 50, 100, 500].map((n) => (
                      <SelectItem key={n} value={n.toString()}>{n} MB</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Botão de download */}
              {!bulkDownloadActive ? (
                <Button 
                  size="sm" 
                  className="h-7"
                  onClick={startBulkDownload}
                  data-testid="bulk-download-button"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  variant="destructive"
                  className="h-7"
                  onClick={cancelBulkDownload}
                  data-testid="cancel-bulk-download-button"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Cancelar
                </Button>
              )}
            </div>
          )}
        </div>
        
        {/* Access Denied Alert */}
        {isAccessDenied && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-400">
                  <p className="font-medium">Erro de Acesso</p>
                  {selectedItem.error_message && (
                    <p className="text-xs mt-1 text-red-300/80">{selectedItem.error_message}</p>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-red-500/50 text-red-400 hover:bg-red-500/20"
                onClick={async () => {
                  try {
                    const itemType = isShare ? 'share' : (isDirectory ? 'directory' : 'file');
                    const itemPath = selectedItem.fullPath || selectedItem.serverPath || '';
                    
                    // Usar IDs ao invés de nomes para evitar problemas com caracteres especiais
                    const params = {
                      item_type: itemType
                    };
                    
                    if (isShare) {
                      // Para shares, usar o ID do share
                      params.share_id = selectedItem.id;
                    } else {
                      // Para arquivos/diretórios, usar o ID do item ou o path como fallback
                      if (selectedItem.dbId) {
                        params.item_id = selectedItem.dbId;
                      } else {
                        params.item_path = itemPath;
                      }
                    }
                    
                    await axios.post(`${API}/servers/${serverId}/clear-access-denied`, null, { params });
                    
                    const clearedData = {
                      access_denied: false,
                      accessDenied: false,
                      error_message: null,
                      children_fetched: false
                    };
                    
                    // Atualizar a UI - remover o status de acesso negado
                    if (isShare) {
                      // Atualizar o share na lista pelo share_name
                      setShares(prev => prev.map(s => 
                        s.share_name === selectedItem.share_name
                          ? { ...s, ...clearedData }
                          : s
                      ));
                      
                      // Limpar os filhos carregados para forçar re-fetch
                      // Tentar ambos os formatos de nodeId
                      const nodeIdByName = `share-${selectedItem.share_name}`;
                      const nodeIdById = String(selectedItem.id);
                      
                      setNodeChildren(prev => {
                        const newState = { ...prev };
                        delete newState[nodeIdByName];
                        delete newState[nodeIdById];
                        return newState;
                      });
                      setExpandedNodes(prev => {
                        const newState = { ...prev };
                        newState[nodeIdByName] = false;
                        newState[nodeIdById] = false;
                        return newState;
                      });
                    } else {
                      // Para diretórios - encontrar o nodeId do diretório e limpar
                      const dirNodeId = String(selectedItem.id);
                      
                      // Atualizar o item em todos os nodeChildren do pai
                      setNodeChildren(prev => {
                        const newState = { ...prev };
                        
                        // Remover os filhos do diretório (forçar re-fetch)
                        delete newState[dirNodeId];
                        
                        // Também atualizar o item no pai para limpar access_denied
                        for (const parentKey of Object.keys(newState)) {
                          const children = newState[parentKey];
                          if (!children || !Array.isArray(children)) continue;
                          
                          const updatedChildren = children.map(child => {
                            if (child.fullPath === itemPath || child.id === selectedItem.id || String(child.id) === dirNodeId) {
                              return { ...child, ...clearedData };
                            }
                            return child;
                          });
                          
                          newState[parentKey] = [...updatedChildren];
                        }
                        
                        return newState;
                      });
                      
                      // Colapsar o diretório para forçar re-fetch ao expandir
                      setExpandedNodes(prev => {
                        const newState = { ...prev };
                        newState[dirNodeId] = false;
                        return newState;
                      });
                    }
                    
                    // Atualizar o item selecionado
                    setSelectedItem(prev => ({
                      ...prev,
                      ...clearedData
                    }));
                    
                    toast.success('Flag de bloqueio limpa. Clique novamente para re-testar.');
                  } catch (error) {
                    console.error('Error clearing access denied:', error);
                    toast.error('Erro ao limpar flag de bloqueio');
                  }
                }}
                data-testid="clear-access-denied-button"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Limpar flag de bloqueio
              </Button>
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
                    ? (isAccessDenied ? 'text-red-500' : 'text-green-500')
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Info
                {activeTab === 'info' && (
                  <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${isAccessDenied ? 'bg-red-500' : 'bg-green-500'}`} />
                )}
              </button>
              
              {isFile && downloaded && canViewContent && !isAccessDenied && (
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
              
              {(isShare || isDirectory) && !isAccessDenied && (
                <button
                  onClick={() => setActiveTab('objetos')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'objetos' 
                      ? 'text-green-500' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Objetos
                  {activeTab === 'objetos' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
                  )}
                </button>
              )}
              
              {(isShare || isDirectory) && !isAccessDenied && bulkDownloadItems.length > 0 && (
                <button
                  onClick={() => setActiveTab('download')}
                  className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                    activeTab === 'download' 
                      ? 'text-green-500' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Download
                  {bulkDownloadActive && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    {bulkDownloadStats.completed}/{bulkDownloadStats.total - bulkDownloadStats.skipped}
                  </span>
                  {activeTab === 'download' && (
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
                    label="Nome" 
                    value={String(itemName)}
                    onCopy={() => copyToClipboard(String(itemName), 'name')}
                    copied={copiedField === 'name'}
                  />
                  
                  {/* Server Path */}
                  <InfoRow 
                    label="Caminho" 
                    value={selectedItem.serverPath}
                    onCopy={() => copyToClipboard(selectedItem.serverPath, 'path')}
                    copied={copiedField === 'path'}
                  />
                  
                  {/* Access Status */}
                  <InfoRow 
                    label="Status de Acesso" 
                    value={accessStatus}
                    valueClassName={accessStatusColor}
                  />
                  
                  {/* Error Message - apenas quando acesso negado */}
                  {isAccessDenied && selectedItem.error_message && (
                    <InfoRow 
                      label="Mensagem de Erro" 
                      value={selectedItem.error_message}
                      valueClassName="text-red-400 text-xs"
                    />
                  )}
                  
                  {/* Fetched Date */}
                  <InfoRow 
                    label="Data de Leitura" 
                    value={formatDate(selectedItem.fetchedAt)}
                  />
                  
                  {/* Last Write Time - para diretórios e arquivos */}
                  {(isDirectory || isFile) && selectedItem.modified && (
                    <InfoRow 
                      label="Última Modificação" 
                      value={formatDate(selectedItem.modified)}
                    />
                  )}
                  
                  {/* Size - apenas para arquivos */}
                  {isFile && !isAccessDenied && (
                    <InfoRow 
                      label="Tamanho" 
                      value={formatSize(selectedItem.size)}
                    />
                  )}
                  
                  {/* Sync Status - apenas para arquivos */}
                  {isFile && !isAccessDenied && (
                    <InfoRow 
                      label="Status de Sincronização" 
                      value={downloaded ? 'Sincronizado' : 'Não sincronizado'}
                      valueClassName={downloaded ? 'text-green-500' : 'text-muted-foreground'}
                    />
                  )}
                  
                  {/* MIME Type - apenas para arquivos sincronizados */}
                  {isFile && downloaded && downloadedFilesInfo[selectedItem.fullPath || selectedItem.serverPath]?.mimetype && (
                    <InfoRow 
                      label="MIME Type" 
                      value={downloadedFilesInfo[selectedItem.fullPath || selectedItem.serverPath].mimetype}
                      valueClassName="font-mono text-xs"
                    />
                  )}
                  
                  {/* SHA1 Hash - apenas para arquivos sincronizados */}
                  {isFile && downloaded && downloadedFilesInfo[selectedItem.fullPath || selectedItem.serverPath]?.sha1_hash && (
                    <InfoRow 
                      label="Hash SHA1" 
                      value={downloadedFilesInfo[selectedItem.fullPath || selectedItem.serverPath].sha1_hash}
                      valueClassName="font-mono text-xs"
                    />
                  )}
                  
                  {/* Versão atual - apenas para arquivos sincronizados com múltiplas versões */}
                  {isFile && downloaded && fileVersions.length > 0 && (
                    <InfoRow 
                      label="Versão" 
                      value={`v${fileVersions.find(v => v.is_current)?.version_number || 1} de ${fileVersions.length}`}
                    />
                  )}
                  
                  {/* Senha PFX - apenas para certificados PFX com senha descoberta */}
                  {isFile && downloaded && isCertificateFile(selectedItem?.name) && 
                   fileContent?.password_used && (
                    <InfoRow 
                      label="Senha PFX" 
                      value={fileContent.password_used}
                      valueClassName="font-mono bg-yellow-500/10 px-2 py-1 rounded"
                      onCopy={() => copyToClipboard(fileContent.password_used, 'pfx_password')}
                      copied={copiedField === 'pfx_password'}
                    />
                  )}
                  
                  {/* Remark - apenas para shares */}
                  {isShare && selectedItem.remark && (
                    <InfoRow 
                      label="Observação" 
                      value={selectedItem.remark}
                    />
                  )}
                  
                  {/* Type - apenas para shares */}
                  {isShare && selectedItem.share_type && (
                    <InfoRow 
                      label="Tipo de Compartilhamento" 
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
                ) : fileContent && isCertificateFile(selectedItem?.name) ? (
                  <div className="space-y-4">
                    {/* Certificate Info */}
                    {fileContent.error ? (
                      <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-4">
                        <div className="flex items-center gap-2 text-yellow-500">
                          <AlertTriangle className="w-5 h-5" />
                          <span className="font-medium">{fileContent.error}</span>
                        </div>
                        {fileContent.requires_password && (
                          <>
                            <p className="text-sm text-muted-foreground">
                              {fileContent.message}
                              {fileContent.known_passwords > 0 && (
                                <span className="ml-2 text-xs">
                                  ({fileContent.known_passwords} senha(s) conhecida(s) testada(s))
                                </span>
                              )}
                            </p>
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                value={pfxPassword}
                                onChange={(e) => setPfxPassword(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && pfxPassword) {
                                    loadFileContent();
                                  }
                                }}
                                placeholder="Digite a senha do certificado"
                                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                              <Button 
                                size="sm"
                                onClick={loadFileContent}
                                disabled={!pfxPassword || loadingContent}
                              >
                                {loadingContent ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  'Desbloquear'
                                )}
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Header */}
                        <div className="flex items-center flex-wrap gap-3 mb-4">
                          <Badge variant="outline" className="text-green-500 border-green-500">
                            {fileContent.type?.toUpperCase()}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {fileContent.total_certificates} certificado(s)
                          </span>
                          {(() => {
                            const privateKeyCount = fileContent.certificates?.filter(c => c.has_private_key).length || 0;
                            if (privateKeyCount > 0) {
                              return (
                                <Badge className="bg-purple-500/20 text-purple-400 border border-purple-500">
                                  🔑 {privateKeyCount === 1 ? 'Contém Chave Privada' : `${privateKeyCount} Chaves Privadas`}
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                          {fileContent.password_used && (
                            <Badge variant="secondary" className="text-xs">
                              Senha: {fileContent.password_used}
                            </Badge>
                          )}
                        </div>
                        
                        {/* Certificates */}
                        <div className="space-y-4">
                        {fileContent.certificates?.map((cert, idx) => (
                          <div key={idx} className="border border-border rounded-lg overflow-hidden">
                            {/* Cert Header */}
                            <div className={`p-3 ${cert.is_expired ? 'bg-red-500/10' : 'bg-green-500/10'} border-b border-border`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    Certificado {cert.index}
                                    {cert.is_self_signed && <span className="text-xs text-muted-foreground ml-2">(Auto-assinado)</span>}
                                  </span>
                                  {cert.has_private_key && (
                                    <Badge variant="secondary" className="bg-purple-500/20 text-purple-400 border-purple-500">
                                      🔑 Chave Privada
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {cert.is_expired ? (
                                    <Badge variant="destructive">Expirado</Badge>
                                  ) : cert.days_until_expiry <= 30 ? (
                                    <Badge variant="warning" className="bg-yellow-500/20 text-yellow-500 border-yellow-500">
                                      Expira em {cert.days_until_expiry} dias
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-green-500 border-green-500">
                                      Válido ({cert.days_until_expiry} dias)
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {/* Cert Details */}
                            <div className="p-4 space-y-4 text-sm">
                              {/* Subject */}
                              <div>
                                <h4 className="font-medium text-muted-foreground mb-2">Titular (Subject)</h4>
                                <div className="bg-muted/30 p-3 rounded space-y-1 font-mono text-xs">
                                  {cert.subject.commonName && <div><span className="text-muted-foreground">CN:</span> {cert.subject.commonName}</div>}
                                  {cert.subject.organizationName && <div><span className="text-muted-foreground">O:</span> {cert.subject.organizationName}</div>}
                                  {cert.subject.organizationalUnitName && <div><span className="text-muted-foreground">OU:</span> {cert.subject.organizationalUnitName}</div>}
                                  {cert.subject.localityName && <div><span className="text-muted-foreground">L:</span> {cert.subject.localityName}</div>}
                                  {cert.subject.stateOrProvinceName && <div><span className="text-muted-foreground">ST:</span> {cert.subject.stateOrProvinceName}</div>}
                                  {cert.subject.countryName && <div><span className="text-muted-foreground">C:</span> {cert.subject.countryName}</div>}
                                </div>
                              </div>
                              
                              {/* Issuer */}
                              <div>
                                <h4 className="font-medium text-muted-foreground mb-2">Emissor (Issuer)</h4>
                                <div className="bg-muted/30 p-3 rounded space-y-1 font-mono text-xs">
                                  {cert.issuer.commonName && <div><span className="text-muted-foreground">CN:</span> {cert.issuer.commonName}</div>}
                                  {cert.issuer.organizationName && <div><span className="text-muted-foreground">O:</span> {cert.issuer.organizationName}</div>}
                                  {cert.issuer.organizationalUnitName && <div><span className="text-muted-foreground">OU:</span> {cert.issuer.organizationalUnitName}</div>}
                                  {cert.issuer.countryName && <div><span className="text-muted-foreground">C:</span> {cert.issuer.countryName}</div>}
                                </div>
                              </div>
                              
                              {/* Validity */}
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <h4 className="font-medium text-muted-foreground mb-2">Válido de</h4>
                                  <div className="bg-muted/30 p-3 rounded font-mono text-xs">
                                    {new Date(cert.not_valid_before).toLocaleString('pt-BR')}
                                  </div>
                                </div>
                                <div>
                                  <h4 className="font-medium text-muted-foreground mb-2">Válido até</h4>
                                  <div className={`p-3 rounded font-mono text-xs ${cert.is_expired ? 'bg-red-500/10 text-red-400' : 'bg-muted/30'}`}>
                                    {new Date(cert.not_valid_after).toLocaleString('pt-BR')}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Technical Details */}
                              <div>
                                <h4 className="font-medium text-muted-foreground mb-2">Detalhes Técnicos</h4>
                                <div className="bg-muted/30 p-3 rounded space-y-1 font-mono text-xs">
                                  <div><span className="text-muted-foreground">Versão:</span> {cert.version}</div>
                                  <div><span className="text-muted-foreground">Algoritmo:</span> {cert.signature_algorithm}</div>
                                  <div><span className="text-muted-foreground">Chave Pública:</span> {cert.public_key?.algorithm} {cert.public_key?.key_size && `(${cert.public_key.key_size} bits)`}</div>
                                  <div><span className="text-muted-foreground">Nº Serial:</span> {cert.serial_number}</div>
                                </div>
                              </div>
                              
                              {/* Fingerprints */}
                              <div>
                                <h4 className="font-medium text-muted-foreground mb-2">Impressões Digitais</h4>
                                <div className="bg-muted/30 p-3 rounded space-y-2 font-mono text-xs">
                                  <div>
                                    <span className="text-muted-foreground">SHA-1:</span>
                                    <div className="break-all mt-1">{cert.fingerprint_sha1}</div>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">SHA-256:</span>
                                    <div className="break-all mt-1">{cert.fingerprint_sha256}</div>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Extensions */}
                              {cert.extensions?.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-muted-foreground mb-2">Extensões</h4>
                                  <div className="bg-muted/30 p-3 rounded space-y-2 text-xs">
                                    {cert.extensions.map((ext, extIdx) => (
                                      <div key={extIdx} className="border-b border-border last:border-0 pb-2 last:pb-0">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">{ext.name}</span>
                                          {ext.critical && <Badge variant="destructive" className="text-[10px] px-1 py-0">Crítico</Badge>}
                                        </div>
                                        {ext.values && (
                                          <div className="text-muted-foreground mt-1 font-mono">
                                            {Array.isArray(ext.values) 
                                              ? ext.values.join(', ')
                                              : typeof ext.values === 'object'
                                                ? JSON.stringify(ext.values)
                                                : ext.values
                                            }
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : fileContent ? (
                  <div className="space-y-4">
                    {/* Toolbar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {beautified ? (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={showRawContent}
                        >
                          <Code className="w-4 h-4 mr-2" />
                          Raw Content
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={showBeautifiedContent}
                        >
                          <Code className="w-4 h-4 mr-2" />
                          Beautify
                        </Button>
                      )}
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
                        Copiar
                      </Button>
                    </div>
                
                    {/* Content */}
                    {beautified ? (
                      <pre 
                        className="p-4 bg-zinc-900 rounded-lg text-sm font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: typeof fileContent === 'object' ? fileContent.content : fileContent }}
                      />
                    ) : (
                      <pre className="p-4 bg-muted/50 rounded-lg text-sm font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
                        {typeof fileContent === 'object' ? fileContent.content : fileContent}
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
          
          {/* Items Tab Content */}
          {activeTab === 'objetos' && (isShare || isDirectory) && !isAccessDenied && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {(() => {
                const nodeId = String(selectedItem.id || `share-${selectedItem.share_name}`);
                const children = nodeChildren[nodeId] || [];
                const isLoading = loadingNodes[nodeId];
                
                // Função de ordenação
                const sortItems = (items) => {
                  if (!items || items.length === 0) return [];
                  
                  return [...items].sort((a, b) => {
                    let aVal, bVal;
                    
                    switch (itemsSortConfig.key) {
                      case 'name':
                        aVal = (a.name || '').toLowerCase();
                        bVal = (b.name || '').toLowerCase();
                        break;
                      case 'type':
                        aVal = a.type || '';
                        bVal = b.type || '';
                        break;
                      case 'size':
                        aVal = parseInt(a.size) || 0;
                        bVal = parseInt(b.size) || 0;
                        break;
                      case 'modified':
                        aVal = a.modified || '';
                        bVal = b.modified || '';
                        break;
                      default:
                        return 0;
                    }
                    
                    if (aVal < bVal) return itemsSortConfig.direction === 'asc' ? -1 : 1;
                    if (aVal > bVal) return itemsSortConfig.direction === 'asc' ? 1 : -1;
                    return 0;
                  });
                };
                
                const handleSort = (key) => {
                  setItemsSortConfig(prev => ({
                    key,
                    direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
                  }));
                };
                
                const SortIcon = ({ columnKey }) => {
                  if (itemsSortConfig.key !== columnKey) {
                    return <ChevronRight className="w-3 h-3 opacity-30" />;
                  }
                  return itemsSortConfig.direction === 'asc' 
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3 rotate-[-90deg]" />;
                };
                
                const sortedChildren = sortItems(children);
                
                const handleItemClick = (item) => {
                  const path = item.fullPath;
                  const shareName = selectedItem.share_name || selectedItem.shareName;
                  handleSelectItem(item, item.type, path, shareName);
                };
                
                if (isLoading) {
                  return (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  );
                }
                
                if (children.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Folder className="w-8 h-8 mb-2 opacity-30" />
                      <p>Diretório vazio ou não carregado</p>
                      <p className="text-xs mt-1">Expanda o item na árvore para carregar</p>
                    </div>
                  );
                }
                
                return (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th 
                            className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80"
                            onClick={() => handleSort('name')}
                          >
                            <div className="flex items-center gap-1">
                              Nome
                              <SortIcon columnKey="name" />
                            </div>
                          </th>
                          <th 
                            className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80 w-24"
                            onClick={() => handleSort('type')}
                          >
                            <div className="flex items-center gap-1">
                              Tipo
                              <SortIcon columnKey="type" />
                            </div>
                          </th>
                          <th 
                            className="px-4 py-2 text-right font-medium border-b border-border cursor-pointer hover:bg-muted/80 w-28"
                            onClick={() => handleSort('size')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Tamanho
                              <SortIcon columnKey="size" />
                            </div>
                          </th>
                          <th 
                            className="px-4 py-2 text-left font-medium border-b border-border cursor-pointer hover:bg-muted/80 w-44"
                            onClick={() => handleSort('modified')}
                          >
                            <div className="flex items-center gap-1">
                              Modificado
                              <SortIcon columnKey="modified" />
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedChildren.map((item, idx) => {
                          const isDir = item.type === 'Directory';
                          const isItemDownloaded = !isDir && isFileDownloaded(item.fullPath);
                          
                          return (
                            <tr 
                              key={item.id || idx} 
                              className="hover:bg-muted/50 cursor-pointer"
                              onClick={() => handleItemClick(item)}
                            >
                              <td className="px-4 py-2 border-b border-border">
                                <div className="flex items-center gap-2">
                                  {isDir ? (
                                    <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                  ) : isItemDownloaded ? (
                                    <FileCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
                                  ) : (
                                    <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                  )}
                                  <span className="truncate text-blue-400 hover:underline">
                                    {item.name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-2 border-b border-border text-muted-foreground">
                                {item.type === 'Directory' ? 'Pasta' : 'Arquivo'}
                              </td>
                              <td className="px-4 py-2 border-b border-border text-right text-muted-foreground font-mono text-xs">
                                {item.type === 'Directory' ? '—' : formatSize(item.size)}
                              </td>
                              <td className="px-4 py-2 border-b border-border text-muted-foreground text-xs">
                                {item.modified ? formatDate(item.modified) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
          
          {/* Download Tab Content */}
          {activeTab === 'download' && (isShare || isDirectory) && !isAccessDenied && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Stats Header */}
              <div className="p-4 border-b border-border bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm">{bulkDownloadStats.completed} concluídos</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-sm">{bulkDownloadStats.failed} falhas</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Ban className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm">{bulkDownloadStats.skipped} ignorados</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{bulkDownloadStats.total} total</span>
                    </div>
                  </div>
                  
                  {bulkDownloadActive && (
                    <span className="text-xs text-muted-foreground">
                      Download em andamento...
                    </span>
                  )}
                </div>
                
                {/* Progress bar */}
                <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ 
                      width: `${bulkDownloadStats.total > 0 
                        ? ((bulkDownloadStats.completed + bulkDownloadStats.failed + bulkDownloadStats.skipped) / bulkDownloadStats.total) * 100 
                        : 0}%` 
                    }}
                  />
                </div>
              </div>
              
              {/* Items List */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium border-b border-border">Arquivo</th>
                      <th className="px-4 py-2 text-left font-medium border-b border-border w-28">Tamanho</th>
                      <th className="px-4 py-2 text-left font-medium border-b border-border w-32">Status</th>
                      <th className="px-4 py-2 text-center font-medium border-b border-border w-20">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkDownloadItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/50">
                        <td className="px-4 py-2 border-b border-border">
                          <div className="flex items-center gap-2">
                            <File className={`w-4 h-4 flex-shrink-0 ${
                              item.status === 'completed' ? 'text-green-500' :
                              item.status === 'failed' ? 'text-red-500' :
                              item.status === 'skipped' || item.status === 'cancelled' ? 'text-yellow-500' :
                              item.status === 'downloading' ? 'text-blue-500' :
                              'text-muted-foreground'
                            }`} />
                            <span className="truncate text-xs font-mono" title={item.fullPath}>
                              {item.name}
                            </span>
                          </div>
                          {item.error && (
                            <p className="text-xs text-red-400 mt-1 truncate" title={item.error}>
                              {item.error}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2 border-b border-border text-muted-foreground text-xs font-mono">
                          {formatSize(item.fileSize || item.size)}
                        </td>
                        <td className="px-4 py-2 border-b border-border">
                          <div className="flex items-center gap-2">
                            {item.status === 'pending' && (
                              <span className="text-xs text-muted-foreground">Aguardando</span>
                            )}
                            {item.status === 'downloading' && (
                              <div className="flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                                <span className="text-xs text-blue-500">
                                  {item.progress !== null && item.progress !== undefined
                                    ? `${item.progress}%` 
                                    : 'Baixando...'}
                                </span>
                              </div>
                            )}
                            {item.status === 'completed' && (
                              <div className="flex items-center gap-1">
                                <CheckCircle className="w-3 h-3 text-green-500" />
                                <span className="text-xs text-green-500">Concluído</span>
                              </div>
                            )}
                            {item.status === 'failed' && (
                              <div className="flex items-center gap-1">
                                <XCircle className="w-3 h-3 text-red-500" />
                                <span className="text-xs text-red-500">Falha</span>
                              </div>
                            )}
                            {item.status === 'skipped' && (
                              <div className="flex items-center gap-1">
                                <Ban className="w-3 h-3 text-yellow-500" />
                                <span className="text-xs text-yellow-500">Ignorado</span>
                              </div>
                            )}
                            {item.status === 'cancelled' && (
                              <div className="flex items-center gap-1">
                                <Ban className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Cancelado</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 border-b border-border text-center">
                          {(item.status === 'pending' || item.status === 'downloading') && bulkDownloadActive && (
                            <Button 
                              size="sm" 
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => cancelBulkDownloadItem(idx)}
                              title="Cancelar este item"
                            >
                              <XCircle className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
        </div>
      </div>

      {/* Main Content - Split View */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel - Tree View */}
        <ResizablePanel defaultSize={25} minSize={15} maxSize={50}>
          <div className="h-full border-r border-border bg-card flex flex-col">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">
                Compartilhamentos
              </h3>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-7 w-7"
                onClick={refreshShares}
                disabled={loadingShares}
                data-testid="refresh-shares-btn"
                title="Recarregar compartilhamentos"
              >
                {loadingShares ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </Button>
              
              {/* Botão de foco - mostra apenas item selecionado */}
              {selectedItem && (
                <Button 
                  variant={focusedItem ? "default" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    if (focusedItem) {
                      setFocusedItem(null);
                      // Scroll para o objeto selecionado após sair do modo foco
                      setTimeout(() => {
                        const nodeId = String(selectedItem.id || `share-${selectedItem.share_name}`);
                        const safeId = nodeId.replace(/\$/g, '_dollar_');
                        const element = document.querySelector(`[data-testid="tree-node-${safeId}"]`);
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }, 100);
                    } else {
                      const nodeId = String(selectedItem.id || `share-${selectedItem.share_name}`);
                      const shareName = selectedItem.itemType === 'share' 
                        ? selectedItem.share_name 
                        : selectedItem.shareName;
                      setFocusedItem({
                        nodeId,
                        shareName,
                        path: selectedItem.serverPath || selectedItem.fullPath,
                        name: selectedItem.name || selectedItem.share_name,
                        isShare: selectedItem.itemType === 'share'
                      });
                    }
                  }}
                  data-testid="focus-item-btn"
                  title={focusedItem ? "Mostrar todos" : "Focar no item selecionado"}
                >
                  {focusedItem ? (
                    <X className="w-4 h-4" />
                  ) : (
                    <Focus className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>
            
            {/* Indicador de foco */}
            {focusedItem && (
              <div className="px-3 py-1.5 bg-primary/10 border-b border-border flex items-center justify-between">
                <span className="text-xs text-primary truncate">
                  Focado em: <strong>{focusedItem.name}</strong>
                </span>
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="h-5 text-xs px-2 flex-shrink-0"
                  onClick={() => setFocusedItem(null)}
                >
                  Mostrar todos
                </Button>
              </div>
            )}
            
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
                  (() => {
                    // Se há um item focado
                    if (focusedItem) {
                      // Se o foco é em um share, mostrar apenas esse share
                      if (focusedItem.isShare) {
                        const filteredShares = shares.filter(s => s.share_name === focusedItem.shareName);
                        return filteredShares.map((share, index, arr) => 
                          renderTreeNode(share, 0, '', index === arr.length - 1, [])
                        );
                      }
                      
                      // Se o foco é em um diretório/arquivo dentro de um share
                      // Mostrar o share, mas apenas o path até o item focado
                      const filteredShares = shares.filter(s => s.share_name === focusedItem.shareName);
                      return filteredShares.map((share, index, arr) => 
                        renderTreeNode(share, 0, '', index === arr.length - 1, [], focusedItem.nodeId)
                      );
                    }
                    
                    // Sem foco, mostrar tudo
                    return shares.map((share, index, arr) => 
                      renderTreeNode(share, 0, '', index === arr.length - 1, [])
                    );
                  })()
                )}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>
        
        <ResizableHandle withHandle />
        
        {/* Right Panel - Info */}
        <ResizablePanel defaultSize={75}>
          <div className="h-full bg-background">
            {renderInfoPanel()}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
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
