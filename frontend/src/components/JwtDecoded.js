import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldAlert, Clock, KeyRound, FileJson } from 'lucide-react';

// Decodifica base64url (sem verificar assinatura).
function b64urlDecode(str) {
  let s = (str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  try {
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return bin;
  }
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export function looksLikeJwt(token) {
  return typeof token === 'string' && JWT_RE.test(token.trim());
}

export function decodeJwt(token) {
  const parts = (token || '').trim().split('.');
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(b64urlDecode(parts[0]));
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return { header, payload, hasSignature: parts.length > 2 && !!parts[2] };
  } catch (e) {
    return { error: e.message };
  }
}

const TIME_CLAIMS = new Set(['exp', 'iat', 'nbf', 'auth_time', 'updated_at']);

function fmtEpoch(v) {
  try {
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    // Segundos (padrão JWT) vs milissegundos.
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toLocaleString();
  } catch (e) {
    return String(v);
  }
}

function fmtValue(key, value) {
  if (value === null) return 'null';
  if (TIME_CLAIMS.has(key) && (typeof value === 'number' || /^\d+$/.test(String(value)))) {
    return `${fmtEpoch(value)}  (${value})`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function KvTable({ obj }) {
  const entries = Object.entries(obj || {});
  if (entries.length === 0) return null;
  return (
    <div className="rounded border border-border overflow-hidden">
      {entries.map(([k, v], i) => (
        <div key={k} className={`flex gap-3 px-3 py-1.5 text-xs ${i % 2 ? 'bg-muted/30' : ''}`}>
          <span className="font-mono text-primary flex-shrink-0 min-w-[120px]">{k}</span>
          <span className="font-mono break-all text-foreground/90">{fmtValue(k, v)}</span>
        </div>
      ))}
    </div>
  );
}

export default function JwtDecoded({ token }) {
  const { t } = useTranslation('jwt');
  const decoded = useMemo(() => decodeJwt(token), [token]);

  if (!decoded) return null;

  if (decoded.error) {
    return (
      <div className="border border-amber-500/30 rounded-lg p-3 bg-amber-500/5 text-xs text-amber-500">
        {t('decodeError')}: {decoded.error}
      </div>
    );
  }

  const { header, payload } = decoded;
  const now = Date.now();
  const expMs = payload.exp ? (Number(payload.exp) > 1e12 ? Number(payload.exp) : Number(payload.exp) * 1000) : null;
  const nbfMs = payload.nbf ? (Number(payload.nbf) > 1e12 ? Number(payload.nbf) : Number(payload.nbf) * 1000) : null;
  const expired = expMs != null && expMs < now;
  const notYetValid = nbfMs != null && nbfMs > now;

  let statusKind = 'none';
  if (expMs != null) statusKind = expired ? 'expired' : 'valid';
  if (notYetValid) statusKind = 'notyet';

  return (
    <div className="border border-violet-500/30 rounded-lg p-4 bg-violet-500/5 space-y-3" data-testid="jwt-decoded">
      <h4 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
        <KeyRound className="w-4 h-4" /> {t('title')}
      </h4>

      {/* Status de validade */}
      {statusKind === 'valid' && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <ShieldCheck className="w-4 h-4" /> {t('valid')} <span className="text-muted-foreground">· {t('expiresAt')}: {fmtEpoch(payload.exp)}</span>
        </div>
      )}
      {statusKind === 'expired' && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <ShieldAlert className="w-4 h-4" /> {t('expired')} <span className="text-muted-foreground">· {fmtEpoch(payload.exp)}</span>
        </div>
      )}
      {statusKind === 'notyet' && (
        <div className="flex items-center gap-2 text-sm text-amber-400">
          <Clock className="w-4 h-4" /> {t('notYetValid')} <span className="text-muted-foreground">· {t('validFrom')}: {fmtEpoch(payload.nbf)}</span>
        </div>
      )}
      {statusKind === 'none' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" /> {t('noExpiration')}
        </div>
      )}

      {/* Header */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <FileJson className="w-3 h-3" /> {t('header')}
        </div>
        <KvTable obj={header} />
      </div>

      {/* Claims / Payload */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <FileJson className="w-3 h-3" /> {t('claims')}
        </div>
        <KvTable obj={payload} />
      </div>

      <p className="text-[11px] text-muted-foreground">{t('signatureNote')}</p>
    </div>
  );
}
