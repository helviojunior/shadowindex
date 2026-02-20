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
  AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/contexts/AppContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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

  useEffect(() => {
    loadServer();
    loadDownloadedFiles();
  }, [serverId]);

  useEffect(() => {
    if (server) {
      loadShares();
    }
  }, [server, ignoreCache]);

  const loadServer = async () => {
    try {
      const response = await axios.get(`${API}/servers/${serverId}`);
      setServer(response.data);
    } catch (error) {
      console.error('Error loading server:', error);
      toast.error('Erro ao carregar servidor');
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
        // Marcar o nó como tendo acesso negado
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
        
        // Atualizar o share na lista local
        if (shareName) {
          setShares(prev => prev.map(s => 
            s.share_name === shareName 
              ? { ...s, access_denied: true, error_message: response.data.errorMessage }
              : s
          ));
        }
        
        toast.error(`Acesso negado: ${shareName || path}`);
        return;
      }
      
      const items = response.data.items.map((item, idx) => ({
        ...item,
        id: `${nodeId}-${idx}`,
        parentPath: path,
        shareName: shareName
      }));
      
      setNodeChildren(prev => ({ ...prev, [nodeId]: items }));
      
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

  // Renderiza um nó da árvore
  const renderTreeNode = (item, depth = 0, shareName = '') => {
    const isShare = !!item.share_name;
    const rawNodeId = item.id || `share-${item.share_name}`;
    const nodeId = String(rawNodeId);
    const safeTestId = nodeId.replace(/\$/g, '_dollar_');
    const isExpanded = expandedNodes[nodeId];
    const isLoading = loadingNodes[nodeId];
    const children = nodeChildren[nodeId] || [];
    const isDirectory = item.type === 'Directory' || isShare;
    const isAccessDenied = item.access_denied || item.accessDenied || item.type === 'AccessDenied';
    const isSelected = selectedItem?.id === nodeId || 
                       (isShare && selectedItem?.share_name === item.share_name && selectedItem?.itemType === 'share');
    
    const path = isShare 
      ? buildPath(server.ip, item.share_name)
      : item.fullPath;
    
    const currentShareName = isShare ? item.share_name : shareName;
    
    // Cor do ícone baseada no status de acesso
    const iconColor = isAccessDenied ? 'text-red-500' : 'text-blue-500';
    const fileIconColor = isAccessDenied ? 'text-red-500' : 'text-muted-foreground';
    
    return (
      <div key={nodeId}>
        <div
          className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-muted/50 rounded transition-colors ${
            isSelected ? 'bg-primary/10 text-primary' : ''
          } ${isAccessDenied ? 'opacity-75' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (item.type === 'AccessDenied') {
              // Não faz nada ao clicar no item de erro
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
          {/* Expand/Collapse Arrow */}
          {isDirectory && item.type !== 'AccessDenied' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(nodeId, isShare ? 'share' : item.type, path, currentShareName);
              }}
              className="p-0.5 hover:bg-muted rounded"
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
            <span className="w-5" />
          )}
          
          {/* Icon - vermelho se acesso negado */}
          {item.type === 'AccessDenied' ? (
            <File className="w-4 h-4 text-red-500 flex-shrink-0" />
          ) : isShare ? (
            <HardDrive className={`w-4 h-4 ${iconColor} flex-shrink-0`} />
          ) : isDirectory ? (
            isExpanded ? (
              <FolderOpen className={`w-4 h-4 ${iconColor} flex-shrink-0`} />
            ) : (
              <Folder className={`w-4 h-4 ${iconColor} flex-shrink-0`} />
            )
          ) : (
            <File className={`w-4 h-4 ${fileIconColor} flex-shrink-0`} />
          )}
          
          {/* Name - vermelho se acesso negado */}
          <span 
            className={`text-sm truncate flex-1 ${isAccessDenied ? 'text-red-500' : ''}`} 
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
            {children.map((child) => renderTreeNode(child, depth + 1, currentShareName))}
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

    // Cor do ícone no header baseada no status de acesso
    const headerIconColor = isAccessDenied ? 'text-red-500' : (isShare || isDirectory ? 'text-blue-500' : 'text-muted-foreground');

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {isAccessDenied ? (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            ) : isShare ? (
              <HardDrive className={`w-5 h-5 ${headerIconColor}`} />
            ) : isDirectory ? (
              <Folder className={`w-5 h-5 ${headerIconColor}`} />
            ) : (
              <File className={`w-5 h-5 ${headerIconColor}`} />
            )}
            <h2 className={`text-lg font-semibold truncate ${isAccessDenied ? 'text-red-500' : ''}`} title={String(itemName)}>
              {String(itemName)}
            </h2>
            {isAccessDenied && (
              <Badge variant="destructive" className="ml-2">
                Acesso Negado
              </Badge>
            )}
          </div>
          
          {isFile && !isAccessDenied && (
            <Button 
              size="sm" 
              onClick={handleDownload}
              disabled={loading || downloaded}
              data-testid="download-button"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {downloaded ? 'Baixado' : 'Download'}
            </Button>
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
        
        {/* Info Content */}
        <ScrollArea className="flex-1">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Info
            </h3>
            
            <div className="flex flex-col gap-2">
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
              
              {/* Fetched Date */}
              <InfoRow 
                label="Fetched Date" 
                value={formatDate(selectedItem.fetchedAt)}
              />
              
              {/* Access Status */}
              <InfoRow 
                label="Access Status" 
                value={isAccessDenied ? 'Negado' : 'Permitido'}
                valueClassName={isAccessDenied ? 'text-red-500 font-medium' : 'text-green-500'}
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
              
              {/* Downloaded - apenas para arquivos */}
              {isFile && !isAccessDenied && (
                <InfoRow 
                  label="Downloaded" 
                  value={downloaded ? 'Yes' : 'No'}
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
                shares.map((share) => renderTreeNode(share, 0))
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
