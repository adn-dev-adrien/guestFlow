/**
 * ErrorAlert — a failed read, with « Réessayer » (§6.4 « States »). Offline reads say the network is needed.
 *
 * Props: `error` (ApiError), `onRetry`.
 */
import Banner from './Banner';
import { useT } from '../i18n';

export default function ErrorAlert({ error, onRetry }) {
  const t = useT();
  const text = error && error.code === 'NETWORK' ? t('err.network') : (error && error.message && error.code !== 'NETWORK' ? error.message : t('err.generic'));
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Banner tone="bad" role="alert">{text}</Banner>
      {onRetry ? <button type="button" className="btn ghost" onClick={onRetry}>{t('common.retry')}</button> : null}
    </div>
  );
}
