/**
 * useSmtpDetection — what the server proposes as sending server for an address
 * (specs/settings-rationalization.md rule 28). Asks POST /api/settings/smtp-detect once the address
 * has been still for `delayMs`, and only while `enabled` (no saved host: a configured value always
 * wins). The server is the one that fills the host at save; this only shows what it will use.
 *
 * → { status: 'idle' | 'loading' | 'found' | 'missing', provider, message }
 */
import { useEffect, useState } from 'react';
import api from '../api';

const IDLE = { status: 'idle', provider: null, message: '' };

export default function useSmtpDetection(address, enabled, { delayMs = 500 } = {}) {
  const [result, setResult] = useState(IDLE);
  const target = String(address || '').trim();

  useEffect(() => {
    if (!enabled || !target) { setResult(IDLE); return undefined; }
    let live = true;
    setResult({ ...IDLE, status: 'loading' });
    const timer = setTimeout(() => {
      Promise.resolve().then(() => api.detectSmtp(target))
        .then((r) => {
          if (!live) return;
          setResult({ status: r && r.found ? 'found' : 'missing', provider: (r && r.provider) || null, message: (r && r.message) || '' });
        })
        .catch(() => { if (live) setResult({ status: 'missing', provider: null, message: 'Serveur introuvable : le saisir.' }); });
    }, delayMs);
    return () => { live = false; clearTimeout(timer); };
  }, [target, enabled, delayMs]);

  return result;
}
