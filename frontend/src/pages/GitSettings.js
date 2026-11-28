import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Settings, HardDrive, RefreshCw, FileSearch, GitBranch, History, Boxes, Eye, EyeOff, DownloadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

// Apenas as settings do módulo Git são editadas nesta tela. O PUT envia só estas
// chaves, então não interfere com as demais configurações do sistema.
const GIT_KEYS = [
  'git_clone_large_repo_mb',
  'max_simultaneous_git_clones',
  'git_index_max_size_mb',
  'git_clone_job_timeout_min',
  'git_clone_stall_min',
  'git_index_history',
  'git_history_max_commits',
  'git_history_max_versions_per_file',
  'git_dump_max_objects',
];

const DEFAULTS = {
  git_clone_large_repo_mb: '100',
  max_simultaneous_git_clones: '2',
  git_index_max_size_mb: '2',
  git_clone_job_timeout_min: '120',
  git_clone_stall_min: '10',
  git_index_history: 'true',
  git_history_max_commits: '5000',
  git_history_max_versions_per_file: '100',
  git_dump_max_objects: '1000000',
};

const GitSettings = () => {
  const { t } = useTranslation('general-settings');
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const response = await axios.get(`${API}/settings`);
      const loaded = {};
      GIT_KEYS.forEach((k) => {
        if (response.data[k]) loaded[k] = response.data[k].value;
      });
      setSettings((prev) => ({ ...prev, ...loaded }));
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Envia somente as chaves do Git (upsert por chave no backend).
      const payload = {};
      GIT_KEYS.forEach((k) => { payload[k] = settings[k]; });
      await axios.put(`${API}/settings`, { settings: payload });
      toast.success(t('toast.saveSuccess'));
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error(t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

  // Prévia amigável do teto de objetos do Git Dump.
  const dumpObjPreview = () => {
    const n = parseInt(settings.git_dump_max_objects, 10);
    if (!n || n <= 0) return t('gitPage.dump.unlimited');
    try { return n.toLocaleString(); } catch { return String(n); }
  };

  return (
    <div className="space-y-6" data-testid="git-settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="w-7 h-7 text-purple-500" />
            {t('gitPage.title')}
          </h1>
          <p className="text-muted-foreground mt-2 flex items-center gap-2">
            {t('gitPage.subtitle')}
            {loading && (
              <span className="flex items-center gap-1 text-xs">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {t('common:actions.loading')}
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || loading} data-testid="save-git-settings-btn">
          <Save className="w-4 h-4 mr-2" />
          {saving ? t('saving') : t('saveButton')}
        </Button>
      </div>

      {/* Clone e indexação */}
      <Card data-testid="git-clone-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-purple-500" />
            <CardTitle>{t('git.title')}</CardTitle>
          </div>
          <CardDescription>{t('git.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="git_clone_large_repo_mb" className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                {t('git.shallowThresholdLabel')}
              </Label>
              <Input
                id="git_clone_large_repo_mb" type="number" min="0" max="100000"
                value={settings.git_clone_large_repo_mb}
                onChange={(e) => handleChange('git_clone_large_repo_mb', e.target.value)}
                data-testid="git-shallow-threshold-input"
              />
              <p className="text-xs text-muted-foreground">{t('git.shallowThresholdHelp')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max_simultaneous_git_clones" className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                {t('git.simultaneousClonesLabel')}
              </Label>
              <Input
                id="max_simultaneous_git_clones" type="number" min="1" max="10"
                value={settings.max_simultaneous_git_clones}
                onChange={(e) => handleChange('max_simultaneous_git_clones', e.target.value)}
                data-testid="git-max-clones-input"
              />
              <p className="text-xs text-muted-foreground">{t('git.simultaneousClonesHelp')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git_index_max_size_mb" className="flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-muted-foreground" />
                {t('git.indexMaxSizeLabel')}
              </Label>
              <Input
                id="git_index_max_size_mb" type="number" min="0" max="1000"
                value={settings.git_index_max_size_mb}
                onChange={(e) => handleChange('git_index_max_size_mb', e.target.value)}
                data-testid="git-index-max-size-input"
              />
              <p className="text-xs text-muted-foreground">{t('git.indexMaxSizeHelp')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git_clone_job_timeout_min" className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                {t('git.jobTimeoutLabel')}
              </Label>
              <Input
                id="git_clone_job_timeout_min" type="number" min="0" max="1440"
                value={settings.git_clone_job_timeout_min}
                onChange={(e) => handleChange('git_clone_job_timeout_min', e.target.value)}
                data-testid="git-job-timeout-input"
              />
              <p className="text-xs text-muted-foreground">{t('git.jobTimeoutHelp')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git_clone_stall_min" className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                {t('git.stallLabel')}
              </Label>
              <Input
                id="git_clone_stall_min" type="number" min="0" max="240"
                value={settings.git_clone_stall_min}
                onChange={(e) => handleChange('git_clone_stall_min', e.target.value)}
                data-testid="git-stall-input"
              />
              <p className="text-xs text-muted-foreground">{t('git.stallHelp')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Histórico de commits */}
      <Card data-testid="git-history-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-amber-500" />
            <CardTitle>{t('gitPage.history.title')}</CardTitle>
          </div>
          <CardDescription>{t('gitPage.history.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="git_index_history" className="flex items-center gap-2">
                {settings.git_index_history === 'true'
                  ? <Eye className="w-4 h-4 text-amber-500" />
                  : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                {t('gitPage.history.toggleLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('gitPage.history.toggleHelp')}</p>
            </div>
            <Switch
              id="git_index_history"
              checked={settings.git_index_history === 'true'}
              onCheckedChange={(checked) => handleChange('git_index_history', checked ? 'true' : 'false')}
              data-testid="git-index-history-toggle"
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="git_history_max_commits" className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-muted-foreground" />
                {t('gitPage.history.maxCommitsLabel')}
              </Label>
              <Input
                id="git_history_max_commits" type="number" min="0"
                value={settings.git_history_max_commits}
                onChange={(e) => handleChange('git_history_max_commits', e.target.value)}
                disabled={settings.git_index_history !== 'true'}
                data-testid="git-history-max-commits-input"
              />
              <p className="text-xs text-muted-foreground">{t('gitPage.history.maxCommitsHelp')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="git_history_max_versions_per_file" className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-muted-foreground" />
                {t('gitPage.history.maxVersionsLabel')}
              </Label>
              <Input
                id="git_history_max_versions_per_file" type="number" min="0"
                value={settings.git_history_max_versions_per_file}
                onChange={(e) => handleChange('git_history_max_versions_per_file', e.target.value)}
                disabled={settings.git_index_history !== 'true'}
                data-testid="git-history-max-versions-input"
              />
              <p className="text-xs text-muted-foreground">{t('gitPage.history.maxVersionsHelp')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Git Dump (.git exposto) */}
      <Card data-testid="git-dump-settings-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DownloadCloud className="w-5 h-5 text-red-500" />
            <CardTitle>{t('gitPage.dump.title')}</CardTitle>
          </div>
          <CardDescription>{t('gitPage.dump.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="git_dump_max_objects" className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-muted-foreground" />
                {t('gitPage.dump.maxObjectsLabel')}
              </Label>
              <Input
                id="git_dump_max_objects" type="number" min="0" step="1000"
                value={settings.git_dump_max_objects}
                onChange={(e) => handleChange('git_dump_max_objects', e.target.value)}
                data-testid="git-dump-max-objects-input"
              />
              <p className="text-xs text-muted-foreground">{t('gitPage.dump.maxObjectsHelp')}</p>
              <p className="text-xs text-muted-foreground">
                {t('gitPage.dump.preview')}: <span className="font-mono text-foreground/80">{dumpObjPreview()}</span>
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
            <ul className="text-xs text-red-300/80 space-y-1">
              <li>• {t('gitPage.dump.info1')}</li>
              <li>• {t('gitPage.dump.info2')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GitSettings;
