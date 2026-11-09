/**
 * The screens before any session (rules 1, 11quater, 22): « Ce code n'est pas reconnu » with the way to find
 * one's stay, and « Application indisponible » while the plugin is off.
 */
import { useNavigate } from 'react-router';
import Icon from '../components/Icon';
import ErrorAlert from '../components/ErrorAlert';
import { useT } from '../i18n';

export function UnknownCodeScreen() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="unavail">
      <Icon name="qr" />
      <h1>{t('unknown.title')}</h1>
      <p>{t('unknown.text')}</p>
      <button type="button" className="btn" onClick={() => navigate('/retrouver')}>{t('unknown.find')}</button>
    </div>
  );
}

export function UnavailableScreen() {
  const t = useT();
  return (
    <div className="unavail">
      <Icon name="moon" />
      <h1>{t('off.title')}</h1>
      <p>{t('off.text')}</p>
    </div>
  );
}

export function FailedScreen({ error, onRetry }) {
  return <div className="unavail"><div style={{ width: '100%', maxWidth: 420 }}><ErrorAlert error={error} onRetry={onRetry} /></div></div>;
}
