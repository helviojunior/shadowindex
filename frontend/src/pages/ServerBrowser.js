import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Folder, 
  File, 
  Download, 
  ArrowLeft, 
  HardDrive,
  Loader2,
  ChevronRight,
  ChevronLeft,
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
  X,
  FileJson,
  Binary,
  FileText,
  ScanText,
  ShieldAlert,
  Shield
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';
import { useFileStatusEvents, useDownloadEvents } from '@/hooks/useWebSocket';
import { ShieldKeyIcon } from '@/components/icons';

// Configurar o worker do PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const API_V2 = `${BACKEND_URL}/api/v2`;  // API V2 com endpoints baseados em IDs

// Extensões de arquivos de texto que podem ser visualizados
const TEXT_EXTENSIONS = [
  // Texto básico
  '.txt', '.md', '.markdown', '.rst', '.text',
  // Configuração
  '.xml', '.json', '.config', '.cfg', '.ini', '.conf', '.yaml', '.yml', '.toml', '.properties',
  '.env', '.env.local', '.env.development', '.env.production', '.env.example',
  '.htaccess', '.htpasswd',
  // Logs
  '.log',
  // Dados
  '.csv', '.tsv',
  // Web
  '.html', '.htm', '.xhtml', '.css', '.scss', '.sass', '.less',
  // JavaScript/TypeScript
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
  // Python
  '.py', '.pyw', '.pyi', '.pyx',
  // Shell/Scripts
  '.sh', '.bash', '.zsh', '.fish', '.csh', '.ksh',
  '.bat', '.cmd',
  '.ps1', '.psm1', '.psd1',  // PowerShell
  '.vbs', '.vbe', '.wsf', '.wsh',  // VBScript
  '.ahk',  // AutoHotkey
  '.awk',
  // Perl
  '.pl', '.pm', '.perl',
  // Ruby
  '.rb', '.rake', '.gemspec',
  // PHP
  '.php', '.php3', '.php4', '.php5', '.phtml',
  // Java/Kotlin/Scala
  '.java', '.kt', '.kts', '.scala', '.groovy', '.gradle',
  // C/C++/C#
  '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx',
  '.cs', '.csx',
  // Go
  '.go',
  // Rust
  '.rs',
  // SQL
  '.sql', '.ddl', '.dml',
  // ASP.NET
  '.asp', '.aspx', '.asmx', '.asa', '.asax', '.ascx', '.master',
  // Outros
  '.reg',  // Windows Registry
  '.inc',  // Include files
  '.inf',  // Windows INF
  '.gitignore', '.gitattributes', '.gitmodules',
  '.dockerignore', '.editorconfig', '.eslintrc', '.prettierrc', '.babelrc',
  '.npmrc', '.nvmrc', '.yarnrc',
  // Terraform/Ansible
  '.tf', '.tfvars', '.hcl',
  // Kubernetes/Docker
  '.dockerfile',
  // Markup
  '.tex', '.latex', '.bib',
  // Data serialization
  '.plist', '.strings'
];

// Arquivos especiais sem extensão que são texto
const SPECIAL_TEXT_FILES = [
  '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.editorconfig',
  '.eslintrc', '.prettierrc', '.babelrc', '.npmrc', '.nvmrc', '.yarnrc',
  '.htaccess', '.htpasswd', '.bashrc', '.bash_profile', '.bash_history',
  '.zshrc', '.zsh_history', '.profile', '.bash_aliases',
  'Dockerfile', 'Makefile', 'Vagrantfile', 'Gemfile', 'Rakefile', 'Procfile',
  'README', 'LICENSE', 'CHANGELOG', 'CONTRIBUTING', 'AUTHORS', 'INSTALL',
  'COPYING', 'NOTICE', 'TODO', 'CREDITS',
  'requirements.txt', 'package.json', 'composer.json', 'Cargo.toml',
  'hosts', 'passwd', 'shadow', 'group', 'fstab', 'crontab', 'sudoers'
];

// Extensões de arquivos de imagem que podem ser visualizados
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];

// Extensões de certificados digitais
const CERTIFICATE_EXTENSIONS = ['.cer', '.crt', '.pem', '.der', '.p7b', '.p7c', '.pfx', '.p12'];

// Extensão PDF
const PDF_EXTENSION = '.pdf';

const ServerBrowser = () => {
  const { serverId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { ignoreCache } = useApp();
  
  // Determinar a origem da navegação para o botão "Voltar"
  const getBackDestination = () => {
    // Verificar se veio via state do React Router
    if (location.state?.from) {
      return location.state.from;
    }
    // Verificar query parameter
    const params = new URLSearchParams(location.search);
    const from = params.get('from');
    if (from) {
      return from;
    }
    // Default: /servers
    return '/servers';
  };
  
  const backDestination = getBackDestination();
  const backLabel = backDestination === '/files/browse' ? 'Navegação' 
                  : backDestination === '/leaks' ? 'Leaks' 
                  : 'Servidores';
  
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
  const [contentLoadError, setContentLoadError] = useState(false); // Flag para evitar loop em caso de erro
  const [beautified, setBeautified] = useState(false);
  const [base64Decoded, setBase64Decoded] = useState(false); // Flag para conteúdo decodificado de base64
  const [itemsSortConfig, setItemsSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [focusedItem, setFocusedItem] = useState(null); // Item focado (oculta os demais) - {nodeId, shareName, path}
  const [showOnlyDownloaded, setShowOnlyDownloaded] = useState(false); // Filtro para mostrar apenas baixados
  const [showOnlySearchResults, setShowOnlySearchResults] = useState(false); // Filtro para mostrar apenas resultados da busca
  const [pfxPassword, setPfxPassword] = useState(''); // Senha para arquivos PFX
  const [singleDownloadProgress, setSingleDownloadProgress] = useState(null); // Progresso do download individual (0-100)
  const singleDownloadCancelledRef = useRef(false); // Ref para cancelamento do sync individual
  const processingClickRef = useRef(false); // Ref para evitar cliques duplos na tree
  
  // Estados para visualização de PDF
  const [pdfNumPages, setPdfNumPages] = useState(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.0);
  
  // Estados para OCR
  const [ocrData, setOcrData] = useState(null); // {ocr_processed, ocr_content, ocr_metadata, ocr_error}
  const [ocrLoading, setOcrLoading] = useState(false);
  const [processingOcr, setProcessingOcr] = useState(false);
  
  // Estados para identificação manual de credenciais
  const [showLeakModal, setShowLeakModal] = useState(false);
  const [leakTypes, setLeakTypes] = useState([]);
  const [manualLeak, setManualLeak] = useState({
    secret_type: 'password',
    description: '',
    line_number: null,
    match_text: ''
  });
  const [submittingLeak, setSubmittingLeak] = useState(false);
  
  // Estados para download recursivo
  const [bulkDownloadConfig, setBulkDownloadConfig] = useState({ depth: 5, maxSize: 100 }); // maxSize em MB
  const [bulkDownloadActive, setBulkDownloadActive] = useState(false);
  const [bulkDownloadItems, setBulkDownloadItems] = useState([]); // Lista de itens a baixar
  const [bulkDownloadStats, setBulkDownloadStats] = useState({ total: 0, completed: 0, failed: 0, skipped: 0 });
  const bulkDownloadCancelledRef = useRef(false); // Ref para cancelamento síncrono

  // Estados para busca
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [navigatingToResult, setNavigatingToResult] = useState(false); // Overlay de loading para navegação
  const [pendingFileNavigation, setPendingFileNavigation] = useState(null); // ID do arquivo para navegar automaticamente
  const [searchFilters, setSearchFilters] = useState({
    extension: '',
    sha1: '',
    dateFrom: '',
    dateTo: '',
    itemType: '' // '', 'File', 'Directory'
  });
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const searchTimeoutRef = useRef(null);
  const urlParamsConsumedRef = useRef(false); // Flag para garantir que parâmetros da URL sejam processados apenas uma vez
  

  // WebSocket para atualizações em tempo real do status dos arquivos
  useFileStatusEvents((data) => {
    // Atualizar status do arquivo na tree view quando receber evento
    if (data.server_id === parseInt(serverId)) {
      // Atualizar lista de arquivos baixados
      if (data.status === 'downloaded' && data.file_id) {
        setDownloadedFiles(prev => {
          if (!prev.includes(data.file_path)) {
            return [...prev, data.file_path];
          }
          return prev;
        });
      }
    }
  });

  // WebSocket para eventos de download (progresso e conclusão)
  // Filtra eventos para só atualizar progresso do arquivo selecionado
  useDownloadEvents(
    // onProgress
    (data) => {
      const selectedPath = selectedItem?.fullPath || selectedItem?.serverPath;
      if (data.file_path && selectedPath && data.file_path === selectedPath) {
        setSingleDownloadProgress(Math.round(data.progress));
      }
    },
    // onComplete
    (data) => {
      const selectedPath = selectedItem?.fullPath || selectedItem?.serverPath;
      if (data.file_path && selectedPath && data.file_path === selectedPath) {
        setSingleDownloadProgress(null);
      }
      // Recarregar arquivos baixados quando qualquer download completar
      loadDownloadedFiles();
    },
    // onFailed
    (data) => {
      const selectedPath = selectedItem?.fullPath || selectedItem?.serverPath;
      if (data.file_path && selectedPath && data.file_path === selectedPath) {
        setSingleDownloadProgress(null);
      }
      // Não exibir toast de erro aqui - erros em batch geram muitos toasts.
      // O status de cada download pode ser acompanhado em Arquivos > Downloads.
    },
    // onStarted
    (data) => {
      const selectedPath = selectedItem?.fullPath || selectedItem?.serverPath;
      if (data.file_path && selectedPath && data.file_path === selectedPath) {
        setSingleDownloadProgress(0);
      }
    }
  );

  // Carregar configurações gerais para os valores default dos combos
  useEffect(() => {
    const loadGeneralSettings = async () => {
      try {
        const response = await axios.get(`${API}/settings`);
        const settings = response.data;
        
        const depth = settings.default_depth_levels?.value 
          ? parseInt(settings.default_depth_levels.value) 
          : 5;
        const maxSize = settings.default_max_file_size_mb?.value 
          ? parseInt(settings.default_max_file_size_mb.value) 
          : 100;
        
        setBulkDownloadConfig({ depth, maxSize });
      } catch (error) {
        console.error('Error loading general settings:', error);
        // Manter valores default em caso de erro
      }
    };
    
    // Carregar tipos de leak
    const loadLeakTypes = async () => {
      try {
        const response = await axios.get(`${API_V2}/gitleaks/leak-types`);
        setLeakTypes(response.data);
      } catch (error) {
        console.error('Error loading leak types:', error);
        // Usar tipos padrão se falhar
        setLeakTypes([
          { value: 'password', label: 'Senha', severity: 'medium' },
          { value: 'token', label: 'Token', severity: 'medium' },
          { value: 'api_key', label: 'API Key', severity: 'high' },
          { value: 'private_key', label: 'Chave Privada', severity: 'critical' },
          { value: 'ssh_key', label: 'Chave SSH', severity: 'critical' },
          { value: 'certificate', label: 'Certificado com Chave', severity: 'critical' },
          { value: 'connection_string', label: 'String de Conexão', severity: 'high' },
          { value: 'other', label: 'Outro', severity: 'low' }
        ]);
      }
    };
    
    loadGeneralSettings();
    loadLeakTypes();
  }, []);

  // Função para submeter leak manual
  const submitManualLeak = async () => {
    if (!selectedItem || !selectedItem.fullPath) {
      toast.error('Nenhum arquivo selecionado');
      return;
    }
    
    setSubmittingLeak(true);
    try {
      const response = await axios.post(`${API_V2}/gitleaks/manual-leak`, {
        file_path: selectedItem.fullPath,
        server_id: parseInt(serverId),
        secret_type: manualLeak.secret_type,
        description: manualLeak.description || null,
        line_number: manualLeak.line_number || null,
        match_text: manualLeak.match_text || null
      });
      
      if (response.data.success) {
        toast.success('Credencial identificada com sucesso');
        setShowLeakModal(false);
        setManualLeak({
          secret_type: 'password',
          description: '',
          line_number: null,
          match_text: ''
        });
      } else {
        toast.error(response.data.message || 'Erro ao registrar credencial');
      }
    } catch (error) {
      console.error('Error submitting manual leak:', error);
      toast.error('Erro ao registrar credencial');
    } finally {
      setSubmittingLeak(false);
    }
  };

  useEffect(() => {
    loadServer();
    loadDownloadedFiles();
  }, [serverId]);


  // Atalho de teclado Ctrl+F (Windows) ou Cmd+F (Mac) para focar na busca
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+F no Windows/Linux ou Cmd+F no Mac
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault(); // Prevenir busca nativa do navegador
        
        // Focar no campo de busca
        const searchInput = document.querySelector('[data-testid="search-input"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select(); // Selecionar texto existente
        }
      }
      
      // ESC para fechar resultados de busca
      if (e.key === 'Escape' && searchResults) {
        clearSearch();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchResults]);

  // Verificar parâmetro file_id ou path na URL para navegação automática (apenas uma vez)
  useEffect(() => {
    // Se já consumimos os parâmetros, não processar novamente
    if (urlParamsConsumedRef.current) return;

    const searchParams = new URLSearchParams(location.search);
    const fileId = searchParams.get('file_id');
    const filePath = searchParams.get('path');

    if (fileId && server && !pendingFileNavigation) {
      urlParamsConsumedRef.current = true;
      setPendingFileNavigation(parseInt(fileId));
      // Limpar parâmetros da URL imediatamente via React Router
      navigate(location.pathname, { replace: true });
    } else if (filePath && server && shares.length > 0 && !pendingFileNavigation) {
      urlParamsConsumedRef.current = true;
      // Limpar parâmetros da URL imediatamente via React Router
      navigate(location.pathname, { replace: true });
      // Navegar pelo caminho do arquivo (para leaks manuais)
      const decodedPath = decodeURIComponent(filePath);
      navigateToFilePath(decodedPath);
    }
  }, [location.search, server, shares]);
  
  // Navegar até o arquivo quando temos pendingFileNavigation e os shares carregaram
  useEffect(() => {
    const navigateToFile = async () => {
      if (!pendingFileNavigation || !server || shares.length === 0) return;
      
      setNavigatingToResult(true);
      
      try {
        // Buscar informações do arquivo baixado
        const response = await axios.get(`${API_V2}/downloads/${pendingFileNavigation}`);
        const fileInfo = response.data;
        
        if (fileInfo && fileInfo.file_path) {
          // Criar um item para navegar
          const item = {
            id: fileInfo.id,
            name: fileInfo.file_name || fileInfo.file_path.split('\\').pop() || fileInfo.file_path.split('/').pop(),
            full_path: fileInfo.file_path,
            share_name: fileInfo.share_name,
            item_type: 'File',
            itemType: 'File',
            is_downloaded: true
          };
          
          // Usar a função de navegação existente
          await navigateToSearchResult(item);
        } else {
          toast.error('Arquivo não encontrado');
        }
      } catch (error) {
        console.error('Error navigating to file:', error);
        toast.error('Erro ao navegar até o arquivo');
      } finally {
        setNavigatingToResult(false);
        setPendingFileNavigation(null);
      }
    };

    navigateToFile();
  }, [pendingFileNavigation, server, shares]);

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
    
    // Resetar estados do PDF
    setPdfNumPages(null);
    setPdfPageNumber(1);
    setPdfScale(1.0);
    
    // Se acesso negado, mostrar apenas Info
    if (isAccessDenied) {
      setActiveTab('info');
    } else if (isShare || isDirectory) {
      setActiveTab('objetos');
    } else if (isFile) {
      const filePath = selectedItem.fullPath || selectedItem.serverPath;

      // Recarregar lista de arquivos baixados para ter dados atualizados
      loadDownloadedFiles();

      const isDownloaded = downloadedFiles.includes(filePath);
      const fileInfo = downloadedFilesInfo[filePath];
      console.log(fileInfo);
      const fileMimeType = fileInfo?.mimetype || fileInfo?.mime_type || null;
      console.log(fileMimeType);
      const canView = canPreviewFile(selectedItem.name, fileMimeType);

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
  }, [selectedItem?.id, bulkDownloadActive]);

  // Atualizar aba quando downloadedFiles mudar (arquivo foi sincronizado)
  useEffect(() => {
    if (!selectedItem || selectedItem.itemType !== 'File') return;
    
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    const isDownloaded = downloadedFiles.includes(filePath);
    const fileInfo = downloadedFilesInfo[filePath];
    const fileMimeType = fileInfo?.mimetype || fileInfo?.mime_type || null;
    const canView = canPreviewFile(selectedItem.name, fileMimeType);
    
    // Se arquivo foi sincronizado e pode ser visualizado, atualizar aba
    if (isDownloaded && canView && activeTab === 'info') {
      setActiveTab('view');
      loadFileVersions(filePath);
    }
  }, [downloadedFiles, selectedItem?.id]);

  // Resetar estados quando o arquivo selecionado muda
  useEffect(() => {
    // Limpar conteúdo e estados de formatação quando muda de arquivo
    setFileContent(null);
    setRawFileContent(null);
    setFilePreviewUrl(null);
    setBeautified(false);
    setBase64Decoded(false);
    setContentLoadError(false); // Reset erro ao mudar de arquivo
    setSingleDownloadProgress(null); // Reset progresso de download ao mudar de arquivo
  }, [selectedItem?.id, selectedItem?.fullPath]);

  // Carregar conteúdo automaticamente quando aba View for selecionada
  useEffect(() => {
    // Só executar se estiver na aba view e for um arquivo
    if (activeTab !== 'view' || selectedItem?.itemType !== 'File') {
      return;
    }
    
    // Se já tem conteúdo, está carregando, ou teve erro, não fazer nada
    if (fileContent || filePreviewUrl || loadingContent || contentLoadError) {
      return;
    }
    
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    const isDownloaded = downloadedFiles.includes(filePath);
    const fileInfo = downloadedFilesInfo[filePath];
    const fileMimeType = fileInfo?.mimetype || fileInfo?.mime_type || null;
    const canView = canPreviewFile(selectedItem.name, fileMimeType);
    
    if (isDownloaded && canView) {
      loadFileContent();
    }
  }, [activeTab, selectedItem?.id, fileContent, filePreviewUrl, loadingContent, contentLoadError, downloadedFiles]);

  // Carregar dados de OCR quando arquivo baixado for selecionado
  useEffect(() => {
    if (selectedItem?.itemType === 'File') {
      const filePath = selectedItem.fullPath || selectedItem.serverPath;
      const fileInfo = downloadedFilesInfo[filePath];
      
      if (fileInfo?.id) {
        loadOcrData(fileInfo.id);
      } else {
        setOcrData(null);
      }
    } else {
      setOcrData(null);
    }
  }, [selectedItem?.id, downloadedFilesInfo]);

  const loadServer = async () => {
    try {
      const response = await axios.get(`${API}/servers/${serverId}`);
      setServer(response.data);
    } catch (error) {
      console.error('Error loading server:', error);
      toast.error('Erro ao carregar servidor');
    }
  };

  // Verifica se é um arquivo de texto (por extensão ou mime type)
  const isTextFile = (filename, mimeType = null) => {
    if (!filename) return false;
    const lowerName = filename.toLowerCase();
    
    // Verificar por mime type text/*
    if (mimeType && mimeType.startsWith('text/')) return true;
    
    // Verificar extensões de texto
    if (TEXT_EXTENSIONS.some(ext => lowerName.endsWith(ext))) return true;
    
    // Verificar arquivos especiais (sem extensão ou começando com .)
    if (SPECIAL_TEXT_FILES.some(name => lowerName === name.toLowerCase() || lowerName.endsWith('/' + name.toLowerCase()))) return true;
    
    return false;
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
  const canPreviewFile = (filename, mimeType = null) => {
    if (!filename) return false;
    return isTextFile(filename, mimeType) || isImageFile(filename) || isPdfFile(filename) || isCertificateFile(filename);
  };
  
  const isCertificateFile = (filename) => {
    if (!filename) return false;
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return CERTIFICATE_EXTENSIONS.includes(ext);
  };

  // Função auxiliar para obter fileId pelo path (usando API V2)
  const getFileIdByPath = async (filePath) => {
    // Primeiro verificar no cache local
    const cachedInfo = downloadedFilesInfo[filePath];
    if (cachedInfo?.id) {
      return cachedInfo.id;
    }
    
    // Buscar via API V2
    try {
      const response = await axios.get(`${API_V2}/servers/${serverId}/files/by-path`, {
        params: { file_path: filePath }
      });
      if (response.data.found && response.data.file_id) {
        // Atualizar cache local
        setDownloadedFilesInfo(prev => ({
          ...prev,
          [filePath]: { ...prev[filePath], id: response.data.file_id, ...response.data.file }
        }));
        return response.data.file_id;
      }
    } catch (error) {
      console.error('Error getting file ID by path:', error);
    }
    return null;
  };

  // Carrega o conteúdo do arquivo para visualização
  const loadFileContent = async () => {
    if (!selectedItem || !isFileDownloaded(selectedItem.fullPath || selectedItem.serverPath)) {
      toast.error('Arquivo precisa ser sincronizado primeiro');
      return;
    }

    const filename = selectedItem.name;
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    
    // Obter file_id do downloadedFilesInfo ou buscar via API
    let fileId = downloadedFilesInfo[filePath]?.id;
    if (!fileId) {
      fileId = await getFileIdByPath(filePath);
    }
    
    if (!fileId) {
      toast.error('Arquivo não encontrado no banco de dados');
      setContentLoadError(true);
      return;
    }
    
    // Para certificados, carregar informações parseadas
    if (isCertificateFile(filename)) {
      setLoadingContent(true);
      try {
        const requestBody = {};
        if (pfxPassword && pfxPassword.trim()) {
          requestBody.password = pfxPassword.trim();
        }
        const response = await axios.post(`${API_V2}/servers/${serverId}/files/${fileId}/certificate-info`, requestBody);
        
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
        
        // Capturar response data completo do backend (inclui debug_log)
        const responseData = error.response?.data || {};
        
        setFileContent({ 
          error: true,
          message: responseData.message || error.response?.data?.detail || error.message,
          requires_password: responseData.requires_password || true,
          debug_log: responseData.debug_log || [],
          passwords_tried: responseData.passwords_tried || [],
          last_exception: responseData.last_exception,
          exception_type: responseData.exception_type
        });
        setContentLoadError(true);
      } finally {
        setLoadingContent(false);
      }
      return;
    }
    
    // Para imagens e PDFs, carregar como blob e criar URL
    if (isImageFile(filename) || isPdfFile(filename)) {
      setLoadingContent(true);
      try {
        const response = await axios.get(`${API_V2}/servers/${serverId}/files/${fileId}/download`, {
          responseType: 'blob'
        });
        
        const url = window.URL.createObjectURL(new Blob([response.data]));
        setFilePreviewUrl(url);
        setFileContent(null);
      } catch (error) {
        console.error('Error loading file preview:', error);
        // Handle blob error response
        let errorMessage = 'Erro ao carregar preview do arquivo';
        if (error.response?.data instanceof Blob) {
          try {
            const text = await error.response.data.text();
            const parsed = JSON.parse(text);
            errorMessage = parsed.detail || errorMessage;
          } catch (e) {
            // Ignore parse errors
          }
        }
        toast.error(errorMessage);
        setContentLoadError(true);
      } finally {
        setLoadingContent(false);
      }
      return;
    }

    // Para arquivos de texto
    setLoadingContent(true);
    try {
      const response = await axios.get(`${API_V2}/servers/${serverId}/files/${fileId}/content`);
      
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
      const fname = selectedItem?.name?.toLowerCase() || '';
      try {
        let beautifiedContent = content;
        let fileType = 'text';
        
        if (fname.endsWith('.json')) {
          fileType = 'json';
          beautifiedContent = JSON.stringify(JSON.parse(content), null, 2);
        } else if (fname.endsWith('.xml') || fname.endsWith('.config')) {
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
      setContentLoadError(true);
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
    setBase64Decoded(false);
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

  // Decodifica conteúdo de Base64
  const decodeBase64Content = () => {
    const content = rawFileContent || (typeof fileContent === 'object' ? fileContent.content : fileContent);
    if (!content) return;
    
    try {
      // Limpar o conteúdo (remover espaços e quebras de linha extras)
      const cleanContent = content.trim();
      
      // Tentar decodificar
      const decoded = atob(cleanContent);
      
      // Verificar se o resultado é texto válido
      // Contar caracteres printáveis (incluindo UTF-8/acentos)
      let printableCount = 0;
      let nullCount = 0;
      const bytes = new Uint8Array(decoded.length);
      
      for (let i = 0; i < decoded.length; i++) {
        const byte = decoded.charCodeAt(i);
        bytes[i] = byte;
        
        // Caracteres printáveis: tab, newline, carriage return, e 32-126, ou bytes UTF-8 (128-255)
        if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) {
          printableCount++;
        }
        if (byte === 0) {
          nullCount++;
        }
      }
      
      // Calcular proporção de caracteres printáveis
      const printableRatio = decoded.length > 0 ? printableCount / decoded.length : 0;
      
      // Considera texto se:
      // - Mais de 85% dos caracteres são printáveis
      // - E não tem muitos bytes nulos (< 5%)
      const nullRatio = decoded.length > 0 ? nullCount / decoded.length : 0;
      const isText = printableRatio > 0.85 && nullRatio < 0.05;
      
      if (!isText && decoded.length > 0) {
        // Conteúdo binário - mostrar no formato hexdump -C
        let hexdump = '';
        const bytesPerLine = 16;
        
        for (let offset = 0; offset < bytes.length; offset += bytesPerLine) {
          const offsetHex = offset.toString(16).padStart(8, '0');
          let hexPart = '';
          let asciiPart = '';
          
          for (let i = 0; i < bytesPerLine; i++) {
            if (offset + i < bytes.length) {
              const byte = bytes[offset + i];
              hexPart += byte.toString(16).padStart(2, '0') + ' ';
              asciiPart += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
            } else {
              hexPart += '   ';
              asciiPart += ' ';
            }
            if (i === 7) hexPart += ' ';
          }
          
          hexdump += `${offsetHex}  ${hexPart} |${asciiPart}|\n`;
        }
        
        setFileContent(`[Conteúdo binário - ${decoded.length} bytes]\n\n${hexdump}`);
      } else {
        setFileContent(decoded);
      }
      
      setBase64Decoded(true);
      setBeautified(false);
    } catch (error) {
      console.error('Base64 decode error:', error);
      toast.error('Erro ao decodificar Base64 - conteúdo inválido');
    }
  };

  // Restaura conteúdo original (antes da decodificação base64)
  const restoreOriginalContent = () => {
    if (!rawFileContent) return;
    setFileContent(rawFileContent);
    setBase64Decoded(false);
    setBeautified(false);
  };

  // Download do arquivo para a máquina do usuário
  const openFile = async () => {
    if (!selectedItem) return;
    
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    
    // Obter file_id do downloadedFilesInfo ou buscar via API
    let fileId = downloadedFilesInfo[filePath]?.id;
    if (!fileId) {
      fileId = await getFileIdByPath(filePath);
    }
    
    if (!fileId) {
      toast.error('Arquivo não encontrado no banco de dados');
      return;
    }
    
    try {
      const response = await axios.get(`${API_V2}/servers/${serverId}/files/${fileId}/download`, {
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
    } catch (error) {
      console.error('Error downloading file:', error);
      // Handle blob error response
      let errorMessage = 'Erro ao baixar arquivo';
      if (error.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const parsed = JSON.parse(text);
          errorMessage = parsed.detail || errorMessage;
        } catch (e) {
          // Ignore parse errors
        }
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      toast.error(errorMessage);
    }
  };

  const loadDownloadedFiles = async () => {
    try {
      const response = await axios.get(`${API_V2}/servers/${serverId}/downloads`);
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

  // Carregar dados de OCR do arquivo selecionado
  const loadOcrData = async (fileId) => {
    if (!fileId) return;
    
    setOcrLoading(true);
    try {
      const response = await axios.get(`${API_V2}/servers/${serverId}/files/${fileId}/ocr`);
      setOcrData(response.data);
    } catch (error) {
      console.error('Error loading OCR data:', error);
      setOcrData(null);
    } finally {
      setOcrLoading(false);
    }
  };

  // Processar OCR no arquivo
  const processOcr = async () => {
    if (!selectedItem) return;
    
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    const fileInfo = downloadedFilesInfo[filePath];
    
    if (!fileInfo?.id) {
      toast.error('Arquivo não encontrado para processar OCR');
      return;
    }
    
    setProcessingOcr(true);
    try {
      const response = await axios.post(`${API_V2}/servers/${serverId}/files/${fileInfo.id}/process-ocr`);
      
      if (response.data.success) {
        toast.success(`OCR processado! ${response.data.content_length} caracteres extraídos`);
        // Recarregar dados de OCR
        await loadOcrData(fileInfo.id);
      } else {
        toast.error(`Erro no OCR: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error processing OCR:', error);
      toast.error('Erro ao processar OCR');
    } finally {
      setProcessingOcr(false);
    }
  };


  // Carregar versões do arquivo selecionado
  const loadFileVersions = async (filePath) => {
    try {
      // Obter file_id do downloadedFilesInfo ou buscar via API
      let fileId = downloadedFilesInfo[filePath]?.id;
      if (!fileId) {
        fileId = await getFileIdByPath(filePath);
      }
      
      if (fileId) {
        const response = await axios.get(`${API_V2}/servers/${serverId}/files/${fileId}/versions`);
        setFileVersions(response.data);
      } else {
        console.warn('File ID not found for versions:', filePath);
        setFileVersions([]);
      }
    } catch (error) {
      console.error('Error loading file versions:', error);
      setFileVersions([]);
    }
  };

  // Função de busca rápida (debounced)
  const performQuickSearch = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults(null);
      return;
    }
    
    setSearchLoading(true);
    try {
      const response = await axios.get(`${API_V2}/servers/${serverId}/search/quick`, {
        params: { q: query, limit: 50 }
      });
      setSearchResults(response.data);
    } catch (error) {
      console.error('Error searching:', error);
      toast.error('Erro ao buscar');
    } finally {
      setSearchLoading(false);
    }
  };

  // Função de busca avançada
  const performAdvancedSearch = async () => {
    setSearchLoading(true);
    try {
      const searchParams = {
        query: searchQuery || null,
        sha1: searchFilters.sha1 || null,
        extension: searchFilters.extension || null,
        date_from: searchFilters.dateFrom || null,
        date_to: searchFilters.dateTo || null,
        item_type: searchFilters.itemType || null,
        limit: 100
      };
      
      const response = await axios.post(`${API_V2}/servers/${serverId}/search`, searchParams);
      setSearchResults({
        query: searchQuery,
        directories: response.data.filter(r => r.item_type === 'Directory'),
        files: response.data.filter(r => r.item_type === 'File' && !r.is_downloaded),
        downloaded: response.data.filter(r => r.is_downloaded),
        total: response.data.length
      });
    } catch (error) {
      console.error('Error in advanced search:', error);
      toast.error('Erro na busca avançada');
    } finally {
      setSearchLoading(false);
    }
  };

  // Handler para mudança no campo de busca (com debounce)
  const handleSearchChange = (value) => {
    setSearchQuery(value);
    
    // Limpar timeout anterior
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // Se busca avançada está ativa, não fazer busca rápida automática
    if (showAdvancedSearch) return;
    
    // Debounce de 300ms
    searchTimeoutRef.current = setTimeout(() => {
      performQuickSearch(value);
    }, 300);
  };

  // Limpar busca
  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchFilters({
      extension: '',
      sha1: '',
      dateFrom: '',
      dateTo: '',
      itemType: ''
    });
    setShowAdvancedSearch(false);
    setShowOnlySearchResults(false);
  };

  // Exportar resultados da busca para JSON
  const exportSearchResultsToJson = () => {
    if (!searchResults) return;
    
    const exportData = {
      exportDate: new Date().toISOString(),
      server: {
        id: serverId,
        name: server?.name,
        ip: server?.ip
      },
      searchCriteria: {
        query: searchQuery || null,
        filters: {
          extension: searchFilters.extension || null,
          sha1: searchFilters.sha1 || null,
          dateFrom: searchFilters.dateFrom || null,
          dateTo: searchFilters.dateTo || null,
          itemType: searchFilters.itemType || null
        }
      },
      summary: {
        totalResults: searchResults.total,
        directories: searchResults.directories?.length || 0,
        files: searchResults.files?.length || 0,
        downloadedFiles: searchResults.downloaded?.length || 0
      },
      results: {
        directories: searchResults.directories?.map(item => ({
          id: item.id,
          name: item.name,
          fullPath: item.full_path,
          shareName: item.share_name,
          size: item.size,
          modified_at: item.modified_at,
          type: 'Directory'
        })) || [],
        files: searchResults.files?.map(item => ({
          id: item.id,
          name: item.name,
          fullPath: item.full_path,
          shareName: item.share_name,
          size: item.size,
          modified_at: item.modified_at,
          type: 'File',
          isDownloaded: false
        })) || [],
        downloadedFiles: searchResults.downloaded?.map(item => ({
          id: item.id,
          name: item.name,
          fullPath: item.full_path,
          shareName: item.share_name,
          size: item.size,
          sha1Hash: item.sha1_hash,
          downloadedAt: item.downloaded_at,
          type: 'File',
          isDownloaded: true
        })) || []
      }
    };
    
    // Gerar nome do arquivo: search-results-SERVERNAME-YYYYMMDD-EPOCH.json
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const epoch = now.getTime();
    const serverName = (server?.name || `server${serverId}`).replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `search-results-${serverName}-${year}${month}${day}-${epoch}.json`;
    
    // Criar e baixar o arquivo JSON
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Função para destacar termos de busca no texto
  const highlightSearchTerm = (text, query) => {
    if (!query || !text) return text;
    
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    
    if (index === -1) return text;
    
    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);
    
    return (
      <>
        {before}
        <span className="bg-yellow-500/40 text-yellow-200 px-0.5 rounded">{match}</span>
        {after}
      </>
    );
  };

  // Formatar caminho resumido para exibição nos resultados de busca
  // Formato: share$\..\parentDir\itemName
  const formatShortPath = (fullPath, shareName, itemName) => {
    if (!fullPath) return shareName || '';
    
    // fullPath formato: \\ip\share\folder1\folder2\folder3\item
    const parts = fullPath.split('\\').filter(p => p);
    // parts: [ip, share, folder1, folder2, folder3, item]
    
    if (parts.length <= 2) {
      // Apenas share, sem subpastas
      return shareName || parts[1] || '';
    }
    
    // Pegar o share e o diretório pai
    const share = parts[1] || shareName || '';
    const parentDir = parts.length > 3 ? parts[parts.length - 2] : '';
    
    if (!parentDir || parentDir === itemName) {
      // Item está diretamente no share ou é o próprio diretório pai
      return `${share}\\${itemName}`;
    }
    
    // Formato: share$\..\parentDir\itemName
    return `${share}\\..\\${parentDir}\\${itemName}`;
  };

  // Navegar para um resultado de busca
  const navigateToSearchResult = async (result) => {
    // Mostrar overlay de loading
    setNavigatingToResult(true);
    
    try {
      // Encontrar o share do resultado
      const shareName = result.share_name;
      
      // Expandir a árvore até o item
      const pathParts = result.full_path.split('\\').filter(p => p);
      
      if (pathParts.length < 2) {
        return;
      }
      
      // Construir o path do share
      const serverIp = pathParts[0];
      const shareNameFromPath = pathParts[1];
      const sharePath = `\\\\${serverIp}\\${shareNameFromPath}`;
      const shareNodeId = `share-${shareName}`;
      
      // 1. Primeiro expandir o share
      setExpandedNodes(prev => ({ ...prev, [shareNodeId]: true }));
      
      // Carregar filhos do share se necessário
      try {
        await loadDirectory(shareNodeId, sharePath, shareName);
      } catch (e) {
        console.error('Erro ao carregar share:', e);
      }
      
      // Aguardar o estado atualizar
      await new Promise(resolve => setTimeout(resolve, 400));
    
    // 2. Expandir cada diretório intermediário sequencialmente
    // Precisamos construir o path incrementalmente e buscar cada nível
    let currentPath = sharePath;
    let parentNodeId = shareNodeId;
    
    // Função para buscar o estado atual de nodeChildren
    const getNodeChildren = () => {
      return new Promise(resolve => {
        // Forçar uma atualização para obter o estado mais recente
        setNodeChildren(prev => {
          resolve(prev);
          return prev;
        });
      });
    };
    
    for (let i = 2; i < pathParts.length - 1; i++) {
      currentPath += `\\${pathParts[i]}`;
      const dirName = pathParts[i];
      
      // Buscar os filhos do nó pai para encontrar o ID correto deste diretório
      const currentNodeChildren = await getNodeChildren();
      const currentChildren = currentNodeChildren[parentNodeId] || [];
      
      console.log(`[Navigate] Buscando "${dirName}" em ${parentNodeId}, ${currentChildren.length} filhos disponíveis`);
      
      // Encontrar o diretório pelo nome ou fullPath
      const dirItem = currentChildren.find(child => 
        child.name === dirName || child.fullPath === currentPath
      );
      
      if (dirItem) {
        const dirNodeId = String(dirItem.id);
        console.log(`[Navigate] Encontrado: ${dirName} -> ${dirNodeId}`);
        
        // Expandir este nó
        setExpandedNodes(prev => ({ ...prev, [dirNodeId]: true }));
        
        // Carregar filhos deste diretório
        try {
          await loadDirectory(dirNodeId, currentPath, shareName);
        } catch (e) {
          console.error(`Erro ao carregar diretório ${currentPath}:`, e);
        }
        
        // Atualizar o parentNodeId para o próximo nível
        parentNodeId = dirNodeId;
        
        // Aguardar estado atualizar
        await new Promise(resolve => setTimeout(resolve, 300));
      } else {
        console.warn(`[Navigate] Diretório não encontrado: ${dirName} em ${parentNodeId}`);
        console.log(`[Navigate] Filhos disponíveis:`, currentChildren.map(c => c.name));
        
        // Tentar carregar o diretório pai novamente com forceRefresh
        try {
          const prevPath = currentPath.substring(0, currentPath.lastIndexOf('\\'));
          await loadDirectory(parentNodeId, prevPath, shareName, true);
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Tentar novamente encontrar o diretório
          const refreshedNodeChildren = await getNodeChildren();
          const refreshedChildren = refreshedNodeChildren[parentNodeId] || [];
          const refreshedDirItem = refreshedChildren.find(child => 
            child.name === dirName || child.fullPath === currentPath
          );
          
          if (refreshedDirItem) {
            const dirNodeId = String(refreshedDirItem.id);
            console.log(`[Navigate] Encontrado após refresh: ${dirName} -> ${dirNodeId}`);
            setExpandedNodes(prev => ({ ...prev, [dirNodeId]: true }));
            await loadDirectory(dirNodeId, currentPath, shareName);
            parentNodeId = dirNodeId;
            await new Promise(resolve => setTimeout(resolve, 300));
          } else {
            console.error(`[Navigate] Ainda não encontrado após refresh: ${dirName}`);
          }
        } catch (e) {
          console.error(`Falha ao recarregar diretório pai:`, e);
        }
      }
    }
    
    // Buscar o ID real do item nos filhos do último diretório
    const finalNodeChildren = await getNodeChildren();
    const parentChildren = finalNodeChildren[parentNodeId] || [];
    const fileName = result.name;
    const realItem = parentChildren.find(child => 
      child.name === fileName || child.fullPath === result.full_path
    );
    
    // 3. Selecionar o item (abre as abas de detalhes)
    const selectedItemData = {
      id: realItem?.id || result.id,
      name: result.name,
      fullPath: result.full_path,
      serverPath: result.full_path,
      shareName: shareName,
      itemType: result.item_type,
      type: result.item_type,
      size: realItem?.size || result.size,
      modified_at: realItem?.modified_at || result.modified_at,
      sha1_hash: realItem?.sha1_hash || result.sha1_hash,
      is_downloaded: realItem?.is_downloaded || result.is_downloaded
    };
    setSelectedItem(selectedItemData);
    
    // Carregar informações adicionais se for arquivo
    if (result.item_type === 'File') {
      // Carregar versões se já foi baixado
      if (result.is_downloaded) {
        loadFileVersions(result.full_path);
      }
    }
    
    // 4. Fazer scroll para o item na árvore após um delay maior
    setTimeout(() => {
      // Tentar encontrar o elemento na árvore pelo fullPath
      const escapedPath = CSS.escape(result.full_path);
      const itemElement = document.querySelector(`[data-item-path="${escapedPath}"]`);
      const shareElement = document.querySelector(`[data-node-id="${shareNodeId}"]`);
      const targetElement = itemElement || shareElement;
      
      console.log(`[Navigate] Scroll para elemento:`, targetElement ? 'encontrado' : 'não encontrado', result.full_path);
      
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Adicionar destaque temporário estilo highlight amarelo
        targetElement.style.backgroundColor = 'rgba(234, 179, 8, 0.3)';
        targetElement.style.boxShadow = '0 0 0 2px rgba(234, 179, 8, 0.5)';
        targetElement.style.borderRadius = '4px';
        targetElement.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
          targetElement.style.backgroundColor = '';
          targetElement.style.boxShadow = '';
          targetElement.style.borderRadius = '';
        }, 2500);
      }
    }, 800);
    } finally {
      // Esconder overlay de loading
      setNavigatingToResult(false);
    }
  };

  // Navegar para um arquivo pelo seu caminho no servidor (usado por leaks manuais)
  const navigateToFilePath = async (filePath) => {
    if (!filePath) return;
    
    setNavigatingToResult(true);
    
    try {
      // Parse do caminho: \\server\share\folder\file.txt
      const pathParts = filePath.replace(/\//g, '\\').split('\\').filter(p => p);
      
      if (pathParts.length < 2) {
        toast.error('Caminho de arquivo inválido');
        return;
      }
      
      // Extrair nome do share e nome do arquivo
      const shareName = pathParts[1];
      const fileName = pathParts[pathParts.length - 1];
      
      // Criar objeto similar ao resultado de busca
      const item = {
        name: fileName,
        full_path: filePath,
        share_name: shareName,
        item_type: 'File',
        itemType: 'File'
      };
      
      // Usar a função de navegação existente
      await navigateToSearchResult(item);
      
    } catch (error) {
      console.error('Error navigating to file path:', error);
      toast.error('Erro ao navegar até o arquivo');
    } finally {
      setNavigatingToResult(false);
    }
  };

  const loadShares = async () => {
    // Verificar se o servidor tem uma instância de plugin configurada
    if (!server?.plugin_instance_id) {
      toast.error('Instância de plugin não configurada', {
        duration: 6000,
        description: 'Configure uma instância de plugin nas configurações do servidor antes de navegar nos arquivos.'
      });
      setLoadingShares(false);
      return;
    }

    setLoadingShares(true);
    try {
      // Usar API V2 que retorna shares com filhos do banco
      const response = await axios.get(`${API_V2}/servers/${serverId}/shares-tree`);
      const { shares: loadedShares, items_by_path } = response.data;
      
      // Definir os shares com campos mapeados para o formato do frontend
      const mappedShares = loadedShares.map(share => {
        const mapped = {
          ...share,
          nodeId: `share-${share.share_name}`,
          type: 'Share',
          itemType: 'Share',
          name: share.share_name,
          fullPath: `\\\\${server?.ip}\\${share.share_name}`,
          shareName: share.share_name,
          hasChildren: share.has_children,
          childrenFetched: share.children_fetched || false,
          accessDenied: share.access_denied || false,
          errorMessage: share.error_message
        };
        console.log(`[loadShares] Share ${share.share_name}: access_denied=${share.access_denied}, children_fetched=${share.children_fetched}`);
        return mapped;
      });
      setShares(mappedShares);
      
      // Carregar filhos salvos no banco para cada share e subdiretório
      // Isso permite que diretórios previamente visitados apareçam em azul
      if (items_by_path && Object.keys(items_by_path).length > 0) {
        const newNodeChildren = {};
        
        // Criar um mapa de full_path -> item para busca rápida
        const allItemsMap = {};
        Object.values(items_by_path).flat().forEach(item => {
          allItemsMap[item.full_path] = item;
        });
        
        // Para cada share que tem filhos no banco
        loadedShares.forEach(share => {
          const shareNodeId = `share-${share.share_name}`;
          // Tentar encontrar o path do share no items_by_path
          const sharePath = `\\\\${server?.ip}\\${share.share_name}`;
          const shareItems = items_by_path[sharePath];
          
          if (shareItems && Array.isArray(shareItems)) {
            // Mapear itens para o formato usado no frontend
            newNodeChildren[shareNodeId] = shareItems.map(item => {
              const mapped = {
                ...item,
                id: item.id,
                type: item.type,
                itemType: item.type,
                name: item.name,
                fullPath: item.full_path,
                shareName: share.share_name,
                childrenFetched: item.children_fetched || false,
                hasChildren: item.has_children,
                accessDenied: item.access_denied || false
              };
              if (item.type === 'Directory') {
                console.log(`[loadShares] Item ${item.name}: access_denied=${item.access_denied}, children_fetched=${item.children_fetched}`);
              }
              return mapped;
            });
          }
        });
        
        // Processar todos os itens de subdiretórios (qualquer profundidade)
        // O items_by_path já vem organizado por parent_path do backend
        Object.entries(items_by_path).forEach(([parentPath, items]) => {
          if (!Array.isArray(items) || items.length === 0) return;
          
          // Encontrar o item pai que corresponde a este parentPath
          const parentItem = allItemsMap[parentPath];
          
          if (parentItem && parentItem.id) {
            const parentNodeId = String(parentItem.id);
            
            // Encontrar o shareName do pai
            // Extrair share_name do path (formato: \\ip\share\...)
            let shareName = '';
            const pathParts = parentPath.split('\\').filter(p => p);
            if (pathParts.length >= 2) {
              shareName = pathParts[1]; // Segundo elemento é o share_name
            }
            
            newNodeChildren[parentNodeId] = items.map(item => ({
              ...item,
              id: item.id,
              type: item.type,
              itemType: item.type,
              name: item.name,
              fullPath: item.full_path,
              shareName: shareName,
              childrenFetched: item.children_fetched || false,
              hasChildren: item.has_children,
              accessDenied: item.access_denied || false
            }));
          }
        });
        
        if (Object.keys(newNodeChildren).length > 0) {
          setNodeChildren(newNodeChildren);
        }
      }
      
    } catch (error) {
      console.error('Error loading shares:', error);
      
      // Verificar se é erro de credencial não configurada
      if (error.response?.status === 422 && error.response?.data?.detail?.error === 'credential_not_set') {
        const detail = error.response.data.detail;
        toast.error(detail.message || 'Credencial não configurada para este servidor', {
          duration: 6000,
          description: 'Configure uma credencial válida nas configurações do plugin do servidor.'
        });
        setLoadingShares(false);
        return;
      }
      
      // Verificar se é erro estruturado 500
      if (error.response?.status === 500 && error.response?.data?.detail) {
        const detail = error.response.data.detail;
        let errorMessage = detail.message || 'Erro ao carregar compartilhamentos';
        let description = '';
        
        switch (detail.error) {
          case 'credential_error':
            description = 'Verifique as credenciais configuradas no plugin.';
            break;
          case 'connection_error':
            description = 'Verifique se o servidor está acessível na rede.';
            break;
          case 'timeout_error':
            description = 'Servidor demorou muito para responder.';
            break;
          case 'config_error':
            description = 'Verifique as configurações do plugin (URL, credenciais, etc).';
            break;
          default:
            description = 'Verifique os logs para mais detalhes.';
        }
        
        toast.error(errorMessage, {
          duration: 6000,
          description
        });
        setLoadingShares(false);
        return;
      }
      
      // Fallback para API V2 com refresh
      try {
        const fallbackResponse = await axios.get(`${API_V2}/servers/${serverId}/shares?refresh=${ignoreCache}`);
        setShares(fallbackResponse.data);
      } catch (fallbackError) {
        // Verificar se fallback também é erro de credencial
        if (fallbackError.response?.status === 422 && fallbackError.response?.data?.detail?.error === 'credential_not_set') {
          const detail = fallbackError.response.data.detail;
          toast.error(detail.message || 'Credencial não configurada para este servidor', {
            duration: 6000,
            description: 'Configure uma credencial válida nas configurações do plugin do servidor.'
          });
        } else if (fallbackError.response?.status === 500 && fallbackError.response?.data?.detail) {
          const detail = fallbackError.response.data.detail;
          toast.error(detail.message || 'Erro ao carregar compartilhamentos', {
            duration: 6000,
            description: 'Verifique os logs do servidor para mais detalhes.'
          });
        } else {
          toast.error('Erro ao carregar compartilhamentos', {
            duration: 4000,
            description: fallbackError.message || 'Erro desconhecido'
          });
        }
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
      
      // Usar API V2 com refresh=true
      const response = await axios.get(`${API_V2}/servers/${serverId}/shares?refresh=true`);
      
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
    } catch (error) {
      console.error('Error refreshing shares:', error);
      
      // Verificar se é erro de credencial não configurada
      if (error.response?.status === 422 && error.response?.data?.detail?.error === 'credential_not_set') {
        const detail = error.response.data.detail;
        toast.error(detail.message || 'Credencial não configurada para este servidor', {
          duration: 6000,
          description: 'Configure uma credencial válida nas configurações do plugin do servidor.'
        });
      } else if (error.response?.status === 500 && error.response?.data?.detail) {
        // Tratamento para erros estruturados do plugin
        const detail = error.response.data.detail;
        let errorMessage = detail.message || 'Erro ao atualizar compartilhamentos';
        let description = '';
        
        switch (detail.error) {
          case 'credential_error':
            description = 'Verifique as credenciais configuradas no plugin.';
            break;
          case 'connection_error':
            description = 'Verifique se o servidor está acessível na rede.';
            break;
          case 'timeout_error':
            description = 'Servidor demorou muito para responder.';
            break;
          case 'config_error':
            description = 'Verifique as configurações do plugin (URL, credenciais, etc).';
            break;
          default:
            description = 'Verifique os logs para mais detalhes.';
        }
        
        toast.error(errorMessage, {
          duration: 6000,
          description
        });
      } else {
        toast.error('Erro ao atualizar compartilhamentos', {
          duration: 4000,
          description: error.message || 'Erro desconhecido'
        });
      }
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
          // Usar API V2 para buscar itens do cache
          const cachedResponse = await axios.get(
            `${API_V2}/servers/${serverId}/items`,
            { params: { parent_path: path } }
          );
          
          if (cachedResponse.data.items && cachedResponse.data.items.length > 0) {
            // Encontrou dados em cache no banco
            const items = cachedResponse.data.items.map((item, idx) => ({
              ...item,
              id: item.id || `${nodeId}-${idx}`,  // Preservar ID do banco se existir
              fullPath: item.fullPath || item.full_path || `${path}\\${item.name}`,  // Normalizar fullPath
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
      
      // Passo 2: Buscar via SOAP usando API V2
      const response = await axios.post(
        `${API_V2}/servers/${serverId}/browse`,
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
        id: item.id || `${nodeId}-${idx}`,  // Preservar ID do banco se existir
        fullPath: item.fullPath || item.full_path || `${path}\\${item.name}`,  // Normalizar fullPath
        parentPath: path,
        shareName: shareName,
        childrenFetched: !!(item.childrenFetched || item.children_fetched)  // Flag do banco para diretórios visitados
      }));

      setNodeChildren(prev => {
        // Preservar childrenFetched dos itens anteriores pelo fullPath.
        // Necessário quando o backend recria itens com novos IDs (ex: forceRefresh)
        // e a lógica de prev_fetched_paths não consegue restaurar corretamente.
        const oldItems = prev[nodeId] || [];
        const oldByPath = {};
        oldItems.forEach(old => {
          const fp = old.fullPath || old.full_path;
          if (fp) oldByPath[fp] = old;
        });

        const mergedItems = items.map(item => {
          const fp = item.fullPath || item.full_path;
          const old = fp ? oldByPath[fp] : null;
          if (old && (old.childrenFetched || old.children_fetched) && !item.childrenFetched) {
            return { ...item, childrenFetched: true, children_fetched: true };
          }
          return item;
        });

        const newState = { ...prev, [nodeId]: mergedItems };
        
        // Atualizar o próprio item no nodeChildren do pai para marcar como childrenFetched
        // Isso é necessário para que o ícone azul apareça
        Object.keys(prev).forEach(parentKey => {
          const parentChildren = prev[parentKey];
          if (Array.isArray(parentChildren)) {
            const childIndex = parentChildren.findIndex(c => String(c.id) === nodeId);
            if (childIndex !== -1) {
              const updatedChildren = [...parentChildren];
              updatedChildren[childIndex] = {
                ...updatedChildren[childIndex],
                childrenFetched: true,
                children_fetched: true
              };
              newState[parentKey] = updatedChildren;
            }
          }
        });
        
        return newState;
      });
      
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
      
      // Toast informativo quando diretório/share está vazio
      if (items.length === 0) {
        const label = (isSharePath || nodeId.startsWith('share-')) ? 'Compartilhamento' : 'Diretório';
        toast.info(`${label} vazio`, { duration: 3000 });
      }
    } catch (error) {
      console.error('Error loading directory:', error);
      
      // Verificar se é erro de credencial não configurada
      if (error.response?.status === 422 && error.response?.data?.detail?.error === 'credential_not_set') {
        const detail = error.response.data.detail;
        toast.error(detail.message || 'Credencial não configurada para este servidor', {
          duration: 6000,
          description: 'Configure uma credencial válida nas configurações do plugin do servidor.'
        });
      } else if (error.response?.status === 500 && error.response?.data?.detail) {
        // Tratamento para erros estruturados do plugin
        const detail = error.response.data.detail;
        let errorMessage = detail.message || 'Erro ao navegar diretório';
        let description = '';
        
        switch (detail.error) {
          case 'credential_error':
            description = 'Verifique as credenciais configuradas no plugin.';
            break;
          case 'connection_error':
            description = 'Verifique se o servidor está acessível na rede.';
            break;
          case 'timeout_error':
            description = 'Servidor demorou muito para responder.';
            break;
          case 'config_error':
            description = 'Verifique as configurações do plugin (URL, credenciais, etc).';
            break;
          case 'auth_error':
            description = 'Falha na autenticação. Verifique usuário e senha.';
            break;
          default:
            description = 'Verifique os logs para mais detalhes.';
        }
        
        toast.error(errorMessage, {
          duration: 6000,
          description
        });
      } else {
        toast.error('Erro ao carregar diretório', {
          duration: 4000,
          description: error.message || 'Erro desconhecido'
        });
      }
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

  const handleSelectItem = async (item, type, path, shareName = '') => {
    // Definir o item selecionado para mostrar no painel Info
    setSelectedItem({
      ...item,
      itemType: type,
      serverPath: path,
      shareName: shareName,
      fetchedAt: new Date().toISOString()
    });
    
    // Se for um arquivo, verificar se foi baixado (atualiza o estado para refletir downloads do batch)
    if (type === 'File') {
      const filePath = item.fullPath || item.full_path || path;
      // Verificar se o arquivo está na lista de baixados
      if (!downloadedFiles.includes(filePath)) {
        // Recarregar lista de arquivos baixados para pegar novos downloads do batch
        loadDownloadedFiles();
      }
    }
  };

  const handleDownload = async () => {
    if (!selectedItem || selectedItem.itemType !== 'File') return;
    
    const fileSize = parseInt(selectedItem.size) || 0;
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    const shareName = selectedItem.shareName;
    const ONE_MB = 1024 * 1024; // 1MB
    
    // Se arquivo > 1MB, adicionar na fila de downloads
    if (fileSize > ONE_MB) {
      try {
        // Usar API V2 para adicionar à fila
        const response = await axios.post(`${API_V2}/downloads`, {
          server_id: parseInt(serverId),
          share_name: shareName,
          file_path: filePath,
          file_name: selectedItem.name,
          file_size: fileSize,
          max_file_size_bytes: null, // Sem limite para download direto
          max_depth: null
        });
        
        if (response.data.success) {
          toast.success(`Download adicionado à fila (${(fileSize / ONE_MB).toFixed(2)} MB). Acompanhe em Arquivos > Downloads`);
        }
      } catch (error) {
        const errorMsg = error.response?.data?.detail || 'Erro ao adicionar à fila de downloads';
        toast.error(errorMsg);
      }
      return;
    }
    
    // Download direto para arquivos < 1MB
    setLoading(true);
    setSingleDownloadProgress(0);
    singleDownloadCancelledRef.current = false;
    
    try {
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
          
          // Usar API V2 para download em chunks
          const chunkResponse = await axios.post(
            `${API_V2}/servers/${serverId}/download-chunk`,
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
          
          if (chunkResponse.data.data) {
            allChunks.push(chunkResponse.data.data);
          }
          
          const chunkSize = chunkResponse.data.bytes_read || 0;
          totalBytesReceived += chunkSize;
          offset += chunkSize;
          
          // Calcular progresso - usar o maior valor entre fileSize informado e bytes recebidos
          const estimatedTotal = Math.max(fileSize, totalBytesReceived);
          const progress = chunkResponse.data.is_last 
            ? 100 
            : Math.min(99, Math.round((totalBytesReceived / estimatedTotal) * 100));
          setSingleDownloadProgress(progress);
          
          if (chunkResponse.data.is_last || chunkSize === 0) {
            break;
          }
        }
        
        // Verificar cancelamento antes de salvar
        if (singleDownloadCancelledRef.current) {
          toast.info('Download cancelado');
          return;
        }
        
        // Enviar para salvar no servidor usando API V2
        const combinedBase64 = allChunks.join('');
        response = await axios.post(
          `${API_V2}/servers/${serverId}/download`,
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
        // Download normal para arquivos pequenos usando API V2
        response = await axios.post(
          `${API_V2}/servers/${serverId}/download`,
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
      
      // Atualizar info do arquivo - IMPORTANTE: incluir o id para o loadFileContent funcionar
      setDownloadedFilesInfo(prev => ({
        ...prev,
        [filePath]: {
          ...prev[filePath],
          id: response.data.file_id,
          sha1_hash: sha1_hash,
          file_size: response.data.size,
          mimetype: response.data.mimetype,
          downloaded_at: new Date().toISOString()
        }
      }));
      
      // Limpar conteúdo atual para forçar reload do arquivo recém-baixado
      setFileContent(null);
      setRawFileContent(null);
      setFilePreviewUrl(null);
      setContentLoadError(null);
      
      // Recarregar versões
      loadFileVersions(filePath);
      loadServer();
      
      // O useEffect de carregamento automático vai cuidar de carregar o conteúdo
      // quando detectar que o arquivo foi adicionado a downloadedFiles
      // Não precisamos mais do setTimeout aqui para evitar race conditions
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
      // Buscar conteúdo do diretório usando API V2
      const response = await axios.post(
        `${API_V2}/servers/${serverId}/browse`,
        null,
        { params: { path, ignore_cache: false, share_name: shareName } }
      );
      
      if (response.data.accessDenied) return;
      
      const items = response.data.items || [];
      
      // Determinar o nodeId do diretório pai para atualizar a árvore
      let nodeId;
      if (path === `\\\\${server?.ip}\\${shareName}`) {
        // É o share raiz
        nodeId = `share-${shareName}`;
      } else {
        // É um subdiretório - buscar o ID do item pai no nodeChildren existente
        // Primeiro, encontrar o pai deste path
        const pathParts = path.split('\\').filter(p => p);
        const parentPath = pathParts.slice(0, -1).join('\\');
        const currentDirName = pathParts[pathParts.length - 1];
        
        // Buscar o ID do diretório atual nos nodeChildren do pai
        let foundId = null;
        
        // Iterar sobre todos os nodeChildren para encontrar o item com este fullPath
        for (const [parentNodeId, children] of Object.entries(nodeChildren)) {
          const matchingChild = children.find(c => 
            c.fullPath === path || 
            c.full_path === path ||
            (c.name === currentDirName && (c.fullPath?.includes(parentPath) || c.full_path?.includes(parentPath)))
          );
          if (matchingChild && matchingChild.id) {
            foundId = matchingChild.id;
            break;
          }
        }
        
        // Usar o ID encontrado ou fallback para o path sanitizado
        nodeId = foundId ? String(foundId) : path.replace(/[^a-zA-Z0-9]/g, '_');
      }
      
      // Atualizar nodeChildren preservando os dados existentes
      setNodeChildren(prev => {
        const existingChildren = prev[nodeId] || [];
        // Preservar o estado dos filhos (expandedNodes, etc) mesclando com novos dados
        const mergedItems = items.map(newItem => {
          const existing = existingChildren.find(e => e.id === newItem.id || e.fullPath === newItem.fullPath);
          return existing ? { ...existing, ...newItem } : newItem;
        });
        return { ...prev, [nodeId]: mergedItems };
      });
      
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
              
              // Usar API V2 para download em chunks
              const chunkResponse = await axios.post(
                `${API_V2}/servers/${serverId}/download-chunk`,
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
              
              if (chunkResponse.data.data) {
                allChunks.push(chunkResponse.data.data);
              }
              
              const chunkSize = chunkResponse.data.bytes_read || 0;
              totalBytesReceived += chunkSize;
              offset += chunkSize;
              
              // Calcular progresso - usar o maior valor entre fileSize informado e bytes recebidos
              const estimatedTotal = Math.max(fileSize, totalBytesReceived);
              const progress = chunkResponse.data.is_last 
                ? 100 
                : Math.min(99, Math.round((totalBytesReceived / estimatedTotal) * 100));
              
              // Atualizar progresso
              setBulkDownloadItems(prev => prev.map((it) => 
                it.fullPath === file.fullPath && it.status === 'downloading'
                  ? { ...it, progress } 
                  : it
              ));
              
              if (chunkResponse.data.is_last || chunkSize === 0) {
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
            
            // Combinar chunks e salvar usando API V2
            const combinedBase64 = allChunks.join('');
            await axios.post(
              `${API_V2}/servers/${serverId}/download`,
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
            // Download normal para arquivos pequenos usando API V2
            await axios.post(
              `${API_V2}/servers/${serverId}/download`,
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
          
          // Expandir o nó na árvore usando o ID correto do banco
          // O dir já tem o id do banco de dados
          const dirNodeId = dir.id ? String(dir.id) : dir.fullPath.replace(/[^a-zA-Z0-9]/g, '_');
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

  // Iniciar download em massa usando o scanner do backend (100% backend-driven)
  const startBulkDownloadQueue = async () => {
    if (!selectedItem) return;
    
    const isShare = selectedItem.itemType === 'share';
    const shareName = isShare ? selectedItem.share_name : selectedItem.shareName;
    const path = selectedItem.serverPath;
    const maxSizeBytes = bulkDownloadConfig.maxSize * 1024 * 1024;
    const maxDepth = bulkDownloadConfig.depth;
    
    setLoading(true);
    
    try {
      // Usar o endpoint de scan V2
      const response = await axios.post(`${API_V2}/downloads/scan`, null, {
        params: {
          server_id: parseInt(serverId),
          share_name: shareName,
          path: path,
          max_depth: maxDepth,
          max_file_size_mb: Math.round(maxSizeBytes / (1024 * 1024))
        }
      });
      
      toast.success(`${response.data.message}. Acompanhe em Arquivos > Downloads`);

    } catch (error) {
      console.error('Error starting bulk download:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao iniciar download em massa';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Iniciar busca crítica (foca em arquivos sensíveis, ignora logs)
  const startCriticalSearch = async () => {
    if (!selectedItem) return;
    
    const isShare = selectedItem.itemType === 'share';
    const shareName = isShare ? selectedItem.share_name : selectedItem.shareName;
    const path = selectedItem.serverPath;
    const maxSizeBytes = bulkDownloadConfig.maxSize * 1024 * 1024;
    const maxDepth = bulkDownloadConfig.depth;
    
    setLoading(true);
    
    try {
      // Usar o endpoint de scan V2 com critical_only=true
      const response = await axios.post(`${API_V2}/downloads/scan`, null, {
        params: {
          server_id: parseInt(serverId),
          share_name: shareName,
          path: path,
          max_depth: maxDepth,
          max_file_size_mb: Math.round(maxSizeBytes / (1024 * 1024)),
          critical_only: true
        }
      });
      
      toast.success(`${response.data.message}. Busca crítica iniciada - GitLeaks será executado automaticamente ao final.`);

    } catch (error) {
      console.error('Error starting critical search:', error);
      const errorMsg = error.response?.data?.detail || 'Erro ao iniciar busca crítica';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Iniciar download em massa (versão incremental - LEGADO)
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

  // Forçar download de item ignorado - usar API V2
  const forceDownloadItem = async (item, index) => {
    try {
      const response = await axios.post(`${API_V2}/downloads`, {
        server_id: parseInt(serverId),
        share_name: item.shareName || selectedItem?.shareName,
        file_path: item.path || item.fullPath,
        file_name: item.name,
        file_size: item.size,
        force: true,
        max_file_size_bytes: null // Sem limite para forçar
      });
      
      if (response.data.success) {
        toast.success(`Download forçado adicionado à fila: ${item.name}`);
        
        // Atualizar status do item na lista
        setBulkDownloadItems(prev => prev.map((it, idx) => 
          idx === index 
            ? { ...it, status: 'pending', forcedDownload: true } 
            : it
        ));
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || 'Erro ao forçar download';
      toast.error(errorMsg);
    }
  };

  const copyToClipboard = async (text, field) => {
    if (!text) {
      toast.error('Nenhum texto para copiar');
      return;
    }
    
    try {
      // Tentar API moderna primeiro
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback para contextos não-seguros (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast.success('Copiado!');
    } catch (error) {
      console.error('Erro ao copiar:', error);
      toast.error('Erro ao copiar para a área de transferência');
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

  // Verifica recursivamente se um item ou seus filhos têm arquivos baixados
  const hasDownloadedContent = (item, nodeId) => {
    const isShare = !!item.share_name;
    const itemType = (item.type || item.itemType || '').toLowerCase();
    const isFile = itemType === 'file';
    const isDirectory = isShare || itemType === 'directory' || itemType === 'dir' || itemType === 'folder';
    
    // Se é arquivo, verificar se está baixado
    if (isFile) {
      return downloadedFiles.includes(item.fullPath || item.full_path);
    }
    
    // Se é diretório/share, verificar filhos
    if (isDirectory || isShare) {
      const children = nodeChildren[nodeId] || [];
      for (const child of children) {
        const childNodeId = child.id || `item-${(child.fullPath || child.full_path || child.name || '').replace(/[^a-zA-Z0-9]/g, '_')}`;
        if (hasDownloadedContent(child, String(childNodeId))) {
          return true;
        }
      }
      
      // Também verificar se há algum arquivo baixado neste caminho
      const itemPath = isShare 
        ? `\\\\${server.ip}\\${item.share_name}`
        : (item.fullPath || item.full_path || '');
      
      // Verificar se algum arquivo baixado começa com este caminho
      for (const downloadedPath of downloadedFiles) {
        if (downloadedPath && downloadedPath.startsWith(itemPath + '\\')) {
          return true;
        }
      }
    }
    
    return false;
  };

  // Verifica se um item está nos resultados da busca ou se contém itens dos resultados
  const isInSearchResults = (item, nodeId) => {
    if (!searchResults || !showOnlySearchResults) return true;
    
    const itemPath = item.fullPath || item.full_path || '';
    const allSearchPaths = [
      ...(searchResults.directories || []).map(d => d.full_path),
      ...(searchResults.files || []).map(f => f.full_path),
      ...(searchResults.downloaded || []).map(d => d.full_path || d.file_path)
    ].filter(Boolean);
    
    // Verificar se o item está diretamente nos resultados
    if (allSearchPaths.includes(itemPath)) {
      return true;
    }
    
    // Verificar se o item é pai de algum resultado (para mostrar o caminho)
    for (const searchPath of allSearchPaths) {
      if (searchPath && searchPath.startsWith(itemPath + '\\')) {
        return true;
      }
    }
    
    // Para shares, verificar se algum resultado está neste share
    if (item.share_name) {
      const sharePath = `\\\\${server?.ip}\\${item.share_name}`;
      for (const searchPath of allSearchPaths) {
        if (searchPath && searchPath.startsWith(sharePath)) {
          return true;
        }
      }
    }
    
    return false;
  };

  // Renderiza um nó da árvore com linhas de hierarquia
  const renderTreeNode = (item, depth = 0, shareName = '', isLastChild = true, parentLines = [], focusedNodeId = null) => {
    // Proteção contra recursão infinita - limite de profundidade
    if (depth > 50) {
      console.warn('renderTreeNode: Max depth exceeded, stopping recursion');
      return null;
    }
    
    const isShare = !!item.share_name;
    // Calcular nodeId de forma robusta:
    // - Para shares: usar share-{nome}
    // - Para outros: usar ID do banco, ou gerar hash do fullPath se não existir
    const rawNodeId = isShare 
      ? `share-${item.share_name}` 
      : (item.id || `item-${(item.fullPath || item.full_path || item.name || '').replace(/[^a-zA-Z0-9]/g, '_')}`);
    const nodeId = String(rawNodeId);
    
    // Aplicar filtro "Ver apenas baixados"
    if (showOnlyDownloaded && !hasDownloadedContent(item, nodeId)) {
      return null;
    }
    
    // Aplicar filtro "Ver apenas resultados da busca"
    if (showOnlySearchResults && !isInSearchResults(item, nodeId)) {
      return null;
    }
    
    const safeTestId = nodeId.replace(/\$/g, '_dollar_');
    const isExpanded = expandedNodes[nodeId];
    const isLoading = loadingNodes[nodeId];
    const children = nodeChildren[nodeId] || [];
    const hasLoadedChildren = nodeChildren[nodeId] !== undefined;
    // Verificar se é diretório - considerar vários formatos possíveis
    const itemType = (item.type || item.itemType || '').toLowerCase();
    const isDirectory = isShare || itemType === 'directory' || itemType === 'dir' || itemType === 'folder';
    const isFile = itemType === 'file';
    const isAccessDenied = item.access_denied === true || item.accessDenied === true;
    const isDownloaded = isFile && isFileDownloaded(item.fullPath);
    const isSelected = selectedItem?.id === nodeId || 
                       (isShare && selectedItem?.share_name === item.share_name && selectedItem?.itemType === 'share');
    
    // Se há um foco e este nó é o focado, mostrar apenas ele
    const isFocusedNode = focusedNodeId && nodeId === focusedNodeId;
    
    // Calcular o path correto para este item
    // Para shares: construir a partir do IP e nome do share
    // Para outros: usar fullPath ou full_path ou construir a partir do parentPath
    const path = isShare 
      ? buildPath(server.ip, item.share_name)
      : (item.fullPath || item.full_path || (item.parentPath ? `${item.parentPath}\\${item.name}` : item.name));
    
    // Log para debug de paths incorretos (comentar em produção)
    // if (!isShare && !item.fullPath && !item.full_path) {
    //   console.warn('[renderTreeNode] Item sem fullPath:', item.name, 'parentPath:', item.parentPath);
    // }
    
    const currentShareName = isShare ? item.share_name : shareName;
    
    // Para shares e diretórios: usar flag do banco (children_fetched ou childrenFetched)
    // Fallback para hasLoadedChildren em ambos os casos - necessário quando loadShares
    // pré-popula nodeChildren a partir do items_by_path mas o flag do banco ainda é false
    const childrenFetched = item.children_fetched === true || item.childrenFetched === true || hasLoadedChildren;
    
    // Determina se o item ainda não teve seus filhos carregados
    // Um diretório é considerado "não carregado" se nunca fizemos fetch dos filhos
    const isNotFetched = isDirectory && !childrenFetched;
    
    // Cor do ícone baseada no status de acesso, download e fetch
    // Visitados (fetched) = azul, Não visitados = cinza
    const getIconColor = () => {
      if (isAccessDenied) return 'text-red-500';
      if (isNotFetched) return 'text-gray-500';
      return 'text-blue-500';
    };
    
    const getFileIconColor = () => {
      if (isAccessDenied) return 'text-red-500';
      if (isDownloaded) return 'text-green-500';
      return 'text-gray-500';
    };
    
    const iconColor = getIconColor();
    const fileIconColor = getFileIconColor();
    
    // Cor do texto baseada no status de fetch/download
    // Diretórios: visitados = azul, não visitados = cinza
    // Arquivos: baixados = normal, não baixados = cinza
    const getTextColor = () => {
      if (isAccessDenied) return 'text-red-500';
      if (isDirectory) {
        return isNotFetched ? 'text-gray-500' : 'text-blue-400';
      }
      // Arquivos
      if (isDownloaded) return ''; // cor padrão
      return 'text-gray-500';
    };
    const textColor = getTextColor();
    
    // Handler para clique no item - seleciona e expande se for diretório
    const handleNodeClick = async () => {
      // Proteção contra cliques duplos/rápidos
      if (processingClickRef.current) {
        console.log('[handleNodeClick] Ignoring - already processing');
        return;
      }
      
      processingClickRef.current = true;
      
      try {
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
      } finally {
        // Liberar após um pequeno delay para evitar cliques muito rápidos
        setTimeout(() => {
          processingClickRef.current = false;
        }, 100);
      }
    };
    
    return (
      <div key={`${nodeId}-${isAccessDenied ? 'denied' : 'ok'}`}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={`group flex items-center cursor-pointer hover:bg-muted/50 rounded transition-colors ${
                isSelected ? 'bg-primary/10 text-primary' : ''
              } ${isAccessDenied ? 'opacity-75' : ''}`}
              style={{ paddingLeft: '8px', paddingRight: '8px', minHeight: '32px' }}
              onClick={handleNodeClick}
              data-testid={`tree-node-${safeTestId}`}
              data-item-path={path}
              data-node-id={nodeId}
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
                        width: isDirectory ? '50%' : 'calc(50% + 20px)', // Estende para arquivos para compensar espaço do botão
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

              {/* Force Refresh Button - for directories and shares (only when previously fetched, only on hover) */}
              {isDirectory && childrenFetched && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    // Forçar refresh ignorando cache
                    setExpandedNodes(prev => ({ ...prev, [nodeId]: true }));
                    await loadDirectory(nodeId, path, currentShareName, true); // true = forceRefresh
                    toast.success(`Diretório atualizado: ${isShare ? item.share_name : item.name}`);
                  }}
                  className="p-1 hover:bg-muted rounded flex-shrink-0 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Forçar atualização (ignorar cache)"
                  data-testid={`force-refresh-${safeTestId}`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {/* Abrir em nova aba */}
            <ContextMenuItem onClick={() => {
              window.open(`${window.location.origin}/servers/${serverId}/browse?path=${encodeURIComponent(path)}&from=${encodeURIComponent(window.location.pathname)}`, '_blank');
            }}>
              Abrir em nova aba
            </ContextMenuItem>
            <ContextMenuSeparator />
            {/* Busca crítica */}
            <ContextMenuItem onClick={startCriticalSearch}>
              Busca Crítica
            </ContextMenuItem>
            {/* Recarregar - para diretórios/shares */}
            {isDirectory && (
              <ContextMenuItem onClick={async () => {
                setExpandedNodes(prev => ({ ...prev, [nodeId]: true }));
                await loadDirectory(nodeId, path, currentShareName, true);
                toast.success(`Recarregado: ${isShare ? item.share_name : item.name}`);
              }}>
                Recarregar
              </ContextMenuItem>
            )}
            {/* Enviar para fila - arquivos e diretórios */}
            <ContextMenuItem onClick={async () => {
              if (isFile) {
                // Arquivo: adicionar na fila de downloads
                const fileSize = parseInt(item.size) || 0;
                const filePath = item.fullPath || item.full_path || path;
                try {
                  const response = await axios.post(`${API_V2}/downloads`, {
                    server_id: parseInt(serverId),
                    share_name: currentShareName,
                    file_path: filePath,
                    file_name: item.name,
                    file_size: fileSize,
                    max_file_size_bytes: null,
                    max_depth: null
                  });
                  if (response.data.success) {
                    toast.success(`Adicionado à fila: ${item.name}`);
                  }
                } catch (error) {
                  const errorMsg = error.response?.data?.detail || 'Erro ao enviar para fila';
                  toast.error(errorMsg);
                }
              } else {
                // Diretório/Share: scan + download via backend
                const shareName = isShare ? item.share_name : currentShareName;
                const scanPath = item.fullPath || item.full_path || path;
                try {
                  const response = await axios.post(`${API_V2}/downloads/scan`, null, {
                    params: {
                      server_id: parseInt(serverId),
                      share_name: shareName,
                      path: scanPath,
                      max_depth: bulkDownloadConfig.depth,
                      max_file_size_mb: bulkDownloadConfig.maxSize
                    }
                  });
                  toast.success(`${response.data.message}. Acompanhe em Arquivos > Downloads`);
                } catch (error) {
                  const errorMsg = error.response?.data?.detail || 'Erro ao enviar para fila';
                  toast.error(errorMsg);
                }
              }
            }}>
              Enviar para fila
            </ContextMenuItem>
            {/* Sync - apenas arquivos */}
            {isFile && (
              <ContextMenuItem onClick={async () => {
                // Selecionar o item primeiro para que handleDownload funcione
                handleSelectItem(item, item.type, path, currentShareName);
                // Chamar download diretamente com os dados do nó
                const fileSize = parseInt(item.size) || 0;
                const filePath = item.fullPath || item.full_path || path;
                const ONE_MB = 1024 * 1024;
                if (fileSize > ONE_MB) {
                  try {
                    const response = await axios.post(`${API_V2}/downloads`, {
                      server_id: parseInt(serverId),
                      share_name: currentShareName,
                      file_path: filePath,
                      file_name: item.name,
                      file_size: fileSize,
                      max_file_size_bytes: null,
                      max_depth: null
                    });
                    if (response.data.success) {
                      toast.success(`Sync adicionado à fila (${(fileSize / ONE_MB).toFixed(2)} MB)`);
                    }
                  } catch (error) {
                    const errorMsg = error.response?.data?.detail || 'Erro ao adicionar sync à fila';
                    toast.error(errorMsg);
                  }
                } else {
                  // Para arquivos pequenos, selecionar e chamar handleDownload
                  // handleDownload usa selectedItem, que acabou de ser setado
                  setTimeout(() => handleDownload(), 100);
                }
              }}>
                Sync
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
        
        {/* Children */}
        {isExpanded && children.length > 0 && (
          <div>
            {(() => {
              // Se este nó é o focado ou estamos dentro do item focado, mostrar todos os filhos
              if (isFocusedNode || !focusedNodeId) {
                return children
                  .filter(child => {
                    // Evitar loop infinito: não renderizar filho cujo fullPath é igual ao path do pai
                    const childPath = child.fullPath || child.full_path;
                    if (childPath && childPath === path) {
                      console.warn('[renderTreeNode] Skipping child with same path as parent:', childPath);
                      return false;
                    }
                    return true;
                  })
                  .sort((a, b) => {
                    // Diretórios primeiro, depois ordem alfabética case insensitive
                    const aType = (a.type || a.itemType || '').toLowerCase();
                    const bType = (b.type || b.itemType || '').toLowerCase();
                    const aIsDir = aType === 'directory' || aType === 'dir' || aType === 'folder';
                    const bIsDir = bType === 'directory' || bType === 'dir' || bType === 'folder';
                    if (aIsDir && !bIsDir) return -1;
                    if (!aIsDir && bIsDir) return 1;
                    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
                  })
                  .map((child, index, arr) => {
                    const isLast = index === arr.length - 1;
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
                // Usar Set para evitar visitar o mesmo nó duas vezes (proteção contra loop)
                const hasFocusedDescendant = (nodes, targetId, visited = new Set(), maxDepth = 30) => {
                  if (maxDepth <= 0) return false; // Proteção contra recursão infinita
                  for (const node of nodes) {
                    const nId = String(node.id || `share-${node.share_name}`);
                    if (visited.has(nId)) continue; // Já visitado, pular
                    visited.add(nId);
                    if (nId === targetId) return true;
                    const nc = nodeChildren[nId] || [];
                    if (nc.length > 0 && hasFocusedDescendant(nc, targetId, visited, maxDepth - 1)) return true;
                  }
                  return false;
                };
                const childChildren = nodeChildren[childNodeId] || [];
                return hasFocusedDescendant(childChildren, focusedNodeId);
              });
              
              return filteredChildren
                .filter(child => {
                  // Evitar loop infinito: não renderizar filho cujo fullPath é igual ao path do pai
                  const childPath = child.fullPath || child.full_path;
                  if (childPath && childPath === path) {
                    console.warn('[renderTreeNode] Skipping child with same path as parent:', childPath);
                    return false;
                  }
                  return true;
                })
                .sort((a, b) => {
                  // Diretórios primeiro, depois ordem alfabética (estilo Windows Explorer)
                  const aType = (a.type || a.itemType || '').toLowerCase();
                  const bType = (b.type || b.itemType || '').toLowerCase();
                  const aIsDir = aType === 'directory' || aType === 'dir' || aType === 'folder';
                  const bIsDir = bType === 'directory' || bType === 'dir' || bType === 'folder';
                  if (aIsDir && !bIsDir) return -1;
                  if (!aIsDir && bIsDir) return 1;
                  return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
                })
                .map((child, index, arr) => {
                  const isLast = index === arr.length - 1;
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
    const filePath = selectedItem.fullPath || selectedItem.serverPath;
    const downloaded = isFile && isFileDownloaded(filePath);
    const fileInfo = downloadedFilesInfo[filePath];
    const fileMimeType = fileInfo?.mimetype || fileInfo?.mime_type || null;
    const canViewContent = isFile && downloaded && canPreviewFile(selectedItem.name, fileMimeType);
    
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
                        await axios.post(`${API_V2}/servers/${serverId}/files/${versionId}/set-current`);
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
              {/* Botão Identificar Credencial - ao lado do Abrir */}
              {downloaded && (
                <Button 
                  size="sm" 
                  variant="outline"
                  className="h-7 text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10"
                  onClick={() => setShowLeakModal(true)}
                  title="Identificar credencial manualmente"
                  data-testid="identify-credential-button"
                >
                  <ShieldKeyIcon className="w-4 h-4 mr-1" />
                  Identificar
                </Button>
              )}
              
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
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].map((n) => (
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
                    {[1, 5, 10, 25, 50, 100, 200, 500, 1000].map((n) => (
                      <SelectItem key={n} value={n.toString()}>{n} MB</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Botão de download */}
              {!bulkDownloadActive ? (
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    className="h-7"
                    onClick={startBulkDownloadQueue}
                    data-testid="bulk-download-queue-button"
                    title="Enviar para fila de downloads (recomendado)"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Enviar para Fila
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-7 border-red-500/50 text-red-500 hover:bg-red-500/10"
                    onClick={startCriticalSearch}
                    data-testid="critical-search-button"
                    title="Buscar arquivos sensíveis (ignora logs, foca em arquivos críticos)"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Busca Crítica
                  </Button>
                </div>
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
                    
                    await axios.post(`${API_V2}/servers/${serverId}/clear-access-denied`, null, { params });
                    
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
                      const shareNameForId = selectedItem.share_name || selectedItem.shareName || selectedItem.name;
                      const nodeIdByName = `share-${shareNameForId}`;
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
              
              {/* OCR Tab - apenas para arquivos baixados */}
              {isFile && downloaded && !isAccessDenied && (
                <button
                  onClick={() => setActiveTab('ocr')}
                  className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${
                    activeTab === 'ocr' 
                      ? 'text-green-500' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ScanText className="w-3.5 h-3.5" />
                  OCR
                  {ocrData?.ocr_processed && (
                    <CheckCircle className="w-3 h-3 text-green-500" />
                  )}
                  {activeTab === 'ocr' && (
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
                  {(isDirectory || isFile) && selectedItem.modified_at && (
                    <InfoRow 
                      label="Última Modificação" 
                      value={formatDate(selectedItem.modified_at)}
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
                  
                  {/* OCR Status - apenas para arquivos sincronizados */}
                  {isFile && downloaded && (
                    <InfoRow 
                      label="OCR" 
                      value={
                        ocrData?.ocr_processed ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            <span className="text-green-500">Processado</span>
                            {ocrData?.ocr_content && (
                              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                {ocrData.ocr_content.length.toLocaleString()} chars
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <XCircle className="w-4 h-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Não processado</span>
                          </div>
                        )
                      } 
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
                    
                    {/* PDF Preview usando react-pdf */}
                    {isPdfFile(selectedItem?.name) && (
                      <div className="bg-muted/30 rounded-lg overflow-hidden">
                        {/* Controles do PDF */}
                        <div className="flex items-center justify-between p-2 bg-muted/50 border-b border-border">
                          <div className="flex items-center gap-2">
                            <Button 
                              variant="outline" 
                              size="icon" 
                              className="h-8 w-8"
                              onClick={() => setPdfPageNumber(prev => Math.max(1, prev - 1))}
                              disabled={pdfPageNumber <= 1}
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-sm">
                              Página {pdfPageNumber} de {pdfNumPages || '?'}
                            </span>
                            <Button 
                              variant="outline" 
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setPdfPageNumber(prev => Math.min(pdfNumPages || 1, prev + 1))}
                              disabled={pdfPageNumber >= (pdfNumPages || 1)}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setPdfScale(prev => Math.max(0.5, prev - 0.25))}
                              disabled={pdfScale <= 0.5}
                            >
                              -
                            </Button>
                            <span className="text-sm w-16 text-center">{Math.round(pdfScale * 100)}%</span>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setPdfScale(prev => Math.min(2, prev + 0.25))}
                              disabled={pdfScale >= 2}
                            >
                              +
                            </Button>
                          </div>
                        </div>
                        {/* Visualizador do PDF */}
                        <div className="flex justify-center p-4 max-h-[500px] overflow-auto bg-gray-800">
                          <Document
                            file={filePreviewUrl}
                            onLoadSuccess={({ numPages }) => {
                              setPdfNumPages(numPages);
                              setPdfPageNumber(1);
                            }}
                            onLoadError={(error) => {
                              console.error('Error loading PDF:', error);
                              toast.error('Erro ao carregar PDF');
                            }}
                            loading={
                              <div className="flex items-center justify-center p-8">
                                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                              </div>
                            }
                          >
                            <Page 
                              pageNumber={pdfPageNumber} 
                              scale={pdfScale}
                              renderTextLayer={true}
                              renderAnnotationLayer={true}
                            />
                          </Document>
                        </div>
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
                          <span className="font-medium">{fileContent.message || fileContent.error}</span>
                        </div>
                        {fileContent.requires_password && (
                          <>
                            <p className="text-sm text-muted-foreground">
                              Digite a senha para desbloquear o certificado
                              {fileContent.passwords_tried?.length > 0 && (
                                <span className="ml-2 text-xs">
                                  ({fileContent.passwords_tried.length} tentativa(s) falhada(s))
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
                        
                        {/* Debug Log */}
                        {fileContent.debug_log && fileContent.debug_log.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-yellow-500/20">
                            <details className="group">
                              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2">
                                <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                                Debug: {fileContent.debug_log.length} passos
                              </summary>
                              <div className="mt-3 space-y-1 pl-6">
                                {fileContent.debug_log.map((entry, idx) => (
                                  <div 
                                    key={idx} 
                                    className={`text-xs font-mono flex items-start gap-2 py-1 ${
                                      entry.status === 'success' ? 'text-green-500' :
                                      entry.status === 'error' ? 'text-red-400' :
                                      entry.status === 'warning' ? 'text-yellow-500' :
                                      'text-muted-foreground'
                                    }`}
                                  >
                                    <span className="w-4 flex-shrink-0">
                                      {entry.status === 'success' ? '✓' :
                                       entry.status === 'error' ? '✗' :
                                       entry.status === 'warning' ? '⚠' : '•'}
                                    </span>
                                    <span className="flex-1">
                                      {entry.step}
                                      {entry.details && (
                                        <span className="ml-2 text-muted-foreground">
                                          → {entry.details}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                            
                            {/* Exception Details */}
                            {fileContent.last_exception && (
                              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs">
                                <div className="font-medium text-red-400 mb-1">
                                  Exception: {fileContent.exception_type || 'Unknown'}
                                </div>
                                <pre className="text-red-300/80 whitespace-pre-wrap break-all font-mono">
                                  {fileContent.last_exception}
                                </pre>
                              </div>
                            )}
                          </div>
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
                                    {cert.not_before ? new Date(cert.not_before).toLocaleString('pt-BR') : 'N/A'}
                                  </div>
                                </div>
                                <div>
                                  <h4 className="font-medium text-muted-foreground mb-2">Válido até</h4>
                                  <div className={`p-3 rounded font-mono text-xs ${cert.is_expired ? 'bg-red-500/10 text-red-400' : 'bg-muted/30'}`}>
                                    {cert.not_after ? new Date(cert.not_after).toLocaleString('pt-BR') : 'N/A'}
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
                        
                        {/* Debug Log - também exibido em caso de sucesso */}
                        {fileContent.debug_log && fileContent.debug_log.length > 0 && (
                          <div className="mt-6 pt-4 border-t border-border">
                            <details className="group">
                              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2">
                                <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                                Debug: {fileContent.debug_log.length} passos
                              </summary>
                              <div className="mt-3 space-y-1 pl-6">
                                {fileContent.debug_log.map((entry, idx) => (
                                  <div 
                                    key={idx} 
                                    className={`text-xs font-mono flex items-start gap-2 py-1 ${
                                      entry.status === 'success' ? 'text-green-500' :
                                      entry.status === 'error' ? 'text-red-400' :
                                      entry.status === 'warning' ? 'text-yellow-500' :
                                      'text-muted-foreground'
                                    }`}
                                  >
                                    <span className="w-4 flex-shrink-0">
                                      {entry.status === 'success' ? '✓' :
                                       entry.status === 'error' ? '✗' :
                                       entry.status === 'warning' ? '⚠' : '•'}
                                    </span>
                                    <span className="flex-1">
                                      {entry.step}
                                      {entry.details && (
                                        <span className="ml-2 text-muted-foreground">
                                          → {entry.details}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}
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
                      
                      {/* Botão Base64 Decode */}
                      {base64Decoded ? (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={restoreOriginalContent}
                          title="Restaurar conteúdo original"
                        >
                          <Binary className="w-4 h-4 mr-2" />
                          Original
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={decodeBase64Content}
                          title="Decodificar Base64"
                        >
                          <Binary className="w-4 h-4 mr-2" />
                          Base64
                        </Button>
                      )}
                    </div>
                
                    {/* Content with line numbers */}
                    {beautified ? (
                      <div className="bg-zinc-900 rounded-lg overflow-x-auto">
                        <div className="flex min-w-max">
                          {/* Line numbers */}
                          <div className="flex-shrink-0 bg-zinc-800 text-zinc-500 text-xs font-mono py-4 px-2 select-none border-r border-zinc-700 text-right sticky left-0">
                            {(() => {
                              const content = typeof fileContent === 'object' ? fileContent.content : fileContent;
                              // Remover tags HTML para contar linhas corretamente
                              const textContent = content?.replace(/<[^>]*>/g, '') || '';
                              const lines = textContent.split('\n');
                              return lines.map((_, idx) => (
                                <div key={idx} className="leading-5 h-5">{idx + 1}</div>
                              ));
                            })()}
                          </div>
                          {/* Content */}
                          <pre 
                            className="flex-1 p-4 text-sm font-mono whitespace-pre overflow-visible"
                            dangerouslySetInnerHTML={{ __html: (() => {
                              const content = typeof fileContent === 'object' ? fileContent.content : fileContent;
                              // Renderizar cada linha em uma div com altura fixa
                              const lines = (content || '').split('\n');
                              return lines.map((line, idx) => `<div class="leading-5 h-5">${line || ' '}</div>`).join('');
                            })() }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="bg-muted/50 rounded-lg overflow-x-auto">
                        <div className="flex min-w-max">
                          {/* Line numbers */}
                          <div className="flex-shrink-0 bg-muted text-muted-foreground/50 text-xs font-mono py-4 px-2 select-none border-r border-border text-right sticky left-0">
                            {(() => {
                              const content = typeof fileContent === 'object' ? fileContent.content : fileContent;
                              const lines = (content || '').split('\n');
                              return lines.map((_, idx) => (
                                <div key={idx} className="leading-5 h-5">{idx + 1}</div>
                              ));
                            })()}
                          </div>
                          {/* Content */}
                          <pre className="flex-1 p-4 text-sm font-mono whitespace-pre overflow-visible">
                            {(() => {
                              const content = typeof fileContent === 'object' ? fileContent.content : fileContent;
                              const lines = (content || '').split('\n');
                              return lines.map((line, idx) => (
                                <div key={idx} className="leading-5 h-5">{line || ' '}</div>
                              ));
                            })()}
                          </pre>
                        </div>
                      </div>
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
                // Para shares, usar share-{nome} (consistente com renderTreeNode e loadShares)
                // Para diretórios, usar o id do banco
                const shareNameForId = selectedItem.share_name || selectedItem.shareName || selectedItem.name;
                const nodeId = isShare
                  ? `share-${shareNameForId}`
                  : String(selectedItem.id || `share-${shareNameForId}`);
                const children = nodeChildren[nodeId] || [];
                const isLoading = loadingNodes[nodeId];
                
                // Função de ordenação - Diretórios sempre primeiro (estilo Windows Explorer)
                const sortItems = (items) => {
                  if (!items || items.length === 0) return [];
                  
                  return [...items].sort((a, b) => {
                    // Primeiro critério: Diretórios sempre vêm antes de arquivos
                    const aIsDir = a.type === 'Directory';
                    const bIsDir = b.type === 'Directory';
                    
                    if (aIsDir && !bIsDir) return -1;
                    if (!aIsDir && bIsDir) return 1;
                    
                    // Segundo critério: Ordenação pela coluna selecionada
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
                      case 'modified_at':
                        aVal = a.modified_at || '';
                        bVal = b.modified_at || '';
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

                // Pre-compute rows to avoid visual editor injecting <span> inside <tbody>
                const tableRows = sortedChildren.map((item, idx) => {
                  const isDir = item.type === 'Directory';
                  const isFile = item.type === 'File';
                  const isItemDownloaded = !isDir && isFileDownloaded(item.fullPath);
                  const itemPath = item.fullPath || item.full_path;
                  const shareName = selectedItem.share_name || selectedItem.shareName || selectedItem.name;
                  return (
                    <ContextMenu key={item.id || idx}>
                      <ContextMenuTrigger asChild>
                        <tr
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
                            {item.modified_at ? formatDate(item.modified_at) : '—'}
                          </td>
                        </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        {/* Abrir em nova aba */}
                        <ContextMenuItem onClick={() => {
                          window.open(`${window.location.origin}/servers/${serverId}/browse?path=${encodeURIComponent(itemPath)}&from=${encodeURIComponent(window.location.pathname)}`, '_blank');
                        }}>
                          Abrir em nova aba
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        {/* Busca Crítica */}
                        <ContextMenuItem onClick={() => {
                          handleSelectItem(item, item.type, itemPath, shareName);
                          setTimeout(() => startCriticalSearch(), 100);
                        }}>
                          Busca Crítica
                        </ContextMenuItem>
                        {/* Recarregar - para diretórios */}
                        {isDir && (
                          <ContextMenuItem onClick={async () => {
                            const dirNodeId = String(item.id || itemPath);
                            setExpandedNodes(prev => ({ ...prev, [dirNodeId]: true }));
                            await loadDirectory(dirNodeId, itemPath, shareName, true);
                            toast.success(`Recarregado: ${item.name}`);
                          }}>
                            Recarregar
                          </ContextMenuItem>
                        )}
                        {/* Enviar para fila */}
                        <ContextMenuItem onClick={async () => {
                          if (isFile) {
                            const fileSize = parseInt(item.size) || 0;
                            try {
                              const response = await axios.post(`${API_V2}/downloads`, {
                                server_id: parseInt(serverId),
                                share_name: shareName,
                                file_path: itemPath,
                                file_name: item.name,
                                file_size: fileSize,
                                max_file_size_bytes: null,
                                max_depth: null
                              });
                              if (response.data.success) {
                                toast.success(`Adicionado à fila: ${item.name}`);
                              }
                            } catch (error) {
                              const errorMsg = error.response?.data?.detail || 'Erro ao enviar para fila';
                              toast.error(errorMsg);
                            }
                          } else {
                            try {
                              const response = await axios.post(`${API_V2}/downloads/scan`, null, {
                                params: {
                                  server_id: parseInt(serverId),
                                  share_name: shareName,
                                  path: itemPath,
                                  max_depth: bulkDownloadConfig.depth,
                                  max_file_size_mb: bulkDownloadConfig.maxSize
                                }
                              });
                              toast.success(`${response.data.message}. Acompanhe em Arquivos > Downloads`);
                            } catch (error) {
                              const errorMsg = error.response?.data?.detail || 'Erro ao enviar para fila';
                              toast.error(errorMsg);
                            }
                          }
                        }}>
                          Enviar para fila
                        </ContextMenuItem>
                        {/* Sync - apenas arquivos */}
                        {isFile && (
                          <ContextMenuItem onClick={async () => {
                            handleSelectItem(item, item.type, itemPath, shareName);
                            const fileSize = parseInt(item.size) || 0;
                            const ONE_MB = 1024 * 1024;
                            if (fileSize > ONE_MB) {
                              try {
                                const response = await axios.post(`${API_V2}/downloads`, {
                                  server_id: parseInt(serverId),
                                  share_name: shareName,
                                  file_path: itemPath,
                                  file_name: item.name,
                                  file_size: fileSize,
                                  max_file_size_bytes: null,
                                  max_depth: null
                                });
                                if (response.data.success) {
                                  toast.success(`Sync adicionado à fila (${(fileSize / ONE_MB).toFixed(2)} MB)`);
                                }
                              } catch (error) {
                                const errorMsg = error.response?.data?.detail || 'Erro ao adicionar sync à fila';
                                toast.error(errorMsg);
                              }
                            } else {
                              setTimeout(() => handleDownload(), 100);
                            }
                          }}>
                            Sync
                          </ContextMenuItem>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                });

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
                            onClick={() => handleSort('modified_at')}
                          >
                            <div className="flex items-center gap-1">
                              Modificado
                              <SortIcon columnKey="modified_at" />
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>{tableRows}</tbody>
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
                          {item.status === 'skipped' && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => forceDownloadItem(item, idx)}
                              title="Forçar download deste arquivo"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              Forçar
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
          
          {/* OCR Tab Content */}
          {activeTab === 'ocr' && isFile && downloaded && !isAccessDenied && (
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {/* OCR Status & Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ScanText className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">OCR / Extração de Texto</span>
                    {ocrLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  </div>
                  <Button
                    size="sm"
                    onClick={processOcr}
                    disabled={processingOcr}
                    variant={ocrData?.ocr_processed ? "secondary" : "default"}
                  >
                    {processingOcr ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ScanText className="w-4 h-4 mr-2" />
                    )}
                    {ocrData?.ocr_processed ? "Reprocessar OCR" : "Processar OCR"}
                  </Button>
                </div>

                {/* OCR Error */}
                {ocrData?.ocr_error && (
                  <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-medium">Erro no OCR</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{ocrData.ocr_error}</p>
                  </div>
                )}

                {/* OCR Not Processed */}
                {!ocrData?.ocr_processed && !ocrData?.ocr_error && (
                  <div className="p-6 text-center border border-dashed border-border rounded-lg">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-muted-foreground">
                      Clique em "Processar OCR" para extrair texto e metadados deste arquivo.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Suporta PDFs, imagens, documentos Office e mais.
                    </p>
                  </div>
                )}

                {/* OCR Metadata */}
                {ocrData?.ocr_processed && ocrData?.ocr_metadata && Object.keys(ocrData.ocr_metadata).length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileJson className="w-4 h-4" />
                      <span>Metadados Extraídos</span>
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {Object.keys(ocrData.ocr_metadata).length} campos
                      </span>
                    </div>
                    <div className="border border-border rounded-lg divide-y divide-border max-h-64 overflow-auto">
                      {Object.entries(ocrData.ocr_metadata)
                        .filter(([key]) => !key.startsWith('X-TIKA'))
                        .slice(0, 30)
                        .map(([key, value]) => (
                          <div key={key} className="px-3 py-2 flex justify-between gap-4">
                            <span className="text-xs font-mono text-muted-foreground">{key}</span>
                            <span className="text-xs text-right truncate max-w-[200px]">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* OCR Content */}
                {ocrData?.ocr_processed && ocrData?.ocr_content && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileText className="w-4 h-4" />
                        <span>Conteúdo Extraído</span>
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {ocrData.ocr_content.length.toLocaleString()} caracteres
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(ocrData.ocr_content, 'ocr_content')}
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Copiar
                      </Button>
                    </div>
                    <div className="relative">
                      <pre className="p-4 bg-muted rounded-lg text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-auto">
                        {ocrData.ocr_content}
                      </pre>
                    </div>
                  </div>
                )}

                {/* OCR Processing Info */}
                {ocrData?.ocr_processed_at && (
                  <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
                    Processado em: {new Date(ocrData.ocr_processed_at).toLocaleString('pt-BR')}
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
    <div className="h-[calc(100vh-120px)] flex flex-col relative" data-testid="server-browser-page">
      {/* Overlay de Loading para navegação da busca */}
      {navigatingToResult && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/10 backdrop-blur-[1px]"
          style={{ pointerEvents: 'all' }}
        >
          <div className="flex flex-col items-center gap-3 bg-card/90 px-6 py-4 rounded-lg shadow-lg border border-border">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Navegando até o item...</span>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(backDestination)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {backLabel}
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{server.name}</h1>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{server.ip}</code>
              {server.plugin_instance_name && (
                <Badge variant="secondary" className="text-xs">
                  {server.plugin_instance_name}
                </Badge>
              )}
            </div>
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

      {/* Alert when no plugin instance configured */}
      {!server.plugin_instance_id && (
        <div className="px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/30">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-500">Instância de Plugin Não Configurada</p>
              <p className="text-xs text-muted-foreground">
                Configure uma instância de plugin na página de <a href="/servers" className="text-primary hover:underline">Servidores</a> para poder navegar e baixar arquivos.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/servers')}>
              Configurar
            </Button>
          </div>
        </div>
      )}

      {/* Main Content - Split View */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel - Tree View */}
        <ResizablePanel defaultSize={25} minSize={15} maxSize={50}>
          <div className="h-full border-r border-border bg-card flex flex-col">
            {/* Search Box */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar arquivos e diretórios..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full px-3 py-2 pr-20 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                  data-testid="search-input"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {searchLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={clearSearch}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                  <Button
                    variant={showAdvancedSearch ? "default" : "ghost"}
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                    title="Busca avançada"
                  >
                    <Code className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              
              {/* Advanced Search Filters */}
              {showAdvancedSearch && (
                <div className="mt-2 p-2 bg-muted/30 rounded-md space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Extensão (.aspx)"
                      value={searchFilters.extension}
                      onChange={(e) => setSearchFilters(prev => ({ ...prev, extension: e.target.value }))}
                      className="px-2 py-1 text-xs bg-background border border-border rounded"
                    />
                    <input
                      type="text"
                      placeholder="SHA1 hash"
                      value={searchFilters.sha1}
                      onChange={(e) => setSearchFilters(prev => ({ ...prev, sha1: e.target.value }))}
                      className="px-2 py-1 text-xs bg-background border border-border rounded"
                    />
                    <input
                      type="date"
                      placeholder="Data inicial"
                      value={searchFilters.dateFrom}
                      onChange={(e) => setSearchFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                      className="px-2 py-1 text-xs bg-background border border-border rounded"
                    />
                    <input
                      type="date"
                      placeholder="Data final"
                      value={searchFilters.dateTo}
                      onChange={(e) => setSearchFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                      className="px-2 py-1 text-xs bg-background border border-border rounded"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={searchFilters.itemType}
                      onChange={(e) => setSearchFilters(prev => ({ ...prev, itemType: e.target.value }))}
                      className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded"
                    >
                      <option value="">Todos os tipos</option>
                      <option value="File">Arquivos</option>
                      <option value="Directory">Diretórios</option>
                    </select>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={performAdvancedSearch}
                      disabled={searchLoading}
                    >
                      Buscar
                    </Button>
                  </div>
                </div>
              )}
              
              {/* Search Results */}
              {searchResults && (
                <div className="mt-2 max-h-64 overflow-y-auto border border-border rounded-md bg-background">
                  {searchResults.total === 0 ? (
                    <div className="p-3 text-center text-sm text-muted-foreground">
                      Nenhum resultado encontrado
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {/* Header com total e botão de exportar */}
                      <div className="px-3 py-2 bg-muted flex items-center justify-between sticky top-0 z-10">
                        <span className="text-xs font-medium text-muted-foreground">
                          {searchResults.total} resultado(s) encontrado(s)
                        </span>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant={showOnlySearchResults ? "default" : "ghost"}
                            size="sm"
                            className={`h-6 w-6 p-0 ${showOnlySearchResults ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                            onClick={() => setShowOnlySearchResults(!showOnlySearchResults)}
                            data-testid="filter-search-results-btn"
                            title={showOnlySearchResults ? "Mostrar toda a árvore" : "Filtrar árvore pelos resultados"}
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={exportSearchResultsToJson}
                            data-testid="export-search-btn"
                            title="Exportar resultados para JSON"
                          >
                            <FileJson className="w-3 h-3 mr-1" />
                            Exportar
                          </Button>
                        </div>
                      </div>
                      
                      {/* Diretórios */}
                      {searchResults.directories?.length > 0 && (
                        <div>
                          <div className="px-3 py-1 bg-muted/50 text-xs font-medium text-muted-foreground">
                            Diretórios ({searchResults.directories.length})
                          </div>
                          {searchResults.directories.map((item, idx) => (
                            <div
                              key={`dir-${idx}`}
                              className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                              onClick={() => navigateToSearchResult({ ...item, item_type: 'Directory' })}
                            >
                              <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{highlightSearchTerm(item.name, searchQuery)}</div>
                                <div className="text-xs text-muted-foreground truncate" title={item.full_path}>
                                  {formatShortPath(item.full_path, item.share_name, item.name)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Arquivos */}
                      {searchResults.files?.length > 0 && (
                        <div>
                          <div className="px-3 py-1 bg-muted/50 text-xs font-medium text-muted-foreground">
                            Arquivos ({searchResults.files.length})
                          </div>
                          {searchResults.files.map((item, idx) => (
                            <div
                              key={`file-${idx}`}
                              className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                              onClick={() => navigateToSearchResult({ ...item, item_type: 'File' })}
                            >
                              <File className="w-4 h-4 text-blue-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{highlightSearchTerm(item.name, searchQuery)}</div>
                                <div className="text-xs text-muted-foreground truncate" title={item.full_path}>
                                  {formatShortPath(item.full_path, item.share_name, item.name)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Arquivos Baixados */}
                      {searchResults.downloaded?.length > 0 && (
                        <div>
                          <div className="px-3 py-1 bg-muted/50 text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <FileCheck className="w-3 h-3 text-green-500" />
                            Baixados ({searchResults.downloaded.length})
                          </div>
                          {searchResults.downloaded.map((item, idx) => (
                            <div
                              key={`dl-${idx}`}
                              className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                              onClick={() => navigateToSearchResult({ ...item, item_type: 'File', is_downloaded: true })}
                            >
                              <FileCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{highlightSearchTerm(item.name, searchQuery)}</div>
                                <div className="text-xs text-muted-foreground truncate" title={item.full_path || item.file_path}>
                                  {searchFilters.sha1 && item.sha1_hash ? (
                                    <>SHA1: {highlightSearchTerm(item.sha1_hash, searchFilters.sha1)}</>
                                  ) : (
                                    formatShortPath(item.full_path || item.file_path, item.share_name, item.name)
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">
                Arquivos
                {showOnlyDownloaded && (
                  <span className="ml-2 text-xs text-green-500">(Somente Baixados)</span>
                )}
              </h3>
              <div className="flex items-center gap-1">
                {/* Botão para filtrar apenas baixados */}
                <Button 
                  variant={showOnlyDownloaded ? "default" : "ghost"}
                  size="icon"
                  className={`h-7 w-7 ${showOnlyDownloaded ? 'bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setShowOnlyDownloaded(!showOnlyDownloaded)}
                  data-testid="filter-downloaded-btn"
                  title={showOnlyDownloaded ? "Mostrar todos os arquivos" : "Ver apenas baixados"}
                >
                  <Eye className="w-4 h-4" />
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
                          const shareNameForId = selectedItem.share_name || selectedItem.shareName || selectedItem.name;
                          const isShareItem = selectedItem.itemType === 'share';
                          const nodeId = isShareItem
                            ? `share-${shareNameForId}`
                            : String(selectedItem.id || `share-${shareNameForId}`);
                          const safeId = nodeId.replace(/\$/g, '_dollar_');
                          const element = document.querySelector(`[data-testid="tree-node-${safeId}"]`);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }, 100);
                      } else {
                        const shareNameForId = selectedItem.share_name || selectedItem.shareName || selectedItem.name;
                        const isShareItem = selectedItem.itemType === 'share';
                        const nodeId = isShareItem
                          ? `share-${shareNameForId}`
                          : String(selectedItem.id || `share-${shareNameForId}`);
                        const shareName = isShareItem 
                          ? (selectedItem.share_name || selectedItem.shareName || selectedItem.name)
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
                
                {/* Botão recarregar */}
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-7 w-7"
                  onClick={refreshShares}
                  disabled={loadingShares}
                  data-testid="refresh-shares-btn"
                  title="Recarregar arquivos"
                >
                  {loadingShares ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </Button>
              </div>
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
            
            <ScrollArea className="flex-1 tree-scroll-area">
              <div className="py-2 pr-3">
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
                    
                    // Sem foco, mostrar tudo (ordenado alfabeticamente, case insensitive)
                    const sortedShares = [...shares].sort((a, b) =>
                      (a.share_name || '').localeCompare(b.share_name || '', undefined, { sensitivity: 'base' })
                    );
                    return sortedShares.map((share, index, arr) =>
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
      
      {/* Modal de Identificação Manual de Credencial */}
      <Dialog open={showLeakModal} onOpenChange={setShowLeakModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-yellow-500" />
              Identificar Credencial
            </DialogTitle>
            <DialogDescription>
              Registre manualmente uma credencial encontrada neste arquivo que não foi detectada automaticamente pelo GitLeaks.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Arquivo */}
            <div className="space-y-2">
              <Label>Arquivo</Label>
              <div className="p-2 bg-muted/50 rounded text-sm font-mono break-all">
                {selectedItem?.fullPath || selectedItem?.name || 'Nenhum arquivo selecionado'}
              </div>
            </div>
            
            {/* Tipo de Credencial */}
            <div className="space-y-2">
              <Label htmlFor="leak-type">Tipo de Credencial</Label>
              <Select 
                value={manualLeak.secret_type} 
                onValueChange={(value) => setManualLeak(prev => ({ ...prev, secret_type: value }))}
              >
                <SelectTrigger id="leak-type">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {leakTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <span>{type.label}</span>
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1 py-0 ${
                            type.severity === 'critical' ? 'border-red-500 text-red-500' :
                            type.severity === 'high' ? 'border-orange-500 text-orange-500' :
                            type.severity === 'medium' ? 'border-yellow-500 text-yellow-500' :
                            'border-muted-foreground text-muted-foreground'
                          }`}
                        >
                          {type.severity}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Texto Encontrado */}
            <div className="space-y-2">
              <Label htmlFor="match-text">Texto/Padrão Encontrado (opcional)</Label>
              <Input
                id="match-text"
                placeholder="Ex: password=abc123"
                value={manualLeak.match_text}
                onChange={(e) => setManualLeak(prev => ({ ...prev, match_text: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Cole o trecho do arquivo onde a credencial foi encontrada
              </p>
            </div>
            
            {/* Número da Linha */}
            <div className="space-y-2">
              <Label htmlFor="line-number">Número da Linha (opcional)</Label>
              <Input
                id="line-number"
                type="number"
                min="1"
                placeholder="Ex: 42"
                value={manualLeak.line_number || ''}
                onChange={(e) => setManualLeak(prev => ({ ...prev, line_number: e.target.value ? parseInt(e.target.value) : null }))}
              />
            </div>
            
            {/* Descrição */}
            <div className="space-y-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                placeholder="Descreva a credencial encontrada..."
                value={manualLeak.description}
                onChange={(e) => setManualLeak(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeakModal(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={submitManualLeak} 
              disabled={submittingLeak || !selectedItem}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {submittingLeak ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ShieldKeyIcon className="w-4 h-4 mr-2" />
              )}
              Registrar Credencial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
