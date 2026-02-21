import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Lock, Search, FileWarning, Clock } from 'lucide-react';

const Leaks = () => {
  return (
    <div className="space-y-6" data-testid="leaks-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leaks</h1>
        <p className="text-muted-foreground mt-2">Detecção e análise de vazamentos de dados sensíveis</p>
      </div>

      {/* Coming Soon Card */}
      <Card className="border-dashed">
        <CardContent className="py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-yellow-500" />
          </div>
          
          <h2 className="text-2xl font-bold mb-2">Em Desenvolvimento</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            Esta funcionalidade está sendo desenvolvida e estará disponível em breve.
          </p>
          
          <Badge variant="outline" className="gap-2">
            <Clock className="w-3 h-3" />
            Coming Soon
          </Badge>
        </CardContent>
      </Card>

      {/* Feature Preview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="w-4 h-4 text-primary" />
              Busca de Padrões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Detecção automática de padrões sensíveis como CPF, cartões de crédito, senhas e credenciais em arquivos.
            </p>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileWarning className="w-4 h-4 text-orange-500" />
              Análise de Arquivos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Varredura de documentos, planilhas e arquivos de texto em busca de dados confidenciais expostos.
            </p>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="w-4 h-4 text-green-500" />
              Relatórios de Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Geração de relatórios de conformidade com LGPD, GDPR e outras regulamentações de privacidade.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Leaks;
