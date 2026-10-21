import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Network, Plus, ChevronUp, Trash2, FolderTree, Upload, Loader2, CheckCircle, XCircle, Server, Hash } from 'lucide-react';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const STATUS_META = {
  pending: { label: 'Na fila', cls: 'text-muted-foreground', icon: Loader2 },
  running: { label: 'Importando', cls: 'text-blue-400', icon: Loader2 },
  completed: { label: 'Concluído', cls: 'text-green-500', icon: CheckCircle },
  failed: { label: 'Falhou', cls: 'text-red-500', icon: XCircle },
  cancelled: { label: 'Cancelado', cls: 'text-amber-500', icon: XCircle },
};

const AdDomains = () => {
  const navigate = useNavigate();
  const [domains, setDomains] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputs = useRef({});

  const loadDomains = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/ad/domains`);
      setDomains(data);
    } catch (e) {
      console.error('Error loading AD domains:', e);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/ad/jobs`);
      setJobs(data);
    } catch (e) {
      // silencioso
    }
  }, []);

  useEffect(() => {
    loadDomains();
    loadJobs();
  }, [loadDomains, loadJobs]);

  // Auto-refresh enquanto houver job ativo
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'pending');
    if (!hasActive) return;
    const t = setInterval(() => {
      loadJobs();
      loadDomains();
    }, 2500);
    return () => clearInterval(t);
  }, [jobs, loadJobs, loadDomains]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newDomain.trim()) return toast.error('Informe o domínio (FQDN)');
    setCreating(true);
    try {
      await axios.post(`${API}/ad/domains`, { name: newDomain.trim() });
      toast.success('Domínio criado');
      setNewDomain('');
      setShowAddForm(false);
      loadDomains();
    } catch (error) {
      const msg = error.response?.data?.detail || 'Erro ao criar domínio';
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover este domínio e toda a árvore importada?')) return;
    try {
      await axios.delete(`${API}/ad/domains/${id}`);
      toast.success('Domínio removido');
      loadDomains();
      loadJobs();
    } catch {
      toast.error('Erro ao remover domínio');
    }
  };

  const handleUpload = async (domainId, files) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    setUploadingId(domainId);
    try {
      await axios.post(`${API}/ad/domains/${domainId}/import`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Upload concluído — importação iniciada em background');
      loadJobs();
    } catch (error) {
      const msg = error.response?.data?.detail || error.message;
      toast.error(`Falha no upload: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    } finally {
      setUploadingId(null);
      if (fileInputs.current[domainId]) fileInputs.current[domainId].value = '';
    }
  };

  const jobsFor = (domainId) => jobs.filter((j) => j.domain_id === domainId);

  return (
    <div className="space-y-6" data-testid="ad-domains-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Network className="w-7 h-7 text-indigo-400" />
            AD Explorer
          </h1>
          <p className="text-muted-foreground mt-2">
            Explore a árvore do Active Directory por domínio. Importe dados do BloodHound (v6)
            para montar e navegar a árvore completa.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'default'} data-testid="toggle-add-domain">
          {showAddForm ? <><ChevronUp className="w-4 h-4 mr-2" />Fechar</> : <><Plus className="w-4 h-4 mr-2" />Novo Domínio</>}
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Novo domínio</CardTitle>
            <CardDescription>Informe o FQDN do domínio (ex.: empresa.local). A base do AD Explorer é o domínio, não um servidor.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex items-end gap-3">
              <div className="space-y-2 flex-1 max-w-md">
                <Label htmlFor="domain-name">Domínio (FQDN) *</Label>
                <Input id="domain-name" placeholder="empresa.local" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} data-testid="ad-domain-input" />
              </div>
              <Button type="submit" disabled={creating} data-testid="create-domain-btn">
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Criar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {domains.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhum domínio cadastrado. Crie um e importe os arquivos do BloodHound.</CardContent></Card>
        )}
        {domains.map((dom) => {
          const domJobs = jobsFor(dom.id);
          const activeJob = domJobs.find((j) => j.status === 'running' || j.status === 'pending');
          return (
            <Card key={dom.id} data-testid={`ad-domain-${dom.id}`}>
              <CardContent className="py-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Network className="w-5 h-5 text-indigo-400" />
                      <span className="text-lg font-semibold">{dom.name}</span>
                      {dom.domain_sid && <Badge variant="outline" className="gap-1 font-mono text-xs"><Hash className="w-3 h-3" />{dom.domain_sid}</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Server className="w-3.5 h-3.5" />{dom.object_count?.toLocaleString() || 0} objetos</span>
                      {dom.last_scan_at && <span>Última importação: {new Date(dom.last_scan_at).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => navigate(`/ad/${dom.id}/browse`)} disabled={!dom.object_count} data-testid={`explore-${dom.id}`}>
                      <FolderTree className="w-4 h-4 mr-2" />Explorar
                    </Button>
                    <input
                      ref={(el) => (fileInputs.current[dom.id] = el)}
                      type="file"
                      multiple
                      accept=".json,.zip"
                      className="hidden"
                      onChange={(e) => handleUpload(dom.id, e.target.files)}
                    />
                    <Button variant="outline" disabled={uploadingId === dom.id || !!activeJob} onClick={() => fileInputs.current[dom.id]?.click()} data-testid={`import-${dom.id}`}>
                      {uploadingId === dom.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                      Importar BloodHound
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(dom.id)} data-testid={`delete-domain-${dom.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Jobs de importação */}
                {domJobs.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-border pt-4">
                    {domJobs.slice(0, 3).map((job) => {
                      const meta = STATUS_META[job.status] || STATUS_META.pending;
                      const Icon = meta.icon;
                      const spinning = job.status === 'running' || job.status === 'pending';
                      return (
                        <div key={job.id} className="text-sm">
                          <div className="flex items-center justify-between">
                            <span className={`flex items-center gap-2 ${meta.cls}`}>
                              <Icon className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} />
                              {meta.label}
                              {job.current_step && <span className="text-muted-foreground">— {job.current_step}</span>}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs">
                              {job.processed_objects?.toLocaleString() || 0} objetos
                            </span>
                          </div>
                          {spinning && <Progress value={job.processed_objects > 0 ? 100 : 10} className="h-1.5 mt-1 animate-pulse" />}
                          {job.status === 'failed' && job.error_message && (
                            <div className="text-xs text-red-400 mt-1 truncate">{job.error_message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdDomains;
