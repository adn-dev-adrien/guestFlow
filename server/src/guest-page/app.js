/* Accès portail — the whole guest client (specs/guest-gate-access.md §6).
 *
 * Vanilla on purpose. A guest stands at a gate, in the rain, on cellular data: this page has no
 * business shipping a framework to draw one button. It holds no rule either — every window check,
 * every ceiling, every refusal is the server's, and the page renders what it is handed.
 */
(function () {
  'use strict';

  var TRAVEL_SECONDS = 34;          // measured on the real gate: how long the button stays inactive
  var POLL_MS = 1000;               // while the gate travels
  var POLL_TIMEOUT_MS = 45000;
  var REFRESH_MS = 20000;           // gate state + availability, while the page is visible

  var view = document.getElementById('view');
  var lodging = document.getElementById('lodging');
  var refreshTimer = null;
  var state = null;

  // ---------- plumbing ----------

  function api(path, options) {
    return fetch('/gate/v1' + path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }, options || {})).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        return { status: response.status, body: body };
      });
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render(nodes) {
    view.textContent = '';
    nodes.filter(Boolean).forEach(function (node) { view.appendChild(node); });
  }

  function setLodging(name) {
    if (name) {
      lodging.textContent = name;
      lodging.hidden = false;
    } else {
      lodging.hidden = true;
    }
  }

  function greeting(payload) {
    var name = payload && payload.stay && payload.stay.guestLabel;
    var hour = new Date().getHours();
    var salutation = (hour >= 18 || hour < 5) ? 'Bonsoir' : 'Bonjour';
    return name ? salutation + ' ' + name : salutation;
  }

  function stayLine(payload) {
    var stay = (payload && payload.stay) || {};
    if (stay.startLabel && stay.endLabel) return 'Du ' + stay.startLabel + ' au ' + stay.endLabel;
    return null;
  }

  // ---------- the code form ----------

  function showCodeForm(message) {
    var field = el('input');
    field.type = 'text';
    field.id = 'code';
    field.placeholder = 'XXXX-XXXX';
    field.autocomplete = 'one-time-code';
    field.setAttribute('inputmode', 'text');
    field.setAttribute('autocapitalize', 'characters');
    field.setAttribute('spellcheck', 'false');
    field.maxLength = 9;

    // The dash is inserted as you type — the code is READ as two groups of four, so it should be
    // typed that way. The server folds it out again.
    field.addEventListener('input', function () {
      var raw = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      field.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
    });

    var submit = el('button', 'press', 'Valider');
    submit.type = 'submit';

    var form = document.createElement('form');
    form.appendChild(el('label', null, 'Code d’accès'));
    form.appendChild(field);
    form.appendChild(submit);
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '.8rem';

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Vérification…';
      unlock(field.value).then(function (ok) {
        if (ok) return;
        submit.disabled = false;
        submit.textContent = 'Valider';
        showCodeForm('Code incorrect ou expiré.');
        var again = document.getElementById('code');
        if (again) again.focus();
      });
    });

    setLodging(null);
    render([
      el('h1', null, 'Accès portail'),
      el('p', 'sub', 'Entrez le code qui figure dans votre email d’arrivée.'),
      message ? el('p', 'note warn', message) : null,
      form,
      el('div', 'spacer'),
      el('p', 'caption', 'Ce code vous est propre et cesse de fonctionner à la fin de votre séjour.'),
    ]);
  }

  // ---------- the states the server hands back ----------

  function showActive(payload) {
    state = payload;
    var badge = el('p', 'state' + (payload.gate.state === 'open' ? ' is-open' : ''));
    badge.appendChild(el('span', 'dot'));
    badge.appendChild(document.createTextNode(
      payload.gate.state === 'open' ? 'Portail ouvert'
        : payload.gate.state === 'closed' ? 'Portail fermé' : 'État inconnu',
    ));

    // The label says what the pulse will DO, read from the contact — a guest who wants to close the
    // gate behind them should not have to press a button that claims to open it. When the state is
    // unknown or stale it stays « Ouvrir » : that is the overwhelmingly common intent.
    var press = el('button', 'press', payload.gate.state === 'open' ? 'Fermer le portail' : 'Ouvrir le portail');
    var slot = el('div');
    slot.style.display = 'flex';
    slot.style.flexDirection = 'column';
    slot.style.gap = '.6rem';
    slot.appendChild(press);

    // The ONE thing that greys the button out: the house is not answering, so nothing would happen.
    // The gate's own state never does (decision 2026-09-10) — the command always goes out.
    if (!payload.service.available) {
      press.disabled = true;
      slot.insertBefore(serviceDownNote(payload), press);
    }

    press.addEventListener('click', function () { requestOpen(press, slot, payload); });

    var share = el('button', 'ghost', 'Partager l’accès');
    share.disabled = !payload.share;
    share.addEventListener('click', function () { shareAccess(payload, share); });

    setLodging(payload.stay.propertyName);
    render([
      el('h1', null, greeting(payload)),
      el('p', 'sub', stayLine(payload)),
      badge,
      el('div', 'spacer'),
      slot,
      share,
      el('p', 'caption', payload.stay.endsAtLabel ? 'Actif jusqu’au ' + payload.stay.endsAtLabel : null),
    ]);
  }

  function serviceDownNote(payload) {
    var note = el('p', 'note warn');
    note.appendChild(document.createTextNode('Ouverture à distance indisponible. '));
    if (payload.service.phone) {
      var link = el('a', null, payload.service.phone);
      link.href = 'tel:' + payload.service.phone.replace(/[^+0-9]/g, '');
      note.appendChild(document.createTextNode('Appelez le '));
      note.appendChild(link);
      note.appendChild(document.createTextNode(', nous ouvrons pour vous.'));
    }
    return note;
  }

  function showBefore(payload) {
    state = payload;
    var counter = el('p', 'countdown', '—');
    var startsAt = new Date(payload.stay.startsAt).getTime();

    function tick() {
      var left = Math.max(0, startsAt - Date.now());
      if (left === 0) { load(); return; }
      var total = Math.floor(left / 1000);
      var hours = Math.floor(total / 3600);
      var minutes = Math.floor((total % 3600) / 60);
      var seconds = total % 60;
      counter.textContent = (hours < 10 ? '0' : '') + hours + ':'
        + (minutes < 10 ? '0' : '') + minutes + ':'
        + (seconds < 10 ? '0' : '') + seconds;
    }
    tick();
    window.setInterval(tick, 1000);

    var press = el('button', 'press', 'Ouvrir le portail');
    press.disabled = true;

    setLodging(payload.stay.propertyName);
    render([
      el('h1', null, 'Bientôt'),
      el('p', 'sub', payload.stay.startLabel
        ? 'Votre accès sera actif le ' + payload.stay.startLabel + '.'
        : 'Votre accès n’est pas encore actif.'),
      el('div', 'spacer'),
      el('p', 'caption', 'dans'),
      counter,
      el('div', 'spacer'),
      press,
      el('p', 'caption', 'Vous arrivez en avance ? Appelez-nous, nous ouvrons l’accès depuis la maison.'),
    ]);
  }

  function showFinished(payload) {
    setLodging(null);
    var recap = payload && payload.stay && payload.stay.reservationNumber
      ? el('p', 'code-recap', 'Séjour n° ' + payload.stay.reservationNumber)
      : null;
    render([
      el('h1', null, 'Séjour terminé'),
      el('p', 'sub', 'Merci de votre visite. Votre accès s’est refermé une heure après votre départ.'),
      el('div', 'spacer'),
      recap,
      el('div', 'spacer'),
      el('p', 'caption', 'À bientôt au Domaine Solio.'),
    ]);
  }

  // ---------- the press ----------

  function requestOpen(press, slot, payload) {
    press.textContent = 'Envoi…';

    api('/open', { method: 'POST' }).then(function (result) {
      if (result.status !== 200) {
        press.textContent = payload.gate.state === 'open' ? 'Fermer le portail' : 'Ouvrir le portail';
        slot.appendChild(refusalNote(result, payload));
        return;
      }
      watchQuietly(result.body.requestId, press, slot, payload);
    }).catch(function () {
      press.textContent = payload.gate.state === 'open' ? 'Fermer le portail' : 'Ouvrir le portail';
      slot.appendChild(el('p', 'note warn', 'Connexion perdue. Réessayez dans un instant.'));
    });
  }

  function refusalNote(result, payload) {
    var code = (result.body && result.body.error && result.body.error.code) || 'ERROR';
    if (code === 'SERVICE_UNAVAILABLE') return serviceDownNote(payload);
    if (code === 'TOO_MANY_OPENS') {
      return el('p', 'note warn', 'Trop d’ouvertures sur la dernière heure. Réessayez plus tard.');
    }
    if (code === 'NOT_YET_ACTIVE' || code === 'EXPIRED' || code === 'REVOKED') {
      window.setTimeout(load, 800);
      return el('p', 'note warn', 'Votre accès n’est plus actif.');
    }
    return el('p', 'note warn', 'L’ouverture a échoué.');
  }

  /**
   * After the press. Deliberately almost nothing (decision 2026-09-10): no progress bar, no
   * countdown, no confirmation screen, and **no lock on the button** — a guest presses and puts the
   * phone away, and the one who wants to close the gate behind them must be able to press again.
   *
   * The request is still watched silently, and the page speaks ONLY on a failure: a refusal from
   * the house, an error, or no answer at all. Standing in front of a gate that was never going to
   * move, a guest deserves to be told.
   */
  function watchQuietly(requestId, press, slot, payload) {
    var label = press.textContent;
    press.textContent = 'Demande envoyée';
    // Half a second of grace, purely so the label is readable — not a lock.
    window.setTimeout(function () { press.textContent = label; }, 1500);

    var startedAt = Date.now();
    var poll = window.setInterval(function () {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(poll);
        slot.appendChild(el('p', 'note warn', 'Sans réponse de la maison. Réessayez, ou appelez-nous.'));
        return;
      }
      api('/open/' + requestId).then(function (result) {
        var status = result.body && result.body.status;
        if (!status || status === 'pending') return;
        window.clearInterval(poll);
        // opened / already_open: nothing to say. The gate is moving and the guest is driving in.
        if (status === 'refused') {
          slot.appendChild(el('p', 'note warn', 'Commande refusée depuis la maison.'
            + (result.body.detail ? ' (' + result.body.detail + ')' : '')));
          return;
        }
        if (status === 'error' || status === 'timeout') slot.appendChild(serviceDownNote(payload));
      }).catch(function () { /* one lost poll is not a failure — the next one answers */ });
    }, POLL_MS);
  }

  // ---------- sharing ----------

  function shareAccess(payload, button) {
    if (!payload.share) return;
    var text = 'Accès au portail du Domaine Solio pendant notre séjour : ' + payload.share.url;
    if (navigator.share) {
      navigator.share({ title: 'Accès portail', text: text, url: payload.share.url }).catch(function () {});
      return;
    }
    var done = function () {
      button.textContent = 'Lien copié';
      window.setTimeout(function () { button.textContent = 'Partager l’accès'; }, 2500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(payload.share.url).then(done, function () {});
    else done();
  }

  // ---------- loading ----------

  function apply(result) {
    var body = result.body || {};
    var code = body.error && body.error.code;

    if (result.status === 200) { showActive(body); return true; }
    if (result.status === 403 && code === 'NOT_YET_ACTIVE') { showBefore(body); return true; }
    if (result.status === 403 && (code === 'EXPIRED' || code === 'REVOKED')) { showFinished(body); return true; }
    return false;
  }

  function unlock(code) {
    return api('/session', { method: 'POST', body: JSON.stringify({ code: code }) })
      .then(function (result) {
        if (result.status === 429) {
          showCodeForm('Trop d’essais. Patientez quelques minutes.');
          return true;
        }
        return apply(result);
      })
      .catch(function () {
        showCodeForm('Connexion impossible. Vérifiez votre réseau.');
        return true;
      });
  }

  function load() {
    return api('/session').then(function (result) {
      if (!apply(result)) showCodeForm();
    }).catch(function () {
      showCodeForm('Connexion impossible. Vérifiez votre réseau.');
    });
  }

  function start() {
    var match = /[?&]c=([^&]+)/.exec(window.location.search);
    if (match) {
      var code = decodeURIComponent(match[1]);
      // The code leaves the address bar immediately: it should not sit in a screenshot, a shared
      // tab or the back-button history. Caddy strips it from the access log on its side.
      window.history.replaceState({}, '', window.location.pathname);
      unlock(code).then(function (ok) { if (!ok) showCodeForm('Ce lien n’est plus valable.'); });
    } else {
      load();
    }

    // The gate state and the availability go stale in a minute, so a page left open on a kitchen
    // table must not offer a button that has since died.
    refreshTimer = window.setInterval(function () {
      if (document.visibilityState === 'visible' && state) load();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state) load();
    });
  }

  start();
}());
