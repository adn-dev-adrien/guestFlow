/**
 * WifiBlock — the lodging's wifi as a ticket with a perforated edge (rule 18 `wifi`, §6.4): network,
 * password, « Copier », the QR that joins it; or the lodging's « Pas de wifi » message (rule 11ter).
 *
 * The QR is scanned by another phone, so a tap on it opens it full screen on white (rule 18, reading of
 * 2026-11-13); a tap anywhere, « Fermer » or Escape closes it. The full view portals into the app's own
 * `.app` element, which carries the colour tokens, and stacks above a sheet the block may sit in.
 *
 * Props: `block`, `onCopy(text)` (the app copies and confirms).
 */
import { useRef, useState } from 'react';
import Modal from '@mui/material/Modal';
import Icon from '../Icon';
import { useT } from '../../i18n';

export default function WifiBlock({ block, onCopy }) {
  const t = useT();
  const ticket = useRef(null);
  const [full, setFull] = useState(false);
  if (!block.available) return <div className="callout"><Icon name="wifiOff" /><p style={{ margin: 0 }}>{block.text}</p></div>;
  return (
    <div className="wifi" ref={ticket}>
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
      {block.joinQr ? (
        <button type="button" className="qrthumb" onClick={() => setFull(true)}>
          <img className="qrimg" src={block.joinQr} alt={t('wifi.qr')} />
          <span>{t('wifi.enlarge')}</span>
        </button>
      ) : null}
      {block.joinQr ? (
        <Modal
          open={full}
          onClose={() => setFull(false)}
          hideBackdrop
          container={() => ticket.current?.closest('.app') || document.body}
          aria-label={t('wifi.qr')}
        >
          <div className="qrfull" role="dialog" aria-modal="true" aria-label={t('wifi.qr')} onClick={() => setFull(false)}>
            <button type="button" className="x qrfull-close" aria-label={t('common.close')} onClick={() => setFull(false)}><Icon name="x" /></button>
            <img src={block.joinQr} alt={t('wifi.qr')} />
            <b>{block.network}</b>
            <span>{t('wifi.scan')}</span>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
