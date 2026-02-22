import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Settings, Download, Layers, HardDrive, RefreshCw, FileX, X, Plus, Server, Database, FileSearch, Eye, EyeOff, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

// Portas conhecidas de bancos de dados
const DEFAULT_DB_PORTS = {
  1433: 'MSSQL',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  1521: 'Oracle',
  27017: 'MongoDB',
  6379: 'Redis',
  5984: 'CouchDB',
  9200: 'Elasticsearch'
};

const DEFAULT_SMB_PORT = 445;

const GeneralSettings = () => {
  const [settings, setSettings] = useState({
    max_simultaneous_downloads: '3',
    default_depth_levels: '5',
    default_max_file_size_mb: '100',
    ignored_extensions: '.log,.tmp,.bak,.log.*',
    import_ports: '445,1433,3306,5432,1521,27017,6379,5984,9200',
    auto_ocr_enabled: 'true',
    auto_ocr_extensions: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.odt,.ods,.odp',
    auto_ocr_mimetypes: 'application/pdf,image/,text/,application/msword,application/vnd.openxmlformats-officedocument,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.oasis.opendocument',
    auto_ocr_excluded_extensions: '.svg,.jpeg,.jpg,.png,.gif,.ico,.css,.html,.htm,.ttf,.woff,.woff2,.pyc,.exe,.dll,.msi,.emf,.bdb,.vox,.bin,.dat,.pkl,.parquet,.parq,.rsc,.DS_Store,.idea,.svn,.pyenv,.git,.gitignore,.npmrc,.yarnrc,.ascx'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newExtension, setNewExtension] = useState('');
  const [newPort, setNewPort] = useState('');
  const [newPortName, setNewPortName] = useState('');
  const [newOcrExtension, setNewOcrExtension] = useState('');
  const [newOcrMimetype, setNewOcrMimetype] = useState('');
  const [newOcrExcludedExtension, setNewOcrExcludedExtension] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await axios.get(`${API}/settings`);
      const loadedSettings = {};
      Object.keys(response.data).forEach(key => {
        loadedSettings[key] = response.data[key].value;
      });
      setSettings(prev => ({ ...prev, ...loadedSettings }));
    } catch (error) {
      console.error('Error loading settings:', error);
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings`, {
        settings: settings
      });
      toast.success('Configurações salvas com sucesso');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  // Funções para gerenciar extensões
  const getExtensionsList = () => {
    const ext = settings.ignored_extensions || '';
    return ext.split(',').map(e => e.trim()).filter(e => e);
  };

  const addExtension = () => {
    if (!newExtension.trim()) return;
    
    let ext = newExtension.trim().toLowerCase();
    // Garantir que começa com ponto
    if (!ext.startsWith('.')) {
      ext = '.' + ext;
    }
    
    const currentList = getExtensionsList();
    if (currentList.includes(ext)) {
      toast.error('Extensão já existe na lista');
      return;
    }
    
    const newList = [...currentList, ext].join(',');
    handleChange('ignored_extensions', newList);
    setNewExtension('');
  };

  const removeExtension = (extToRemove) => {
    const currentList = getExtensionsList();
    const newList = currentList.filter(e => e !== extToRemove).join(',');
    handleChange('ignored_extensions', newList);
  };

  // Funções para gerenciar portas de importação
  const getPortsList = () => {
    const ports = settings.import_ports || '';
    return ports.split(',').map(p => p.trim()).filter(p => p);
  };

  const getPortName = (port) => {
    const portNum = parseInt(port);
    if (portNum === DEFAULT_SMB_PORT) return 'SMB';
    return DEFAULT_DB_PORTS[portNum] || `Porta ${port}`;
  };

  const addPort = () => {
    const portNum = parseInt(newPort);
    if (!portNum || portNum < 1 || portNum > 65535) {
      toast.error('Porta inválida (1-65535)');
      return;
    }
    
    const currentList = getPortsList();
    if (currentList.includes(String(portNum))) {
      toast.error('Porta já existe na lista');
      return;
    }
    
    const newList = [...currentList, String(portNum)].join(',');
    handleChange('import_ports', newList);
    setNewPort('');
    setNewPortName('');
  };

  const removePort = (portToRemove) => {
    const currentList = getPortsList();
    const newList = currentList.filter(p => p !== portToRemove).join(',');
    handleChange('import_ports', newList);
  };

  return (
    <div className="space-y-6" data-testid="general-settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configurações Gerais</h1>
          <p className="text-muted-foreground mt-2 flex items-center gap-2">
            Configure os parâmetros gerais do sistema
            {loading && (
              <span className="flex items-center gap-1 text-xs">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Carregando...
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || loading} data-testid="save-settings-btn">
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando...' : 'Salvar Configurações'}
        </Button>
      </div>

      {/* Download Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-emerald-500" />
            <CardTitle>Configurações de Download</CardTitle>
          </div>
          <CardDescription>
            Configure os limites e comportamentos padrão do sistema de downloads
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Max Simultaneous Downloads */}
            <div className="space-y-2">
              <Label htmlFor="max_simultaneous_downloads" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                Downloads Simultâneos
              </Label>
              <Input
                id="max_simultaneous_downloads"
                type="number"
                min="1"
                max="10"
                value={settings.max_simultaneous_downloads}
                onChange={(e) => handleChange('max_simultaneous_downloads', e.target.value)}
                data-testid="max-downloads-input"
              />
              <p className="text-xs text-muted-foreground">
                Número máximo de downloads em paralelo (1-10). Afeta diretamente o processamento no servidor.
              </p>
            </div>

            {/* Default Depth Levels */}
            <div className="space-y-2">
              <Label htmlFor="default_depth_levels" className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                Níveis de Profundidade
              </Label>
              <Input
                id="default_depth_levels"
                type="number"
                min="1"
                max="20"
                value={settings.default_depth_levels}
                onChange={(e) => handleChange('default_depth_levels', e.target.value)}
                data-testid="depth-levels-input"
              />
              <p className="text-xs text-muted-foreground">
                Valor padrão do combo de níveis na tela de arquivos (1-20).
              </p>
            </div>

            {/* Default Max File Size */}
            <div className="space-y-2">
              <Label htmlFor="default_max_file_size_mb" className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                Tamanho Máximo (MB)
              </Label>
              <Input
                id="default_max_file_size_mb"
                type="number"
                min="1"
                max="1000"
                value={settings.default_max_file_size_mb}
                onChange={(e) => handleChange('default_max_file_size_mb', e.target.value)}
                data-testid="max-size-input"
              />
              <p className="text-xs text-muted-foreground">
                Valor padrão do combo de tamanho máximo na tela de arquivos (1-1000 MB).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ignored Extensions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileX className="w-5 h-5 text-orange-500" />
            <CardTitle>Extensões Ignoradas</CardTitle>
          </div>
          <CardDescription>
            Extensões de arquivo que serão ignoradas no download em batch. Downloads manuais (botão Sync) não aplicam esses filtros.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new extension */}
          <div className="flex gap-2">
            <Input
              placeholder="Ex: .log"
              value={newExtension}
              onChange={(e) => setNewExtension(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExtension()}
              className="max-w-xs"
              data-testid="new-extension-input"
            />
            <Button variant="outline" onClick={addExtension} data-testid="add-extension-btn">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar
            </Button>
          </div>

          {/* Extensions list */}
          <div className="flex flex-wrap gap-2">
            {getExtensionsList().map((ext) => (
              <Badge 
                key={ext} 
                variant="secondary" 
                className="px-3 py-1.5 text-sm flex items-center gap-2"
              >
                {ext}
                <button
                  onClick={() => removeExtension(ext)}
                  className="hover:bg-destructive/20 rounded-full p-0.5"
                  data-testid={`remove-ext-${ext}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {getExtensionsList().length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma extensão configurada</p>
            )}
          </div>

          {/* Info Box */}
          <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-4 mt-4">
            <h4 className="text-sm font-medium text-orange-400 mb-2">Sobre as Extensões Ignoradas</h4>
            <ul className="text-xs text-orange-300/80 space-y-1">
              <li>• Arquivos com essas extensões serão automaticamente ignorados no download em batch (botão "Enviar para Fila")</li>
              <li>• Downloads manuais pelo botão Sync baixam qualquer arquivo, sem aplicar filtros</li>
              <li>• Use para evitar baixar arquivos de log, temporários ou backups</li>
              <li>• <strong>Wildcards:</strong> Use <code className="bg-orange-500/20 px-1 rounded">.log.*</code> para ignorar .log.1, .log.2, etc.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Import Ports Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-500" />
            <CardTitle>Portas de Importação</CardTitle>
          </div>
          <CardDescription>
            Configure quais portas serão consideradas na importação de servidores via Nmap XML. Apenas hosts com essas portas abertas serão importados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new port */}
          <div className="flex gap-2">
            <Input
              placeholder="Porta (ex: 445)"
              type="number"
              min="1"
              max="65535"
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPort()}
              className="w-32"
              data-testid="new-port-input"
            />
            <Button variant="outline" onClick={addPort} data-testid="add-port-btn">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar
            </Button>
          </div>

          {/* Ports list */}
          <div className="flex flex-wrap gap-2">
            {getPortsList().map((port) => {
              const portNum = parseInt(port);
              const isSMB = portNum === DEFAULT_SMB_PORT;
              const isDB = DEFAULT_DB_PORTS[portNum];
              
              return (
                <Badge 
                  key={port} 
                  variant="secondary" 
                  className={`px-3 py-1.5 text-sm flex items-center gap-2 ${
                    isSMB ? 'bg-blue-600/20 border-blue-600/40' : 
                    isDB ? 'bg-emerald-600/20 border-emerald-600/40' : ''
                  }`}
                >
                  {isSMB ? <Server className="w-3 h-3" /> : <Database className="w-3 h-3" />}
                  {getPortName(port)}: {port}
                  <button
                    onClick={() => removePort(port)}
                    className="hover:bg-destructive/20 rounded-full p-0.5"
                    data-testid={`remove-port-${port}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              );
            })}
            {getPortsList().length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma porta configurada - todos os hosts serão importados</p>
            )}
          </div>

          {/* Info Box */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4 mt-4">
            <h4 className="text-sm font-medium text-blue-400 mb-2">Sobre as Portas de Importação</h4>
            <ul className="text-xs text-blue-300/80 space-y-1">
              <li>• <strong>SMB (445):</strong> Compartilhamento de arquivos Windows</li>
              <li>• <strong>Bancos de Dados:</strong> MSSQL (1433), MySQL (3306), PostgreSQL (5432), Oracle (1521), MongoDB (27017), Redis (6379)</li>
              <li>• Hosts sem nenhuma dessas portas abertas serão ignorados na importação</li>
              <li>• Você pode adicionar portas personalizadas conforme necessidade</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Auto OCR Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-purple-500" />
            <CardTitle>Auto OCR</CardTitle>
          </div>
          <CardDescription>
            Configure o OCR automático para extrair texto de arquivos após o download
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto_ocr_enabled" className="flex items-center gap-2">
                {settings.auto_ocr_enabled === 'true' ? (
                  <Eye className="w-4 h-4 text-green-500" />
                ) : (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                )}
                OCR Automático
              </Label>
              <p className="text-xs text-muted-foreground">
                Quando habilitado, arquivos baixados serão automaticamente adicionados à fila de OCR
              </p>
            </div>
            <Switch
              id="auto_ocr_enabled"
              checked={settings.auto_ocr_enabled === 'true'}
              onCheckedChange={(checked) => handleChange('auto_ocr_enabled', checked ? 'true' : 'false')}
              data-testid="auto-ocr-toggle"
            />
          </div>

          {/* OCR Extensions */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <FileX className="w-4 h-4 text-muted-foreground" />
              Extensões para OCR Automático
            </Label>
            <p className="text-xs text-muted-foreground">
              Arquivos com estas extensões serão processados pelo OCR após download
            </p>
            <div className="flex gap-2">
              <Input
                placeholder=".ext (ex: .pdf)"
                value={newOcrExtension}
                onChange={(e) => setNewOcrExtension(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newOcrExtension) {
                    const ext = newOcrExtension.startsWith('.') ? newOcrExtension : `.${newOcrExtension}`;
                    const current = settings.auto_ocr_extensions ? settings.auto_ocr_extensions.split(',').filter(e => e) : [];
                    if (!current.includes(ext.toLowerCase())) {
                      handleChange('auto_ocr_extensions', [...current, ext.toLowerCase()].join(','));
                    }
                    setNewOcrExtension('');
                  }
                }}
                className="max-w-[200px]"
                data-testid="new-ocr-extension-input"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newOcrExtension) {
                    const ext = newOcrExtension.startsWith('.') ? newOcrExtension : `.${newOcrExtension}`;
                    const current = settings.auto_ocr_extensions ? settings.auto_ocr_extensions.split(',').filter(e => e) : [];
                    if (!current.includes(ext.toLowerCase())) {
                      handleChange('auto_ocr_extensions', [...current, ext.toLowerCase()].join(','));
                    }
                    setNewOcrExtension('');
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(settings.auto_ocr_extensions || '').split(',').filter(e => e).map((ext, idx) => (
                <Badge key={idx} variant="secondary" className="gap-1">
                  {ext}
                  <button
                    onClick={() => {
                      const current = settings.auto_ocr_extensions.split(',').filter(e => e && e !== ext);
                      handleChange('auto_ocr_extensions', current.join(','));
                    }}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          {/* OCR MIME Types */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              MIME Types para OCR Automático
            </Label>
            <p className="text-xs text-muted-foreground">
              MIME types (parcial) que ativam o OCR automático. Ex: "image/" captura todos os tipos de imagem.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="MIME type (ex: image/)"
                value={newOcrMimetype}
                onChange={(e) => setNewOcrMimetype(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newOcrMimetype) {
                    const current = settings.auto_ocr_mimetypes ? settings.auto_ocr_mimetypes.split(',').filter(m => m) : [];
                    if (!current.includes(newOcrMimetype.toLowerCase())) {
                      handleChange('auto_ocr_mimetypes', [...current, newOcrMimetype.toLowerCase()].join(','));
                    }
                    setNewOcrMimetype('');
                  }
                }}
                className="max-w-[300px]"
                data-testid="new-ocr-mimetype-input"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newOcrMimetype) {
                    const current = settings.auto_ocr_mimetypes ? settings.auto_ocr_mimetypes.split(',').filter(m => m) : [];
                    if (!current.includes(newOcrMimetype.toLowerCase())) {
                      handleChange('auto_ocr_mimetypes', [...current, newOcrMimetype.toLowerCase()].join(','));
                    }
                    setNewOcrMimetype('');
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(settings.auto_ocr_mimetypes || '').split(',').filter(m => m).map((mime, idx) => (
                <Badge key={idx} variant="outline" className="gap-1 text-xs">
                  {mime}
                  <button
                    onClick={() => {
                      const current = settings.auto_ocr_mimetypes.split(',').filter(m => m && m !== mime);
                      handleChange('auto_ocr_mimetypes', current.join(','));
                    }}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Extensões Excluídas do OCR */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-400" />
              <Label className="text-sm font-medium">Extensões Excluídas do OCR</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Arquivos com estas extensões serão <strong>sempre ignorados</strong> pelo OCR automático, mesmo que estejam na lista de inclusão.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder=".ext (ex: .jpg)"
                value={newOcrExcludedExtension}
                onChange={(e) => setNewOcrExcludedExtension(e.target.value)}
                className="flex-1 h-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newOcrExcludedExtension.trim()) {
                    const current = settings.auto_ocr_excluded_extensions ? settings.auto_ocr_excluded_extensions.split(',').filter(e => e) : [];
                    let ext = newOcrExcludedExtension.trim().toLowerCase();
                    if (!ext.startsWith('.')) ext = '.' + ext;
                    if (!current.includes(ext)) {
                      handleChange('auto_ocr_excluded_extensions', [...current, ext].join(','));
                    }
                    setNewOcrExcludedExtension('');
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newOcrExcludedExtension.trim()) {
                    const current = settings.auto_ocr_excluded_extensions ? settings.auto_ocr_excluded_extensions.split(',').filter(e => e) : [];
                    let ext = newOcrExcludedExtension.trim().toLowerCase();
                    if (!ext.startsWith('.')) ext = '.' + ext;
                    if (!current.includes(ext)) {
                      handleChange('auto_ocr_excluded_extensions', [...current, ext].join(','));
                    }
                    setNewOcrExcludedExtension('');
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(settings.auto_ocr_excluded_extensions || '').split(',').filter(e => e).map((ext, idx) => (
                <Badge key={idx} variant="outline" className="gap-1 text-xs border-red-500/50 text-red-400">
                  {ext}
                  <button
                    onClick={() => {
                      const current = settings.auto_ocr_excluded_extensions.split(',').filter(e => e && e !== ext);
                      handleChange('auto_ocr_excluded_extensions', current.join(','));
                    }}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="rounded-lg bg-purple-500/10 border border-purple-500/30 p-4 mt-4">
            <h4 className="text-sm font-medium text-purple-400 mb-2">Sobre o Auto OCR</h4>
            <ul className="text-xs text-purple-300/80 space-y-1">
              <li>• O OCR é executado em background após o download do arquivo</li>
              <li>• O texto extraído fica disponível para busca e visualização</li>
              <li>• Requer Apache Tika configurado e em execução</li>
              <li>• MIME types são verificados com match parcial (ex: "image/" captura "image/png", "image/jpeg", etc.)</li>
              <li>• <strong className="text-red-400">Extensões excluídas têm precedência</strong> sobre inclusões por extensão ou MIME type</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Info Box */}
      <Card>
        <CardContent className="p-4 pt-4">
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
            <h4 className="text-sm font-medium text-blue-400 mb-2">Sobre as Configurações</h4>
            <ul className="text-xs text-blue-300/80 space-y-1">
              <li>• <strong>Downloads Simultâneos:</strong> Controla quantos arquivos são baixados ao mesmo tempo pelo servidor. Valores maiores podem sobrecarregar o sistema.</li>
              <li>• <strong>Níveis de Profundidade:</strong> Define o valor padrão que aparece no combo da tela de arquivos. O usuário pode alterar na hora do download.</li>
              <li>• <strong>Tamanho Máximo:</strong> Define o valor padrão para ignorar arquivos maiores que o limite. O usuário pode alterar na hora do download.</li>
              <li>• <strong>Extensões Ignoradas:</strong> Arquivos com essas extensões são automaticamente pulados no batch download.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GeneralSettings;
