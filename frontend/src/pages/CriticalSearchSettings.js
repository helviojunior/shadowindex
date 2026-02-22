import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Save, Shield, FileSearch, AlertTriangle, X, Plus, 
  RefreshCw, Settings2, Folder, RotateCcw, FileKey,
  Loader2, Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api/v2';

const CriticalSearchSettings = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  
  // Inputs para adicionar novos itens
  const [newKeyword, setNewKeyword] = useState('');
  const [newExtension, setNewExtension] = useState('');
  const [newExactName, setNewExactName] = useState('');
  const [newMimeType, setNewMimeType] = useState('');
  const [newLogPattern, setNewLogPattern] = useState('');
  const [newLogExtension, setNewLogExtension] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await axios.get(`${API}/settings/critical-search`);
      setConfig(response.data);
    } catch (error) {
      console.error('Error loading critical search config:', error);
      toast.error('Erro ao carregar configuração');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/settings/critical-search`, config);
      toast.success('Configuração salva com sucesso');
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Tem certeza que deseja restaurar as configurações padrão?')) {
      return;
    }
    
    setResetting(true);
    try {
      const response = await axios.post(`${API}/settings/critical-search/reset`);
      setConfig(response.data.config);
      toast.success('Configuração restaurada para o padrão');
    } catch (error) {
      console.error('Error resetting config:', error);
      toast.error('Erro ao restaurar configuração');
    } finally {
      setResetting(false);
    }
  };

  // Helpers para adicionar/remover itens
  const addToArray = (path, value) => {
    if (!value.trim()) return;
    
    const keys = path.split('.');
    const newConfig = { ...config };
    let current = newConfig;
    
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = { ...current[keys[i]] };
      current = current[keys[i]];
    }
    
    const lastKey = keys[keys.length - 1];
    if (!current[lastKey].includes(value.trim())) {
      current[lastKey] = [...current[lastKey], value.trim()];
      setConfig(newConfig);
    }
  };

  const removeFromArray = (path, index) => {
    const keys = path.split('.');
    const newConfig = { ...config };
    let current = newConfig;
    
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = { ...current[keys[i]] };
      current = current[keys[i]];
    }
    
    const lastKey = keys[keys.length - 1];
    current[lastKey] = current[lastKey].filter((_, i) => i !== index);
    setConfig(newConfig);
  };

  const updateNestedValue = (path, value) => {
    const keys = path.split('.');
    const newConfig = { ...config };
    let current = newConfig;
    
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = { ...current[keys[i]] };
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    setConfig(newConfig);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Erro ao carregar configuração</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="critical-search-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-red-500" />
            Busca Crítica
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure as regras para identificar arquivos potencialmente sensíveis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetting}
            data-testid="reset-config-btn"
          >
            {resetting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4 mr-2" />
            )}
            Restaurar Padrão
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            data-testid="save-config-btn"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Regras de Arquivo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileKey className="w-5 h-5 text-amber-500" />
              Regras de Arquivo
            </CardTitle>
            <CardDescription>
              Defina quais arquivos são considerados críticos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Palavras-chave */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Palavras-chave no Nome</Label>
              <p className="text-xs text-muted-foreground">
                Arquivos que contenham estas palavras no nome serão considerados críticos
              </p>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {config.file_rules?.keywords?.map((keyword, index) => (
                  <Badge key={index} variant="secondary" className="gap-1">
                    {keyword}
                    <X 
                      className="w-3 h-3 cursor-pointer hover:text-red-500" 
                      onClick={() => removeFromArray('file_rules.keywords', index)}
                    />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: password, secret, key..."
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addToArray('file_rules.keywords', newKeyword);
                      setNewKeyword('');
                    }
                  }}
                  className="flex-1"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => {
                    addToArray('file_rules.keywords', newKeyword);
                    setNewKeyword('');
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <Separator />

            {/* Extensões */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Extensões Críticas</Label>
              <p className="text-xs text-muted-foreground">
                Arquivos com estas extensões serão sempre considerados críticos
              </p>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {config.file_rules?.extensions?.map((ext, index) => (
                  <Badge key={index} variant="outline" className="gap-1 bg-amber-500/10">
                    {ext}
                    <X 
                      className="w-3 h-3 cursor-pointer hover:text-red-500" 
                      onClick={() => removeFromArray('file_rules.extensions', index)}
                    />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: .pfx, .pem, .key..."
                  value={newExtension}
                  onChange={(e) => setNewExtension(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addToArray('file_rules.extensions', newExtension);
                      setNewExtension('');
                    }
                  }}
                  className="flex-1"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => {
                    addToArray('file_rules.extensions', newExtension);
                    setNewExtension('');
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <Separator />

            {/* Nomes Exatos */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Nomes de Arquivo Exatos</Label>
              <p className="text-xs text-muted-foreground">
                Arquivos com estes nomes exatos serão considerados críticos
              </p>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {config.file_rules?.exact_names?.map((name, index) => (
                  <Badge key={index} variant="destructive" className="gap-1">
                    {name}
                    <X 
                      className="w-3 h-3 cursor-pointer hover:text-white" 
                      onClick={() => removeFromArray('file_rules.exact_names', index)}
                    />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: .env, web.config..."
                  value={newExactName}
                  onChange={(e) => setNewExactName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addToArray('file_rules.exact_names', newExactName);
                      setNewExactName('');
                    }
                  }}
                  className="flex-1"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => {
                    addToArray('file_rules.exact_names', newExactName);
                    setNewExactName('');
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <Separator />

            {/* MIME Types */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">MIME Types Críticos</Label>
              <p className="text-xs text-muted-foreground">
                Arquivos com estes tipos MIME serão considerados críticos
              </p>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {config.file_rules?.mime_types?.map((mime, index) => (
                  <Badge key={index} variant="secondary" className="gap-1 text-xs">
                    {mime}
                    <X 
                      className="w-3 h-3 cursor-pointer hover:text-red-500" 
                      onClick={() => removeFromArray('file_rules.mime_types', index)}
                    />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: application/x-pkcs12..."
                  value={newMimeType}
                  onChange={(e) => setNewMimeType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addToArray('file_rules.mime_types', newMimeType);
                      setNewMimeType('');
                    }
                  }}
                  className="flex-1"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => {
                    addToArray('file_rules.mime_types', newMimeType);
                    setNewMimeType('');
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Regras de Tamanho e Detecção de Logs */}
        <div className="space-y-6">
          {/* Regras de Tamanho */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="w-5 h-5 text-blue-500" />
                Regras de Tamanho
              </CardTitle>
              <CardDescription>
                Limites de tamanho para arquivos críticos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Filtro de tamanho habilitado</Label>
                <Switch
                  checked={config.size_rules?.enabled ?? true}
                  onCheckedChange={(checked) => updateNestedValue('size_rules.enabled', checked)}
                />
              </div>
              
              {config.size_rules?.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Tamanho Mínimo (bytes)</Label>
                      <Input
                        type="number"
                        value={config.size_rules?.min_bytes ?? 0}
                        onChange={(e) => updateNestedValue('size_rules.min_bytes', parseInt(e.target.value) || 0)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {((config.size_rules?.min_bytes ?? 0) / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Tamanho Máximo (bytes)</Label>
                      <Input
                        type="number"
                        value={config.size_rules?.max_bytes ?? 52428800}
                        onChange={(e) => updateNestedValue('size_rules.max_bytes', parseInt(e.target.value) || 0)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {((config.size_rules?.max_bytes ?? 52428800) / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Arquivos fora deste intervalo serão ignorados na busca crítica
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Detecção de Diretórios de Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Folder className="w-5 h-5 text-orange-500" />
                Detecção de Logs
              </CardTitle>
              <CardDescription>
                Configurações para ignorar diretórios de log
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Ignorar diretórios de log</Label>
                <Switch
                  checked={config.log_detection?.enabled ?? true}
                  onCheckedChange={(checked) => updateNestedValue('log_detection.enabled', checked)}
                />
              </div>
              
              {config.log_detection?.enabled && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm">Mínimo de arquivos similares</Label>
                    <Input
                      type="number"
                      value={config.log_detection?.min_similar_files ?? 10}
                      onChange={(e) => updateNestedValue('log_detection.min_similar_files', parseInt(e.target.value) || 10)}
                      className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                      Quantidade de arquivos com padrão de log para considerar diretório de logs
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Extensões de Log</Label>
                    <div className="flex flex-wrap gap-2 min-h-[32px]">
                      {config.log_detection?.log_extensions?.map((ext, index) => (
                        <Badge key={index} variant="outline" className="gap-1">
                          {ext}
                          <X 
                            className="w-3 h-3 cursor-pointer hover:text-red-500" 
                            onClick={() => removeFromArray('log_detection.log_extensions', index)}
                          />
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Ex: .log, .logs..."
                        value={newLogExtension}
                        onChange={(e) => setNewLogExtension(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            addToArray('log_detection.log_extensions', newLogExtension);
                            setNewLogExtension('');
                          }
                        }}
                        className="flex-1"
                      />
                      <Button 
                        variant="outline" 
                        size="icon"
                        onClick={() => {
                          addToArray('log_detection.log_extensions', newLogExtension);
                          setNewLogExtension('');
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Auto GitLeaks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                Auto GitLeaks
              </CardTitle>
              <CardDescription>
                Iniciar varredura do GitLeaks automaticamente após busca crítica
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Iniciar GitLeaks automaticamente</Label>
                <Switch
                  checked={config.auto_gitleaks?.enabled ?? true}
                  onCheckedChange={(checked) => updateNestedValue('auto_gitleaks.enabled', checked)}
                />
              </div>
              
              {config.auto_gitleaks?.enabled && (
                <div className="space-y-2">
                  <Label className="text-sm">Delay antes de iniciar (segundos)</Label>
                  <Input
                    type="number"
                    value={config.auto_gitleaks?.delay_seconds ?? 5}
                    onChange={(e) => updateNestedValue('auto_gitleaks.delay_seconds', parseInt(e.target.value) || 5)}
                    className="w-32"
                  />
                  <p className="text-xs text-muted-foreground">
                    Tempo de espera após o término do scan para iniciar o GitLeaks
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Info Box */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <FileSearch className="w-5 h-5 text-blue-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-500">Como funciona a Busca Crítica?</p>
              <p className="text-muted-foreground mt-1">
                A busca crítica escaneia diretórios procurando por arquivos que correspondam às regras definidas acima.
                Diferente do scan normal, ela ignora diretórios de log e foca apenas em arquivos potencialmente sensíveis.
                Ao final, se habilitado, inicia automaticamente uma varredura do GitLeaks para detectar segredos expostos.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CriticalSearchSettings;
