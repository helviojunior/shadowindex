import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  AlertTriangle, 
  Lock, 
  Search, 
  FileWarning, 
  Trash2,
  RefreshCw,
  File,
  Key,
  Eye,
  Copy,
  CheckCircle,
  Filter
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api/v2`;

const Leaks = () => {
  const [findings, setFindings] = useState([]);
  const [files, setFiles] = useState([]);
  const [totalFindings, setTotalFindings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [copied, setCopied] = useState(false);

  // Carregar findings
  const loadFindings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/gitleaks/findings`);
      setFindings(response.data.findings || []);
      setFiles(response.data.files || []);
      setTotalFindings(response.data.total_findings || 0);
    } catch (error) {
      console.error('Error loading findings:', error);
      toast.error('Erro ao carregar findings');
    } finally {
      setLoading(false);
    }
  }, []);

  // Recarregar do disco
  const handleReload = async () => {
    try {
      await axios.post(`${API}/gitleaks/findings/reload`);
      toast.success('Findings recarregados do disco');
      loadFindings();
    } catch (error) {
      toast.error('Erro ao recarregar');
    }
  };

  // Limpar todos
  const handleClear = async () => {
    if (!confirm('Tem certeza que deseja limpar todos os findings?')) return;
    
    try {
      const response = await axios.delete(`${API}/gitleaks/findings`);
      toast.success(`${response.data.cleared} findings removidos`);
      loadFindings();
    } catch (error) {
      toast.error('Erro ao limpar findings');
    }
  };

  // Copiar para clipboard
  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Copiado!');
  };

  useEffect(() => {
    loadFindings();
  }, [loadFindings]);

  // Filtrar arquivos por termo de busca
  const filteredFiles = files.filter(file => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      file.file.toLowerCase().includes(term) ||
      file.findings.some(f => 
        f.RuleID?.toLowerCase().includes(term) ||
        f.Description?.toLowerCase().includes(term) ||
        f.Secret?.toLowerCase().includes(term)
      )
    );
  });

  // Badge de severidade baseado na regra
  const getSeverityBadge = (ruleId) => {
    const highSeverity = ['aws-access-key', 'github-pat', 'private-key', 'jwt'];
    const mediumSeverity = ['generic-api-key', 'password', 'token'];
    
    if (highSeverity.some(s => ruleId?.toLowerCase().includes(s))) {
      return <Badge variant="destructive">Alta</Badge>;
    }
    if (mediumSeverity.some(s => ruleId?.toLowerCase().includes(s))) {
      return <Badge className="bg-orange-600">Média</Badge>;
    }
    return <Badge variant="outline">Baixa</Badge>;
  };

  // Se não há findings, mostrar placeholder
  if (!loading && totalFindings === 0) {
    return (
      <div className="space-y-6" data-testid="leaks-page">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leaks</h1>
          <p className="text-muted-foreground mt-2">Resultados de detecção de vazamentos (GitLeaks)</p>
        </div>

        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
              <Search className="w-10 h-10 text-muted-foreground" />
            </div>
            
            <h2 className="text-2xl font-bold mb-2">Nenhum Leak Detectado</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              Execute um scan do GitLeaks em Tools → GitLeaks para detectar secrets e credenciais em arquivos.
            </p>
            
            <div className="flex justify-center gap-4">
              <Button onClick={() => window.location.href = '/tools/gitleaks'}>
                <Search className="w-4 h-4 mr-2" />
                Ir para GitLeaks
              </Button>
              <Button variant="outline" onClick={handleReload}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Recarregar do Disco
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Feature Preview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="opacity-80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="w-4 h-4 text-red-500" />
                Secrets & API Keys
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Detecção de chaves de API, tokens, secrets e credenciais expostas em arquivos.
              </p>
            </CardContent>
          </Card>

          <Card className="opacity-80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileWarning className="w-4 h-4 text-orange-500" />
                Análise de Arquivos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Varredura de código-fonte, configurações e documentos em busca de dados sensíveis.
              </p>
            </CardContent>
          </Card>

          <Card className="opacity-80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="w-4 h-4 text-green-500" />
                Regras Customizadas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Configuração personalizada do GitLeaks para detecção específica do ShadowIndex.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="leaks-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leaks</h1>
          <p className="text-muted-foreground mt-2">
            {totalFindings} vazamentos detectados em {files.length} arquivos
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadFindings}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
          <Button variant="outline" onClick={handleReload}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Recarregar Disco
          </Button>
          {totalFindings > 0 && (
            <Button variant="destructive" onClick={handleClear}>
              <Trash2 className="w-4 h-4 mr-2" />
              Limpar Todos
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total de Leaks</p>
                <p className="text-2xl font-bold">{totalFindings}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Arquivos Afetados</p>
                <p className="text-2xl font-bold">{files.length}</p>
              </div>
              <File className="w-8 h-8 text-orange-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tipos de Secrets</p>
                <p className="text-2xl font-bold">
                  {new Set(findings.map(f => f.RuleID)).size}
                </p>
              </div>
              <Key className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Alta Severidade</p>
                <p className="text-2xl font-bold text-red-500">
                  {findings.filter(f => 
                    ['aws', 'private-key', 'github', 'jwt'].some(s => 
                      f.RuleID?.toLowerCase().includes(s)
                    )
                  ).length}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por arquivo, regra ou conteúdo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="search-input"
              />
            </div>
            <Badge variant="outline" className="gap-1">
              <Filter className="w-3 h-3" />
              {filteredFiles.length} arquivos
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Findings List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="w-5 h-5 text-orange-500" />
            Findings por Arquivo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Accordion type="multiple" className="space-y-2">
                {filteredFiles.map((file, index) => (
                  <AccordionItem 
                    key={index} 
                    value={`file-${index}`}
                    className="border rounded-lg px-4"
                  >
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 text-left">
                        <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-mono text-sm truncate max-w-lg">
                            {file.file}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {file.count} finding(s)
                          </p>
                        </div>
                        <Badge variant="destructive" className="ml-auto flex-shrink-0">
                          {file.count}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        {file.findings.map((finding, fIndex) => (
                          <div 
                            key={fIndex}
                            className="p-3 bg-muted/50 rounded-lg border"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-2 flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="font-mono text-xs">
                                    {finding.RuleID}
                                  </Badge>
                                  {getSeverityBadge(finding.RuleID)}
                                  {finding.StartLine && (
                                    <span className="text-xs text-muted-foreground">
                                      Linha {finding.StartLine}
                                    </span>
                                  )}
                                </div>
                                
                                {finding.Description && (
                                  <p className="text-sm text-muted-foreground">
                                    {finding.Description}
                                  </p>
                                )}
                                
                                {finding.Secret && (
                                  <div className="flex items-center gap-2">
                                    <code className="text-xs bg-red-500/10 px-2 py-1 rounded border border-red-500/30 font-mono truncate max-w-md">
                                      {finding.Secret.length > 60 
                                        ? finding.Secret.substring(0, 60) + '...' 
                                        : finding.Secret}
                                    </code>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleCopy(finding.Secret)}
                                    >
                                      {copied ? (
                                        <CheckCircle className="w-4 h-4 text-green-500" />
                                      ) : (
                                        <Copy className="w-4 h-4" />
                                      )}
                                    </Button>
                                  </div>
                                )}
                              </div>
                              
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedFinding(finding)}
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                Detalhes
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Finding Detail Modal */}
      <Dialog open={!!selectedFinding} onOpenChange={() => setSelectedFinding(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Detalhes do Finding
            </DialogTitle>
            <DialogDescription>
              {selectedFinding?.RuleID}
            </DialogDescription>
          </DialogHeader>
          
          {selectedFinding && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Regra</Label>
                  <p className="font-mono">{selectedFinding.RuleID}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Linha</Label>
                  <p className="font-mono">
                    {selectedFinding.StartLine || 'N/A'}
                    {selectedFinding.EndLine && selectedFinding.EndLine !== selectedFinding.StartLine 
                      ? ` - ${selectedFinding.EndLine}` 
                      : ''}
                  </p>
                </div>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground">Arquivo</Label>
                <p className="font-mono text-sm break-all">{selectedFinding.File}</p>
              </div>
              
              {selectedFinding.Description && (
                <div>
                  <Label className="text-xs text-muted-foreground">Descrição</Label>
                  <p className="text-sm">{selectedFinding.Description}</p>
                </div>
              )}
              
              {selectedFinding.Secret && (
                <div>
                  <Label className="text-xs text-muted-foreground">Secret Detectado</Label>
                  <div className="flex items-start gap-2">
                    <code className="flex-1 text-xs bg-red-500/10 p-3 rounded border border-red-500/30 font-mono break-all">
                      {selectedFinding.Secret}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(selectedFinding.Secret)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              
              {selectedFinding.Match && (
                <div>
                  <Label className="text-xs text-muted-foreground">Match</Label>
                  <code className="block text-xs bg-muted p-3 rounded font-mono break-all">
                    {selectedFinding.Match}
                  </code>
                </div>
              )}
              
              {selectedFinding.Fingerprint && (
                <div>
                  <Label className="text-xs text-muted-foreground">Fingerprint</Label>
                  <code className="block text-xs text-muted-foreground font-mono">
                    {selectedFinding.Fingerprint}
                  </code>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Componente auxiliar para labels
const Label = ({ children, className }) => (
  <p className={`text-xs font-medium mb-1 ${className || ''}`}>{children}</p>
);

export default Leaks;
