import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Settings, Download, Layers, HardDrive, RefreshCw, FileX, X, Plus, Server, Database, FileSearch, Eye, EyeOff, Ban, Image as ImageIcon, Palette, AlignLeft, AlignCenter, AlignRight, Upload, Network, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useUiSettings, resolveBrandingUrl } from '@/contexts/UiSettingsContext';

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

// Portas que não são SMB nem banco de dados (ex.: acesso remoto)
const DEFAULT_OTHER_PORTS = {
  3389: 'RDP'
};

const GeneralSettings = () => {
  const { t } = useTranslation('general-settings');
  const [settings, setSettings] = useState({
    max_simultaneous_downloads: '3',
    download_threads_per_file: '3',
    max_simultaneous_ocr_jobs: '2',
    max_simultaneous_scans: '3',
    ocr_auto_cleanup_minutes: '15',
    default_depth_levels: '5',
    default_max_file_size_mb: '100',
    ignored_extensions: '.log,.tmp,.bak,.log.*',
    import_ports: '445,3389,1433,3306,5432,1521,27017,6379,5984,9200',
    auto_ocr_enabled: 'true',
    auto_ocr_extensions: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.odt,.ods,.odp',
    auto_ocr_mimetypes: 'application/pdf,image/,text/,application/msword,application/vnd.openxmlformats-officedocument,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.oasis.opendocument',
    auto_ocr_excluded_extensions: '.svg,.jpeg,.jpg,.png,.gif,.ico,.css,.html,.htm,.ttf,.woff,.woff2,.pyc,.exe,.dll,.msi,.emf,.bdb,.vox,.bin,.dat,.pkl,.parquet,.parq,.rsc,.DS_Store,.idea,.svn,.pyenv,.git,.gitignore,.npmrc,.yarnrc,.ascx',
    auto_index_enabled: 'true',
    auto_index_max_size_mb: '1',
    auto_index_extensions: '.txt,.csv,.xml,.json,.yaml,.yml,.ini,.cfg,.conf,.log,.md,.bat,.ps1,.sh,.py,.js,.ts,.sql,.vbs,.cmd,.reg,.inf,.properties,.env*,.toml',
    auto_index_mimetypes: 'text/',
    // Git (clone de repositórios)
    git_clone_large_repo_mb: '100',
    max_simultaneous_git_clones: '2',
    git_index_max_size_mb: '2',
    git_clone_job_timeout_min: '120',
    // Aparência / UI
    ui_logo_url: 'https://media.sec4us.com.br/logo/sec4us-dark-mode.svg',
    ui_logo_alignment: 'center',
    ui_sidebar_active_color: '#34d399',
    ui_favicon_url: 'https://media.sec4us.com.br/icon/favicon.ico'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newExtension, setNewExtension] = useState('');
  const [newPort, setNewPort] = useState('');
  const [newPortName, setNewPortName] = useState('');
  const [newOcrExtension, setNewOcrExtension] = useState('');
  const [newOcrMimetype, setNewOcrMimetype] = useState('');
  const [newOcrExcludedExtension, setNewOcrExcludedExtension] = useState('');
  const [newAutoIndexExtension, setNewAutoIndexExtension] = useState('');
  const [newAutoIndexMimetype, setNewAutoIndexMimetype] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const { reloadUiSettings } = useUiSettings();

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
      // Não mostrar toast - a barra de conexão já informa
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
      toast.success(t('toast.saveSuccess'));
      // Atualiza logo/favicon/cor/alinhamento na interface imediatamente
      reloadUiSettings();
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error(t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Upload de logo/favicon - arquivo salvo em ./shadowindex_data/branding
  const handleBrandingUpload = async (kind, file) => {
    if (!file) return;
    const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingFavicon;
    const settingKey = kind === 'logo' ? 'ui_logo_url' : 'ui_favicon_url';
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await axios.post(`${API}/branding/${kind}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Backend já atualizou a setting; refletir no formulário e na UI
      handleChange(settingKey, data.url);
      reloadUiSettings();
      toast.success(kind === 'logo' ? t('toast.logoUploaded') : t('toast.faviconUploaded'));
    } catch (error) {
      console.error('Error uploading branding:', error);
      const msg = error.response?.data?.detail || t('toast.uploadError');
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setUploading(false);
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
      toast.error(t('toast.extensionExists'));
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
    return DEFAULT_DB_PORTS[portNum] || DEFAULT_OTHER_PORTS[portNum] || t('importPorts.portLabel', { port });
  };

  const addPort = () => {
    const portNum = parseInt(newPort);
    if (!portNum || portNum < 1 || portNum > 65535) {
      toast.error(t('toast.invalidPort'));
      return;
    }

    const currentList = getPortsList();
    if (currentList.includes(String(portNum))) {
      toast.error(t('toast.portExists'));
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
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-2 flex items-center gap-2">
            {t('subtitle')}
            {loading && (
              <span className="flex items-center gap-1 text-xs">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {t('common:actions.loading')}
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || loading} data-testid="save-settings-btn">
          <Save className="w-4 h-4 mr-2" />
          {saving ? t('saving') : t('saveButton')}
        </Button>
      </div>

      {/* Aparência / Branding */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-pink-500" />
            <CardTitle>{t('appearance.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('appearance.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              {t('appearance.logoLabel')}
            </Label>
            <div className="flex items-center gap-4">
              <div className="h-12 w-40 flex items-center justify-center rounded border border-border bg-muted/30 overflow-hidden">
                {settings.ui_logo_url ? (
                  <img
                    src={resolveBrandingUrl(settings.ui_logo_url)}
                    alt={t('appearance.logoPreviewAlt')}
                    className="max-h-10 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{t('appearance.logoEmpty')}</span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  placeholder="https://.../logo.svg"
                  value={settings.ui_logo_url}
                  onChange={(e) => handleChange('ui_logo_url', e.target.value)}
                  data-testid="ui-logo-url-input"
                />
                <div className="flex items-center gap-2">
                  <input
                    id="logo-file-input"
                    type="file"
                    accept="image/svg+xml,image/png,image/jpeg,image/gif,image/webp,image/x-icon"
                    className="hidden"
                    onChange={(e) => { handleBrandingUpload('logo', e.target.files?.[0]); e.target.value = ''; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingLogo}
                    onClick={() => document.getElementById('logo-file-input').click()}
                    data-testid="upload-logo-btn"
                  >
                    {uploadingLogo ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    {t('appearance.uploadFile')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('appearance.logoFormats')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Alinhamento da logo */}
          <div className="space-y-2 max-w-xs">
            <Label className="flex items-center gap-2">
              <AlignCenter className="w-4 h-4 text-muted-foreground" />
              {t('appearance.alignmentLabel')}
            </Label>
            <Select
              value={settings.ui_logo_alignment}
              onValueChange={(value) => handleChange('ui_logo_alignment', value)}
            >
              <SelectTrigger data-testid="ui-logo-alignment-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left"><span className="flex items-center gap-2"><AlignLeft className="w-4 h-4" /> {t('appearance.alignmentLeft')}</span></SelectItem>
                <SelectItem value="center"><span className="flex items-center gap-2"><AlignCenter className="w-4 h-4" /> {t('appearance.alignmentCenter')}</span></SelectItem>
                <SelectItem value="right"><span className="flex items-center gap-2"><AlignRight className="w-4 h-4" /> {t('appearance.alignmentRight')}</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Cor do menu selecionado */}
          <div className="space-y-2 max-w-xs">
            <Label className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
              {t('appearance.sidebarColorLabel')}
            </Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(settings.ui_sidebar_active_color) ? settings.ui_sidebar_active_color : '#34d399'}
                onChange={(e) => handleChange('ui_sidebar_active_color', e.target.value)}
                className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
                data-testid="ui-sidebar-color-input"
              />
              <Input
                value={settings.ui_sidebar_active_color}
                onChange={(e) => handleChange('ui_sidebar_active_color', e.target.value)}
                placeholder="#34d399"
                className="font-mono w-32"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('appearance.sidebarColorHelp')}</p>
          </div>

          {/* Favicon */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              {t('appearance.faviconLabel')}
            </Label>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 flex items-center justify-center rounded border border-border bg-muted/30 overflow-hidden">
                {settings.ui_favicon_url ? (
                  <img
                    src={resolveBrandingUrl(settings.ui_favicon_url)}
                    alt={t('appearance.faviconPreviewAlt')}
                    className="max-h-8 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-muted-foreground">{t('appearance.faviconEmpty')}</span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  placeholder="https://.../favicon.ico"
                  value={settings.ui_favicon_url}
                  onChange={(e) => handleChange('ui_favicon_url', e.target.value)}
                  data-testid="ui-favicon-url-input"
                />
                <div className="flex items-center gap-2">
                  <input
                    id="favicon-file-input"
                    type="file"
                    accept="image/x-icon,image/png,image/svg+xml,image/gif"
                    className="hidden"
                    onChange={(e) => { handleBrandingUpload('favicon', e.target.files?.[0]); e.target.value = ''; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingFavicon}
                    onClick={() => document.getElementById('favicon-file-input').click()}
                    data-testid="upload-favicon-btn"
                  >
                    {uploadingFavicon ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    {t('appearance.uploadFile')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('appearance.faviconFormats')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-pink-500/10 border border-pink-500/30 p-4">
            <ul className="text-xs text-pink-300/80 space-y-1">
              <li>• {t('appearance.info.filesLocationBefore')} <code className="bg-pink-500/20 px-1 rounded">./shadowindex_data/branding</code> {t('appearance.info.filesLocationAfter')}</li>
              <li>• {t('appearance.info.urlOrUpload')}</li>
              <li>• {t('appearance.info.appliedBefore')} <strong>{t('saveButton')}</strong>{t('appearance.info.appliedAfter')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Download Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-emerald-500" />
            <CardTitle>{t('download.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('download.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Max Simultaneous Downloads */}
            <div className="space-y-2">
              <Label htmlFor="max_simultaneous_downloads" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('download.simultaneousDownloadsLabel')}
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
                {t('download.simultaneousDownloadsHelp')}
              </p>
            </div>

            {/* Download Threads per File */}
            <div className="space-y-2">
              <Label htmlFor="download_threads_per_file" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('download.threadsPerFileLabel')}
              </Label>
              <Input
                id="download_threads_per_file"
                type="number"
                min="1"
                max="10"
                value={settings.download_threads_per_file}
                onChange={(e) => handleChange('download_threads_per_file', e.target.value)}
                data-testid="download-threads-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('download.threadsPerFileHelp')}
              </p>
            </div>

            {/* Max Simultaneous OCR Jobs */}
            <div className="space-y-2">
              <Label htmlFor="max_simultaneous_ocr_jobs" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('download.ocrJobsLabel')}
              </Label>
              <Input
                id="max_simultaneous_ocr_jobs"
                type="number"
                min="1"
                max="5"
                value={settings.max_simultaneous_ocr_jobs}
                onChange={(e) => handleChange('max_simultaneous_ocr_jobs', e.target.value)}
                data-testid="max-ocr-jobs-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('download.ocrJobsHelp')}
              </p>
            </div>

            {/* Max Simultaneous Scans */}
            <div className="space-y-2">
              <Label htmlFor="max_simultaneous_scans" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('download.scansLabel')}
              </Label>
              <Input
                id="max_simultaneous_scans"
                type="number"
                min="1"
                max="10"
                value={settings.max_simultaneous_scans}
                onChange={(e) => handleChange('max_simultaneous_scans', e.target.value)}
                data-testid="max-scans-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('download.scansHelp')}
              </p>
            </div>

            {/* OCR Auto Cleanup Minutes */}
            <div className="space-y-2">
              <Label htmlFor="ocr_auto_cleanup_minutes" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('download.ocrCleanupLabel')}
              </Label>
              <Input
                id="ocr_auto_cleanup_minutes"
                type="number"
                min="0"
                max="1440"
                value={settings.ocr_auto_cleanup_minutes}
                onChange={(e) => handleChange('ocr_auto_cleanup_minutes', e.target.value)}
                data-testid="ocr-cleanup-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('download.ocrCleanupHelp')}
              </p>
            </div>

            {/* Default Depth Levels */}
            <div className="space-y-2">
              <Label htmlFor="default_depth_levels" className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                {t('download.depthLevelsLabel')}
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
                {t('download.depthLevelsHelp')}
              </p>
            </div>

            {/* Default Max File Size */}
            <div className="space-y-2">
              <Label htmlFor="default_max_file_size_mb" className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                {t('download.maxFileSizeLabel')}
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
                {t('download.maxFileSizeHelp')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Git - Clone de Repositórios */}
      <Card data-testid="git-clone-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-purple-500" />
            <CardTitle>{t('git.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('git.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Threshold de clone raso (depth=1) */}
            <div className="space-y-2">
              <Label htmlFor="git_clone_large_repo_mb" className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                {t('git.shallowThresholdLabel')}
              </Label>
              <Input
                id="git_clone_large_repo_mb"
                type="number"
                min="0"
                max="100000"
                value={settings.git_clone_large_repo_mb}
                onChange={(e) => handleChange('git_clone_large_repo_mb', e.target.value)}
                data-testid="git-shallow-threshold-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('git.shallowThresholdHelp')}
              </p>
            </div>

            {/* Clones Git simultâneos */}
            <div className="space-y-2">
              <Label htmlFor="max_simultaneous_git_clones" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('git.simultaneousClonesLabel')}
              </Label>
              <Input
                id="max_simultaneous_git_clones"
                type="number"
                min="1"
                max="10"
                value={settings.max_simultaneous_git_clones}
                onChange={(e) => handleChange('max_simultaneous_git_clones', e.target.value)}
                data-testid="git-max-clones-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('git.simultaneousClonesHelp')}
              </p>
            </div>

            {/* Tamanho máximo de arquivo para indexação */}
            <div className="space-y-2">
              <Label htmlFor="git_index_max_size_mb" className="flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-muted-foreground" />
                {t('git.indexMaxSizeLabel')}
              </Label>
              <Input
                id="git_index_max_size_mb"
                type="number"
                min="0"
                max="1000"
                value={settings.git_index_max_size_mb}
                onChange={(e) => handleChange('git_index_max_size_mb', e.target.value)}
                data-testid="git-index-max-size-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('git.indexMaxSizeHelp')}
              </p>
            </div>

            {/* Timeout do job de clone (watchdog) */}
            <div className="space-y-2">
              <Label htmlFor="git_clone_job_timeout_min" className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                {t('git.jobTimeoutLabel')}
              </Label>
              <Input
                id="git_clone_job_timeout_min"
                type="number"
                min="0"
                max="1440"
                value={settings.git_clone_job_timeout_min}
                onChange={(e) => handleChange('git_clone_job_timeout_min', e.target.value)}
                data-testid="git-job-timeout-input"
              />
              <p className="text-xs text-muted-foreground">
                {t('git.jobTimeoutHelp')}
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
            <CardTitle>{t('ignoredExtensions.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('ignoredExtensions.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new extension */}
          <div className="flex gap-2">
            <Input
              placeholder={t('ignoredExtensions.placeholder')}
              value={newExtension}
              onChange={(e) => setNewExtension(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExtension()}
              className="max-w-xs"
              data-testid="new-extension-input"
            />
            <Button variant="outline" onClick={addExtension} data-testid="add-extension-btn">
              <Plus className="w-4 h-4 mr-2" />
              {t('common:actions.add')}
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
              <p className="text-sm text-muted-foreground">{t('ignoredExtensions.empty')}</p>
            )}
          </div>

          {/* Info Box */}
          <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-4 mt-4">
            <h4 className="text-sm font-medium text-orange-400 mb-2">{t('ignoredExtensions.infoTitle')}</h4>
            <ul className="text-xs text-orange-300/80 space-y-1">
              <li>• {t('ignoredExtensions.info.item1')}</li>
              <li>• {t('ignoredExtensions.info.item2')}</li>
              <li>• {t('ignoredExtensions.info.item3')}</li>
              <li>• <strong>{t('ignoredExtensions.info.wildcardLabel')}</strong> {t('ignoredExtensions.info.wildcardBefore')} <code className="bg-orange-500/20 px-1 rounded">.log.*</code> {t('ignoredExtensions.info.wildcardAfter')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Import Ports Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-500" />
            <CardTitle>{t('importPorts.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('importPorts.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new port */}
          <div className="flex gap-2">
            <Input
              placeholder={t('importPorts.placeholder')}
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
              {t('common:actions.add')}
            </Button>
          </div>

          {/* Ports list */}
          <div className="flex flex-wrap gap-2">
            {getPortsList().map((port) => {
              const portNum = parseInt(port);
              const isSMB = portNum === DEFAULT_SMB_PORT;
              const isDB = DEFAULT_DB_PORTS[portNum];
              const isOther = DEFAULT_OTHER_PORTS[portNum];

              return (
                <Badge
                  key={port}
                  variant="secondary"
                  className={`px-3 py-1.5 text-sm flex items-center gap-2 ${
                    isSMB ? 'bg-blue-600/20 border-blue-600/40' :
                    isDB ? 'bg-emerald-600/20 border-emerald-600/40' :
                    isOther ? 'bg-purple-600/20 border-purple-600/40' : ''
                  }`}
                >
                  {isSMB ? <Server className="w-3 h-3" /> : isOther ? <Network className="w-3 h-3" /> : <Database className="w-3 h-3" />}
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
              <p className="text-sm text-muted-foreground">{t('importPorts.empty')}</p>
            )}
          </div>

          {/* Info Box */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4 mt-4">
            <h4 className="text-sm font-medium text-blue-400 mb-2">{t('importPorts.infoTitle')}</h4>
            <ul className="text-xs text-blue-300/80 space-y-1">
              <li>• <strong>{t('importPorts.info.smbLabel')}</strong> {t('importPorts.info.smbText')}</li>
              <li>• <strong>{t('importPorts.info.rdpLabel')}</strong> {t('importPorts.info.rdpText')}</li>
              <li>• <strong>{t('importPorts.info.dbLabel')}</strong> {t('importPorts.info.dbText')}</li>
              <li>• {t('importPorts.info.item4')}</li>
              <li>• {t('importPorts.info.item5')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Auto OCR Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-purple-500" />
            <CardTitle>{t('autoOcr.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('autoOcr.description')}
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
                {t('autoOcr.toggleLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('autoOcr.toggleHelp')}
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
              {t('autoOcr.extensionsLabel')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('autoOcr.extensionsHelp')}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={t('autoOcr.extensionsPlaceholder')}
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
              {t('autoOcr.mimetypesLabel')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('autoOcr.mimetypesHelp')}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={t('autoOcr.mimetypesPlaceholder')}
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
              <Label className="text-sm font-medium">{t('autoOcr.excludedLabel')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('autoOcr.excludedHelpBefore')} <strong>{t('autoOcr.excludedHelpStrong')}</strong> {t('autoOcr.excludedHelpAfter')}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={t('autoOcr.excludedPlaceholder')}
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
            <h4 className="text-sm font-medium text-purple-400 mb-2">{t('autoOcr.infoTitle')}</h4>
            <ul className="text-xs text-purple-300/80 space-y-1">
              <li>• {t('autoOcr.info.item1')}</li>
              <li>• {t('autoOcr.info.item2')}</li>
              <li>• {t('autoOcr.info.item3')}</li>
              <li>• {t('autoOcr.info.item4')}</li>
              <li>• <strong className="text-red-400">{t('autoOcr.info.item5Strong')}</strong> {t('autoOcr.info.item5After')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Auto-Index Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-500" />
            {t('autoIndex.title')}
          </CardTitle>
          <CardDescription>{t('autoIndex.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="auto_index_enabled" className="flex items-center gap-2">
                {settings.auto_index_enabled === 'true' ? (
                  <Eye className="w-4 h-4 text-cyan-500" />
                ) : (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                )}
                {t('autoIndex.toggleLabel')}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">{t('autoIndex.toggleHelp')}</p>
            </div>
            <Switch
              id="auto_index_enabled"
              checked={settings.auto_index_enabled === 'true'}
              onCheckedChange={(checked) => handleChange('auto_index_enabled', checked ? 'true' : 'false')}
            />
          </div>

          {/* Max Size */}
          <div>
            <Label htmlFor="auto_index_max_size_mb">{t('autoIndex.maxSizeLabel')}</Label>
            <Input
              id="auto_index_max_size_mb"
              type="number"
              min="1"
              max="500"
              value={settings.auto_index_max_size_mb}
              onChange={(e) => handleChange('auto_index_max_size_mb', e.target.value)}
              className="w-32 mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">{t('autoIndex.maxSizeHelp')}</p>
          </div>

          {/* Extensions */}
          <div>
            <Label>{t('autoIndex.extensionsLabel')} <span className="text-muted-foreground font-normal">{t('autoIndex.extensionsHint')}</span></Label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder={t('autoIndex.extensionsPlaceholder')}
                value={newAutoIndexExtension}
                onChange={(e) => setNewAutoIndexExtension(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newAutoIndexExtension.trim()) {
                    const current = settings.auto_index_extensions ? settings.auto_index_extensions.split(',').filter(e => e) : [];
                    const ext = newAutoIndexExtension.trim().startsWith('.') ? newAutoIndexExtension.trim() : '.' + newAutoIndexExtension.trim();
                    if (!current.includes(ext.toLowerCase())) {
                      handleChange('auto_index_extensions', [...current, ext.toLowerCase()].join(','));
                    }
                    setNewAutoIndexExtension('');
                  }
                }}
                className="w-40"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newAutoIndexExtension.trim()) {
                    const current = settings.auto_index_extensions ? settings.auto_index_extensions.split(',').filter(e => e) : [];
                    const ext = newAutoIndexExtension.trim().startsWith('.') ? newAutoIndexExtension.trim() : '.' + newAutoIndexExtension.trim();
                    if (!current.includes(ext.toLowerCase())) {
                      handleChange('auto_index_extensions', [...current, ext.toLowerCase()].join(','));
                    }
                    setNewAutoIndexExtension('');
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(settings.auto_index_extensions || '').split(',').filter(e => e).map((ext, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                  {ext}
                  <button
                    onClick={() => {
                      const current = settings.auto_index_extensions.split(',').filter(e => e && e !== ext);
                      handleChange('auto_index_extensions', current.join(','));
                    }}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          {/* MIME Types */}
          <div>
            <Label>{t('autoIndex.mimetypesLabel')}</Label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder={t('autoIndex.mimetypesPlaceholder')}
                value={newAutoIndexMimetype}
                onChange={(e) => setNewAutoIndexMimetype(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newAutoIndexMimetype.trim()) {
                    const current = settings.auto_index_mimetypes ? settings.auto_index_mimetypes.split(',').filter(m => m) : [];
                    if (!current.includes(newAutoIndexMimetype.trim().toLowerCase())) {
                      handleChange('auto_index_mimetypes', [...current, newAutoIndexMimetype.trim().toLowerCase()].join(','));
                    }
                    setNewAutoIndexMimetype('');
                  }
                }}
                className="w-48"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newAutoIndexMimetype.trim()) {
                    const current = settings.auto_index_mimetypes ? settings.auto_index_mimetypes.split(',').filter(m => m) : [];
                    if (!current.includes(newAutoIndexMimetype.trim().toLowerCase())) {
                      handleChange('auto_index_mimetypes', [...current, newAutoIndexMimetype.trim().toLowerCase()].join(','));
                    }
                    setNewAutoIndexMimetype('');
                  }
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(settings.auto_index_mimetypes || '').split(',').filter(m => m).map((mime, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                  {mime}
                  <button
                    onClick={() => {
                      const current = settings.auto_index_mimetypes.split(',').filter(m => m && m !== mime);
                      handleChange('auto_index_mimetypes', current.join(','));
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
          <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-4 mt-4">
            <h4 className="text-sm font-medium text-cyan-400 mb-2">{t('autoIndex.infoTitle')}</h4>
            <ul className="text-xs text-cyan-300/80 space-y-1">
              <li>• {t('autoIndex.info.item1')}</li>
              <li>• {t('autoIndex.info.item2')}</li>
              <li>• {t('autoIndex.info.item3')}</li>
              <li>• {t('autoIndex.info.item4')}</li>
              <li>• <strong className="text-cyan-300">{t('autoIndex.info.item5Strong')}</strong></li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Info Box */}
      <Card>
        <CardContent className="p-4 pt-4">
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
            <h4 className="text-sm font-medium text-blue-400 mb-2">{t('generalInfo.title')}</h4>
            <ul className="text-xs text-blue-300/80 space-y-1">
              <li>• <strong>{t('generalInfo.simultaneousDownloadsLabel')}</strong> {t('generalInfo.simultaneousDownloadsText')}</li>
              <li>• <strong>{t('generalInfo.depthLevelsLabel')}</strong> {t('generalInfo.depthLevelsText')}</li>
              <li>• <strong>{t('generalInfo.maxFileSizeLabel')}</strong> {t('generalInfo.maxFileSizeText')}</li>
              <li>• <strong>{t('generalInfo.ignoredExtensionsLabel')}</strong> {t('generalInfo.ignoredExtensionsText')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GeneralSettings;
