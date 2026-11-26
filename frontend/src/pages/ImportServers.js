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
import { Upload, FileCode, Server, Database, Loader2, CheckCircle, AlertCircle, Trash2, FileUp, Search, CloudUpload, Plug, Settings, Shield, List, Globe } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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

const DEFAULT_OTHER_PORTS = {
  3389: 'RDP'
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
  const { t } = useTranslation('import-servers');
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

  // List (TXT) state
  const [listText, setListText] = useState('');
  const [listParsedHosts, setListParsedHosts] = useState([]);
  const [listSelectedHosts, setListSelectedHosts] = useState(new Set());
  const [listImporting, setListImporting] = useState(false);
  const [listImportResults, setListImportResults] = useState(null);
  const [listChecking, setListChecking] = useState(false);
  const listFileInputRef = useRef(null);

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
      const importPorts = settingsRes.data?.import_ports?.value || '445,3389,1433,3306,5432,1521,27017,6379,5984,9200';
      const ports = importPorts.split(',').map(p => parseInt(p.trim())).filter(p => p);
      setConfiguredPorts(ports);
    } catch (error) {
      console.error('Error loading config:', error);
      setConfiguredPorts([DEFAULT_SMB_PORT, ...Object.keys(DEFAULT_OTHER_PORTS).map(p => parseInt(p)), ...Object.keys(DEFAULT_DB_PORTS).map(p => parseInt(p))]);
    } finally {
      setLoadingConfig(false);
    }
  };

  const getPortName = (portNum) => {
    if (portNum === DEFAULT_SMB_PORT) return 'SMB';
    return DEFAULT_DB_PORTS[portNum] || DEFAULT_OTHER_PORTS[portNum] || t('helper.port', { port: portNum });
  };

  // ========================
  // Nmap handlers
  // ========================

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xml')) {
      toast.error(t('toast.selectNmapXml'));
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
      toast.error(t('toast.readError'));
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
        toast.warning(t('toast.noServersWithPorts'));
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
          toast.warning(t('toast.allExist', { count: skippedCount }));
        } else if (skippedCount > 0) {
          toast.success(t('toast.newFound', { count: filtered.length, skipped: skippedCount }));
        } else {
          toast.success(t('toast.found', { count: filtered.length }));
        }
      } catch {
        // Se falhar o check, exibir todos
        setParsedHosts(hosts);
        setSelectedHosts(new Set(hosts.map(h => h.ip)));
        setUploadStatus(UPLOAD_STEPS.READY);
        toast.success(t('toast.found', { count: hosts.length }));
      }
    } catch (error) {
      console.error('Error parsing XML:', error);
      toast.error(t('toast.xmlParseError'));
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
      toast.error(t('toast.selectAtLeastOne'));
      return;
    }

    if (!selectedPluginInstance) {
      toast.error(t('toast.selectPluginInstance'));
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
        toast.success(t('toast.imported', { count: data.imported }));
      }
      if (data.skipped > 0) {
        toast.warning(t('toast.skipped', { count: data.skipped }));
      }
      if (data.failed > 0) {
        toast.error(t('toast.failed', { count: data.failed }));
      }

    } catch (error) {
      console.error('Import error:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.importError', { error: errorMsg }));

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
      toast.error(t('toast.selectBhFile'));
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
        toast.error(t('toast.readError'));
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
          toast.warning(t('toast.noEnabledZip'));
        } else {
          // Filtrar os que já existem
          await filterExistingBhHosts(hosts, data.total_in_file);
        }
      } catch (error) {
        console.error('Error parsing BloodHound ZIP:', error);
        const errorMsg = error.response?.data?.detail || error.message;
        toast.error(t('toast.zipError', { error: errorMsg }));
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
        toast.warning(t('toast.allComputersExist', { count: skippedCount }));
      } else if (skippedCount > 0) {
        toast.success(t('toast.newComputers', { count: filtered.length, skipped: skippedCount, total: totalInFile }));
      } else {
        toast.success(t('toast.computersFound', { count: filtered.length, total: totalInFile }));
      }
    } catch {
      // Se falhar o check, exibir todos
      setBhParsedHosts(hosts);
      setBhSelectedHosts(new Set(hosts.map(h => h.name)));
      setBhUploadStatus(UPLOAD_STEPS.READY);
      toast.success(t('toast.computersFound', { count: hosts.length, total: totalInFile }));
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
        toast.warning(t('toast.noEnabled'));
      } else {
        // Filtrar os que já existem
        await filterExistingBhHosts(hosts, totalInFile);
      }
    } catch (error) {
      console.error('Error parsing BloodHound JSON:', error);
      toast.error(t('toast.bhJsonError'));
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
      toast.error(t('toast.selectAtLeastOne'));
      return;
    }

    if (!selectedPluginInstance) {
      toast.error(t('toast.selectPluginInstance'));
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
        toast.success(t('toast.imported', { count: data.imported }));
      }
      if (data.skipped > 0) {
        toast.warning(t('toast.skipped', { count: data.skipped }));
      }
      if (data.failed > 0) {
        toast.error(t('toast.failed', { count: data.failed }));
      }

    } catch (error) {
      console.error('BloodHound import error:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.importError', { error: errorMsg }));

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
  // List (TXT) handlers
  // ========================

  const isValidIp = (v) => {
    // IPv4 simples
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const m = v.match(ipv4);
    if (!m) return false;
    return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  };

  const isValidHostname = (v) => {
    // hostname/FQDN básico (letras, dígitos, hífen e pontos)
    return /^(?=.{1,253}$)([a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)(\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*$/.test(v);
  };

  const parseServerList = (text) => {
    // Uma entrada por linha; aceita separação por vírgula/; /espaço também
    const rawEntries = text
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));

    const seen = new Set();
    const valid = [];
    const invalid = [];
    for (const entry of rawEntries) {
      const value = entry.toLowerCase();
      if (seen.has(value)) continue;
      seen.add(value);
      const ip = isValidIp(value);
      const host = !ip && isValidHostname(value);
      if (ip || host) {
        valid.push({ value, type: ip ? 'ip' : 'hostname' });
      } else {
        invalid.push(value);
      }
    }
    return { valid, invalid };
  };

  const handleListFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
      toast.error(t('toast.selectTxt'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setListText(String(event.target?.result || ''));
      toast.success(t('toast.fileLoaded', { name: file.name }));
    };
    reader.onerror = () => toast.error(t('toast.readError'));
    reader.readAsText(file);
  };

  const handleListAnalyze = async () => {
    const { valid, invalid } = parseServerList(listText);
    if (valid.length === 0) {
      setListParsedHosts([]);
      setListSelectedHosts(new Set());
      toast.warning(t('toast.noValidEntries'));
      return;
    }
    if (invalid.length > 0) {
      toast.warning(t('toast.invalidIgnored', { count: invalid.length }));
    }

    setListChecking(true);
    try {
      // Filtra os que já existem (por IP ou por nome)
      const values = valid.map((h) => h.value);
      const checkRes = await axios.post(`${API}/v2/servers/check-existing`, {
        ips: values,
        names: values
      });
      const existing = new Set([
        ...(checkRes.data.existing_ips || []),
        ...(checkRes.data.existing_names || [])
      ]);
      const filtered = valid.filter((h) => !existing.has(h.value));
      const skippedCount = valid.length - filtered.length;

      setListParsedHosts(filtered);
      setListSelectedHosts(new Set(filtered.map((h) => h.value)));

      if (filtered.length === 0 && skippedCount > 0) {
        toast.warning(t('toast.allEntriesExist', { count: skippedCount }));
      } else if (skippedCount > 0) {
        toast.success(t('toast.newEntries', { count: filtered.length, skipped: skippedCount }));
      } else {
        toast.success(t('toast.readyToImport', { count: filtered.length }));
      }
    } catch {
      // Se o check falhar, exibe todos
      setListParsedHosts(valid);
      setListSelectedHosts(new Set(valid.map((h) => h.value)));
      toast.success(t('toast.readyToImport', { count: valid.length }));
    } finally {
      setListChecking(false);
    }
  };

  const toggleListHost = (value) => {
    const newSelected = new Set(listSelectedHosts);
    if (newSelected.has(value)) newSelected.delete(value);
    else newSelected.add(value);
    setListSelectedHosts(newSelected);
  };

  const listSelectAll = () => setListSelectedHosts(new Set(listParsedHosts.map((h) => h.value)));
  const listDeselectAll = () => setListSelectedHosts(new Set());

  const handleListImport = async () => {
    if (listSelectedHosts.size === 0) {
      toast.error(t('toast.selectAtLeastOne'));
      return;
    }
    if (!selectedPluginInstance) {
      toast.error(t('toast.selectPluginInstance'));
      return;
    }

    setListImporting(true);
    setListImportResults(null);

    const hostsToImport = listParsedHosts.filter((h) => listSelectedHosts.has(h.value));

    try {
      const response = await axios.post(`${API}/v2/servers/import/list`, {
        hosts: hostsToImport.map((h) => ({
          value: h.value,
          plugin_instance_id: parseInt(selectedPluginInstance)
        }))
      });

      const data = response.data;
      const results = {
        success: data.details.filter((d) => d.id !== undefined),
        failed: data.details.filter((d) => d.error !== undefined),
        skipped: data.details.filter((d) => d.reason !== undefined)
      };
      setListImportResults(results);

      if (data.imported > 0) toast.success(t('toast.imported', { count: data.imported }));
      if (data.skipped > 0) toast.warning(t('toast.skipped', { count: data.skipped }));
      if (data.failed > 0) toast.error(t('toast.failed', { count: data.failed }));

      // Remove da lista os que foram importados/ignorados
      const done = new Set([
        ...results.success.map((d) => d.ip),
        ...results.skipped.map((d) => d.ip)
      ]);
      setListParsedHosts((prev) => prev.filter((h) => !done.has(h.value)));
      setListSelectedHosts(new Set());
    } catch (error) {
      console.error('List import error:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error(t('toast.importError', { error: errorMsg }));
      setListImportResults({
        success: [],
        failed: hostsToImport.map((h) => ({ name: h.value, ip: h.value, error: errorMsg })),
        skipped: []
      });
    }

    setListImporting(false);
  };

  const clearList = () => {
    setListText('');
    setListParsedHosts([]);
    setListSelectedHosts(new Set());
    setListImportResults(null);
    if (listFileInputRef.current) listFileInputRef.current.value = '';
  };

  // ========================
  // Shared UI helpers
  // ========================

  const getStatusMessage = (status, fName) => {
    switch (status) {
      case UPLOAD_STEPS.UPLOADING:
        return { icon: <FileUp className="w-4 h-4 animate-bounce" />, text: t('status.uploading') };
      case UPLOAD_STEPS.PARSING:
        return { icon: <Search className="w-4 h-4 animate-pulse" />, text: t('status.parsing') };
      case UPLOAD_STEPS.READY:
        return { icon: <CheckCircle className="w-4 h-4 text-green-500" />, text: t('status.ready') };
      default:
        return null;
    }
  };

  const renderImportResults = (results) => {
    if (!results) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('results.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {results.success.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle className="w-4 h-4" />
                <span className="font-medium">{t('results.success', { count: results.success.length })}</span>
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
                <span className="font-medium">{t('results.skipped', { count: results.skipped.length })}</span>
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
                <span className="font-medium">{t('results.failed', { count: results.failed.length })}</span>
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
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
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
          <TabsTrigger value="list" className="flex items-center gap-2">
            <List className="w-4 h-4" />
            {t('tabs.list')}
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
                {t('nmap.uploadTitle')}
              </CardTitle>
              <CardDescription>
                {t('nmap.uploadDescPrefix')}{' '}
                <Link to="/settings" className="text-primary hover:underline inline-flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  {t('nmap.configuredPorts')}
                </Link>
                {' '}{t('nmap.uploadDescSuffix')}
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
                      {t('common:actions.clear')}
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
                      {t('nmap.foundTitle')}
                    </CardTitle>
                    <CardDescription>
                      {t('nmap.foundDesc', { count: parsedHosts.length, selected: selectedHosts.size })}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        <Plug className="w-4 h-4 inline mr-1" />
                        {t('shared.instanceLabel')}
                      </Label>
                      <Select value={selectedPluginInstance} onValueChange={setSelectedPluginInstance}>
                        <SelectTrigger className="w-56" data-testid="plugin-instance-select">
                          <SelectValue placeholder={t('shared.instancePlaceholder')} />
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
                      {t('shared.selectAll')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={deselectAll}>
                      {t('shared.deselectAll')}
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
                      {t('shared.importCount', { count: selectedHosts.size })}
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
                {t('bh.uploadTitle')}
              </CardTitle>
              <CardDescription>
                {t('bh.uploadDescPrefix')} <Badge variant="outline" className="mx-1 text-xs">enabled: true</Badge> {t('bh.uploadDescSuffix')}
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
                      {t('common:actions.clear')}
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
                    {t('bh.sourcePrefix')} <span className="font-mono">{bhSourceInfo.file}</span> {t('bh.sourceSuffix', { total: bhSourceInfo.total })}
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
                      {t('bh.foundTitle')}
                    </CardTitle>
                    <CardDescription>
                      {t('bh.foundDesc', { count: bhParsedHosts.length, selected: bhSelectedHosts.size })}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        <Plug className="w-4 h-4 inline mr-1" />
                        {t('shared.instanceLabel')}
                      </Label>
                      <Select value={selectedPluginInstance} onValueChange={setSelectedPluginInstance}>
                        <SelectTrigger className="w-56" data-testid="bh-plugin-instance-select">
                          <SelectValue placeholder={t('shared.instancePlaceholder')} />
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
                      {t('shared.selectAll')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={bhDeselectAll}>
                      {t('shared.deselectAll')}
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
                      {t('shared.importCount', { count: bhSelectedHosts.size })}
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

        {/* ======================== */}
        {/* List (TXT) Tab */}
        {/* ======================== */}
        <TabsContent value="list" className="space-y-6">
          {/* Input Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="w-5 h-5" />
                {t('list.title')}
              </CardTitle>
              <CardDescription>
                {t('list.descPrefix')} <span className="font-mono">.txt</span> {t('list.descMiddle')}{' '}
                <span className="font-mono">#</span> {t('list.descSuffix')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Input
                    ref={listFileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleListFileUpload}
                    className="max-w-md"
                    data-testid="list-file-input"
                  />
                  {(listText || listParsedHosts.length > 0) && (
                    <Button variant="outline" onClick={clearList}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      {t('common:actions.clear')}
                    </Button>
                  )}
                </div>

                <Textarea
                  value={listText}
                  onChange={(e) => setListText(e.target.value)}
                  placeholder={'10.0.0.10\nfileserver01.empresa.local\n10.0.0.11\ndc01.empresa.local'}
                  className="font-mono text-sm min-h-[160px]"
                  data-testid="list-textarea"
                />

                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleListAnalyze}
                    disabled={!listText.trim() || listChecking}
                    data-testid="list-analyze-btn"
                  >
                    {listChecking ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4 mr-2" />
                    )}
                    {t('list.analyze')}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t('list.analyzeHint')}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Parsed Hosts */}
          {listParsedHosts.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="w-5 h-5" />
                      {t('list.foundTitle')}
                    </CardTitle>
                    <CardDescription>
                      {t('list.foundDesc', { count: listParsedHosts.length, selected: listSelectedHosts.size })}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">
                        <Plug className="w-4 h-4 inline mr-1" />
                        {t('shared.instanceLabel')}
                      </Label>
                      <Select value={selectedPluginInstance} onValueChange={setSelectedPluginInstance}>
                        <SelectTrigger className="w-56" data-testid="list-plugin-instance-select">
                          <SelectValue placeholder={t('shared.instancePlaceholder')} />
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
                    <Button variant="outline" size="sm" onClick={listSelectAll}>
                      {t('shared.selectAll')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={listDeselectAll}>
                      {t('shared.deselectAll')}
                    </Button>
                    <Button
                      onClick={handleListImport}
                      disabled={listImporting || listSelectedHosts.size === 0 || !selectedPluginInstance}
                      data-testid="list-import-btn"
                    >
                      {listImporting ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CloudUpload className="w-4 h-4 mr-2" />
                      )}
                      {t('shared.importCount', { count: listSelectedHosts.size })}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {listParsedHosts.map((host) => (
                    <div
                      key={host.value}
                      className={`flex items-center justify-between px-6 py-3 transition-colors ${
                        listSelectedHosts.has(host.value) ? 'bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={listSelectedHosts.has(host.value)}
                          onCheckedChange={() => toggleListHost(host.value)}
                          data-testid={`select-list-host-${host.value}`}
                        />
                        <div className="flex items-center gap-2">
                          {host.type === 'ip' ? (
                            <Server className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <Globe className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className="font-medium font-mono">{host.value}</span>
                          <Badge variant="outline" className="text-xs">
                            {host.type === 'ip' ? 'IP' : 'DNS'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {renderImportResults(listImportResults)}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ImportServers;
