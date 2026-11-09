/**
 * Activités — Soliomap inside the app shell, in a full-height frame under the app bar, with « Ouvrir dans
 * le navigateur » in the bar (rule 15). Reached only while the studio's « Intégrer dans l'app » is on; a place
 * opens on its permalink.
 */
import { useSearchParams } from 'react-router';
import AppBar from '../components/AppBar';
import Icon from '../components/Icon';
import { useSession } from '../hooks/useSession';
import { useT } from '../i18n';

export default function SoliomapPage() {
  const t = useT();
  const [params] = useSearchParams();
  const { lodging } = useSession();
  const base = lodging && lodging.soliomap ? lodging.soliomap.url : null;
  const wanted = params.get('url');
  const url = wanted && base && wanted.startsWith(base) ? wanted : base;
  return (
    <>
      <div className="scroll" style={{ paddingBottom: 0 }}>
        <AppBar
          title={t('soliomap.title')}
          back="/"
          action={url ? <a className="act" href={url} target="_blank" rel="noopener noreferrer" aria-label={t('soliomap.open')}><Icon name="ext" />{t('soliomap.browser')}</a> : null}
        />
      </div>
      <div className="frame">{url ? <iframe src={url} title={t('soliomap.title')} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /> : null}</div>
    </>
  );
}
