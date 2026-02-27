import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileCode, Server, Database, Loader2, CheckCircle, AlertCircle, Trash2, FileUp, Search, CloudUpload, Plug, Settings, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Default known database ports (fallback)
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

// Status steps for upload process
const UPLOAD_STEPS = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PARSING: 'parsing',
  READY: 'ready'
};

const ImportServers = () => {
  const [activeTab, setActiveTab] = useState('nmap');

  // Nmap state
  const [xmlContent, setXmlContent] = useState('');
  const [parsedHosts, setParsedHosts] = useState([]);
  const [selectedHosts, setSelectedHosts] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(UPLOAD_STEPS.IDLE);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);

  // BloodHound state
  const [bhParsedHosts, setBhParsedHosts] = useState([]);
  const [bhSelectedHosts, setBhSelectedHosts] = useState(new Set());
  const [bhImporting, setBhImporting] = useState(false);
  const [bhImportResults, setBhImportResults] = useState(null);
  const [bhUploadStatus, setBhUploadStatus] = useState(UPLOAD_STEPS.IDLE);
  const [bhUploadProgress, setBhUploadProgress] = useState(0);
  const [bhFileName, setBhFileName] = useState('');
  const [bhSourceInfo, setBhSourceInfo] = useState(null);
  const bhFileInputRef = useRef(null);

  // Shared state
  const [pluginInstances, setPluginInstances] = useState([]);
  const [selectedPluginInstance, setSelectedPluginInstance] = useState('');
  const [configuredPorts, setConfiguredPorts] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoadingConfig(true);
    try {
      const [instancesRes, settingsRes] = await Promise.all([
        axios.get(`${API}/plugin-instances`),
        axios.get(`${API}/settings`)
      ]);

      setPluginInstances(instancesRes.data || []);

      // Carregar portas configuradas
      const importPorts = settingsRes.data?.import_ports?.value || '445,1433,3306,5432,1521,27017,6379,5984,9200';
      const ports = importPorts.split(',').map(p => parseInt(p.trim())).filter(p => p);
      setConfiguredPorts(ports);
    } catch (error) {
      console.error('Error loading config:', error);
      setConfiguredPorts([DEFAULT_SMB_PORT, ...Object.keys(DEFAULT_DB_PORTS).map(p => parseInt(p))]);
    } finally {
      setLoadingConfig(false);
    }
  };

  const getPortName = (portNum) => {
    if (portNum === DEFAULT_SMB_PORT) return 'SMB';
    return DEFAULT_DB_PORTS[portNum] || `Porta ${portNum}`;
  };

  // ========================
  // Nmap handlers
  // ========================

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xml')) {
      toast.error('Por favor, selecione um arquivo XML do nmap');
      return;
    }

    setFileName(file.name);
    setUploadStatus(UPLOAD_STEPS.UPLOADING);
    setUploadProgress(0);

    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(progress);
      }
    };

    reader.onload = (event) => {
      const content = event.target?.result;
      setXmlContent(content);
      setUploadStatus(UPLOAD_STEPS.PARSING);
      setUploadProgress(100);

      setTimeout(() => {
        parseNmapXml(content);
      }, 300);
    };

    reader.onerror = () => {
      toast.error('Erro ao ler o arquivo');
      setUploadStatus(UPLOAD_STEPS.IDLE);
      setUploadProgress(0);
    };

    reader.readAsText(file);
  };

  const parseNmapXml = async (xml) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');

      const hosts = [];
      const hostElements = doc.querySelectorAll('host');

      hostElements.forEach((host) => {
        const status = host.querySelector('status');
        if (status?.getAttribute('state') !== 'up') return;

        const address = host.querySelector('address[addrtype="ipv4"]');
        const hostname = host.querySelector('hostnames hostname');
        const ports = host.querySelectorAll('ports port');

        const ip = address?.getAttribute('addr');
        if (!ip) return;

        const name = hostname?.getAttribute('name') || ip;
        const openPorts = [];
        let hasRelevantPort = false;

        ports.forEach((port) => {
          const state = port.querySelector('state');
          if (state?.getAttribute('state') !== 'open') return;

          const portId = parseInt(port.getAttribute('portid'));
          const service = port.querySelector('service');
          const serviceName = service?.getAttribute('name') || 'unknown';

          openPorts.push({ port: portId, service: serviceName });

          if (configuredPorts.includes(portId)) {
            hasRelevantPort = true;
          }
        });

        if (hasRelevantPort) {
          hosts.push({
            ip,
            name,
            openPorts: openPorts.filter(p => configuredPorts.includes(p.port))
          });
        }
      });

      if (hosts.length === 0) {
        setParsedHosts([]);
        setSelectedHosts(new Set());
        setUploadStatus(UPLOAD_STEPS.READY);
        toast.warning('Nenhum servidor com portas configuradas encontrado');
        return;
      }

      // Filtrar servidores que já existem no banco
      try {
        const checkRes = await axios.post(`${API}/v2/servers/check-existing`, {
          ips: hosts.map(h => h.ip)
        });
        const existingIps = new Set(checkRes.data.existing_ips || []);
        const filtered = hosts.filter(h => !existingIps.has(h.ip));
        const skippedCount = hosts.length - filtered.length;

        setParsedHosts(filtered);
        setSelectedHosts(new Set(filtered.map(h => h.ip)));
        setUploadStatus(UPLOAD_STEPS.READY);

        if (filtered.length === 0 && skippedCount > 0) {
          toast.warning(`Todos os ${skippedCount} servidores já existem no banco`);
        } else if (skippedCount > 0) {
          toast.success(`${filtered.length} servidores novos encontrados (${skippedCount} já existiam)`);
        } else {
          toast.success(`${filtered.length} servidores encontrados`);
        }
      } catch {
        // Se falhar o check, exibir todos
        setParsedHosts(hosts);
        setSelectedHosts(new Set(hosts.map(h => h.ip)));
        setUploadStatus(UPLOAD_STEPS.READY);
        toast.success(`${hosts.length} servidores encontrados`);
      }
    } catch (error) {
      console.error('Error parsing XML:', error);
      toast.error('Erro ao processar arquivo XML');
      setUploadStatus(UPLOAD_STEPS.IDLE);
    }
  };

  const toggleHost = (ip) => {
    const newSelected = new Set(selectedHosts);
    if (newSelected.has(ip)) {
      newSelected.delete(ip);
    } else {
      newSelected.add(ip);
    }
    setSelectedHosts(newSelected);
  };

  const selectAll = () => {
    setSelectedHosts(new Set(parsedHosts.map(h => h.ip)));
  };

  const deselectAll = () => {
    setSelectedHosts(new Set());
  };

  const handleImport = async () => {
    if (selectedHosts.size === 0) {
      toast.error('Selecione pelo menos um servidor para importar');
      return;
    }

    if (!selectedPluginInstance) {
      toast.error('Selecione uma instância de plugin para os servidores');
      return;
    }

    setImporting(true);
    setImportResults(null);

    const hostsToImport = parsedHosts.filter(h => selectedHosts.has(h.ip));

    try {
      const response = await axios.post(`${API}/v2/servers/import/nmap`, {
        hosts: hostsToImport.map(h => ({
          ip: h.ip,
          name: h.name,
          plugin_instance_id: parseInt(selectedPluginInstance)
        }))
      });

      const data = response.data;

      const results = {
        success: data.details.filter(d => d.id !== undefined),
        failed: data.details.filter(d => d.error !== undefined),
        skipped: data.details.filter(d => d.reason !== undefined)
      };

      setImportResults(results);

      if (data.imported > 0) {
        toast.success(`${data.imported} servidores importados com sucesso`);
      }
      if (data.skipped > 0) {
        toast.warning(`${data.skipped} servidores já existiam e foram ignorados`);
      }
      if (data.failed > 0) {
        toast.error(`${data.failed} servidores falharam na importação`);
      }

    } catch (error) {
      console.error('Import error:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(`Erro na importação: ${errorMsg}`);

      setImportResults({
        success: [],
        failed: hostsToImport.map(h => ({ ...h, error: errorMsg })),
        skipped: []
      });
    }

    setImporting(false);
  };

  const clearAll = () => {
    setXmlContent('');
    setParsedHosts([]);
    setSelectedHosts(new Set());
    setImportResults(null);
    setUploadStatus(UPLOAD_STEPS.IDLE);
    setUploadProgress(0);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ========================
  // BloodHound handlers
  // ========================

  const handleBhFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isJson = file.name.endsWith('.json');
    const isZip = file.name.endsWith('.zip');

    if (!isJson && !isZip) {
      toast.error('Por favor, selecione um arquivo JSON ou ZIP do BloodHound');
      return;
    }

    setBhFileName(file.name);
    setBhUploadStatus(UPLOAD_STEPS.UPLOADING);
    setBhUploadProgress(0);
    setBhSourceInfo(null);

    if (isJson) {
      // Parse JSON no frontend
      const reader = new FileReader();

      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          setBhUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      reader.onload = (event) => {
        setBhUploadStatus(UPLOAD_STEPS.PARSING);
        setBhUploadProgress(100);

        setTimeout(() => {
          parseBloodHoundJson(event.target?.result, file.name);
        }, 300);
      };

      reader.onerror = () => {
        toast.error('Erro ao ler o arquivo');
        setBhUploadStatus(UPLOAD_STEPS.IDLE);
        setBhUploadProgress(0);
      };

      reader.readAsText(file);
    } else {
      // ZIP: enviar ao backend para extração
      setBhUploadProgress(50);
      setBhUploadStatus(UPLOAD_STEPS.PARSING);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await axios.post(`${API}/v2/servers/import/bloodhound/parse`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        const data = response.data;
        const hosts = data.hosts || [];
        setBhSourceInfo({ file: data.source_file, total: data.total_in_file });
        setBhUploadProgress(100);

        if (hosts.length === 0) {
          setBhParsedHosts([]);
          setBhSelectedHosts(new Set());
          setBhUploadStatus(UPLOAD_STEPS.READY);
          toast.warning('Nenhum computador enabled encontrado no ZIP');
        } else {
          // Filtrar os que já existem
          await filterExistingBhHosts(hosts, data.total_in_file);
        }
      } catch (error) {
        console.error('Error parsing BloodHound ZIP:', error);
        const errorMsg = error.response?.data?.detail || error.message;
        toast.error(`Erro ao processar ZIP: ${errorMsg}`);
        setBhUploadStatus(UPLOAD_STEPS.IDLE);
        setBhUploadProgress(0);
      }
    }
  };

  const filterExistingBhHosts = async (hosts, totalInFile) => {
    try {
      const checkRes = await axios.post(`${API}/v2/servers/check-existing`, {
        names: hosts.map(h => h.name)
      });
      const existingNames = new Set(checkRes.data.existing_names || []);
      const filtered = hosts.filter(h => !existingNames.has(h.name));
      const skippedCount = hosts.length - filtered.length;

      setBhParsedHosts(filtered);
      setBhSelectedHosts(new Set(filtered.map(h => h.name)));
      setBhUploadStatus(UPLOAD_STEPS.READY);

      if (filtered.length === 0 && skippedCount > 0) {
        toast.warning(`Todos os ${skippedCount} computadores enabled já existem no banco`);
      } else if (skippedCount > 0) {
        toast.success(`${filtered.length} computadores novos (${skippedCount} já existiam, de ${totalInFile} total)`);
      } else {
        toast.success(`${filtered.length} computadores enabled encontrados (de ${totalInFile} total)`);
      }
    } catch {
      // Se falhar o check, exibir todos
      setBhParsedHosts(hosts);
      setBhSelectedHosts(new Set(hosts.map(h => h.name)));
      setBhUploadStatus(UPLOAD_STEPS.READY);
      toast.success(`${hosts.length} computadores enabled encontrados (de ${totalInFile} total)`);
    }
  };

  const parseBloodHoundJson = async (jsonStr, fileName) => {
    try {
      const data = JSON.parse(jsonStr);
      const computers = Array.isArray(data) ? data : (data.data || []);
      const totalInFile = computers.length;

      const oneYearAgo = Date.now() / 1000 - 365 * 24 * 60 * 60;

      const hosts = [];
      for (const comp of computers) {
        const props = comp.Properties || {};
        if (!props.enabled) continue;
        const name = props.name || '';
        if (!name) continue;

        // Filtrar por lastlogon < 1 ano
        const lastlogon = props.lastlogon || 0;
        if (!lastlogon || lastlogon < oneYearAgo) continue;

        hosts.push({
          name: name.toLowerCase(),
          os: props.operatingsystem || '',
          domain: props.domain || '',
          enabled: true
        });
      }

      setBhSourceInfo({ file: fileName, total: totalInFile });

      if (hosts.length === 0) {
        setBhParsedHosts([]);
        setBhSelectedHosts(new Set());
        setBhUploadStatus(UPLOAD_STEPS.READY);
        toast.warning('Nenhum computador enabled encontrado');
      } else {
        // Filtrar os que já existem
        await filterExistingBhHosts(hosts, totalInFile);
      }
    } catch (error) {
      console.error('Error parsing BloodHound JSON:', error);
      toast.error('Erro ao processar arquivo JSON do BloodHound');
      setBhUploadStatus(UPLOAD_STEPS.IDLE);
    }
  };

  const toggleBhHost = (name) => {
    const newSelected = new Set(bhSelectedHosts);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setBhSelectedHosts(newSelected);
  };

  const bhSelectAll = () => {
    setBhSelectedHosts(new Set(bhParsedHosts.map(h => h.name)));
  };

  const bhDeselectAll = () => {
    setBhSelectedHosts(new Set());
  };

  const handleBhImport = async () => {
    if (bhSelectedHosts.size === 0) {
      toast.error('Selecione pelo menos um servidor para importar');
      return;
    }

    if (!selectedPluginInstance) {
      toast.error('Selecione uma instância de plugin para os servidores');
      return;
    }

    setBhImporting(true);
    setBhImportResults(null);

    const hostsToImport = bhParsedHosts.filter(h => bhSelectedHosts.has(h.name));

    try {
      const response = await axios.post(`${API}/v2/servers/import/bloodhound`, {
        hosts: hostsToImport.map(h => ({
          name: h.name,
          os: h.os,
          domain: h.domain,
          plugin_instance_id: parseInt(selectedPluginInstance)
        }))
      });

      const data = response.data;

      const results = {
        success: data.details.filter(d => d.id !== undefined),
        failed: data.details.filter(d => d.error !== undefined),
        skipped: data.details.filter(d => d.reason !== undefined)
      };

      setBhImportResults(results);

      if (data.imported > 0) {
        toast.success(`${data.imported} servidores importados com sucesso`);
      }
      if (data.skipped > 0) {
        toast.warning(`${data.skipped} servidores já existiam e foram ignorados`);
      }
      if (data.failed > 0) {
        toast.error(`${data.failed} servidores falharam na importação`);
      }

    } catch (error) {
      console.error('BloodHound import error:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(`Erro na importação: ${errorMsg}`);

      setBhImportResults({
        success: [],
        failed: hostsToImport.map(h => ({ name: h.name, ip: h.name, error: errorMsg })),
        skipped: []
      });
    }

    setBhImporting(false);
  };

  const clearBh = () => {
    setBhParsedHosts([]);
    setBhSelectedHosts(new Set());
    setBhImportResults(null);
    setBhUploadStatus(UPLOAD_STEPS.IDLE);
    setBhUploadProgress(0);
    setBhFileName('');
    setBhSourceInfo(null);
    if (bhFileInputRef.current) {
      bhFileInputRef.current.value = '';
    }
  };

  // ========================
  // Shared UI helpers
  // ========================

  const getStatusMessage = (status, fName) => {
    switch (status) {
      case UPLOAD_STEPS.UPLOADING:
        return { icon: <FileUp className="w-4 h-4 animate-bounce" />, text: 'Enviando arquivo...' };
      case UPLOAD_STEPS.PARSING:
        return { icon: <Search className="w-4 h-4 animate-pulse" />, text: 'Analisando arquivo...' };
      case UPLOAD_STEPS.READY:
        return { icon: <CheckCircle className="w-4 h-4 text-green-500" />, text: 'Pronto para importar' };
      default:
        return null;
    }
  };

  const renderImportResults = (results) => {
    if (!results) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resultado da Importação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {results.success.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">{results.success.length} importados com sucesso</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {results.success.map((host) => (
                  <div key={host.ip || host.name} className="text-sm p-2 bg-green-500/10 rounded border border-green-500/30">
                    <div className="font-medium truncate">{host.name}</div>
                    {host.ip && host.ip !== host.name && (
                      <div className="text-xs text-muted-foreground font-mono">{host.ip}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.skipped && results.skipped.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-yellow-500 mb-2">
                <AlertCircle className="w-4 h-4" />
                <span className="font-medium">{results.skipped.length} já existiam (ignorados)</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {results.skipped.map((host) => (
                  <div key={host.ip || host.name} className="text-sm p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                    <div className="font-medium truncate">{host.name}</div>
                    <div className="text-xs text-yellow-400 truncate">{host.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.failed.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-red-500 mb-2">
                <AlertCircle className="w-4 h-4" />
                <span className="font-medium">{results.failed.length} falharam</span>
              </div>
              <div className="space-y-2">
                {results.failed.map((host) => (
                  <div key={host.ip || host.name} className="text-sm p-2 bg-red-500/10 rounded border border-red-500/30">
                    <div className="font-medium">{host.name} ({host.ip})</div>
                    <div className="text-xs text-red-400">{host.error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const nmapStatusInfo = getStatusMessage(uploadStatus, fileName);
  const bhStatusInfo = getStatusMessage(bhUploadStatus, bhFileName);

  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="import-servers-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Importar Servidores</h1>
        <p className="text-muted-foreground mt-2">Importe servidores a partir de scans Nmap ou BloodHound</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="nmap" className="flex items-center gap-2">
            <FileCode className="w-4 h-4" />
            Nmap XML
          </TabsTrigger>
          <TabsTrigger value="bloodhound" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            BloodHound
          </TabsTrigger>
        </TabsList>

        {/* ======================== */}
        {/* Nmap Tab */}
        {/* ======================== */}
        <TabsContent value="nmap" className="space-y-6">
          {/* Upload Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload XML do Nmap
              </CardTitle>
              <CardDescription>
                Faça upload de um arquivo XML gerado pelo nmap. Serão importados apenas hosts com as{' '}
                <Link to="/settings" className="text-primary hover:underline inline-flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  portas configuradas
                </Link>
                {' '}abertas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml"
                    onChange={handleFileUpload}
                    className="max-w-md"
                    data-testid="xml-file-input"
                  />
                  {parsedHosts.length > 0 && (
                    <Button variant="outline" onClick={clearAll}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Limpar
                    </Button>
                  )}
                </div>

                {nmapStatusInfo && (
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    {nmapStatusInfo.icon}
                    <span className="text-sm font-medium">{nmapStatusInfo.text}</span>
                    {fileName && <span className="text-sm text-muted-foreground">({fileName})</span>}
                    {uploadStatus === UPLOAD_STEPS.UPLOADING && (
                      <Progress value={uploadProgress} className="w-32 h-2" />
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Parsed Hosts */}
          {parsedHosts.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileCode className="w-5 h-5" />
                      Servidores Encontrados
                    </CardTitle>
                    <CardDescription>
                      {parsedHosts.length} servidores com portas relevantes • {selectedHosts.size} selecionados
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        <Plug className="w-4 h-4 inline mr-1" />
                        Instância:
                      </Label>
                      <Select value={selectedPluginInstance} onValueChange={setSelectedPluginInstance}>
                        <SelectTrigger className="w-56" data-testid="plugin-instance-select">
                          <SelectValue placeholder="Selecione uma instância..." />
                        </SelectTrigger>
                        <SelectContent>
                          {pluginInstances.map((instance) => (
                            <SelectItem key={instance.id} value={instance.id.toString()}>
                              <div className="flex items-center gap-2">
                                {instance.name}
                                <span className="text-xs text-muted-foreground">({instance.plugin_type})</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-px h-6 bg-border mx-2" />
                    <Button variant="outline" size="sm" onClick={selectAll}>
                      Selecionar Todos
                    </Button>
                    <Button variant="outline" size="sm" onClick={deselectAll}>
                      Desmarcar Todos
                    </Button>
                    <Button
                      onClick={handleImport}
                      disabled={importing || selectedHosts.size === 0 || !selectedPluginInstance}
                      data-testid="import-btn"
                    >
                      {importing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CloudUpload className="w-4 h-4 mr-2" />
                      )}
                      Importar {selectedHosts.size} Servidor{selectedHosts.size !== 1 ? 'es' : ''}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {parsedHosts.map((host) => (
                    <div
                      key={host.ip}
                      className={`flex items-center justify-between px-6 py-3 transition-colors ${
                        selectedHosts.has(host.ip) ? 'bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedHosts.has(host.ip)}
                          onCheckedChange={() => toggleHost(host.ip)}
                          data-testid={`select-host-${host.ip}`}
                        />
                        <div>
                          <div className="font-medium">{host.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">{host.ip}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {renderImportResults(importResults)}
        </TabsContent>

        {/* ======================== */}
        {/* BloodHound Tab */}
        {/* ======================== */}
        <TabsContent value="bloodhound" className="space-y-6">
          {/* Upload Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload BloodHound
              </CardTitle>
              <CardDescription>
                Faça upload de um arquivo JSON de computers do BloodHound ou um ZIP completo (será extraído o JSON com "computers" no nome).
                Apenas computadores com <Badge variant="outline" className="mx-1 text-xs">enabled: true</Badge> serão importados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    ref={bhFileInputRef}
                    type="file"
                    accept=".json,.zip"
                    onChange={handleBhFileUpload}
                    className="max-w-md"
                    data-testid="bh-file-input"
                  />
                  {bhParsedHosts.length > 0 && (
                    <Button variant="outline" onClick={clearBh}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Limpar
                    </Button>
                  )}
                </div>

                {bhStatusInfo && (
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    {bhStatusInfo.icon}
                    <span className="text-sm font-medium">{bhStatusInfo.text}</span>
                    {bhFileName && <span className="text-sm text-muted-foreground">({bhFileName})</span>}
                    {bhUploadStatus === UPLOAD_STEPS.UPLOADING && (
                      <Progress value={bhUploadProgress} className="w-32 h-2" />
                    )}
                  </div>
                )}

                {bhSourceInfo && (
                  <div className="text-sm text-muted-foreground">
                    Arquivo fonte: <span className="font-mono">{bhSourceInfo.file}</span> — {bhSourceInfo.total} computadores no total
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Parsed Hosts */}
          {bhParsedHosts.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5" />
                      Computadores Encontrados
                    </CardTitle>
                    <CardDescription>
                      {bhParsedHosts.length} computadores enabled • {bhSelectedHosts.size} selecionados
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        <Plug className="w-4 h-4 inline mr-1" />
                        Instância:
                      </Label>
                      <Select value={selectedPluginInstance} onValueChange={setSelectedPluginInstance}>
                        <SelectTrigger className="w-56" data-testid="bh-plugin-instance-select">
                          <SelectValue placeholder="Selecione uma instância..." />
                        </SelectTrigger>
                        <SelectContent>
                          {pluginInstances.map((instance) => (
                            <SelectItem key={instance.id} value={instance.id.toString()}>
                              <div className="flex items-center gap-2">
                                {instance.name}
                                <span className="text-xs text-muted-foreground">({instance.plugin_type})</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-px h-6 bg-border mx-2" />
                    <Button variant="outline" size="sm" onClick={bhSelectAll}>
                      Selecionar Todos
                    </Button>
                    <Button variant="outline" size="sm" onClick={bhDeselectAll}>
                      Desmarcar Todos
                    </Button>
                    <Button
                      onClick={handleBhImport}
                      disabled={bhImporting || bhSelectedHosts.size === 0 || !selectedPluginInstance}
                      data-testid="bh-import-btn"
                    >
                      {bhImporting ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CloudUpload className="w-4 h-4 mr-2" />
                      )}
                      Importar {bhSelectedHosts.size} Servidor{bhSelectedHosts.size !== 1 ? 'es' : ''}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {bhParsedHosts.map((host) => (
                    <div
                      key={host.name}
                      className={`flex items-center justify-between px-6 py-3 transition-colors ${
                        bhSelectedHosts.has(host.name) ? 'bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={bhSelectedHosts.has(host.name)}
                          onCheckedChange={() => toggleBhHost(host.name)}
                        />
                        <div>
                          <div className="font-medium">{host.name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {host.os && (
                              <span className="text-xs text-muted-foreground">{host.os}</span>
                            )}
                            {host.domain && (
                              <Badge variant="outline" className="text-xs">{host.domain}</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {renderImportResults(bhImportResults)}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ImportServers;
