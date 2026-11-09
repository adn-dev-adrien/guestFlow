/**
 * HeroHeader — the home's full-bleed photo (§6.4): 46 % of the viewport on a phone, 420 px from the tablet,
 * the site's scrim, the brand top-left, language and day / night on a frosted pill top-right, the lodging
 * eyebrow and the greeting in Marcellus.
 *
 * Props: `photo` (url), `brand`, `brandSub`, `eyebrow`, `title`, `children` (under the title).
 */
import Photo from './Photo';
import Icon from './Icon';
import { useSession } from '../hooks/useSession';
import { useT } from '../i18n';

export function LanguageDayNight() {
  const t = useT();
  const { lang, night, chooseLang, toggleNight } = useSession();
  return (
    <div className="pill">
      <button type="button" aria-pressed={lang === 'fr'} aria-label={`FR, ${t('pill.fr')}`} lang="fr" onClick={() => chooseLang('fr')}>FR</button>
      <button type="button" aria-pressed={lang === 'en'} aria-label={`EN, ${t('pill.en')}`} lang="en" onClick={() => chooseLang('en')}>EN</button>
      <button type="button" aria-label={night ? t('pill.toDay') : t('pill.toNight')} onClick={toggleNight}><Icon name={night ? 'sun' : 'moon'} /></button>
    </div>
  );
}

export default function HeroHeader({ photo, brand, brandSub, eyebrow, title, fallback = 'forest', children }) {
  return (
    <Photo src={photo} scrim fallback={fallback} className="hero">
      <div className="hero-top">
        <span className="brand">{brand}{brandSub ? <small>{brandSub}</small> : null}</span>
        <LanguageDayNight />
      </div>
      <div className="hero-in">
        {eyebrow ? <p className="eb">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </div>
    </Photo>
  );
}
