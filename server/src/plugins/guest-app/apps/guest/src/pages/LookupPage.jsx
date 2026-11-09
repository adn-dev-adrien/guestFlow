/**
 * « Retrouver mon séjour » (rule 6, §6.6 Lookup): the night hero, the last name and the reservation number,
 * one button, one calm error for every failure; « Trop d'essais » once the server throttles.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import Photo from '../components/Photo';
import Icon from '../components/Icon';
import Banner from '../components/Banner';
import { useSession } from '../hooks/useSession';
import { api } from '../services/api';
import { useT } from '../i18n';

export default function LookupPage() {
  const t = useT();
  const navigate = useNavigate();
  const { afterLookup } = useSession();
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !number.trim()) { setError('fill'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.lookup(name.trim(), number.trim());
      await afterLookup();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.status === 429 ? 'locked' : err.code === 'NETWORK' ? 'network' : 'notFound');
    } finally {
      setBusy(false);
    }
  };
  const message = { fill: t('lookup.fill'), locked: t('lookup.locked'), network: t('err.network'), notFound: t('lookup.notFound') }[error];
  return (
    <div className="scroll enter">
      <Photo fallback="night" scrim className="hero" style={{ height: 300, minHeight: 0 }}>
        <div className="hero-top"><button type="button" className="back onphoto" aria-label={t('common.back')} onClick={() => navigate(-1)}><Icon name="back" /></button><span /></div>
        <div className="hero-in" style={{ paddingBottom: 24 }}><p className="eb">{t('lookup.eyebrow')}</p><h1 style={{ fontSize: 29 }}>{t('lookup.title')}</h1></div>
      </Photo>
      <form className="pad lookupwrap" style={{ marginTop: 20, gap: 14 }} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="lk-name">{t('lookup.name')}</label>
          <input id="lk-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="family-name" autoCapitalize="words" enterKeyHint="next" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'lk-err' : undefined} />
        </div>
        <div className="field">
          <label htmlFor="lk-number">{t('lookup.number')}</label>
          <input id="lk-number" value={number} onChange={(e) => setNumber(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck="false" enterKeyHint="go" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'lk-err' : undefined} />
        </div>
        {message ? <div id="lk-err"><Banner tone="bad" role="alert">{message}</Banner></div> : null}
        <button type="submit" className="btn block" disabled={busy || error === 'locked'}>{t('lookup.submit')}</button>
        <p className="hint">{t('lookup.help')}</p>
      </form>
    </div>
  );
}
