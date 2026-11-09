/**
 * `/s/:token` (the stay link, rule 1) and `/l/:code` (the lodging poster, rule 3): open the session, keep
 * what opened it on the device, and go home — the address bar forgets the token at once. Without network the
 * page stays, says so and offers « Réessayer »: the link is kept, nothing is lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import Photo from '../components/Photo';
import ErrorAlert from '../components/ErrorAlert';
import { useSession } from '../hooks/useSession';
import { useT } from '../i18n';

export default function EntryPage({ kind }) {
  const t = useT();
  const navigate = useNavigate();
  const params = useParams();
  const { enter } = useSession();
  const started = useRef(false);
  const [offline, setOffline] = useState(null);

  const open = useCallback(() => {
    setOffline(null);
    const how = kind === 'stay' ? { stayToken: params.token } : { lodgingCode: params.code };
    enter(how).then(({ error }) => {
      if (error && error.code === 'NETWORK') setOffline(error);
      else navigate('/', { replace: true });
    });
  }, [kind, params.token, params.code, enter, navigate]);

  useEffect(() => {
    if (started.current || kind === 'none') return;
    started.current = true;
    open();
  }, [kind, open]);

  return (
    <div className="scroll">
      <Photo src="/img/hero-domaine.jpg" scrim className="hero">
        <div className="hero-in"><p className="eb">Domaine Solio</p><h1>{t('opening.title')}</h1></div>
      </Photo>
      {offline ? (
        <div className="pad" style={{ paddingTop: 24 }}><ErrorAlert error={offline} onRetry={open} /></div>
      ) : (
        <div className="done" style={{ paddingTop: 40 }}><div className="spin" role="status" aria-label={t('common.loading')} /></div>
      )}
    </div>
  );
}
