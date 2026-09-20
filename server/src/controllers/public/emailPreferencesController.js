/**
 * Public email-preferences page — the unsubscribe link of the season emails
 * (specs/guest-email-sequence.md §3.2 rule 9, §4.3, §6.2).
 *
 * GET shows the page and never changes anything: mail scanners and link previews fetch every link of
 * an email, and they must not unsubscribe anybody. POST performs the change. An unknown token gets the
 * same neutral page, so the endpoint cannot be used to probe which tokens exist.
 *
 * Self-contained HTML: no script, no external asset, readable on a phone.
 */

const COPY = {
  fr: {
    title: 'Vos nouvelles du Domaine Solio',
    ask: 'Vous recevez de temps en temps des nouvelles du domaine : nos bons cadeau en novembre, nos vœux en janvier.',
    button: 'Ne plus recevoir les nouvelles du domaine',
    done: 'C\'est noté. Vous ne recevrez plus nos nouvelles. Les informations liées à vos séjours continueront de vous parvenir.',
    already: 'C\'est déjà fait : vous ne recevez plus nos nouvelles. Les informations liées à vos séjours continuent de vous parvenir.',
    unknown: 'Ce lien n\'est plus valable. Pour toute demande, répondez simplement à l\'un de nos mails.',
  },
  en: {
    title: 'News from Domaine Solio',
    ask: 'From time to time you receive news from the domain: our gift vouchers in November, our greetings in January.',
    button: 'Stop receiving news from the domain',
    done: 'Done. You will no longer receive our news. Information about your stays will keep reaching you.',
    already: 'Already done: you no longer receive our news. Information about your stays keeps reaching you.',
    unknown: 'This link is no longer valid. For any request, simply reply to one of our emails.',
  },
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(copy, inner) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(copy.title)}</title>
<style>body{margin:0;background:#F5F0E6;color:#1F241D;font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:520px;margin:0 auto;padding:40px 20px}h1{font:600 24px/1.25 Georgia,serif;color:#2E3B2A;margin:0 0 16px}button{width:100%;min-height:48px;border:0;border-radius:8px;background:#2E3B2A;color:#fff;font:600 16px/1.2 inherit;cursor:pointer;margin-top:12px}</style>
</head><body><main><h1>${escapeHtml(copy.title)}</h1>${inner}</main></body></html>`;
}

function buildController({ preferences, database }) {
  function languageOf(clientId) {
    try {
      const row = database.prepare('SELECT emailLanguage FROM clients WHERE id = ?').get(Number(clientId));
      return row && String(row.emailLanguage).toLowerCase() === 'en' ? 'en' : 'fr';
    } catch {
      return 'fr';
    }
  }

  function show(req, res) {
    const token = String((req.query && req.query.t) || '');
    const found = preferences.findByToken(token);
    res.set('Cache-Control', 'no-store');
    if (!found) return res.status(200).type('html').send(page(COPY.fr, `<p>${escapeHtml(COPY.fr.unknown)}</p>`));
    const copy = COPY[languageOf(found.id)];
    if (found.marketingUnsubscribedAt) return res.type('html').send(page(copy, `<p>${escapeHtml(copy.already)}</p>`));
    return res.type('html').send(page(copy, `<p>${escapeHtml(copy.ask)}</p>
<form method="post" action="${escapeHtml(req.baseUrl + req.path)}"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">${escapeHtml(copy.button)}</button></form>`));
  }

  function confirm(req, res) {
    const token = String((req.body && req.body.t) || '');
    const found = preferences.findByToken(token);
    res.set('Cache-Control', 'no-store');
    if (!found) return res.status(200).type('html').send(page(COPY.fr, `<p>${escapeHtml(COPY.fr.unknown)}</p>`));
    const copy = COPY[languageOf(found.id)];
    preferences.unsubscribe(found.id);
    return res.type('html').send(page(copy, `<p>${escapeHtml(copy.done)}</p>`));
  }

  return { show, confirm };
}

module.exports = { buildController };
