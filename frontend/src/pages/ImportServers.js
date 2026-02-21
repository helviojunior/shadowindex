import { useState, useRef } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, FileCode, Server, Database, Loader2, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Known database ports
const DB_PORTS = {
  1433: 'MSSQL',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  1521: 'Oracle',
  27017: 'MongoDB',
  6379: 'Redis',
  5984: 'CouchDB',
  9200: 'Elasticsearch'
};

const SMB_PORT = 445;

const ImportServers = () => {
  const [xmlContent, setXmlContent] = useState('');
  const [parsedHosts, setParsedHosts] = useState([]);
  const [selectedHosts, setSelectedHosts] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xml')) {
      toast.error('Por favor, selecione um arquivo XML do nmap');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      setXmlContent(content);
      parseNmapXml(content);
    };
    reader.readAsText(file);
  };

  const parseNmapXml = (xml) => {
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
        let hasSMB = false;
        let hasDB = false;
        const dbTypes = [];

        ports.forEach((port) => {
          const state = port.querySelector('state');
          if (state?.getAttribute('state') !== 'open') return;
          
          const portId = parseInt(port.getAttribute('portid'));
          const service = port.querySelector('service');
          const serviceName = service?.getAttribute('name') || 'unknown';
          
          openPorts.push({ port: portId, service: serviceName });
          
          if (portId === SMB_PORT) {
            hasSMB = true;
          }
          
          if (DB_PORTS[portId]) {
            hasDB = true;
            dbTypes.push(DB_PORTS[portId]);
          }
        });

        // Only include hosts with SMB or DB ports
        if (hasSMB || hasDB) {
          hosts.push({
            ip,
            name,
            hasSMB,
            hasDB,
            dbTypes,
            openPorts: openPorts.filter(p => p.port === SMB_PORT || DB_PORTS[p.port])
          });
        }
      });

      setParsedHosts(hosts);
      setSelectedHosts(new Set(hosts.map(h => h.ip)));
      
      if (hosts.length === 0) {
        toast.warning('Nenhum servidor com porta SMB (445) ou banco de dados encontrado');
      } else {
        toast.success(`${hosts.length} servidores encontrados`);
      }
    } catch (error) {
      console.error('Error parsing XML:', error);
      toast.error('Erro ao processar arquivo XML');
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

    setImporting(true);
    setImportResults(null);

    const hostsToImport = parsedHosts.filter(h => selectedHosts.has(h.ip));
    
    try {
      // Usar o novo endpoint de importação em lote
      const response = await axios.post(`${API}/v2/servers/import/nmap`, {
        hosts: hostsToImport.map(h => ({
          ip: h.ip,
          name: h.name,
          hasSMB: h.hasSMB,
          hasDB: h.hasDB,
          dbTypes: h.dbTypes
        }))
      });
      
      const data = response.data;
      
      // Mapear resposta para formato esperado pela UI
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
      
      // Fallback: mostrar todos como falha
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6" data-testid="import-servers-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Importar Servidores</h1>
        <p className="text-muted-foreground mt-2">Importe servidores a partir de um scan XML do nmap</p>
      </div>

      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload XML do Nmap
          </CardTitle>
          <CardDescription>
            Faça upload de um arquivo XML gerado pelo nmap para importar servidores com porta SMB (445) ou portas de banco de dados abertas
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
            
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="gap-1">
                <Server className="w-3 h-3" />
                SMB: Porta 445
              </Badge>
              {Object.entries(DB_PORTS).map(([port, name]) => (
                <Badge key={port} variant="outline" className="gap-1">
                  <Database className="w-3 h-3" />
                  {name}: {port}
                </Badge>
              ))}
            </div>
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
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Selecionar Todos
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Desmarcar Todos
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-2">
                {parsedHosts.map((host) => (
                  <div
                    key={host.ip}
                    className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                      selectedHosts.has(host.ip) ? 'bg-primary/5 border-primary/30' : 'border-border hover:bg-muted/50'
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
                    <div className="flex items-center gap-2">
                      {host.hasSMB && (
                        <Badge variant="default" className="gap-1 bg-blue-600">
                          <Server className="w-3 h-3" />
                          SMB
                        </Badge>
                      )}
                      {host.dbTypes.map((db) => (
                        <Badge key={db} variant="secondary" className="gap-1">
                          <Database className="w-3 h-3" />
                          {db}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="mt-4 pt-4 border-t">
              <Button 
                onClick={handleImport} 
                disabled={importing || selectedHosts.size === 0}
                data-testid="import-btn"
              >
                {importing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Importar {selectedHosts.size} Servidor{selectedHosts.size !== 1 ? 'es' : ''}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Os servidores serão importados com o plugin "Interação Direta" como padrão
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Results */}
      {importResults && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado da Importação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {importResults.success.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-green-500 mb-2">
                  <CheckCircle className="w-4 h-4" />
                  <span className="font-medium">{importResults.success.length} importados com sucesso</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {importResults.success.map((host) => (
                    <div key={host.ip} className="text-sm p-2 bg-green-500/10 rounded border border-green-500/30">
                      <div className="font-medium truncate">{host.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{host.ip}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {importResults.failed.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-red-500 mb-2">
                  <AlertCircle className="w-4 h-4" />
                  <span className="font-medium">{importResults.failed.length} falharam</span>
                </div>
                <div className="space-y-2">
                  {importResults.failed.map((host) => (
                    <div key={host.ip} className="text-sm p-2 bg-red-500/10 rounded border border-red-500/30">
                      <div className="font-medium">{host.name} ({host.ip})</div>
                      <div className="text-xs text-red-400">{host.error}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ImportServers;
