/**
 * « Réserver une séance » frontend (build-free, plain ES) — specs/site-outside-resource-booking.md rules 1-19.
 *
 *   ?gf_session=<ref>                  → the return page of a payment: polls GuestFlow until « Séance réservée »
 *   ?gf_use=paid                       → back from the bank after a voucher's remainder was paid
 *   #bon=<code> | the « Code bon cadeau » field → the voucher is read by GuestFlow (the code travels in a body, never in a URL)
 *
 * One form: activity → gift voucher code → session (duration, people) → date → slot → « Ajouter à la séance » → contact → terms.
 * Without a voucher the calls are `/sessions/*` and the session is paid online in full; with a resource voucher they are the
 * `/gift-vouchers/use/*` calls of its redemption, and only what the voucher does not cover is paid.
 *
 * No rule and no amount lives here: the resources, the durations, the slots with what each costs, the recap and every refusal sentence
 * come from GuestFlow. The page lays them out and relays the visitor's choices.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;
  var VC = GF.voucherCode;
  var money = GF.voucherMoney;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var MAX_MONTHS = 13;
  var POLL_MS = 3000;
  var POLL_TRIES = 40;

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  // The QR code of a voucher PDF carries the code in the URL fragment, which browsers never send to a server.
  function codeFromHash() {
    var found = /[#&]bon=([^&]+)/.exec(window.location.hash || '');
    if (!found) return '';
    try { return VC.normalise(decodeURIComponent(found[1])); } catch (e) { return ''; }
  }

  function two(n) { return n < 10 ? '0' + n : String(n); }
  function longDay(iso) { return GF.date(new Date(iso + 'T00:00:00'), { weekday: 'long', day: 'numeric', month: 'long' }); }

  function error(res) { return res && res.body && res.body.error && typeof res.body.error === 'object' ? res.body.error : null; }
  function refusalText(res) { var err = error(res); return (err && typeof err.message === 'string' && err.message) || GF.errorMessage(res); }
  function ok(res) { return res.status >= 200 && res.status < 300 && res.body && res.body.data; }
  function fieldOf(res) {
    var err = error(res);
    var first = err && Array.isArray(err.details) ? err.details.filter(function (d) { return d && d.field; })[0] : null;
    return first ? first.field : '';
  }

  function scrollTo(node) {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (node && node.scrollIntoView) node.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  }

  function init(container) {
    if (container.getAttribute('data-gf-ready')) return;
    container.setAttribute('data-gf-ready', '1');
    if (!GF.configured) {
      container.innerHTML = '';
      container.appendChild(GF.el('div', { class: 'gf-error' }, GF.t('unavailable')));
      return;
    }
    container.innerHTML = '';
    var ref = queryParam('gf_session');
    if (ref && /^[0-9a-f]{32}$/.test(ref)) { showReturn(container, ref); return; }
    if (queryParam('gf_use') === 'paid') {
      container.appendChild(GF.el('div', { class: 'gf-sb' }, GF.el('div', { class: 'gf-success', role: 'status' }, GF.t('guPaid'))));
      return;
    }
    container.appendChild(GF.el('div', { class: 'gf-loading', role: 'status' }, GF.t('loading')));
    GF.api('GET', '/sessions/resources').then(function (res) {
      container.innerHTML = '';
      if (GF.voucherInactive(res)) { GF.voucherHide(container); return; }
      var list = ok(res);
      if (!list) { container.appendChild(GF.el('div', { class: 'gf-error' }, refusalText(res))); return; }
      if (!list.length) { container.appendChild(GF.el('div', { class: 'gf-empty' }, GF.t('sbNone'))); return; }
      build(container, list);
    });
  }

  // ── The return page of a payment (rule 16) ─────────────────────────────────────────────────────
  function showReturn(container, ref) {
    var box = GF.el('div', { class: 'gf-sb' });
    container.appendChild(box);
    var tries = 0;
    function wait() { box.innerHTML = ''; box.appendChild(GF.el('div', { class: 'gf-loading', role: 'status' }, GF.t('sbWaiting'))); }
    function again() { box.appendChild(GF.el('a', { class: 'gf-btn', href: window.location.pathname }, GF.t('sbAgain'))); }
    function poll() {
      tries += 1;
      GF.api('GET', '/sessions/status/' + ref).then(function (res) {
        var data = ok(res);
        if (!data) { box.innerHTML = ''; box.appendChild(GF.el('div', { class: 'gf-error', role: 'alert' }, refusalText(res))); return; }
        if (data.state === 'booked') { paintBooked(box, data); box.appendChild(GF.el('a', { class: 'gf-btn', href: window.location.pathname }, GF.t('sbAgain'))); return; }
        if (data.state === 'lapsed') { box.innerHTML = ''; box.appendChild(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('sbLapsed'))); again(); return; }
        if (data.state === 'refundOwed') { box.innerHTML = ''; box.appendChild(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('sbRefund'))); again(); return; }
        if (tries >= POLL_TRIES) { box.innerHTML = ''; box.appendChild(GF.el('div', { class: 'gf-inline-info', role: 'status' }, GF.t('gvStillPending'))); return; }
        setTimeout(poll, POLL_MS);
      });
    }
    wait();
    poll();
  }

  function recapLines(parts, extras) {
    var lines = [];
    (parts || []).forEach(function (p) {
      lines.push(GF.el('div', { class: 'gf-sb-summary-line' }, GF.el('span', {}, p.label), GF.el('span', {}, GF.euro(p.cents / 100))));
    });
    (extras || []).forEach(function (e) {
      lines.push(GF.el('div', { class: 'gf-sb-summary-line' },
        GF.el('span', {}, (e.qty > 1 ? e.qty + ' × ' : '') + e.label, e.detail ? GF.el('small', {}, e.detail) : null), GF.el('span', {}, GF.euro(e.cents / 100))));
    });
    return lines;
  }

  function vatLines(vat) {
    return (vat || []).map(function (row) {
      return GF.el('div', { class: 'gf-sb-summary-line is-vat' }, GF.el('span', {}, GF.t('gvVat', String(row.rate).replace('.', ','))), GF.el('span', {}, GF.euro(row.cents / 100)));
    });
  }

  // « Séance réservée », the day, the slot, the people and the paid recap — never a bare « Paiement reçu » (rule 16).
  function paintBooked(box, data) {
    box.innerHTML = '';
    var recap = data.recap && data.recap.parts ? data.recap : null;
    var done = GF.el('div', { class: 'gf-sb-done', role: 'status' },
      GF.el('h3', {}, GF.t('sbBooked')),
      GF.el('p', {}, GF.t('sbBookedLine', longDay(data.date), data.start, data.end) + (data.people ? ' · ' + GF.t('sbPeopleShort', data.people) : '')),
      GF.el('p', {}, GF.t('sbBookedMail')));
    if (recap) {
      done.appendChild(GF.el('div', { class: 'gf-summary' }, recapLines(recap.parts, recap.extras).concat([
        GF.el('div', { class: 'gf-summary-line gf-summary-total' }, GF.el('span', {}, GF.t('sbPaidLabel')), GF.el('span', {}, GF.euro((recap.dueCents || 0) / 100))),
      ], vatLines(recap.vat))));
    }
    box.appendChild(done);
  }

  // ── The tunnel ──────────────────────────────────────────────────────────────────────────────────
  function build(container, resources) {
    var proof = GF.voucherProof();
    var st = {
      resources: resources, res: null, minutes: 0, people: 2, month: '', days: {}, day: '', slot: null, qty: {}, quote: null,
      voucher: null, code: '', horizonUntil: null, busy: false, tried: false,
    };
    var slotsSeq = 0;
    var quoteSeq = 0;

    var root = GF.el('div', { class: 'gf-sb' });
    var main = GF.el('div', { class: 'gf-sb-main' });
    var summary = GF.el('aside', { class: 'gf-summary', 'aria-label': GF.t('sbSummary') });
    var barAmt = GF.el('div', { class: 'gf-bar-amt' });
    var barGo = GF.el('button', { type: 'button', class: 'gfb-cta' });
    var bar = GF.el('div', { class: 'gf-bar' }, barAmt, barGo);
    root.appendChild(main);
    root.appendChild(summary);
    root.appendChild(bar);
    container.appendChild(root);

    function section(title, hint) {
      var node = GF.el('div', { class: 'gf-sb-sec' }, GF.el('p', { class: 'gf-sb-sec-t' }, title, hint ? GF.el('small', {}, hint) : null));
      main.appendChild(node);
      return node;
    }

    main.appendChild(GF.el('h3', { class: 'gf-sb-title' }, GF.t('sbTitle')));
    main.appendChild(GF.el('p', { class: 'gf-sb-intro' }, GF.t('sbIntro')));

    // ── Activity (rule 1): shown selected and not asked when there is only one ──
    var actBox = GF.el('div', { class: 'gf-sb-acts' });
    var actSection = section(GF.t('sbActivity'));
    actSection.appendChild(actBox);
    if (resources.length === 1) actSection.hidden = true;

    function paintActivities() {
      actBox.innerHTML = '';
      resources.forEach(function (r) {
        var btn = GF.el('button', { type: 'button', class: 'gf-sb-act', 'data-resource': String(r.id), 'aria-pressed': st.res && st.res.id === r.id ? 'true' : 'false' },
          GF.el('b', {}, r.name), GF.el('span', {}, [r.blurb, GF.t('sbFrom', money(r.fromCents))].filter(Boolean).join(' · ')));
        btn.addEventListener('click', function () { if (!st.res || st.res.id !== r.id) choose(r); });
        actBox.appendChild(btn);
      });
    }

    // ── Gift voucher code (rule 15) ──
    var codeSection = section(GF.t('sbCode'), GF.t('sbOptional'));
    var codeInput = GF.el('input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '24', 'aria-label': GF.t('sbCode'), placeholder: 'XXXX-XXXX-XXXX-XXXX',
    });
    var applyBtn = GF.el('button', { type: 'button', class: 'gf-btn gf-btn-line' }, GF.t('sbApply'));
    var codeRow = GF.el('div', { class: 'gf-sb-code' }, codeInput, applyBtn);
    var codeMsg = GF.el('div', { class: 'gf-sb-msg', 'aria-live': 'polite' });
    codeSection.appendChild(codeRow);
    codeSection.appendChild(codeMsg);
    // The gift voucher plugin being off in GuestFlow is known before a field is offered: no code field then.
    GF.api('GET', '/gift-vouchers/offer').then(function (res) { if (GF.voucherInactive(res)) codeSection.hidden = true; });
    codeInput.addEventListener('input', function () { codeInput.value = VC.format(VC.normalise(codeInput.value)); });
    codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyCode(codeInput.value); } });
    applyBtn.addEventListener('click', function () { applyCode(codeInput.value); });

    function say(kind, node) {
      codeMsg.className = 'gf-sb-msg is-' + kind;
      codeMsg.innerHTML = '';
      if (node) codeMsg.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    }

    function applyCode(raw) {
      var code = VC.normalise(raw);
      if (!code) { say('bad', GF.t('sbCodeEmpty')); codeInput.focus(); return; }
      if (code.length !== VC.CODE_LENGTH || !VC.hasValidCheck(code)) { say('bad', GF.t('sbCodeUnknown')); codeInput.focus(); return; }
      applyBtn.disabled = true;
      say('', '');
      proof.attach({ code: code }, { solving: function () {} }).then(function (body) {
        return GF.api('POST', '/gift-vouchers/use', body);
      }).then(function (res) {
        proof.spend();
        applyBtn.disabled = false;
        var data = ok(res);
        if (GF.voucherInactive(res)) { say('bad', GF.t('sbCodeUnknown')); return; }
        if (!data) { say('bad', error(res) && error(res).code === 'VOUCHER_UNKNOWN' ? GF.t('sbCodeUnknown') : refusalText(res)); return; }
        if (data.kind === 'lodging') { lodgingNotice(code); return; }
        var target = resources.filter(function (r) { return r.id === data.resource.id; })[0];
        if (!target) { say('warn', GF.t('sbCodeOtherPage')); return; }
        st.voucher = data;
        st.code = code;
        codeInput.value = '';
        if (!st.res || st.res.id !== target.id) choose(target); else reset();
        paintVoucher();
      });
    }

    function lodgingNotice(code) {
      var page = GF.bookingPageUrl;
      var link = page ? GF.el('a', { href: page.replace(/#.*$/, '') + '#bon=' + encodeURIComponent(code) }, GF.t('sbCodeLodgingGo')) : null;
      say('warn', GF.el('span', {}, GF.t('sbCodeLodging') + ' ', link));
    }

    function paintVoucher() {
      var v = st.voucher;
      codeRow.hidden = !!v;
      if (!v) { say('', ''); return; }
      var drop = GF.el('button', { type: 'button', class: 'gf-btn gf-btn-line' }, GF.t('sbRemove'));
      drop.addEventListener('click', function () { st.voucher = null; st.code = ''; reset(); paintVoucher(); });
      var text = GF.t('sbVoucherOn', v.number, v.title)
        + (v.senderName ? GF.t('sbVoucherFrom', v.senderName) : '') + (v.recipientName ? GF.t('sbVoucherTo', v.recipientName) : '') + ' ';
      say('ok', GF.el('span', {}, text, drop));
    }

    // ── Session: duration and people (rules 3-4) ──
    var sessionSection = section(GF.t('sbSession'));
    var durationHint = GF.el('span', {});
    var durationBox = GF.el('div', { class: 'gf-sb-row' });
    var peopleBox = GF.el('div', { class: 'gf-sb-row' });
    sessionSection.appendChild(durationBox);
    sessionSection.appendChild(peopleBox);

    function paintSession() {
      var r = st.res;
      durationBox.innerHTML = '';
      peopleBox.innerHTML = '';
      if (!r) return;
      var min = st.voucher ? st.voucher.resource.minutes : r.minMinutes;
      durationHint.textContent = st.voucher ? GF.t('sbDurationVoucher', GF.voucherDuration(st.voucher.resource.minutes)) : '';
      durationBox.appendChild(GF.el('div', { class: 'gf-sb-lbl' }, GF.el('b', {}, GF.t('sbDuration')), durationHint));
      durationBox.appendChild(GF.voucherStepper({
        value: st.minutes, min: min, max: r.maxMinutes, step: r.stepMinutes, name: GF.t('sbDuration'), format: GF.voucherDuration,
        onChange: function (n) { st.minutes = n; st.slot = null; st.quote = null; loadSlots(); paintAll(); },
      }));
      peopleBox.appendChild(GF.el('div', { class: 'gf-sb-lbl' }, GF.el('b', {}, GF.t('sbPeople')), GF.el('span', {}, GF.t('sbPeopleHint', String(r.maxPeople)))));
      peopleBox.appendChild(GF.voucherStepper({
        value: st.people, min: 1, max: r.maxPeople, step: 1, name: GF.t('sbPeople'),
        onChange: function (n) { st.people = n; paintSummary(); },
      }));
    }

    // ── Date (rule 5) and slots (rule 6) ──
    var dateSection = section(GF.t('sbDate'));
    var dateHint = dateSection.firstChild.appendChild(GF.el('small', {}));
    var chips = GF.el('div', { class: 'gf-cal-chips', role: 'group', 'aria-label': GF.t('sbDate') });
    var grid = GF.el('div', { class: 'gf-sb-days' });
    dateSection.appendChild(chips);
    dateSection.appendChild(grid);
    var slotSection = section(GF.t('sbSlot'));
    var slotHint = slotSection.firstChild.appendChild(GF.el('small', {}));
    var slotNote = GF.el('p', { class: 'gf-sb-note', 'aria-live': 'polite' });
    var slotsBox = GF.el('div', { class: 'gf-sb-slots' });
    slotSection.appendChild(slotNote);
    slotSection.appendChild(slotsBox);

    var months = [];
    function listMonths() {
      months = [];
      var horizon = (st.voucher && st.voucher.horizonUntil) || (st.res && st.res.horizonUntil) || null;
      var now = new Date();
      var last = horizon ? { y: Number(horizon.slice(0, 4)), m: Number(horizon.slice(5, 7)) - 1 } : null;
      for (var i = 0; i < MAX_MONTHS; i++) {
        var yy = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
        var mm = (now.getMonth() + i) % 12;
        if (last && (yy > last.y || (yy === last.y && mm > last.m))) break;
        months.push({ y: yy, m: mm, key: yy + '-' + two(mm + 1) });
      }
      if (!months.length) months.push({ y: now.getFullYear(), m: now.getMonth(), key: now.getFullYear() + '-' + two(now.getMonth() + 1) });
      chips.innerHTML = '';
      months.forEach(function (mo) {
        var chip = GF.el('button', { type: 'button', class: 'gf-cal-chip', 'data-month': mo.key, 'aria-pressed': 'false' }, GF.date(new Date(mo.y, mo.m, 1), { month: 'long', year: 'numeric' }));
        chip.addEventListener('click', function () { st.month = mo.key; st.day = ''; st.slot = null; st.quote = null; loadSlots(); paintAll(); });
        chips.appendChild(chip);
      });
      dateHint.textContent = horizon ? GF.t('sbDateUntil', GF.date(new Date(horizon + 'T00:00:00'))) : '';
    }

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
          if (free) btn.addEventListener('click', function () { st.day = iso; st.slot = null; st.quote = null; paintGrid(); paintSlots(); paintAll(); });
          else btn.disabled = true;
          cells.appendChild(btn);
        })(d);
      }
      grid.appendChild(cells);
    }

    // What a start costs, as the server says it (rules 9-10): « 113 € · dont soirée », « Inclus dans le bon », « + 63 € · soirée ».
    function tagOf(slot) {
      if (st.voucher) {
        if (!slot.dueCents) return { text: GF.t('sbIncluded'), cls: ' is-in' };
        return { text: '+ ' + money(slot.dueCents) + (slot.evening ? GF.t('sbEvening') : ''), cls: slot.evening ? ' is-evening' : '' };
      }
      return { text: money(slot.dueCents) + (slot.evening ? GF.t('sbWithEvening') : ''), cls: slot.evening ? ' is-evening' : '' };
    }

    function paintSlots() {
      slotsBox.innerHTML = '';
      slotHint.textContent = st.day ? longDay(st.day) : '';
      if (!st.day) { slotNote.textContent = GF.t('sbPickDate'); return; }
      var list = st.days[st.day] || [];
      slotNote.textContent = list.length ? '' : GF.t('sbNoSlot', GF.voucherDuration(st.minutes));
      list.forEach(function (slot) {
        var tag = slot.taken ? { text: GF.t('sbTaken'), cls: '' } : tagOf(slot);
        var btn = GF.el('button', {
          type: 'button', class: 'gf-sb-slot' + tag.cls, 'data-start': slot.start, 'aria-pressed': st.slot === slot.start ? 'true' : 'false',
        }, GF.el('b', {}, slot.start + ' – ' + slot.end), GF.el('span', {}, tag.text));
        if (slot.taken) btn.disabled = true;
        else btn.addEventListener('click', function () { st.slot = slot.start; paintSlots(); requote(); });
        slotsBox.appendChild(btn);
      });
    }

    function extraMinutes() { return st.voucher ? st.minutes - st.voucher.resource.minutes : 0; }

    function loadSlots() {
      paintChips();
      slotsSeq += 1;
      var mine = slotsSeq;
      st.days = {};
      slotNote.textContent = '';
      paintGrid();
      paintSlots();
      if (!st.month || !st.res) return;
      var y = Number(st.month.slice(0, 4));
      var m = Number(st.month.slice(5, 7)) - 1;
      var from = st.month + '-01';
      var to = st.month + '-' + two(new Date(y, m + 1, 0).getDate());
      slotNote.textContent = GF.t('loading');
      var call = st.voucher
        ? GF.api('POST', '/gift-vouchers/use/slots', { code: st.code, from: from, to: to, extraMinutes: extraMinutes() })
        : GF.api('POST', '/sessions/slots', { resourceId: st.res.id, from: from, to: to, minutes: st.minutes });
      call.then(function (res) {
        if (mine !== slotsSeq) return;
        var data = ok(res);
        if (!data) { slotNote.textContent = refusalText(res); return; }
        (data.days || []).forEach(function (day) { st.days[day.date] = day.slots || []; });
        paintGrid();
        paintSlots();
        if (!(data.days || []).length) slotNote.textContent = GF.t('noAvailability');
        // A chosen start that no longer fits is dropped (rule 3).
        if (st.slot && !(st.days[st.day] || []).some(function (s) { return s.start === st.slot && !s.taken; })) { st.slot = null; st.quote = null; paintSlots(); paintAll(); }
      });
    }

    // ── What is added to the session (rule 2) ──
    var addHost = GF.el('div', { class: 'gf-sb-sec' });
    main.appendChild(addHost);
    var fold = null;

    function addOnsOffered() { return st.voucher ? st.voucher.addOns : (st.res ? st.res.addOns : []); }

    function paintFold() {
      addHost.innerHTML = '';
      st.qty = {};
      fold = GF.voucherExtrasFold({
        extraTime: null, addOns: addOnsOffered(), title: GF.t('sbAddTitle'), foot: GF.t('sbAddFoot'),
        onAddOn: function (ref, n) { st.qty[ref] = n; if (st.slot) requote(); },
      });
      addHost.hidden = !fold;
      if (fold) addHost.appendChild(fold);
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
      paintAll();
      var call = st.voucher
        ? GF.api('POST', '/gift-vouchers/use/quote', { code: st.code, start: startOf(), extraMinutes: extraMinutes(), addOns: addOnsRequest() })
        : GF.api('POST', '/sessions/quote', { resourceId: st.res.id, start: startOf(), minutes: st.minutes, addOns: addOnsRequest() });
      call.then(function (res) {
        if (mine !== quoteSeq) return;
        var data = ok(res);
        st.quote = data || null;
        paintSummary(data ? '' : refusalText(res));
        paintBar();
        if (!data) {
          var code = error(res) && error(res).code;
          if (code === 'SLOT_TAKEN' || code === 'BEYOND_HORIZON') { st.slot = null; loadSlots(); }
        }
      });
    }

    // ── Contact and terms (rule 7) ──
    var whoSection = section(GF.t('sbContact'));
    var fields = {};
    function field(key, labelText, input) {
      var cid = GF.uid('gf-sb');
      input.id = cid;
      var err = GF.el('p', { class: 'gf-field-error', id: cid + '-err' });
      input.setAttribute('aria-describedby', cid + '-err');
      var wrap = GF.el('div', { class: 'gf-field' }, GF.el('label', { for: cid }, labelText), input, err);
      fields[key] = { input: input, wrap: wrap, err: err };
      input.addEventListener('input', function () { setError(key, ''); });
      return wrap;
    }
    function setError(key, message) {
      var r = fields[key];
      if (!r) return;
      r.wrap.classList.toggle('is-invalid', !!message);
      if (message) r.input.setAttribute('aria-invalid', 'true'); else r.input.removeAttribute('aria-invalid');
      r.err.textContent = message || '';
    }
    var firstInput = GF.el('input', { type: 'text', autocomplete: 'given-name' });
    var lastInput = GF.el('input', { type: 'text', autocomplete: 'family-name' });
    var emailInput = GF.el('input', { type: 'email', inputmode: 'email', autocomplete: 'email' });
    var phoneInput = GF.el('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel' });
    var termsInput = GF.el('input', { type: 'checkbox' });
    var termsErr = GF.el('p', { class: 'gf-field-error', id: GF.uid('gf-sb-terms-err') });
    termsInput.setAttribute('aria-describedby', termsErr.id);
    var termsLabel = GF.el('label', { class: 'gf-cgv-accept' }, termsInput, GF.el('span', { class: 'gf-sb-terms-text' }));
    fields.terms = { input: termsInput, wrap: termsLabel, err: termsErr };
    termsInput.addEventListener('change', function () { setError('terms', ''); });
    var alertBox = GF.el('p', { class: 'gf-gv-alert gf-sb-msg is-bad', role: 'alert', hidden: 'hidden' });
    function showAlert(message) {
      alertBox.textContent = message || '';
      if (message) alertBox.removeAttribute('hidden'); else alertBox.setAttribute('hidden', 'hidden');
    }
    whoSection.appendChild(GF.el('div', { class: 'gf-sb-who' }, field('firstName', GF.t('firstName'), firstInput), field('lastName', GF.t('lastName'), lastInput)));
    whoSection.appendChild(GF.el('div', { class: 'gf-sb-who' }, field('email', GF.t('email'), emailInput), field('phone', GF.t('phone'), phoneInput)));
    whoSection.appendChild(termsLabel);
    whoSection.appendChild(termsErr);
    whoSection.appendChild(alertBox);

    function paintTerms() {
      var text = termsLabel.querySelector('.gf-sb-terms-text');
      text.innerHTML = '';
      var url = '';
      var versionId = termsVersion();
      if (GF.cgvPageUrl) url = GF.cgvPageUrl + (GF.cgvPageUrl.indexOf('?') === -1 ? '?' : '&') + 'activity=resource';
      text.appendChild(document.createTextNode(GF.t('sbTermsBefore')));
      text.appendChild(url ? GF.el('a', { class: 'gf-link', href: url, target: '_blank', rel: 'noopener' }, GF.t('sbTermsLink')) : document.createTextNode(GF.t('sbTermsLink')));
      text.appendChild(document.createTextNode(GF.t('sbTermsAfter')));
      termsLabel.setAttribute('data-version', String(versionId || ''));
    }
    function termsVersion() { return st.voucher ? st.voucher.termsVersionId : (st.res ? st.res.termsVersionId : null); }

    // ── The recap, the bar and the one button (rules 2, 9, 11) ──
    function dueOf(q) { return q ? q.dueCents : 0; }

    function paintSummary(failure) {
      summary.innerHTML = '';
      var q = st.quote;
      summary.appendChild(GF.el('div', { class: 'gf-summary-head' }, st.res ? st.res.name : ''));
      var when = st.day && st.slot && q ? longDay(q.date) + ' · ' + q.start + ' – ' + q.end + ' · ' + GF.t('sbPeopleShort', st.people) : GF.t('sbSummaryEmpty');
      summary.appendChild(GF.el('div', { class: 'gf-summary-dates' }, failure || when));
      if (q) {
        if (st.voucher) {
          (q.included || []).forEach(function (line) {
            summary.appendChild(GF.el('div', { class: 'gf-sb-summary-line is-included' },
              GF.el('span', {}, (line.qty > 1 ? line.qty + ' × ' : '') + line.label, line.detail ? GF.el('small', {}, line.detail) : null), GF.el('span', {}, GF.t('sbIncludedShort'))));
          });
          if (q.supplement) summary.appendChild(GF.el('div', { class: 'gf-sb-summary-line' }, GF.el('span', {}, q.supplement.label), GF.el('span', {}, GF.euro(q.supplement.cents / 100))));
          (q.extras || []).forEach(function (e) {
            summary.appendChild(GF.el('div', { class: 'gf-sb-summary-line' },
              GF.el('span', {}, (e.qty > 1 ? e.qty + ' × ' : '') + e.label, e.detail ? GF.el('small', {}, e.detail) : null), GF.el('span', {}, GF.euro(e.cents / 100))));
          });
        } else {
          recapLines(q.parts, q.extras).forEach(function (line) { summary.appendChild(line); });
        }
        summary.appendChild(GF.el('div', { class: 'gf-summary-line gf-summary-total' }, GF.el('span', {}, dueOf(q) > 0 ? GF.t('sbToPay') : GF.t('sbNothing')), GF.el('span', {}, GF.euro(dueOf(q) / 100))));
        if (dueOf(q) > 0) vatLines(q.vat).forEach(function (line) { summary.appendChild(line); });
      }
      var go = GF.el('button', { type: 'button', class: 'gfb-cta gf-summary-cta' });
      paintButton(go);
      go.addEventListener('click', onGo);
      summary.appendChild(go);
      summary.appendChild(GF.el('p', { class: 'gf-sb-hold' }, q && dueOf(q) > 0 ? GF.t('sbHold') : ''));
    }

    function labelOf() {
      var q = st.quote;
      if (!st.slot || !q) return GF.t('sbPickSlot');
      return dueOf(q) > 0 ? GF.t('payAmount', GF.euro(dueOf(q) / 100)) : GF.t('confirmBooking');
    }
    function paintButton(button) {
      button.disabled = st.busy;
      if (!st.busy) button.textContent = labelOf();
    }

    function paintBar() {
      var q = st.quote;
      barAmt.innerHTML = '';
      barAmt.appendChild(GF.el('b', {}, q ? (dueOf(q) > 0 ? GF.euro(dueOf(q) / 100) : GF.t('sbNothing')) : '—'));
      barAmt.appendChild(GF.el('small', {}, q ? q.start + ' – ' + q.end : GF.t('sbPickSlotBar')));
      paintButton(barGo);
    }

    function paintAll() {
      paintSummary();
      paintBar();
    }

    // ── Submit (rules 7, 8, 12, 14) ──
    function validate() {
      var first = null;
      function need(key, input, message) { setError(key, message); first = first || input; }
      if (!firstInput.value.trim()) need('firstName', firstInput, GF.t('fieldRequired'));
      if (!lastInput.value.trim()) need('lastName', lastInput, GF.t('fieldRequired'));
      var mail = emailInput.value.trim();
      if (!EMAIL_RE.test(mail)) need('email', emailInput, mail ? GF.t('emailInvalid') : GF.t('fieldRequired'));
      if (!phoneInput.value.trim()) need('phone', phoneInput, GF.t('fieldRequired'));
      if (!termsInput.checked) need('terms', termsInput, GF.t('sbTermsRequired'));
      if (first) { showAlert(GF.t('sbFix')); first.focus(); return false; }
      return true;
    }

    function setBusy(on, label) {
      st.busy = on;
      [barGo].concat(Array.prototype.slice.call(summary.querySelectorAll('.gf-summary-cta'))).forEach(function (b) {
        b.disabled = on;
        if (on) { b.setAttribute('aria-busy', 'true'); b.textContent = label; } else { b.removeAttribute('aria-busy'); }
      });
      if (!on) paintAll();
    }

    function refuse(res) {
      var err = error(res);
      var code = err && err.code;
      var text = refusalText(res);
      var key = fieldOf(res);
      if (key && fields[key]) { setError(key, text); fields[key].input.focus(); return; }
      if (code === 'EMAIL_INVALID') { setError('email', text); emailInput.focus(); return; }
      if (code === 'PHONE_INVALID') { setError('phone', text); phoneInput.focus(); return; }
      if (code === 'TERMS_NOT_ACCEPTED' || code === 'TERMS_OUTDATED') { setError('terms', text); termsInput.focus(); return; }
      showAlert(text);
      if (code === 'SLOT_TAKEN' || code === 'BEYOND_HORIZON') { st.slot = null; st.quote = null; loadSlots(); paintAll(); }
    }

    function bookedHere(data) {
      var box = GF.el('div', { class: 'gf-sb' });
      root.replaceWith(box);
      paintBooked(box, {
        date: data.date, start: data.start, end: data.end, people: st.people,
      });
      box.appendChild(GF.el('a', { class: 'gf-btn', href: window.location.pathname }, GF.t('sbAgain')));
    }

    function confirm(retried) {
      var body = st.voucher ? {
        code: st.code, start: startOf(), extraMinutes: extraMinutes(), addOns: addOnsRequest(),
        firstName: firstInput.value.trim(), lastName: lastInput.value.trim(), people: st.people, email: emailInput.value.trim(), phone: phoneInput.value.trim(),
        termsVersionId: termsVersion() || 0, returnPath: window.location.pathname + '?gf_use=paid',
      } : {
        resourceId: st.res.id, start: startOf(), minutes: st.minutes, addOns: addOnsRequest(), people: st.people,
        firstName: firstInput.value.trim(), lastName: lastInput.value.trim(), email: emailInput.value.trim(), phone: phoneInput.value.trim(),
        termsVersionId: termsVersion() || 0, returnPath: window.location.pathname,
      };
      proof.attach(body, {
        solving: function () { setBusy(true, GF.t('verifying')); },
        sending: function () { setBusy(true, GF.t('sending')); },
      }).then(function () {
        return GF.api('POST', st.voucher ? '/gift-vouchers/use/confirm' : '/sessions/confirm', body);
      }).then(function (res) {
        proof.spend();
        var err = error(res);
        if (!retried && err && (err.code === 'CHALLENGE_INVALID' || err.code === 'PROOF_INVALID')) { confirm(true); return; }
        var data = ok(res);
        if (!data) { setBusy(false); refuse(res); return; }
        if (data.booked) { bookedHere(data); return; }
        var safe = false;
        try { safe = !!data.payUrl && new URL(data.payUrl).protocol === 'https:'; } catch (e) { safe = false; }
        if (!safe) { setBusy(false); refuse({ status: 0, body: {} }); return; }
        setBusy(true, GF.t('redirectingPayment'));
        showAlert('');
        GF.voucherGo(data.payUrl);
      });
    }

    function onGo() {
      if (st.busy) return;
      if (!st.slot || !st.quote) { scrollTo(dateSection); return; }
      showAlert('');
      st.tried = true;
      if (!validate()) return;
      confirm(false);
    }
    barGo.addEventListener('click', onGo);

    // ── Choosing the activity resets the session; removing the voucher too ──
    function reset() {
      var r = st.res;
      st.minutes = st.voucher ? st.voucher.resource.minutes : r.minMinutes;
      st.people = Math.min(Math.max(1, st.people), r.maxPeople);
      st.slot = null; st.quote = null; st.day = '';
      listMonths();
      st.month = months[0].key;
      paintSession();
      paintFold();
      paintTerms();
      loadSlots();
      paintAll();
    }

    function choose(r) {
      if (st.voucher && st.voucher.resource.id !== r.id) { st.voucher = null; st.code = ''; paintVoucher(); }
      st.res = r;
      st.people = Math.min(st.people, r.maxPeople);
      paintActivities();
      reset();
    }

    proof.observe(root);
    paintActivities();
    paintVoucher();
    choose(resources[0]);
    var fromHash = codeFromHash();
    if (fromHash) { codeInput.value = VC.format(fromHash); applyCode(fromHash); }
  }

  document.querySelectorAll('[data-gf-session-booking]').forEach(init);
})();
