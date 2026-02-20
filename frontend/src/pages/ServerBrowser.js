import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Folder, 
  File, 
  Download, 
  ArrowLeft, 
  Home, 
  HardDrive,
  Loader2,
  ChevronRight,
  FolderOpen
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
  const [currentPath, setCurrentPath] = useState('');
  const [currentShare, setCurrentShare] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [pathHistory, setPathHistory] = useState([]);
  const [view, setView] = useState('shares'); // 'shares' or 'files'

  useEffect(() => {
    loadServer();
  }, [serverId, ignoreCache]);

  const loadServer = async () => {
    try {
      const response = await axios.get(`${API}/servers/${serverId}?refresh=${ignoreCache}`);
      setServer(response.data);
    } catch (error) {
      console.error('Error loading server:', error);
      toast.error('Erro ao carregar servidor');
    }
  };

  const loadShares = async () => {
    setLoadingShares(true);
    try {
      const response = await axios.get(`${API}/servers/${serverId}/shares?refresh=${ignoreCache}`);
      setShares(response.data);
      setView('shares');
      toast.success(`${response.data.length} compartilhamentos encontrados`);
    } catch (error) {
      console.error('Error loading shares:', error);
      toast.error('Erro ao carregar compartilhamentos');
    } finally {
      setLoadingShares(false);
    }
  };

  const browseShare = async (shareName) => {
    const path = `\\\\\\\\${server.ip}\\\\${shareName}`;
    setCurrentShare(shareName);
    await browsePath(path);
  };

  const browsePath = async (path) => {
    setLoading(true);
    try {
      const response = await axios.post(
        `${API}/servers/${serverId}/browse`,
        null,
        { params: { path } }
      );
      
      setItems(response.data.items);
      setCurrentPath(path);
      setView('files');
      
      // Adicionar ao histórico
      if (!pathHistory.includes(path)) {
        setPathHistory([...pathHistory, path]);
      }
    } catch (error) {
      console.error('Error browsing path:', error);
      toast.error('Erro ao listar diretório');
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (item) => {
    if (item.type === 'Directory') {
      await browsePath(item.fullPath);
    }
  };

  const handleDownload = async (item) => {
    setLoading(true);
    try {
      const response = await axios.post(
        `${API}/servers/${serverId}/download`,
        null,
        {
          params: {
            file_path: item.fullPath,
            share_name: currentShare
          }
        }
      );
      
      toast.success(`Arquivo baixado: ${response.data.size_formatted}`);
      loadServer(); // Atualizar contadores
    } catch (error) {
      console.error('Error downloading file:', error);
      toast.error('Erro ao baixar arquivo');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (pathHistory.length > 1) {
      const newHistory = [...pathHistory];
      newHistory.pop(); // Remove atual
      const previousPath = newHistory[newHistory.length - 1];
      setPathHistory(newHistory);
      browsePath(previousPath);
    } else {
      setView('shares');
      setCurrentPath('');
      setPathHistory([]);
    }
  };

  const goHome = () => {
    setView('shares');
    setCurrentPath('');
    setPathHistory([]);
    setItems([]);
  };

  const formatSize = (size) => {
    if (size === '---' || !size) return size;
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
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleString('pt-BR');
    } catch {
      return dateString;
    }
  };

  const renderBreadcrumb = () => {
    if (!currentPath) return null;
    
    const parts = currentPath.split('\\\\').filter(p => p);
    
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Button variant="ghost" size="sm" onClick={goHome}>
          <Home className="w-4 h-4" />
        </Button>
        {parts.map((part, index) => (
          <div key={index} className="flex items-center gap-2">
            <ChevronRight className="w-4 h-4" />
            <span className="font-medium">{part}</span>
          </div>
        ))}
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
    <div className="space-y-6" data-testid="server-browser-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/servers')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{server.name}</h1>
            <p className="text-muted-foreground mt-1">
              <code className="text-sm bg-muted px-2 py-1 rounded">{server.ip}</code>
            </p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Badge variant="outline">
            <HardDrive className="w-3 h-3 mr-1" />
            {server.shares_count} Shares
          </Badge>
          <Badge variant="outline">
            <Download className="w-3 h-3 mr-1" />
            {server.downloaded_files_count} Downloads
          </Badge>
        </div>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {view === 'shares' ? 'Compartilhamentos' : 'Navegador de Arquivos'}
              </CardTitle>
              <CardDescription>
                {view === 'shares' 
                  ? 'Selecione um compartilhamento para explorar'
                  : currentPath
                }
              </CardDescription>
            </div>
            
            {view === 'shares' ? (
              <Button onClick={loadShares} disabled={loadingShares}>
                {loadingShares && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Carregar Shares
              </Button>
            ) : (
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
            )}
          </div>
        </CardHeader>
        
        <CardContent>
          {renderBreadcrumb()}
          
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : view === 'shares' ? (
            // Shares View
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {shares.length === 0 ? (
                <p className="col-span-full text-center text-muted-foreground py-8">
                  Clique em "Carregar Shares" para listar os compartilhamentos
                </p>
              ) : (
                shares.map((share, index) => (
                  <div
                    key={index}
                    onClick={() => browseShare(share.name)}
                    className="flex items-center gap-3 p-4 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <FolderOpen className="w-8 h-8 text-blue-500" />
                    <div className="flex-1">
                      <div className="font-medium">{share.name}</div>
                      <div className="text-xs text-muted-foreground">{share.type}</div>
                      {share.remark && (
                        <div className="text-xs text-muted-foreground mt-1">{share.remark}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            // Files View
            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Diretório vazio
                </p>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
                    >
                      <div 
                        className="flex items-center gap-3 flex-1 cursor-pointer"
                        onClick={() => handleItemClick(item)}
                      >
                        {item.type === 'Directory' ? (
                          <Folder className="w-5 h-5 text-blue-500" />
                        ) : (
                          <File className="w-5 h-5 text-muted-foreground" />
                        )}
                        <div className="flex-1">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.size !== '---' && formatSize(item.size)} • {formatDate(item.modified)}
                          </div>
                        </div>
                      </div>
                      
                      {item.type !== 'Directory' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDownload(item)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ServerBrowser;