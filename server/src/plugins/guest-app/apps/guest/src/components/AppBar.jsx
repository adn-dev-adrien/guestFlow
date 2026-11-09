/**
 * AppBar — the top of every screen but the home: back, the page title (Marcellus, uppercase), one action.
 * The guest app's own pattern, not GuestFlow's PageActionBar (§6.6, accepted exception).
 *
 * Props: `title`, `back` (path, or a function), `action` (node).
 */
import { useNavigate } from 'react-router';
import Icon from './Icon';
import { useT } from '../i18n';

export default function AppBar({ title, back, action }) {
  const navigate = useNavigate();
  const t = useT();
  const goBack = () => (typeof back === 'function' ? back() : navigate(back));
  return (
    <header className="appbar">
      {back ? <button type="button" className="back" aria-label={t('common.back')} onClick={goBack}><Icon name="back" /></button> : null}
      <div className="ttl"><h1>{title}</h1></div>
      {action || null}
    </header>
  );
}
