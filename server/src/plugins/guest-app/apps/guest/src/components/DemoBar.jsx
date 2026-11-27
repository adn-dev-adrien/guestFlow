/**
 * DemoBar — the thin bar of a demo session (specs/guest-app/guest-app-demo-mode.md rules 16, 18): « Démo · La Granja · Pendant le séjour »,
 * under the top of every screen, never scrolling away. A tap opens a bottom sheet with the lodging (one row per lodging the app shows)
 * and the moment of the fictitious stay; a choice applies at once, empties the cart and closes the sheet. The server holds the demo:
 * this is only the remote control.
 *
 * Props: `demo` (`/me`'s `demo`: `{ moment, lodgings: [{ propertyId, name }] }`), `lodging` (`/me`'s `lodging`: the one shown).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import BottomSheet from './BottomSheet';
import Icon from './Icon';
import ErrorAlert from './ErrorAlert';
import { useCart } from '../hooks/useCart';
import { useSession } from '../hooks/useSession';
import { useT } from '../i18n';

export const MOMENTS = Object.freeze(['preArrival', 'stay', 'ended']);

function Choice({ checked, onSelect, disabled, children }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="demoopt" onClick={onSelect} disabled={disabled}>
      <span>{children}</span>
      {checked ? <Icon name="check" /> : null}
    </button>
  );
}

export default function DemoBar({ demo, lodging }) {
  const t = useT();
  const navigate = useNavigate();
  const cart = useCart();
  const { switchDemo } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const current = demo.lodgings.find((l) => l.propertyId === lodging.id);

  const choose = async (propertyId, moment) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await switchDemo(propertyId, moment);
      if (cart) cart.clear();
      setOpen(false);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="demobar" aria-haspopup="dialog" onClick={() => { setError(null); setOpen(true); }}>
        <span className="dot" aria-hidden="true" />
        <span className="txt">
          {t('demo.label')} · <strong>{lodging.name}</strong> · {t(`demo.moment.${demo.moment}`)}
        </span>
        <Icon name="chevDown" />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label={t('demo.title')}>
        <h3>{t('demo.title')}</h3>
        {error ? <ErrorAlert error={error} /> : null}
        <div role="radiogroup" aria-labelledby="demo-lodging" className="demogroup">
          <h4 id="demo-lodging" className="eb">{t('demo.lodging')}</h4>
          {demo.lodgings.map((l) => (
            <Choice key={l.propertyId} checked={Boolean(current && current.propertyId === l.propertyId)} disabled={busy} onSelect={() => choose(l.propertyId, demo.moment)}>
              {l.name}
            </Choice>
          ))}
        </div>
        <div role="radiogroup" aria-labelledby="demo-moment" className="demogroup">
          <h4 id="demo-moment" className="eb">{t('demo.momentTitle')}</h4>
          {MOMENTS.map((moment) => (
            <Choice key={moment} checked={demo.moment === moment} disabled={busy || !current} onSelect={() => choose(current.propertyId, moment)}>
              {t(`demo.moment.${moment}`)}
            </Choice>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
