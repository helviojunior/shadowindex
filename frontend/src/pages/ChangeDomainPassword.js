import { useState } from 'react';
import axios from 'axios';
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck, Server, Hash, Fingerprint, Key, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

// Métodos para informar a "senha atual"
const AUTH_METHODS = [
  { key: 'password', label: 'Senha', icon: Key },
  { key: 'ntlm', label: 'Hash NTLM', icon: Hash },
  { key: 'ccache', label: 'Ticket Kerberos (ccache)', icon: Fingerprint },
];

const ChangeDomainPassword = () => {
  const [form, setForm] = useState({
    domain: '',
    username: '',
    current_password: '',
    ntlm_hash: '',
    ccache: '',
    kdc_host: '',
    new_password: '',
    confirm_password: '',
    target: ''
  });
  const [authMethod, setAuthMethod] = useState('password');
  const [ccacheFileName, setCcacheFileName] = useState('');
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(false);

  const handleChange = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const toggle = (key) => setShow(prev => ({ ...prev, [key]: !prev[key] }));

  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop());
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleCcacheFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsBase64(file);
      handleChange('ccache', base64);
      setCcacheFileName(file.name);
    } catch (err) {
      console.error('Error reading ccache file:', err);
      toast.error('Não foi possível ler o arquivo ccache');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Kerberos pode derivar o usuário do próprio ccache
    if (!form.username.trim() && authMethod !== 'ccache') return toast.error('Informe o usuário');
    if (authMethod === 'password' && !form.current_password) return toast.error('Informe a senha atual');
    if (authMethod === 'ntlm' && !form.ntlm_hash.trim()) return toast.error('Informe o hash NTLM atual');
    if (authMethod === 'ccache' && !form.ccache) return toast.error('Selecione o arquivo ccache');
    if (!form.new_password) return toast.error('Informe a nova senha');
    if (form.new_password !== form.confirm_password) {
      return toast.error('A confirmação da nova senha não confere');
    }
    if (authMethod === 'password' && form.new_password === form.current_password) {
      return toast.error('A nova senha deve ser diferente da atual');
    }

    setLoading(true);
    try {
      const payload = {
        domain: form.domain || null,
        username: form.username || null,
        new_password: form.new_password,
        target: form.target || null,
        current_password: authMethod === 'password' ? form.current_password : null,
        ntlm_hash: authMethod === 'ntlm' ? form.ntlm_hash.trim() : null,
        ccache: authMethod === 'ccache' ? form.ccache : null,
        kdc_host: authMethod === 'ccache' ? (form.kdc_host || null) : null,
      };
      const { data } = await axios.post(`${API}/tools/change-domain-password`, payload);
      toast.success(data.message || 'Senha alterada com sucesso', { duration: 6000 });
      setForm({ domain: '', username: '', current_password: '', ntlm_hash: '', ccache: '', kdc_host: '', new_password: '', confirm_password: '', target: '' });
      setCcacheFileName('');
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
          Altera a senha de uma conta do Active Directory usando a senha atual, um hash NTLM ou um
          ticket Kerberos (ccache). Funciona inclusive quando a conta exige troca de senha no próximo logon.
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
                <Label htmlFor="username">
                  Usuário {authMethod === 'ccache' ? '(opcional)' : '*'}
                </Label>
                <Input
                  id="username"
                  placeholder={authMethod === 'ccache' ? 'derivado do ccache se vazio' : 'usuario (ou DOMINIO\\usuario)'}
                  value={form.username}
                  onChange={(e) => handleChange('username', e.target.value)}
                  required={authMethod !== 'ccache'}
                  data-testid="username-input"
                />
              </div>
            </div>

            {/* Seletor do método de "senha atual" */}
            <div className="space-y-2">
              <Label>Senha atual (forma de autenticação)</Label>
              <div className="grid grid-cols-3 gap-2" data-testid="auth-method-selector">
                {AUTH_METHODS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAuthMethod(key)}
                    data-testid={`auth-method-${key}`}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                      authMethod === key
                        ? 'border-emerald-500 bg-emerald-500/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {authMethod === 'password' &&
              renderPwd('current-password', 'Senha atual *', 'current_password', 'current', 'Senha atual da conta')}

            {authMethod === 'ntlm' && (
              <div className="space-y-2">
                <Label htmlFor="ntlm-hash" className="flex items-center gap-2">
                  <Hash className="w-4 h-4" />
                  Hash NTLM atual *
                </Label>
                <Input
                  id="ntlm-hash"
                  placeholder="aad3b435b51404eeaad3b435b51404ee:... (LM:NT ou apenas NT)"
                  value={form.ntlm_hash}
                  onChange={(e) => handleChange('ntlm_hash', e.target.value)}
                  className="font-mono text-sm"
                  data-testid="ntlm-hash-input"
                />
                <p className="text-xs text-muted-foreground">Formato: LM:NT ou apenas o hash NT.</p>
              </div>
            )}

            {authMethod === 'ccache' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="ccache-file" className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4" />
                    Ticket Kerberos (arquivo ccache) *
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="ccache-file"
                      type="file"
                      accept=".ccache,application/octet-stream,*/*"
                      onChange={handleCcacheFile}
                      className="cursor-pointer"
                      data-testid="ccache-file-input"
                    />
                    {form.ccache && (
                      <Badge variant="secondary" className="gap-1 shrink-0">
                        <Check className="w-3 h-3" />
                        {ccacheFileName || 'ccache carregado'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A troca usa o protocolo kpasswd (RFC 3244). O ticket precisa estar válido e o usuário/domínio podem ser derivados do ccache.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kdc-host" className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-muted-foreground" />
                    KDC / Controlador de domínio (opcional)
                  </Label>
                  <Input
                    id="kdc-host"
                    placeholder="IP ou hostname do KDC (vazio = usar o alvo/domínio)"
                    value={form.kdc_host}
                    onChange={(e) => handleChange('kdc_host', e.target.value)}
                    data-testid="kdc-host-input"
                  />
                </div>
              </div>
            )}

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
