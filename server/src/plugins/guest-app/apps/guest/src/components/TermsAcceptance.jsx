/**
 * TermsAcceptance — the terms of the activities the cart holds (specs/gift-voucher-campaigns.md rule 37): one checkbox per activity
 * the server says is `required` (« J'accepte les conditions générales — <label> », a « Lire » link that opens the text in a sheet), and
 * a small note per activity already `accepted` for the version in force on this stay. It renders what the quote says: which versions are
 * owed, and the date, are the server's.
 *
 * Props: `required` [{ activity, label, versionId, url }], `accepted` [{ activity, label, acceptedAtLabel }],
 * `checked` (a Set of the version ids ticked — a new version asks again), `onToggle(versionId)`.
 */
import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { api } from '../services/api';
import { useT } from '../i18n';

function TermsText({ item, open, onClose }) {
  const t = useT();
  const [state, setState] = useState({ loading: true, html: '', error: false });
  const [loadedFor, setLoadedFor] = useState(null);
  if (open && loadedFor !== item.versionId) {
    setLoadedFor(item.versionId);
    setState({ loading: true, html: '', error: false });
    api.terms(item.activity)
      .then((r) => setState({ loading: false, html: r.html, error: false }))
      .catch(() => setState({ loading: false, html: '', error: true }));
  }
  return (
    <BottomSheet open={open} onClose={onClose} label={t('terms.title', { label: item.label })}>
      <h2 style={{ fontSize: 19 }}>{t('terms.title', { label: item.label })}</h2>
      {state.loading ? <p className="hint">{t('common.loading')}</p> : null}
      {state.error ? <p className="hint bad">{t('err.generic')}</p> : null}
      {state.html ? <div className="termstext" dangerouslySetInnerHTML={{ __html: state.html }} /> : null}
    </BottomSheet>
  );
}

export default function TermsAcceptance({
  required = [], accepted = [], checked, onToggle,
}) {
  const t = useT();
  const [reading, setReading] = useState(null);
  return (
    <>
      {required.map((item) => (
        <div className="termsask" key={item.activity}>
          <label className="termscheck">
            <input type="checkbox" checked={checked.has(item.versionId)} onChange={() => onToggle(item.versionId)} />
            <span>{t('terms.accept', { label: item.label })}</span>
          </label>
          <button type="button" className="btn text" onClick={() => setReading(item)}>{t('terms.read')}</button>
        </div>
      ))}
      {accepted.map((item) => (
        <p className="hint" key={item.activity}>{t('terms.acceptedOn', { date: item.acceptedAtLabel })}</p>
      ))}
      {reading ? <TermsText item={reading} open onClose={() => setReading(null)} /> : null}
    </>
  );
}
