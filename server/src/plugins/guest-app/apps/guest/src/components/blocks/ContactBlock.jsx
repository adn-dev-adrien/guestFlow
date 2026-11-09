/** ContactBlock — a person to reach: name, role, « Appeler », WhatsApp, e-mail (rule 18 `contact`, §6.4). */
import Icon from '../Icon';
import { useT } from '../../i18n';

export default function ContactBlock({ block }) {
  const t = useT();
  return (
    <>
      {block.contacts.map((c) => (
        <div className="contact" key={`${c.name}|${c.phone || c.email || ''}`}>
          <div><b>{c.name}</b>{c.role || c.phone ? <span>{[c.role, c.phone].filter(Boolean).join(' · ')}</span> : null}</div>
          <div className="row">
            {c.telUrl ? <a className="btn ghost" href={c.telUrl}><Icon name="phone" />{t('common.call')}</a> : null}
            {c.whatsappUrl ? <a className="btn ghost" href={c.whatsappUrl} target="_blank" rel="noopener noreferrer"><Icon name="chat" />WhatsApp</a> : null}
            {c.mailto ? <a className="btn ghost" href={c.mailto}><Icon name="mail" />E-mail</a> : null}
          </div>
        </div>
      ))}
    </>
  );
}
