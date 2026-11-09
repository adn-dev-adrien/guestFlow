/** OfflineBanner — « Hors connexion — le livret reste disponible » (rule 21, §6.4). */
import Icon from './Icon';
import { useT } from '../i18n';

export default function OfflineBanner() {
  const t = useT();
  return <div className="offline" role="status"><Icon name="cloudoff" />{t('net.offline')}</div>;
}
