/**
 * InstallPrompt — « Installer l'app » (rule 52): never on the first load, from the second visit; Android's
 * `beforeinstallprompt`, or on iOS a sheet with Partager → « Sur l'écran d'accueil ». Dismissed for good.
 *
 * Props: none — it reads the visit count and the dismissal from the device.
 */
import { useEffect, useState } from 'react';
import Icon from './Icon';
import BottomSheet from './BottomSheet';
import { device } from '../services/device';
import { useT } from '../i18n';

let deferredPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
}

const standalone = () => typeof window !== 'undefined' && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
const isIos = () => typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

export default function InstallPrompt() {
  const t = useT();
  const [hidden, setHidden] = useState(() => device.get('installDismissed') || standalone() || (device.get('visits') || 0) < 2);
  const [sheet, setSheet] = useState(false);
  const [ready, setReady] = useState(Boolean(deferredPrompt) || isIos());
  useEffect(() => {
    const onPrompt = () => setReady(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (hidden || !ready) return null;
  const dismiss = () => { device.set('installDismissed', true); setHidden(true); };
  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      dismiss();
    } else setSheet(true);
  };
  return (
    <>
      <div className="install">
        <Icon name="share" />
        <div>{t('home.install')}</div>
        <button type="button" className="btn text" onClick={install}>{t('home.installBtn')}</button>
        <button type="button" className="x" aria-label={t('common.close')} onClick={dismiss}><Icon name="x" /></button>
      </div>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} labelledBy="install-title">
        <h3 id="install-title">{t('install.title')}</h3>
        <ol className="bsteps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {[1, 2, 3].map((n) => (
            <li className="bstep" key={n}><em>{n}</em><div><b>{t(`install.s${n}`)}</b><span>{t(`install.s${n}d`)}</span></div></li>
          ))}
        </ol>
        <button type="button" className="btn ghost block" onClick={() => setSheet(false)}>{t('install.ok')}</button>
      </BottomSheet>
    </>
  );
}
