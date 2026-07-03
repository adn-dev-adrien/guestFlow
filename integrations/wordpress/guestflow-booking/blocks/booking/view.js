/**
 * Booking wizard frontend (build-free, plain ES). Loads property detail + options, lets the visitor
 * pick dates/guests/options, shows a LIVE quote (computed server-side via the plugin proxy → GuestFlow
 * pricing engine), then submits a booking request (a draft devis, never a confirmed reservation).
 *
 * No pricing/availability logic lives here: the quote and the availability flag come from the server.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  function init(container) {
    var propertyId = parseInt(container.dataset.propertyId, 10) || 0;
    var showOptions = container.dataset.showOptions !== '0';
    var payOnline = container.dataset.payOnline === '1';

    // Returning from the Qonto payment page → show the live confirmation status instead of the wizard.
    // The per-devis capability token travels in the return URL so the status poll can authorise itself.
    var returnedDevisId = parseInt(queryParam('gf_payment'), 10) || 0;
    if (returnedDevisId) {
      renderStatus(container, returnedDevisId, queryParam('gf_token') || '');
      return;
    }

    if (!GF.configured || !propertyId) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    container.innerHTML = '';
    container.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));

    Promise.all([
      GF.api('GET', '/properties/' + propertyId),
      showOptions ? GF.api('GET', '/properties/' + propertyId + '/options') : Promise.resolve({ status: 200, body: { data: [] } }),
    ]).then(function (r) {
      if (r[0].status < 200 || r[0].status >= 300 || !r[0].body || !r[0].body.data) {
        container.innerHTML = '';
        container.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(r[0])));
        return;
      }
      build(container, propertyId, r[0].body.data, (r[1].body && r[1].body.data) || [], payOnline);
    });
  }

  // Success-page view: poll the booking-request status until the payment confirms (the webhook/poll on
  // the GuestFlow side converts the devis → reservation + sends the confirmation email). Read-only.
  function renderStatus(container, devisId, token) {
    container.innerHTML = '';
    var box = GF.el('div', { class: 'gf-booking' });
    container.appendChild(box);
    var tries = 0;
    var MAX_TRIES = 20;

    function waiting() {
      box.innerHTML = '';
      box.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('confirmingPayment')));
    }

    function recap(d) {
      box.innerHTML = '';
      box.appendChild(GF.el('div', { class: 'gf-success' }, GF.t(d.status === 'conflict' ? 'paymentConflict' : 'paymentConfirmed')));
      if (d.propertyName || d.startDate) {
        var lines = GF.el('div', { class: 'gf-summary' });
        lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('strong', {}, GF.t('stayRecap')), GF.el('span', {}, d.propertyName || '')));
        if (d.startDate) lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('span', {}, GF.t('startDate') + ' → ' + GF.t('endDate')), GF.el('span', {}, d.startDate + ' → ' + d.endDate)));
        var recapTotal = d.totalStayPrice != null ? d.totalStayPrice : d.finalPrice; // tax-inclusive when the server provides it
        if (recapTotal != null) lines.appendChild(GF.el('div', { class: 'gf-summary-line gf-summary-total' }, GF.el('span', {}, GF.t('total')), GF.el('span', {}, GF.euro(recapTotal))));
        // Online-deposit flow: only the acompte was collected — surface the solde still due. The server
        // includes this block only when the balance is unpaid.
        var depositFlow = d.payment && d.payment.mode === 'deposit' && d.payment.balanceAmount;
        if (depositFlow) {
          if (d.payment.depositAmount != null) lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('span', {}, GF.t('depositPaid')), GF.el('span', {}, GF.euro(d.payment.depositAmount))));
          var solLabel = d.payment.balanceDueDate ? GF.t('balanceDueBefore', d.payment.balanceDueDate) : GF.t('balance');
          lines.appendChild(GF.el('div', { class: 'gf-summary-line' }, GF.el('span', {}, solLabel), GF.el('span', {}, GF.euro(d.payment.balanceAmount))));
        }
        box.appendChild(lines);
        if (depositFlow) box.appendChild(GF.el('div', { class: 'gf-inline-info' }, GF.t('balanceEmailFollows')));
      }
    }

    function poll() {
      var qs = token ? ('?token=' + encodeURIComponent(token)) : '';
      GF.api('GET', '/booking-requests/' + devisId + '/status' + qs).then(function (res) {
        var d = (res.body && res.body.data) || {};
        if (d.status === 'confirmed' || d.status === 'conflict') { recap(d); return; }
        waiting();
        tries++;
        if (tries < MAX_TRIES) { setTimeout(poll, 3000); return; }
        box.innerHTML = '';
        box.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('paymentPending')));
      });
    }

    waiting();
    poll();
  }

  function build(container, propertyId, detail, options, payOnline) {
    var f = {}; // field refs
    var debounceTimer = null;

    function numField(key, label, min, def) {
      f[key] = GF.el('input', { type: 'number', min: String(min), value: String(def), onInput: scheduleQuote });
      return GF.el('div', { class: 'gf-field' }, GF.el('label', {}, label), f[key]);
    }

    f.startDate = GF.el('input', { type: 'date', min: todayIso(), onInput: scheduleQuote });
    f.endDate = GF.el('input', { type: 'date', min: todayIso(), onInput: scheduleQuote });

    var datesRow = GF.el('div', { class: 'gf-row' },
      GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('startDate')), f.startDate),
      GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('endDate')), f.endDate)
    );
    var guestsRow = GF.el('div', { class: 'gf-row' },
      numField('adults', GF.t('adults'), 1, 2),
      numField('children', GF.t('children'), 0, 0),
      numField('teens', GF.t('teens'), 0, 0),
      numField('babies', GF.t('babies'), 0, 0)
    );

    // Hide ONLY the time-derived auto-options (arrival/departure are driven by the date/time
    // fields, not a quantity). Paid add-ons (bed/bathroom linen, breakfast, …) stay selectable.
    // See specs/wordpress-plugin.md.
    var HIDDEN_AUTO = { early_check_in: 1, late_check_out: 1 };
    f.optionInputs = {};
    var optionsBox = null;
    var pickable = (options || []).filter(function (o) { return !HIDDEN_AUTO[o.autoOptionType]; });
    if (pickable.length) {
      var lines = pickable.map(function (o) {
        var input = GF.el('input', { type: 'number', min: '0', value: '0', onInput: scheduleQuote });
        f.optionInputs[o.id] = input;
        // Price-basis label + quantity label come from the BACKEND (source of truth) — a new option
        // renders correctly with NO change here (specs/public-planning-options.md).
        var priceStr = o.price ? (' (' + GF.euro(o.price) + (o.priceUnitLabel ? ' · ' + o.priceUnitLabel : '') + ')') : '';
        var label = (o.title || '') + priceStr;
        // Plain row (label ↔ input) unless the option needs a description ⓘ, an « à planifier » note,
        // or a quantity label — then it becomes a stacked card.
        if (!o.description && !o.showsPlanningCard && !o.quantityLabel) {
          return GF.el('div', { class: 'gf-option-line' }, GF.el('span', {}, label), input);
        }
        var titleGroup = [GF.el('span', {}, label)];
        var descBox = null;
        if (o.description) {
          descBox = GF.el('div', { class: 'gf-option-desc', style: 'display:none' }, o.description);
          // ⓘ toggle: tap-to-expand (mobile) + native tooltip on hover (desktop). Responsive + ≥44px.
          titleGroup.push(GF.el('button', {
            type: 'button', class: 'gf-info-btn', title: o.description, 'aria-label': GF.t('moreInfo'),
            onClick: function () { descBox.style.display = descBox.style.display === 'none' ? 'block' : 'none'; },
          }, 'ⓘ'));
        }
        var qtyField = o.quantityLabel
          ? GF.el('span', { class: 'gf-qty' }, GF.el('label', {}, o.quantityLabel), input)
          : input;
        var head = GF.el('div', { class: 'gf-option-head' }, GF.el('span', { class: 'gf-option-title' }, titleGroup), qtyField);
        var body = [head];
        if (o.showsPlanningCard) body.push(GF.el('div', { class: 'gf-option-note' }, GF.t('toBeScheduled')));
        if (descBox) body.push(descBox);
        return GF.el('div', { class: 'gf-option-line gf-option-rich' }, body);
      });
      optionsBox = GF.el('div', {}, GF.el('strong', {}, GF.t('options')), GF.el('div', { class: 'gf-options-list' }, lines));
    }

    var summary = GF.el('div', { class: 'gf-summary' }, GF.el('div', { class: 'gf-loading' }, GF.t('loading')));
    var warn = GF.el('div', {});

    // Contact + message + honeypot
    f.firstName = GF.el('input', { type: 'text', autocomplete: 'given-name' });
    f.lastName = GF.el('input', { type: 'text', autocomplete: 'family-name' });
    f.email = GF.el('input', { type: 'email', autocomplete: 'email' });
    f.phone = GF.el('input', { type: 'tel', autocomplete: 'tel' });
    f.message = GF.el('textarea', { rows: '3' });
    f.hp = GF.el('input', { type: 'text', tabindex: '-1', autocomplete: 'off' });

    var contact = GF.el('div', {},
      GF.el('div', { class: 'gf-row' },
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('firstName') + ' *'), f.firstName),
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('lastName') + ' *'), f.lastName)
      ),
      GF.el('div', { class: 'gf-row' },
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('email') + ' *'), f.email),
        GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('phone') + ' *'), f.phone)
      ),
      GF.el('div', { class: 'gf-row' }, GF.el('div', { class: 'gf-field' }, GF.el('label', {}, GF.t('message')), f.message)),
      GF.el('div', { class: 'gf-hp' }, GF.el('label', {}, 'Ne pas remplir', f.hp))
    );

    var submitLabel = payOnline ? GF.t('payOnline') : GF.t('sendRequest');
    f.submit = GF.el('button', { class: 'gf-btn', type: 'button', disabled: 'disabled', onClick: submit }, submitLabel);
    var feedback = GF.el('div', {});

    var form = GF.el('div', { class: 'gf-booking' },
      GF.el('h3', { style: { marginTop: 0 } }, detail.name || ''),
      datesRow, guestsRow, optionsBox, summary, warn, contact, f.submit, feedback
    );
    container.innerHTML = '';
    container.appendChild(form);

    var lastQuote = null;

    function gatherStay() {
      var opts = [];
      Object.keys(f.optionInputs).forEach(function (id) {
        var q = parseInt(f.optionInputs[id].value, 10) || 0;
        if (q > 0) opts.push({ optionId: parseInt(id, 10), quantity: q });
      });
      return {
        propertyId: propertyId,
        startDate: f.startDate.value,
        endDate: f.endDate.value,
        adults: parseInt(f.adults.value, 10) || 1,
        children: parseInt(f.children.value, 10) || 0,
        teens: parseInt(f.teens.value, 10) || 0,
        babies: parseInt(f.babies.value, 10) || 0,
        options: opts,
      };
    }

    function scheduleQuote() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, 400);
    }

    function recompute() {
      var stay = gatherStay();
      if (!stay.startDate || !stay.endDate || stay.endDate <= stay.startDate) {
        summary.innerHTML = '';
        summary.appendChild(GF.el('div', { class: 'gf-empty' }, GF.t('startDate') + ' / ' + GF.t('endDate')));
        warn.innerHTML = '';
        f.submit.disabled = true;
        lastQuote = null;
        return;
      }
      summary.innerHTML = '';
      summary.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));
      GF.api('POST', '/quote', stay).then(function (res) {
        if (res.status < 200 || res.status >= 300 || !res.body || !res.body.data) {
          summary.innerHTML = '';
          summary.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(res)));
          f.submit.disabled = true;
          lastQuote = null;
          return;
        }
        lastQuote = res.body.data;
        drawSummary(lastQuote);
      });
    }

    function drawSummary(q) {
      summary.innerHTML = '';
      function line(label, value, cls) { return GF.el('div', { class: 'gf-summary-line ' + (cls || '') }, GF.el('span', {}, label), GF.el('span', {}, value)); }
      summary.appendChild(line(q.nights + ' ' + GF.t('nights'), GF.euro(q.accommodationTotal)));
      (q.options || []).forEach(function (o) {
        summary.appendChild(line(o.title + ' ×' + o.quantity, o.offered ? GF.euro(0) : GF.euro(o.total)));
      });
      if (q.touristTax && q.touristTax.total) summary.appendChild(line(GF.t('touristTax'), GF.euro(q.touristTax.total)));
      // Headline total = totalStayPrice (tax-INCLUSIVE) — what the guest actually pays online.
      // finalPrice is tax-exclusive; showing it as "Total" under a tax line understated the charge.
      summary.appendChild(line(GF.t('total'), GF.euro(q.totalStayPrice != null ? q.totalStayPrice : q.finalPrice), 'gf-summary-total'));
      // Deposit mode (server-decided): the site charges the acompte now, the solde is emailed later. The
      // server OMITS the deposit/balance blocks in full mode, so these lines only appear when relevant.
      var depositMode = q.payment && q.payment.mode === 'deposit';
      if (depositMode && q.deposit && q.deposit.amount) {
        summary.appendChild(line(GF.t('depositNow'), GF.euro(q.deposit.amount)));
        if (q.balance && q.balance.amount) {
          var balLabel = q.balance.dueDate ? GF.t('balanceDueBefore', q.balance.dueDate) : GF.t('balance');
          summary.appendChild(line(balLabel, GF.euro(q.balance.amount)));
        }
      }
      // Button reflects what the guest pays now (« Payer l'acompte » vs « Payer en ligne »).
      if (payOnline) f.submit.textContent = depositMode ? GF.t('payDeposit') : GF.t('payOnline');

      warn.innerHTML = '';
      var ok = true;
      if (q.available === false) { warn.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('datesUnavailable'))); ok = false; }
      if (q.minNightsBreached) { warn.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('minNights', q.minNights))); ok = false; }
      f.submit.disabled = !ok;
    }

    function submit() {
      feedback.innerHTML = '';
      if (!lastQuote) return;
      var stay = gatherStay();
      var first = f.firstName.value.trim(), last = f.lastName.value.trim(), email = f.email.value.trim(), phone = f.phone.value.trim();
      if (!first || !last || !email || !phone) {
        feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('requiredFields')));
        return;
      }
      var body = Object.assign({}, stay, {
        guest: { firstName: first, lastName: last, email: email, phone: phone },
        message: f.message.value.trim(),
        _hp: f.hp.value,
      });
      f.submit.disabled = true;
      f.submit.textContent = payOnline ? GF.t('preparingPayment') : GF.t('sending');
      GF.api('POST', '/booking-requests', body).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data) {
          if (payOnline) { startPayment(res.body.data.requestId, res.body.data.publicToken); return; }
          container.innerHTML = '';
          container.appendChild(GF.el('div', { class: 'gf-success' }, GF.t('requestSent', res.body.data.reference || '')));
          return;
        }
        f.submit.disabled = false;
        f.submit.textContent = submitLabel;
        feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.errorMessage(res)));
      });
    }

    // Use case 2: create/reuse the Qonto FULL link for the just-created devis and send the visitor to
    // the hosted payment page. Qonto returns them to this same page with ?gf_payment=<id>&gf_token=<t>
    // (the status view above then polls until confirmed). Amount + availability are enforced
    // server-side; the per-devis token authorises both the pay call and the return-page status poll.
    function startPayment(devisId, token) {
      if (!devisId || !token) { paymentError(); return; }
      var returnPath = window.location.pathname + '?gf_payment=' + devisId + '&gf_token=' + encodeURIComponent(token);
      GF.api('POST', '/booking-requests/' + devisId + '/pay', { returnPath: returnPath, token: token }).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data && res.body.data.paymentUrl) {
          feedback.innerHTML = '';
          feedback.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('redirectingPayment')));
          window.location.href = res.body.data.paymentUrl;
          return;
        }
        paymentError(res);
      });
    }

    function paymentError(res) {
      f.submit.disabled = false;
      f.submit.textContent = submitLabel;
      feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, res ? GF.errorMessage(res) : GF.t('genericError')));
    }

    recompute();
  }

  document.querySelectorAll('[data-gf-booking]').forEach(init);
})();
