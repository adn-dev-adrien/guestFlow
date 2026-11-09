/**
 * `/s/:token` (the stay link, rule 1) and `/l/:code` (the lodging poster, rule 3): open the session, keep
 * what opened it on the device, and go home — the address bar forgets the token at once.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import Photo from '../components/Photo';
import { useSession } from '../hooks/useSession';
import { useT } from '../i18n';

export default function EntryPage({ kind }) {
  const t = useT();
  const navigate = useNavigate();
  const params = useParams();
  const { enter } = useSession();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || kind === 'none') return;
    started.current = true;
    const how = kind === 'stay' ? { stayToken: params.token } : { lodgingCode: params.code };
    enter(how).then(() => navigate('/', { replace: true }));
  }, [kind, params, enter, navigate]);
  return (
    <div className="scroll">
      <Photo src="/img/hero-domaine.jpg" scrim className="hero">
        <div className="hero-in"><p className="eb">Domaine Solio</p><h1>{t('opening.title')}</h1></div>
      </Photo>
      <div className="done" style={{ paddingTop: 40 }}><div className="spin" role="status" aria-label={t('common.loading')} /></div>
    </div>
  );
}
