/**
 * useSmtpDetection — what the server proposes as sending server for an address
 * (specs/settings-rationalization.md rule 28). Asks POST /api/settings/smtp-detect once the address
 * has been still for `delayMs`, and only while `enabled` (no saved host: a configured value always
 * wins). The server is the one that fills the host at save; this only shows what it will use.
 *
 * → { status: 'idle' | 'loading' | 'found' | 'missing', provider, message }. 'missing' carries the
 * server's sentence (provider not found, not supported, domain unreachable); a lookup the server
 * turned off, or a request refused (a read-only instance), says nothing: 'idle'.
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
    const ask = async () => {
      let r = null;
      try {
        r = await api.detectSmtp(target);
      } catch {
        r = null;
      }
      if (!live) return;
      if (r && r.found) setResult({ status: 'found', provider: r.provider, message: r.message || '' });
      else if (r && r.message) setResult({ status: 'missing', provider: null, message: r.message });
      else setResult(IDLE);
    };
    const timer = setTimeout(ask, delayMs);
    return () => { live = false; clearTimeout(timer); };
  }, [target, enabled, delayMs]);

  return result;
}
