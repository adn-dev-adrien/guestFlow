/* Accès portail — the whole guest client (specs/guest-gate-access.md §6).
 *
 * Vanilla on purpose. A guest stands at a gate, in the rain, on cellular data: this page has no
 * business shipping a framework to draw one button. It holds no rule either — every window check,
 * every ceiling, every refusal is the server's, and the page renders what it is handed.
 */
(function () {
  'use strict';

  /* The one line to change if the wording changes. The label deliberately says neither « ouvrir »
   * nor « fermer » (decision 2026-09-14, Adrien): the gate's state has left this application, and a
   * button reading « Fermer le portail » IS a state display wearing a verb. What is left must name
   * the MOVEMENT without claiming to know its direction. */
  var ACTION_LABEL = 'Glisser pour actionner';
  var SLIDE_RESET_MS = 2000;        // back to rest after a send — a rest, never a lock

  var POLL_MS = 1000;               // while the gate travels
  var POLL_TIMEOUT_MS = 45000;
  var REFRESH_MS = 20000;           // availability, while the page is visible

  var view = document.getElementById('view');
  var refreshTimer = null;
  var state = null;
  var busy = false;                 // a slide in progress: the refresh must not redraw under it

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

  // ---------- the slide ----------

  /**
   * Slide-to-confirm, the gesture of the Sowel dashboard tile (Sowel spec 146). Mechanics taken as
   * they are: drag the knob to the end, and **released before the end nothing is sent** — that is
   * the whole point, against the phone in a pocket and the child playing with the screen.
   *
   * After a send it returns to rest after two seconds. That is a rest, not a lock: a guest must be
   * able to command again to close the gate behind them (specs/guest-gate-access.md §3.8 r. 28).
   */
  function buildSlide(options) {
    var KNOB = 50, PAD = 4;
    var track = el('div', 'slide');
    var fill = el('div', 'slide-fill');
    var label = el('div', 'slide-label', options.label);
    var knob = document.createElement('button');
    knob.type = 'button';
    knob.className = 'slide-knob';
    knob.textContent = '\u00BB';
    knob.setAttribute('aria-label', options.label);
    track.appendChild(fill);
    track.appendChild(label);
    track.appendChild(knob);

    var x = 0, dragging = false, startX = 0, done = false;
    if (options.disabled) {
      track.classList.add('is-off');
      knob.disabled = true;
    }

    function max() { return Math.max(0, track.clientWidth - (KNOB + PAD * 2)); }
    function place(value) {
      x = Math.max(0, Math.min(value, max()));
      knob.style.left = (PAD + x) + 'px';
      fill.style.width = (PAD + x + KNOB) + 'px';
    }
    function rest() {
      done = false;
      dragging = false;
      busy = false;
      track.classList.remove('done');
      label.textContent = options.label;
      knob.textContent = '\u00BB';
      place(0);
    }
    function confirm() {
      if (done || options.disabled) return;
      done = true;
      dragging = false;
      busy = true;                  // hold the refresh off until we are back at rest
      track.classList.add('done');
      label.textContent = 'Commande envoyée';
      knob.textContent = '\u2713';
      place(max());
      options.onConfirm();
      window.setTimeout(rest, SLIDE_RESET_MS);
    }

    // Pointer capture keeps the tracking outside the element, but it is NOT the only path: the
    // moves are listened for on the window too. Some environments deliver nothing to the captured
    // element, and a slider that only slides on some phones is not a slider.
    function onMove(event) {
      if (!dragging) return;
      place(event.clientX - startX);
      if (x >= max() - 2) confirm();
    }
    function release() {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      if (!done) { busy = false; place(0); }   // let go too early: nothing goes out
    }
    knob.addEventListener('pointerdown', function (event) {
      if (done || options.disabled) return;
      if (knob.setPointerCapture) knob.setPointerCapture(event.pointerId);
      dragging = true;
      busy = true;
      startX = event.clientX - x;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      event.preventDefault();
    });
    knob.addEventListener('pointermove', onMove);
    knob.addEventListener('pointerup', release);

    // A gesture nobody can perform is a gate nobody can open. A deliberate key press on a focused
    // control is an intent, exactly like a completed drag — so Enter, Space, → and End all confirm.
    knob.addEventListener('keydown', function (event) {
      var keys = ['Enter', ' ', 'Spacebar', 'ArrowRight', 'End'];
      if (keys.indexOf(event.key) === -1) return;
      event.preventDefault();
      confirm();
    });

    return { el: track, rest: rest };
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

    // Everything a press can have to say lives here, and is REPLACED at each press rather than
    // stacked: three failures in a row must not build a wall of identical warnings.
    var notes = el('div');
    notes.style.display = 'flex';
    notes.style.flexDirection = 'column';
    notes.style.gap = '.6rem';

    // The ONE thing that greys the gesture out: the house is not answering, so nothing would
    // happen. The gate's own state never does (decision 2026-09-10) — the command always goes out,
    // and since 2026-09-14 the page does not even say what the state is.
    var down = !payload.service.available;
    if (down) notes.appendChild(serviceDownNote(payload));

    var slide = buildSlide({
      label: ACTION_LABEL,
      disabled: down,
      onConfirm: function () { requestOpen(notes, payload); },
    });

    var share = el('button', 'ghost', 'Partager l’accès');
    share.disabled = !payload.share;
    share.addEventListener('click', function () { shareAccess(payload, share); });

    render([
      el('h1', null, greeting(payload)),
      el('p', 'sub', stayLine(payload)),
      el('div', 'spacer'),
      notes,
      // The one line the removed badge leaves behind: it answers the only question the label does
      // not, and it says nothing about the gate's actual state.
      el('p', 'caption', 'Le même geste ouvre et ferme'),
      slide.el,
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

    var slide = buildSlide({ label: ACTION_LABEL, disabled: true, onConfirm: function () {} });

    render([
      el('h1', null, 'Bientôt'),
      el('p', 'sub', payload.stay.startLabel
        ? 'Votre accès sera actif le ' + payload.stay.startLabel + '.'
        : 'Votre accès n’est pas encore actif.'),
      el('div', 'spacer'),
      el('p', 'caption', 'dans'),
      counter,
      el('div', 'spacer'),
      slide.el,
      el('p', 'caption', 'Vous arrivez en avance ? Appelez-nous, nous ouvrons l’accès depuis la maison.'),
    ]);
  }

  function showFinished(payload) {
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

  // ---------- the command ----------

  function requestOpen(notes, payload) {
    notes.textContent = '';
    if (!state.service.available) notes.appendChild(serviceDownNote(payload));

    api('/open', { method: 'POST' }).then(function (result) {
      if (result.status !== 200) {
        notes.appendChild(refusalNote(result, payload));
        return;
      }
      watchQuietly(result.body.requestId, notes, payload);
    }).catch(function () {
      notes.appendChild(el('p', 'note warn', 'Connexion perdue. Réessayez dans un instant.'));
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
   * After the slide. Deliberately almost nothing (decision 2026-09-10): no progress bar, no
   * countdown, no confirmation screen, and **no lock** — a guest slides and puts the phone away,
   * and the one who wants to close the gate behind them must be able to slide again.
   *
   * The request is still watched silently, and the page speaks ONLY on a failure: a refusal from
   * the house, an error, or no answer at all. Standing in front of a gate that was never going to
   * move, a guest deserves to be told.
   */
  function watchQuietly(requestId, notes, payload) {
    var startedAt = Date.now();
    var poll = window.setInterval(function () {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(poll);
        notes.appendChild(el('p', 'note warn', 'Sans réponse de la maison. Réessayez, ou appelez-nous.'));
        return;
      }
      api('/open/' + requestId).then(function (result) {
        var status = result.body && result.body.status;
        if (!status || status === 'pending') return;
        window.clearInterval(poll);
        // opened / already_open: nothing to say. The gate is moving and the guest is driving in.
        if (status === 'refused') {
          notes.appendChild(el('p', 'note warn', 'Commande refusée depuis la maison.'
            + (result.body.detail ? ' (' + result.body.detail + ')' : '')));
          return;
        }
        if (status === 'error' || status === 'timeout') notes.appendChild(serviceDownNote(payload));
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

    // The availability goes stale in a minute, so a page left open on a kitchen table must not
    // offer a gesture that has since died. `busy` holds the redraw off while a thumb is on the
    // knob: re-rendering under a drag would silently cancel it.
    refreshTimer = window.setInterval(function () {
      if (document.visibilityState === 'visible' && state && !busy) load();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state && !busy) load();
    });
  }

  start();
}());
