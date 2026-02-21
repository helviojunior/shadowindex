import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Settings, Download, Layers, HardDrive, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const GeneralSettings = () => {
  const [settings, setSettings] = useState({
    max_simultaneous_downloads: '3',
    default_depth_levels: '5',
    default_max_file_size_mb: '100'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="general-settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configurações Gerais</h1>
          <p className="text-muted-foreground mt-2">Configure os parâmetros gerais do sistema</p>
        </div>
        <Button onClick={handleSave} disabled={saving} data-testid="save-settings-btn">
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

          {/* Info Box */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
            <h4 className="text-sm font-medium text-blue-400 mb-2">Sobre as Configurações</h4>
            <ul className="text-xs text-blue-300/80 space-y-1">
              <li>• <strong>Downloads Simultâneos:</strong> Controla quantos arquivos são baixados ao mesmo tempo pelo servidor. Valores maiores podem sobrecarregar o sistema.</li>
              <li>• <strong>Níveis de Profundidade:</strong> Define o valor padrão que aparece no combo da tela de arquivos. O usuário pode alterar na hora do download.</li>
              <li>• <strong>Tamanho Máximo:</strong> Define o valor padrão para ignorar arquivos maiores que o limite. O usuário pode alterar na hora do download.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GeneralSettings;
