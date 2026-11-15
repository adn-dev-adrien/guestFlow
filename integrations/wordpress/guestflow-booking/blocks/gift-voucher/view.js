/**
 * Gift voucher tunnel frontend (build-free, plain ES) — specs/gift-vouchers.md §3.C, §3.D and §6.
 *
 * Its own small state machine, independent of the booking block (rule 12): it shares only the runtime
 * (`GF.api`, `GF.el`, `GF.t`), the proof-of-work worker and the field styles.
 *
 *   loading → form ─(pay)→ [redirect to the hosted payment page]
 *   ?gf_voucher=<id>&gf_token=<t> → waiting (poll) → voucher | failed | still pending
 *
 * No money logic lives here: the bounds, the priced ideas, the validity and the voucher come from
 * GuestFlow. The one rule the client repeats is the amount's shape, as a hint before a request is
 * spent — GuestFlow validates the order again and may refuse it.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;
  var VC = GF.voucherCode;

  var NAME_MAX = 40;
  var MESSAGE_MAX = 200;
  var POLL_MS = 3000;
  var POLL_TRIES = 20;
  var CHALLENGE_MIN_MS = 3200;
  var CHALLENGE_REFRESH_MS = 14 * 60 * 1000;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  // « 150 € », « 12,50 € » — a whole amount without its cents, as the voucher prints it.
  function money(cents) {
    var v = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
    } catch (e) { return v + ' €'; }
  }

  function centsToField(cents) {
    return (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)).replace('.', ',');
  }

  function dateOf(iso) {
    return GF.date(new Date(String(iso) + 'T00:00:00'));
  }

  function init(container) {
    var id = parseInt(queryParam('gf_voucher'), 10) || 0;
    var token = queryParam('gf_token') || '';
    if (id && token) {
      renderReturn(container, id, token);
      return;
    }
    if (!GF.configured) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    container.innerHTML = '';
    container.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));
    GF.api('GET', '/gift-vouchers/offer').then(function (res) {
      var offer = res.status >= 200 && res.status < 300 && res.body && res.body.data;
      container.innerHTML = '';
      if (!offer) {
        container.appendChild(GF.el('div', { class: 'gf-error', role: 'status' }, GF.errorMessage(res)));
        return;
      }
      buildForm(container, offer);
    });
  }

  // ── The voucher itself: the live preview and the page shown after payment ────────────────────
  // o: { brand, amountCents, recipient, sender, message, code, conditions }
  function ticket(o) {
    var who = [];
    if (o.recipient) who.push(GF.el('span', {}, GF.t('gvForLine') + ' ', GF.el('b', {}, o.recipient)));
    if (o.sender) who.push(GF.el('span', {}, GF.t(o.recipient ? 'gvFromLine' : 'gvFromLineFirst') + ' ', GF.el('b', {}, o.sender)));
    var whoNode = null;
    if (who.length) {
      whoNode = GF.el('p', { class: 'gf-gv-who' });
      who.forEach(function (n, i) {
        if (i) whoNode.appendChild(document.createTextNode(', '));
        whoNode.appendChild(n);
      });
    }
    return GF.el('div', { class: 'gf-gv-ticket' },
      o.brand ? GF.el('div', { class: 'gf-gv-brand' }, o.brand) : null,
      GF.el('div', { class: 'gf-gv-ticket-title' }, GF.t('gvVoucher')),
      GF.el('div', { class: 'gf-gv-amount' }, o.amountCents != null ? money(o.amountCents) : '—'),
      whoNode,
      o.message ? GF.el('p', { class: 'gf-gv-say' }, o.message) : null,
      GF.el('div', { class: 'gf-gv-foot' },
        GF.el('div', { class: 'gf-gv-lbl' }, GF.t('gvCode')),
        GF.el('div', { class: 'gf-gv-code' + (o.code ? '' : ' is-wait') }, o.code || GF.t('gvCodeAfterPay')),
        GF.el('p', { class: 'gf-gv-small' }, o.conditions)
      )
    );
  }

  // ── Purchase form ───────────────────────────────────────────────────────────────────────────
  function buildForm(container, offer) {
    var available = offer.available === true;
    var min = Number(offer.minAmountCents) || 0;
    var max = Number(offer.maxAmountCents) || 0;
    var months = Number(offer.validityMonths) || 0;
    var ideas = Array.isArray(offer.ideas) ? offer.ideas : [];
    var f = {};
    var pending = null; // { fp, orderId, token } — an order made for these very fields, kept if the payment start failed
    var busy = false;
    var touched = false; // the amount is judged once the visitor has typed or tried to pay, not on arrival

    var root = GF.el('div', { class: 'gf-gv' });
    container.appendChild(root);

    // `input` carries the id and the aria wiring; `shown` is what is drawn in its place (the amount
    // wraps its input with the « € » sign); `notes` are hint nodes read with the field.
    function field(key, labelText, optional, input, shown, notes) {
      var cid = GF.uid('gf-gv');
      input.id = cid;
      var err = GF.el('p', { class: 'gf-field-error', id: cid + '-err' });
      var describedBy = (notes || []).map(function (n) { return n.id; }).concat(cid + '-err');
      input.setAttribute('aria-describedby', describedBy.join(' '));
      var wrap = GF.el('div', { class: 'gf-field gf-gv-field' },
        GF.el('label', { for: cid }, labelText, optional ? GF.el('span', { class: 'gf-gv-opt' }, ' ' + GF.t('gvOptional')) : null),
        shown || input, notes || null, err);
      f[key] = { input: input, wrap: wrap, err: err };
      return wrap;
    }

    function setError(key, message) {
      var r = f[key];
      r.wrap.classList.toggle('is-invalid', !!message);
      if (message) r.input.setAttribute('aria-invalid', 'true'); else r.input.removeAttribute('aria-invalid');
      r.err.textContent = message || '';
    }

    // Amount
    var amountInput = GF.el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'gf-gv-amount-input' });
    var amountHint = GF.el('p', { class: 'gf-gv-hint', id: GF.uid('gf-gv-hint') }, GF.t('gvAmountRange', money(min), money(max)));
    var amountField = field('amount', GF.t('gvAmount'), false, amountInput,
      GF.el('div', { class: 'gf-gv-amt' }, amountInput, GF.el('span', { 'aria-hidden': 'true' }, '€')), [amountHint]);

    function parseAmount() {
      var raw = amountInput.value.trim().replace(/\s/g, '').replace(',', '.');
      if (raw === '') return { error: GF.t('gvAmountEmpty') };
      if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: GF.t('gvAmountFormat') };
      var cents = Math.round(parseFloat(raw) * 100);
      if (cents < min) return { error: GF.t('gvAmountMin', money(min)) };
      if (max && cents > max) return { error: GF.t('gvAmountMax', money(max)) };
      return { cents: cents };
    }

    // Ideas (rule 14): a click fills the amount, it never locks it.
    var chips = [];
    var ideasBlock = null;
    if (ideas.length) {
      var list = GF.el('div', { class: 'gf-gv-ideas' });
      ideas.forEach(function (idea) {
        var row = GF.el('div', { class: 'gf-gv-idea' }, GF.el('b', {}, idea.label || ''));
        var chipRow = GF.el('div', { class: 'gf-gv-chips' });
        (idea.amounts || []).forEach(function (a) {
          var chip = GF.el('button', { type: 'button', class: 'gf-gv-chip', 'aria-pressed': 'false' },
            (a.label ? a.label + ' · ' : '') + money(a.amountCents));
          chip.addEventListener('click', function () {
            touched = true;
            amountInput.value = centsToField(a.amountCents);
            sync();
          });
          chips.push({ node: chip, cents: a.amountCents });
          chipRow.appendChild(chip);
        });
        row.appendChild(chipRow);
        list.appendChild(row);
      });
      ideasBlock = GF.el('div', { class: 'gf-gv-ideas-wrap' },
        GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvIdeas')), list,
        GF.el('p', { class: 'gf-gv-hint' }, GF.t('gvIdeasNote')));
    }

    var recipientInput = GF.el('input', { type: 'text', maxlength: NAME_MAX, autocomplete: 'off' });
    var senderInput = GF.el('input', { type: 'text', maxlength: NAME_MAX, autocomplete: 'off' });
    var messageInput = GF.el('textarea', { maxlength: MESSAGE_MAX, rows: 3 });
    var counter = GF.el('p', { class: 'gf-gv-hint gf-gv-counter', id: GF.uid('gf-gv-count') }, '0 / ' + MESSAGE_MAX);
    var emailInput = GF.el('input', { type: 'email', inputmode: 'email', autocomplete: 'email' });

    var recipientField = field('recipient', GF.t('gvRecipient'), true, recipientInput);
    var senderField = field('sender', GF.t('gvSender'), true, senderInput);
    var messageField = field('message', GF.t('gvWord'), true, messageInput, null, [counter]);
    var emailField = field('email', GF.t('gvEmail'), false, emailInput);

    // Terms (rule 13): the version GuestFlow offers, read on the page the booking checkbox also links to.
    var termsInput = GF.el('input', { type: 'checkbox' });
    var termsUrl = GF.cgvPageUrl
      ? GF.cgvPageUrl + (offer.termsVersionId ? (GF.cgvPageUrl.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(offer.termsVersionId) : '')
      : '';
    var termsLabel = GF.el('label', { class: 'gf-cgv-accept' }, termsInput,
      GF.el('span', {}, GF.t('gvTermsBefore'),
        termsUrl ? GF.el('a', { class: 'gf-link', href: termsUrl, target: '_blank', rel: 'noopener' }, GF.t('gvTermsLink')) : GF.t('gvTermsLink'),
        GF.t('gvTermsAfter')));
    var termsErr = GF.el('p', { class: 'gf-field-error', id: GF.uid('gf-gv-terms-err') });
    termsInput.setAttribute('aria-describedby', termsErr.id);
    f.terms = { input: termsInput, wrap: termsLabel, err: termsErr };

    var alertBox = GF.el('p', { class: 'gf-gv-alert', role: 'alert', hidden: 'hidden' });
    var payBtn = null;
    var soon = null;
    if (available) {
      payBtn = GF.el('button', { type: 'button', class: 'gf-btn gf-gv-pay' });
    } else {
      soon = GF.el('p', { class: 'gf-inline-info gf-gv-soon', role: 'status' }, GF.t('gvSoon'));
    }

    var aside = GF.el('div', { class: 'gf-gv-aside' },
      GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvPreview')),
      GF.el('div', { class: 'gf-gv-preview' }));
    var preview = aside.querySelector('.gf-gv-preview');

    root.appendChild(GF.el('h3', { class: 'gf-gv-title' }, GF.t('gvTitle')));
    if (months) root.appendChild(GF.el('p', { class: 'gf-gv-intro' }, GF.t('gvIntro', months)));
    root.appendChild(GF.el('div', { class: 'gf-gv-two' },
      GF.el('div', { class: 'gf-gv-form' },
        amountField, ideasBlock, recipientField, senderField, messageField, emailField,
        termsLabel, termsErr, alertBox, payBtn, soon),
      aside));

    function showAlert(message) {
      alertBox.textContent = message || '';
      if (message) alertBox.removeAttribute('hidden'); else alertBox.setAttribute('hidden', 'hidden');
    }

    function sync() {
      var a = parseAmount();
      var shown = touched && a.error ? a.error : '';
      setError('amount', shown);
      amountHint.hidden = !!shown;
      chips.forEach(function (c) { c.node.setAttribute('aria-pressed', a.cents != null && c.cents === a.cents ? 'true' : 'false'); });
      counter.textContent = messageInput.value.length + ' / ' + MESSAGE_MAX;
      if (payBtn && !busy) payBtn.textContent = a.cents != null ? GF.t('gvPay', GF.euro(a.cents / 100)) : GF.t('gvPayBare');
      preview.innerHTML = '';
      preview.appendChild(ticket({
        brand: offer.brand || '',
        amountCents: a.cents != null ? a.cents : null,
        recipient: recipientInput.value.trim(),
        sender: senderInput.value.trim(),
        message: messageInput.value.trim(),
        code: null,
        conditions: months ? GF.t('gvConditionsPreview', months) : '',
      }));
    }

    amountInput.addEventListener('input', function () { touched = true; });
    [amountInput, recipientInput, senderInput, messageInput].forEach(function (n) { n.addEventListener('input', sync); });
    emailInput.addEventListener('input', function () { setError('email', ''); });
    termsInput.addEventListener('change', function () { setError('terms', ''); });
    sync();

    // Rule 13 — every refusal on its field, the first one focused.
    function validate() {
      var first = null;
      var a = parseAmount();
      touched = true;
      if (a.error) { setError('amount', a.error); amountHint.hidden = true; first = first || amountInput; }
      var mail = emailInput.value.trim();
      if (!EMAIL_RE.test(mail)) {
        setError('email', mail ? GF.t('emailInvalid') : GF.t('gvEmailEmpty'));
        first = first || emailInput;
      }
      if (!termsInput.checked) { setError('terms', GF.t('gvTermsRequired')); first = first || termsInput; }
      if (first) { first.focus(); return null; }
      return a.cents;
    }

    // ── Proof of work: the same challenge the booking request solves (specs/gift-vouchers.md rule 15) ──
    var proof = null;

    function solveChallenge(c) {
      return new Promise(function (resolve) {
        var done = false;
        function finish(nonce) { if (!done) { done = true; resolve(nonce); } }
        try {
          var worker = new Worker(GF.powWorkerUrl);
          worker.onmessage = function (e) { worker.terminate(); finish(e.data && e.data.nonce); };
          worker.onerror = function () { worker.terminate(); solveOnPage(c, finish); };
          worker.postMessage({ salt: c.salt, difficulty: c.difficulty });
        } catch (e) {
          solveOnPage(c, finish);
        }
      });
    }

    function solveOnPage(c, finish) {
      if (!window.GFPow) { finish(null); return; }
      var start = 0;
      (function slice() {
        var nonce = window.GFPow.search(String(c.salt), Number(c.difficulty), start, 4000);
        if (nonce !== null) { finish(nonce); return; }
        start += 4000;
        setTimeout(slice, 0);
      })();
    }

    function prepareProof() {
      var entry = { receivedAt: Date.now(), solved: false };
      entry.promise = GF.api('GET', '/booking-requests/challenge').then(function (res) {
        var c = res.status >= 200 && res.status < 300 && res.body && res.body.data;
        if (!c || !c.salt) return null;
        entry.receivedAt = Date.now();
        return solveChallenge(c).then(function (nonce) { return nonce ? { challenge: c, nonce: nonce } : null; });
      }).then(function (p) { entry.solved = true; return p; });
      proof = entry;
      return entry;
    }

    function currentProof() {
      if (!proof || Date.now() - proof.receivedAt > CHALLENGE_REFRESH_MS) prepareProof();
      return proof;
    }

    // The work starts when the form is in front of the visitor or touched, never on a mere page view.
    if (available) {
      var wake = function () { if (!proof || Date.now() - proof.receivedAt > CHALLENGE_REFRESH_MS) prepareProof(); };
      root.addEventListener('focusin', wake);
      root.addEventListener('pointerdown', wake);
      if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
          if (entries.some(function (en) { return en.isIntersecting; })) wake();
        }).observe(root);
      }
    }

    // ── Pay ─────────────────────────────────────────────────────────────────────────────────────
    function setBusy(on, label) {
      busy = on;
      payBtn.disabled = on;
      if (on) payBtn.setAttribute('aria-busy', 'true'); else payBtn.removeAttribute('aria-busy');
      if (on) payBtn.textContent = label; else sync();
    }

    function refuse(res) {
      var err = res.body && res.body.error;
      var code = err && err.code;
      var text = (err && typeof err.message === 'string' && err.message) || GF.errorMessage(res);
      if (code === 'VOUCHER_AMOUNT_OUT_OF_BOUNDS') { setError('amount', text); amountInput.focus(); return; }
      if (code === 'EMAIL_INVALID') { setError('email', text); emailInput.focus(); return; }
      if (code === 'TERMS_REQUIRED') { setError('terms', text); termsInput.focus(); return; }
      showAlert(res.status === 429 ? (text || GF.t('gvTooMany')) : text);
    }

    function startPayment(orderId, orderToken) {
      setBusy(true, GF.t('preparingPayment'));
      GF.api('POST', '/gift-vouchers/orders/' + orderId + '/pay', {
        token: orderToken,
        returnPath: window.location.pathname,
      }).then(function (res) {
        var url = res.status >= 200 && res.status < 300 && res.body && res.body.data && res.body.data.paymentUrl;
        var safe = false;
        try { safe = !!url && new URL(url).protocol === 'https:'; } catch (e) { safe = false; }
        if (!safe) {
          setBusy(false);
          refuse(res.status >= 200 && res.status < 300 ? { status: 0, body: {} } : res);
          return;
        }
        payBtn.textContent = GF.t('redirectingPayment');
        window.location.assign(url);
      });
    }

    function createOrder(body, fingerprint, retried) {
      var entry = currentProof();
      if (!entry.solved) setBusy(true, GF.t('verifying'));
      entry.promise.then(function (p) {
        delete body.challenge;
        delete body.nonce;
        if (p) { body.challenge = p.challenge; body.nonce = p.nonce; }
        setBusy(true, GF.t('sending'));
        var wait = p ? Math.max(0, entry.receivedAt + CHALLENGE_MIN_MS - Date.now()) : 0;
        return new Promise(function (resolve) { setTimeout(resolve, wait); });
      }).then(function () {
        return GF.api('POST', '/gift-vouchers/orders', body);
      }).then(function (res) {
        prepareProof(); // a challenge is spent by one request, whatever the answer
        var err = res.body && res.body.error;
        if (!retried && err && err.code === 'CHALLENGE_INVALID') { createOrder(body, fingerprint, true); return; }
        var data = res.status >= 200 && res.status < 300 && res.body && res.body.data;
        if (!data || !data.orderId || !data.token) {
          setBusy(false);
          refuse(res);
          return;
        }
        pending = { fp: fingerprint, orderId: data.orderId, token: data.token };
        startPayment(pending.orderId, pending.token);
      });
    }

    function submit() {
      if (busy) return;
      showAlert('');
      var cents = validate();
      if (cents == null) return;
      var body = {
        amountCents: cents,
        recipientName: recipientInput.value.trim(),
        senderName: senderInput.value.trim(),
        message: messageInput.value.trim(),
        email: emailInput.value.trim(),
        termsVersionId: offer.termsVersionId || 0,
        language: GF.lang || 'fr',
      };
      var fingerprint = JSON.stringify(body);
      if (pending && pending.fp === fingerprint) { startPayment(pending.orderId, pending.token); return; }
      createOrder(body, fingerprint, false);
    }

    if (payBtn) payBtn.addEventListener('click', submit);
  }

  // ── Return from the payment page: wait for the bank, then show the voucher (rules 20-21) ────────
  function renderReturn(container, orderId, token) {
    container.innerHTML = '';
    var box = GF.el('div', { class: 'gf-gv' });
    container.appendChild(box);
    var tries = 0;

    function say(node) { box.innerHTML = ''; box.appendChild(node); }
    function waiting() { say(GF.el('div', { class: 'gf-loading', role: 'status' }, GF.t('gvConfirming'))); }

    function voucherPage(order) {
      var v = order.voucher;
      var code = v.code ? VC.format(VC.normalise(v.code)) : null;
      var state = order.state;
      var notes = [];
      if (state === 'expired') notes.push(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvExpired', dateOf(v.expiresOn))));
      else if (state === 'exhausted') notes.push(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvExhausted')));
      else if (state === 'cancelled') notes.push(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvCancelled')));
      else if (v.balanceCents != null && v.balanceCents < v.amountCents) notes.push(GF.el('div', { class: 'gf-inline-info', role: 'status' }, GF.t('gvBalance', GF.euro(v.balanceCents / 100))));
      var pdfUrl = GF.restUrl + '/gift-vouchers/orders/' + orderId + '/pdf?token=' + encodeURIComponent(token) + '&lang=' + encodeURIComponent(GF.lang || 'fr');
      var print = GF.el('button', { type: 'button', class: 'gf-btn gf-btn-alt' }, GF.t('gvPrint'));
      print.addEventListener('click', function () {
        document.body.classList.add('gf-gv-printing');
        window.addEventListener('afterprint', function done() {
          document.body.classList.remove('gf-gv-printing');
          window.removeEventListener('afterprint', done);
        });
        window.print();
      });
      var page = GF.el('div', {},
        GF.el('h3', { class: 'gf-gv-title' }, GF.t('gvReady')),
        notes,
        GF.el('div', { class: 'gf-gv-two' },
          GF.el('div', { class: 'gf-gv-printzone' }, ticket({
            brand: v.brand || '',
            amountCents: v.amountCents,
            recipient: v.recipientName || '',
            sender: v.senderName || '',
            message: v.message || '',
            code: code,
            conditions: GF.t('gvConditionsUntil', dateOf(v.expiresOn)),
          })),
          GF.el('div', { class: 'gf-gv-form gf-gv-after' },
            GF.el('div', { class: 'gf-gv-actions' },
              GF.el('a', { class: 'gf-btn', href: pdfUrl, target: '_blank', rel: 'noopener' }, GF.t('gvDownload')),
              print),
            GF.el('p', {}, GF.t('gvHowTo')),
            GF.el('p', {}, GF.t('gvLinkStays')))));
      say(page);
    }

    function stop(className, key) { say(GF.el('div', { class: className, role: 'status' }, GF.t(key))); }

    function poll() {
      GF.api('GET', '/gift-vouchers/orders/' + orderId + '?token=' + encodeURIComponent(token)).then(function (res) {
        if (res.status === 404) { stop('gf-inline-warn', 'gvNotFound'); return; }
        var order = (res.body && res.body.data) || {};
        if (order.voucher) { voucherPage(order); return; }
        if (order.state === 'cancelled' || order.state === 'expired' || order.state === 'failed') { stop('gf-inline-warn', 'gvPaymentFailed'); return; }
        waiting();
        tries += 1;
        if (tries < POLL_TRIES) { setTimeout(poll, POLL_MS); return; }
        stop('gf-inline-warn', 'gvStillPending');
      });
    }

    waiting();
    poll();
  }

  document.querySelectorAll('[data-gf-gift-voucher]').forEach(init);
})();
