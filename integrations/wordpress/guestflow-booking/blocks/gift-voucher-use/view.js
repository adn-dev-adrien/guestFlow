/**
 * « Utiliser un bon cadeau » frontend (build-free, plain ES) — specs/gift-voucher-campaigns.md rules 23-32.
 *
 *   ?gf_use=paid                        → « Paiement reçu » (back from the bank)
 *   #bon=<code> | the « Code du bon » field → POST /use (the code travels in the body, never in a URL)
 *       lodging  → the booking engine's page, `#bon=<code>`
 *       resource → « Votre bon comprend » → month → day → slot → recap → e-mail, phone, terms → confirm
 *                  → booked | payUrl (15-minute hold, rule 29)
 *
 * No rule lives here: the contents, the validity, the horizon, the slots with their « Inclus » / « + x € soirée » tag, the
 * recap and every refusal sentence come from GuestFlow. The page only lays them out and relays the visitor's choices.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;
  var VC = GF.voucherCode;
  var money = GF.voucherMoney;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var MAX_MONTHS = 13;
  var NO_HORIZON_MONTHS = 3;

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  // The QR code of a voucher PDF carries the code in the URL fragment, which browsers never send to a server.
  function codeFromHash() {
    var found = /[#&]bon=([^&]+)/.exec(window.location.hash || '');
    if (!found) return '';
    try { return VC.normalise(decodeURIComponent(found[1])); } catch (e) { return ''; }
  }

  function dateOf(iso) { return GF.date(new Date(String(iso) + 'T00:00:00')); }

  function two(n) { return n < 10 ? '0' + n : String(n); }

  function refusalText(res) {
    var err = res && res.body && res.body.error;
    return (err && typeof err.message === 'string' && err.message) || GF.errorMessage(res);
  }

  function ok(res) { return res.status >= 200 && res.status < 300 && res.body && res.body.data; }

  function init(container) {
    if (!GF.configured) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    container.innerHTML = '';
    if (queryParam('gf_use') === 'paid') {
      container.appendChild(GF.el('div', { class: 'gf-gv gf-gv-use' },
        GF.el('div', { class: 'gf-success', role: 'status' }, GF.t('guPaid'))));
      return;
    }
    var code = codeFromHash();
    if (code) { openVoucher(container, code); return; }
    // Nothing to read from the address: the plugin being off in GuestFlow is known before a field is offered (rule 40).
    GF.api('GET', '/gift-vouchers/offer').then(function (res) {
      if (GF.voucherInactive(res)) { GF.voucherHide(container); return; }
      askCode(container, '');
    });
  }

  // ── The code ────────────────────────────────────────────────────────────────────────────────
  function askCode(container, message) {
    container.innerHTML = '';
    var input = GF.el('input', {
      type: 'text', class: 'gf-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '24', id: GF.uid('gf-use-code'),
    });
    input.addEventListener('input', function () { input.value = VC.format(VC.normalise(input.value)); });
    var note = GF.el('p', { class: 'gf-field-error gf-use-note', role: 'alert' }, message || '');
    var go = GF.el('button', { type: 'button', class: 'gf-btn' }, GF.t('guContinue'));

    function submit() {
      var normalised = VC.normalise(input.value);
      if (normalised.length !== VC.CODE_LENGTH) { note.textContent = GF.t('voucherLength', VC.CODE_LENGTH); input.focus(); return; }
      if (!VC.hasValidCheck(normalised)) { note.textContent = GF.t('voucherMistyped'); input.focus(); return; }
      openVoucher(container, normalised);
    }
    go.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    container.appendChild(GF.el('div', { class: 'gf-gv gf-gv-use' },
      GF.el('h3', { class: 'gf-gv-title' }, GF.t('guTitle')),
      GF.el('p', { class: 'gf-gv-intro' }, GF.t('guIntro')),
      GF.el('div', { class: 'gf-field gf-gv-field' }, GF.el('label', { for: input.id }, GF.t('guCodeLabel')), input, note),
      go));
    input.focus();
  }

  function openVoucher(container, code) {
    container.innerHTML = '';
    container.appendChild(GF.el('div', { class: 'gf-loading', role: 'status' }, GF.t('loading')));
    var proof = GF.voucherProof();
    proof.attach({ code: code }, { solving: function () {} }).then(function (body) {
      return GF.api('POST', '/gift-vouchers/use', body);
    }).then(function (res) {
      if (GF.voucherInactive(res)) { GF.voucherHide(container); return; }
      var data = ok(res);
      if (!data) { askCode(container, refusalText(res)); return; }
      if (data.kind === 'lodging') { toBooking(container, code); return; }
      renderUse(container, code, data);
    });
  }

  // A stay voucher is paid at the booking engine, which reads `#bon=` itself.
  function toBooking(container, code) {
    container.innerHTML = '';
    var page = GF.bookingPageUrl;
    if (!page) {
      container.appendChild(GF.el('div', { class: 'gf-gv gf-gv-use' }, GF.el('div', { class: 'gf-inline-info', role: 'status' }, GF.t('guLodgingNoPage'))));
      return;
    }
    container.appendChild(GF.el('div', { class: 'gf-loading', role: 'status' }, GF.t('guLodging')));
    GF.voucherGo(page.replace(/#.*$/, '') + '#bon=' + encodeURIComponent(code));
  }

  // ── A composed voucher: « Mon bain » ─────────────────────────────────────────────────────────
  function renderUse(container, code, voucher) {
    container.innerHTML = '';
    var proof = GF.voucherProof();
    var st = {
      month: '', days: {}, day: '', slot: null, extra: 0, qty: {}, quote: null, horizonUntil: voucher.horizonUntil || null,
    };
    var slotsSeq = 0;
    var quoteSeq = 0;
    var busy = false;

    var root = GF.el('div', { class: 'gf-gv gf-gv-use' });
    container.appendChild(root);

    // « Votre bon comprend » comes first, before any choice (rule 24).
    var who = [];
    if (voucher.recipientName) who.push(GF.t('gvForLine') + ' ' + voucher.recipientName);
    if (voucher.senderName) who.push(GF.t('gvFromLine') + ' ' + voucher.senderName);
    root.appendChild(GF.el('h3', { class: 'gf-gv-title' }, voucher.title));
    if (who.length) root.appendChild(GF.el('p', { class: 'gf-gv-intro' }, who.join(', ')));
    if (voucher.message) root.appendChild(GF.el('p', { class: 'gf-gv-say' }, voucher.message));
    root.appendChild(GF.el('div', { class: 'gf-gv-group-label' }, GF.t('guIncludes')));
    root.appendChild(GF.el('ul', { class: 'gf-gv-items' }, (voucher.contents || []).map(function (line) {
      return GF.el('li', {}, (line.qty > 1 ? line.qty + ' × ' : '') + line.label, line.detail ? GF.el('span', { class: 'gf-gv-offer-detail' }, ' — ' + line.detail) : null);
    })));
    if (voucher.expiresOn) root.appendChild(GF.el('p', { class: 'gf-gv-hint' }, GF.t('guValidUntil', dateOf(voucher.expiresOn))));
    if (voucher.usedOn) {
      root.appendChild(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('guUsedOn', dateOf(voucher.usedOn))));
      return;
    }

    // Extra time and add-ons the recipient may buy (rule 27): the server's step and list.
    var composeRows = [];
    if (voucher.extraTime) {
      composeRows.push(GF.el('div', { class: 'gf-gv-compose-row' },
        GF.el('div', { class: 'gf-gv-compose-label' }, GF.t('gvExtraTime'), GF.el('small', {}, GF.t('gvExtraTimeUnit', GF.voucherDuration(voucher.extraTime.stepMinutes)))),
        GF.voucherStepper({
          value: 0, min: 0, step: voucher.extraTime.stepMinutes, name: GF.t('gvExtraTime'),
          format: function (n) { return n ? '+' + GF.voucherDuration(n) : '0'; },
          onChange: function (n) { st.extra = n; st.slot = null; st.quote = null; loadSlots(); paintBar(); drawRecap(); },
        })));
    }
    (voucher.addOns || []).forEach(function (addOn) {
      composeRows.push(GF.el('div', { class: 'gf-gv-compose-row' },
        GF.el('div', { class: 'gf-gv-compose-label' }, addOn.label),
        GF.voucherStepper({
          value: 0, min: 0, max: addOn.maxQty, name: addOn.label,
          onChange: function (n) { st.qty[addOn.articleRef] = n; if (st.slot) requote(); },
        })));
    });
    if (composeRows.length) {
      root.appendChild(GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvAddToVoucher')));
      composeRows.forEach(function (row) { root.appendChild(row); });
    }

    // ── Date: month chips bounded by the horizon, a day grid, then the slots (rule 25) ──────────
    var chips = GF.el('div', { class: 'gf-cal-chips', role: 'group', 'aria-label': GF.t('guChooseDate') });
    var grid = GF.el('div', { class: 'gf-use-days' });
    var slotsBox = GF.el('div', { class: 'gf-use-slots', 'aria-live': 'polite' });
    var slotsNote = GF.el('p', { class: 'gf-gv-hint gf-use-note', 'aria-live': 'polite' });
    root.appendChild(GF.el('div', { class: 'gf-gv-group-label' }, GF.t('guChooseDate')));
    root.appendChild(GF.el('div', { class: 'gf-cal-box' }, chips, grid, slotsNote, slotsBox));

    var months = [];
    (function listMonths() {
      var now = new Date();
      var y = now.getFullYear();
      var m = now.getMonth();
      var last = st.horizonUntil ? { y: Number(st.horizonUntil.slice(0, 4)), m: Number(st.horizonUntil.slice(5, 7)) - 1 } : null;
      for (var i = 0; i < MAX_MONTHS; i++) {
        var yy = y + Math.floor((m + i) / 12);
        var mm = (m + i) % 12;
        if (last ? (yy > last.y || (yy === last.y && mm > last.m)) : i >= NO_HORIZON_MONTHS) break;
        months.push({ y: yy, m: mm, key: yy + '-' + two(mm + 1) });
      }
      if (!months.length) months.push({ y: y, m: m, key: y + '-' + two(m + 1) });
    })();

    months.forEach(function (mo) {
      var chip = GF.el('button', { type: 'button', class: 'gf-cal-chip', 'data-month': mo.key, 'aria-pressed': 'false' },
        GF.date(new Date(mo.y, mo.m, 1), { month: 'long', year: 'numeric' }));
      chip.addEventListener('click', function () { st.month = mo.key; st.day = ''; st.slot = null; st.quote = null; loadSlots(); paintBar(); drawRecap(); });
      chips.appendChild(chip);
    });

    function paintChips() {
      Array.prototype.forEach.call(chips.children, function (chip) {
        var on = chip.getAttribute('data-month') === st.month;
        chip.classList.toggle('gf-on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function paintGrid() {
      grid.innerHTML = '';
      if (!st.month) return;
      var y = Number(st.month.slice(0, 4));
      var m = Number(st.month.slice(5, 7)) - 1;
      var cells = GF.el('div', { class: 'gf-cal-grid' });
      GF.weekdays().forEach(function (name) { cells.appendChild(GF.el('div', { class: 'gf-cal-dow' }, name)); });
      var lead = (new Date(y, m, 1).getDay() + 6) % 7;
      for (var i = 0; i < lead; i++) cells.appendChild(GF.el('div', { class: 'gf-cal-day gf-empty-cell' }));
      var count = new Date(y, m + 1, 0).getDate();
      for (var d = 1; d <= count; d++) {
        (function (day) {
          var iso = st.month + '-' + two(day);
          var free = !!st.days[iso];
          var btn = GF.el('button', {
            type: 'button',
            class: 'gf-cal-day' + (free ? ' gf-free' : ' gf-past') + (st.day === iso ? ' gf-edge' : ''),
            'data-date': iso,
            'aria-label': GF.dayLabel(y, m, day, !free),
            'aria-pressed': st.day === iso ? 'true' : 'false',
          }, String(day));
          if (free) {
            btn.addEventListener('click', function () { st.day = iso; st.slot = null; st.quote = null; paintGrid(); paintSlots(); paintBar(); drawRecap(); });
          } else {
            btn.disabled = true;
          }
          cells.appendChild(btn);
        })(d);
      }
      grid.appendChild(cells);
    }

    function paintSlots() {
      slotsBox.innerHTML = '';
      var list = st.day ? st.days[st.day] || [] : [];
      list.forEach(function (slot) {
        var tag = slot.tag === 'supplement' ? GF.t('guSlotSupplement', money(slot.supplementCents)) : GF.t('guSlotIncluded');
        var btn = GF.el('button', {
          type: 'button',
          class: 'gf-use-slot' + (slot.tag === 'supplement' ? ' is-supplement' : '') + (st.slot === slot.start ? ' is-on' : ''),
          'data-start': slot.start,
          'aria-pressed': st.slot === slot.start ? 'true' : 'false',
        }, GF.el('b', {}, slot.start + ' – ' + slot.end), GF.el('span', { class: 'gf-use-tag' }, tag));
        btn.addEventListener('click', function () { st.slot = slot.start; paintSlots(); requote(); });
        slotsBox.appendChild(btn);
      });
    }

    function loadSlots() {
      paintChips();
      slotsSeq += 1;
      var mine = slotsSeq;
      slotsNote.textContent = '';
      slotsBox.innerHTML = '';
      st.days = {};
      paintGrid();
      if (!st.month) return;
      var y = Number(st.month.slice(0, 4));
      var m = Number(st.month.slice(5, 7)) - 1;
      var from = st.month + '-01';
      var to = st.month + '-' + two(new Date(y, m + 1, 0).getDate());
      slotsNote.textContent = GF.t('loading');
      GF.api('POST', '/gift-vouchers/use/slots', { code: code, from: from, to: to, extraMinutes: st.extra }).then(function (res) {
        if (mine !== slotsSeq) return;
        var data = ok(res);
        if (!data) { slotsNote.textContent = refusalText(res); return; }
        (data.days || []).forEach(function (day) { st.days[day.date] = day.slots || []; });
        if (data.horizonUntil) st.horizonUntil = data.horizonUntil;
        slotsNote.textContent = (data.days || []).length ? '' : GF.t('noAvailability');
        paintGrid();
        paintSlots();
      });
    }

    // ── The recap of the choice (rule 26) ────────────────────────────────────────────────────────
    var recap = GF.el('div', { class: 'gf-gv-recap gf-use-recap', 'aria-live': 'polite' });
    root.appendChild(recap);

    function drawRecap(error) {
      recap.innerHTML = '';
      if (error) { recap.appendChild(GF.el('p', { class: 'gf-gv-alert', role: 'alert' }, error)); return; }
      var q = st.quote;
      if (!q) return;
      recap.appendChild(GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvRecap')));
      recap.appendChild(GF.el('p', { class: 'gf-gv-hint' }, GF.date(new Date(q.date + 'T00:00:00'), { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + q.start + ' – ' + q.end));
      (q.included || []).forEach(function (line) {
        recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line' },
          GF.el('span', {}, (line.qty > 1 ? line.qty + ' × ' : '') + line.label, line.detail ? GF.el('small', {}, line.detail) : null),
          GF.el('b', { class: 'gf-use-included' }, GF.t('guSlotIncluded'))));
      });
      if (q.supplement) {
        recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line' }, GF.el('span', {}, q.supplement.label), GF.el('b', {}, GF.euro(q.supplement.cents / 100))));
      }
      (q.extras || []).forEach(function (line) {
        recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line' },
          GF.el('span', {}, (line.qty > 1 ? line.qty + ' × ' : '') + line.label, line.detail ? GF.el('small', {}, line.detail) : null),
          GF.el('b', {}, GF.euro(line.cents / 100))));
      });
      recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line gf-gv-recap-total' }, GF.el('span', {}, GF.t('guDue')), GF.el('b', {}, GF.euro(q.dueCents / 100))));
      (q.vat || []).forEach(function (row) {
        recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line gf-gv-recap-vat' },
          GF.el('span', {}, GF.t('gvVat', String(row.rate).replace('.', ','))), GF.el('span', {}, GF.euro(row.cents / 100))));
      });
      if (q.dueCents > 0) recap.appendChild(GF.el('p', { class: 'gf-inline-info' }, GF.t('guHold')));
    }

    function addOnsRequest() {
      var out = [];
      Object.keys(st.qty).forEach(function (ref) { if (st.qty[ref] > 0) out.push({ articleRef: ref, qty: st.qty[ref] }); });
      return out;
    }

    function startOf() { return st.day + 'T' + st.slot; }

    function requote() {
      quoteSeq += 1;
      var mine = quoteSeq;
      st.quote = null;
      paintBar();
      GF.api('POST', '/gift-vouchers/use/quote', { code: code, start: startOf(), extraMinutes: st.extra, addOns: addOnsRequest() }).then(function (res) {
        if (mine !== quoteSeq) return;
        var data = ok(res);
        st.quote = data || null;
        drawRecap(data ? '' : refusalText(res));
        paintBar();
      });
    }

    // ── Who, and the terms (rule 28) ──────────────────────────────────────────────────────────────
    var fields = {};
    function field(key, labelText, input) {
      var cid = GF.uid('gf-use');
      input.id = cid;
      var err = GF.el('p', { class: 'gf-field-error', id: cid + '-err' });
      input.setAttribute('aria-describedby', cid + '-err');
      var wrap = GF.el('div', { class: 'gf-field gf-gv-field' }, GF.el('label', { for: cid }, labelText), input, err);
      fields[key] = { input: input, wrap: wrap, err: err };
      return wrap;
    }
    function setError(key, message) {
      var r = fields[key];
      r.wrap.classList.toggle('is-invalid', !!message);
      if (message) r.input.setAttribute('aria-invalid', 'true'); else r.input.removeAttribute('aria-invalid');
      r.err.textContent = message || '';
    }
    var emailInput = GF.el('input', { type: 'email', inputmode: 'email', autocomplete: 'email' });
    var phoneInput = GF.el('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel' });
    var termsInput = GF.el('input', { type: 'checkbox' });
    var termsUrl = '';
    if (GF.cgvPageUrl) termsUrl = GF.cgvPageUrl + (GF.cgvPageUrl.indexOf('?') === -1 ? '?' : '&') + 'activity=resource' + (voucher.termsVersion ? '&v=' + encodeURIComponent(voucher.termsVersion) : '');
    var termsLabel = GF.el('label', { class: 'gf-cgv-accept' }, termsInput,
      GF.el('span', {}, GF.t('gvTermsBefore'),
        termsUrl ? GF.el('a', { class: 'gf-link', href: termsUrl, target: '_blank', rel: 'noopener' }, GF.t('gvTermsLink')) : GF.t('gvTermsLink'),
        GF.t('guTermsAfter')));
    var termsErr = GF.el('p', { class: 'gf-field-error', id: GF.uid('gf-use-terms-err') });
    termsInput.setAttribute('aria-describedby', termsErr.id);
    fields.terms = { input: termsInput, wrap: termsLabel, err: termsErr };
    emailInput.addEventListener('input', function () { setError('email', ''); });
    phoneInput.addEventListener('input', function () { setError('phone', ''); });
    termsInput.addEventListener('change', function () { setError('terms', ''); });

    var alertBox = GF.el('p', { class: 'gf-gv-alert', role: 'alert', hidden: 'hidden' });
    function showAlert(message) {
      alertBox.textContent = message || '';
      if (message) alertBox.removeAttribute('hidden'); else alertBox.setAttribute('hidden', 'hidden');
    }

    root.appendChild(GF.el('div', { class: 'gf-gv-form gf-use-who' },
      field('email', GF.t('email'), emailInput), field('phone', GF.t('phone'), phoneInput), termsLabel, termsErr, alertBox));

    // ── The sticky bar: what is due, the server's figure, and the one button ──────────────────────
    var barAmt = GF.el('div', { class: 'gf-bar-amt' });
    var go = GF.el('button', { type: 'button', class: 'gf-btn gf-use-go' });
    var bar = GF.el('div', { class: 'gf-use-bar' }, barAmt, go);
    root.appendChild(bar);

    function paintBar() {
      var q = st.quote;
      barAmt.innerHTML = '';
      if (q) barAmt.appendChild(GF.el('b', {}, q.dueCents > 0 ? GF.euro(q.dueCents / 100) : GF.t('guNothingDue')));
      if (q) barAmt.appendChild(GF.el('small', {}, GF.t('guDue')));
      go.disabled = !q || busy;
      if (busy) return;
      if (!q) go.textContent = GF.t('guPickSlot');
      else go.textContent = q.dueCents > 0 ? GF.t('payAmount', GF.euro(q.dueCents / 100)) : GF.t('confirmBooking');
    }

    function validate() {
      var first = null;
      var mail = emailInput.value.trim();
      if (!EMAIL_RE.test(mail)) { setError('email', mail ? GF.t('emailInvalid') : GF.t('fieldRequired')); first = first || emailInput; }
      if (!phoneInput.value.trim()) { setError('phone', GF.t('fieldRequired')); first = first || phoneInput; }
      if (!termsInput.checked) { setError('terms', GF.t('gvTermsRequired')); first = first || termsInput; }
      if (first) { first.focus(); return false; }
      return true;
    }

    function setBusy(on, label) {
      busy = on;
      go.disabled = on;
      if (on) { go.setAttribute('aria-busy', 'true'); go.textContent = label; } else { go.removeAttribute('aria-busy'); paintBar(); }
    }

    function refuse(res) {
      var err = res.body && res.body.error;
      var codeName = err && err.code;
      var text = refusalText(res);
      if (codeName === 'EMAIL_INVALID') { setError('email', text); emailInput.focus(); return; }
      if (codeName === 'PHONE_INVALID') { setError('phone', text); phoneInput.focus(); return; }
      if (codeName === 'TERMS_NOT_ACCEPTED' || codeName === 'TERMS_OUTDATED') { setError('terms', text); termsInput.focus(); return; }
      showAlert(text);
      if (codeName === 'SLOT_TAKEN' || codeName === 'BEYOND_HORIZON') { st.slot = null; st.quote = null; loadSlots(); paintBar(); drawRecap(); }
    }

    function done(data) {
      root.innerHTML = '';
      root.appendChild(GF.el('div', { class: 'gf-success', role: 'status' },
        GF.el('b', {}, GF.t('guBooked')),
        GF.el('p', {}, GF.t('guBookedAt', GF.date(new Date(data.date + 'T00:00:00'), { weekday: 'long', day: 'numeric', month: 'long' }), data.start, data.end)),
        GF.el('p', {}, GF.t('guBookedMail'))));
    }

    function confirm(retried) {
      var body = {
        code: code,
        start: startOf(),
        extraMinutes: st.extra,
        addOns: addOnsRequest(),
        email: emailInput.value.trim(),
        phone: phoneInput.value.trim(),
        termsVersionId: voucher.termsVersionId || 0,
        returnPath: window.location.pathname + '?gf_use=paid',
      };
      proof.attach(body, {
        solving: function () { setBusy(true, GF.t('verifying')); },
        sending: function () { setBusy(true, GF.t('sending')); },
      }).then(function () {
        return GF.api('POST', '/gift-vouchers/use/confirm', body);
      }).then(function (res) {
        proof.spend();
        var err = res.body && res.body.error;
        if (!retried && err && err.code === 'CHALLENGE_INVALID') { confirm(true); return; }
        var data = ok(res);
        if (!data) { setBusy(false); refuse(res); return; }
        if (data.booked) { done(data); return; }
        var safe = false;
        try { safe = !!data.payUrl && new URL(data.payUrl).protocol === 'https:'; } catch (e) { safe = false; }
        if (!safe) { setBusy(false); refuse({ status: 0, body: {} }); return; }
        go.textContent = GF.t('redirectingPayment');
        showAlert('');
        recap.appendChild(GF.el('p', { class: 'gf-inline-info', role: 'status' }, GF.t('guHoldPay')));
        GF.voucherGo(data.payUrl);
      });
    }

    go.addEventListener('click', function () {
      if (busy || !st.quote) return;
      showAlert('');
      if (!validate()) return;
      confirm(false);
    });

    proof.observe(root);
    // The first month opens by itself: the visitor sees days, not an empty frame.
    st.month = months[0].key;
    loadSlots();
    paintBar();
  }

  document.querySelectorAll('[data-gf-gift-voucher-use]').forEach(init);
})();
