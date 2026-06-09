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

  function init(container) {
    var propertyId = parseInt(container.dataset.propertyId, 10) || 0;
    var showOptions = container.dataset.showOptions !== '0';
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
      build(container, propertyId, r[0].body.data, (r[1].body && r[1].body.data) || []);
    });
  }

  function build(container, propertyId, detail, options) {
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

    // Options (skip auto-options like early check-in: they are computed server-side from times).
    f.optionInputs = {};
    var optionsBox = null;
    var pickable = (options || []).filter(function (o) { return !o.autoOptionType; });
    if (pickable.length) {
      var lines = pickable.map(function (o) {
        var input = GF.el('input', { type: 'number', min: '0', value: '0', onInput: scheduleQuote });
        f.optionInputs[o.id] = input;
        var label = (o.title || '') + (o.price ? ' (' + GF.euro(o.price) + ')' : '');
        return GF.el('div', { class: 'gf-option-line' }, GF.el('span', {}, label), input);
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

    f.submit = GF.el('button', { class: 'gf-btn', type: 'button', disabled: 'disabled', onClick: submit }, GF.t('sendRequest'));
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
      summary.appendChild(line(GF.t('total'), GF.euro(q.finalPrice), 'gf-summary-total'));
      if (q.deposit && q.deposit.amount) summary.appendChild(line(GF.t('deposit'), GF.euro(q.deposit.amount)));
      if (q.balance && q.balance.amount) summary.appendChild(line(GF.t('balance'), GF.euro(q.balance.amount)));

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
      f.submit.textContent = GF.t('sending');
      GF.api('POST', '/booking-requests', body).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data) {
          container.innerHTML = '';
          container.appendChild(GF.el('div', { class: 'gf-success' }, GF.t('requestSent', res.body.data.reference || '')));
          return;
        }
        f.submit.disabled = false;
        f.submit.textContent = GF.t('sendRequest');
        feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.errorMessage(res)));
      });
    }

    recompute();
  }

  document.querySelectorAll('[data-gf-booking]').forEach(init);
})();
