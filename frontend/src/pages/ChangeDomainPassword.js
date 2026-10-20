import { useState } from 'react';
import axios from 'axios';
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const ChangeDomainPassword = () => {
  const [form, setForm] = useState({
    domain: '',
    username: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
    target: ''
  });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(false);

  const handleChange = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const toggle = (key) => setShow(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.username.trim()) return toast.error('Informe o usuário');
    if (!form.current_password) return toast.error('Informe a senha atual');
    if (!form.new_password) return toast.error('Informe a nova senha');
    if (form.new_password !== form.confirm_password) {
      return toast.error('A confirmação da nova senha não confere');
    }
    if (form.new_password === form.current_password) {
      return toast.error('A nova senha deve ser diferente da atual');
    }

    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/tools/change-domain-password`, {
        domain: form.domain || null,
        username: form.username,
        current_password: form.current_password,
        new_password: form.new_password,
        target: form.target || null
      });
      toast.success(data.message || 'Senha alterada com sucesso', { duration: 6000 });
      setForm({ domain: '', username: '', current_password: '', new_password: '', confirm_password: '', target: '' });
    } catch (error) {
      console.error('Error changing domain password:', error);
      const detail = error.response?.data?.detail;
      const msg = typeof detail === 'object' ? detail?.message : detail;
      toast.error(msg || 'Falha ao trocar a senha', {
        duration: 7000,
        description: error.response?.status === 503
          ? 'Verifique se o domínio/DC informado está acessível na rede.'
          : undefined
      });
    } finally {
      setLoading(false);
    }
  };

  // Campo de senha com botão mostrar/ocultar (renderizado inline para não perder foco)
  const renderPwd = (id, label, field, showKey, placeholder) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show[showKey] ? 'text' : 'password'}
          placeholder={placeholder}
          value={form[field]}
          onChange={(e) => handleChange(field, e.target.value)}
          className="pr-10"
          data-testid={`${id}-input`}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => toggle(showKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {show[showKey] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="change-domain-password-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="w-7 h-7 text-emerald-500" />
          Trocar senha de domínio
        </h1>
        <p className="text-muted-foreground mt-2">
          Altera a senha de uma conta do Active Directory conhecendo a senha atual. Funciona inclusive
          quando a conta exige troca de senha no próximo logon.
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <CardTitle>Dados da conta</CardTitle>
          </div>
          <CardDescription>
            Informe o domínio, o usuário e as senhas. O alvo pode ser o próprio domínio (que normalmente
            resolve para um controlador de domínio) ou um DC específico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="domain">Domínio</Label>
                <Input
                  id="domain"
                  placeholder="EMPRESA ou empresa.local"
                  value={form.domain}
                  onChange={(e) => handleChange('domain', e.target.value)}
                  data-testid="domain-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Usuário *</Label>
                <Input
                  id="username"
                  placeholder="usuario (ou DOMINIO\\usuario)"
                  value={form.username}
                  onChange={(e) => handleChange('username', e.target.value)}
                  required
                  data-testid="username-input"
                />
              </div>
            </div>

            {renderPwd('current-password', 'Senha atual *', 'current_password', 'current', 'Senha atual da conta')}

            <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border">
              {renderPwd('new-password', 'Nova senha *', 'new_password', 'next', 'Nova senha')}
              {renderPwd('confirm-password', 'Confirmar nova senha *', 'confirm_password', 'confirm', 'Repita a nova senha')}
            </div>

            <div className="space-y-2">
              <Label htmlFor="target" className="flex items-center gap-2">
                <Server className="w-4 h-4 text-muted-foreground" />
                Controlador de domínio / alvo (opcional)
              </Label>
              <Input
                id="target"
                placeholder="IP ou hostname do DC (vazio = usar o domínio)"
                value={form.target}
                onChange={(e) => handleChange('target', e.target.value)}
                data-testid="target-input"
              />
              <p className="text-xs text-muted-foreground">
                Se deixar vazio, o domínio informado será usado como alvo.
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
              <span className="text-yellow-500">⚠</span>
              <span>A nova senha deve atender à política do domínio (tamanho, complexidade e histórico).</span>
            </div>

            <Button type="submit" disabled={loading} data-testid="change-password-btn">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              {loading ? 'Alterando...' : 'Alterar senha'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ChangeDomainPassword;
