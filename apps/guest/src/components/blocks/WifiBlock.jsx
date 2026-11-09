/**
 * WifiBlock — the lodging's wifi as a ticket with a perforated edge (rule 18 `wifi`, §6.4): network,
 * password, « Copier », the QR that joins it; or the lodging's « Pas de wifi » message (rule 11ter).
 *
 * Props: `block`, `onCopy(text)` (the app copies and confirms).
 */
import Icon from '../Icon';
import { useT } from '../../i18n';

export default function WifiBlock({ block, onCopy }) {
  const t = useT();
  if (!block.available) return <div className="callout"><Icon name="wifiOff" /><p style={{ margin: 0 }}>{block.text}</p></div>;
  return (
    <div className="wifi">
      <div>
        <small>{t('wifi.network')}</small>
        <b>{block.network}</b>
        {block.password ? (
          <>
            <small>{t('wifi.password')}</small>
            <b className="fig" style={{ fontSize: 16.5 }}>{block.password}</b>
            <button type="button" className="btn ghost" onClick={() => onCopy && onCopy(block.password)}><Icon name="copy" />{t('common.copy')}</button>
          </>
        ) : null}
        {block.note ? <p className="hint" style={{ marginTop: 8 }}>{block.note}</p> : null}
      </div>
      {block.joinQr ? <img className="qrimg" src={block.joinQr} alt={t('wifi.qr')} /> : null}
    </div>
  );
}
