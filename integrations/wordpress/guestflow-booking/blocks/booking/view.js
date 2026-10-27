/**
 * Booking wizard frontend (build-free, plain ES) — unified widget (specs/wp-booking-widget-redesign.md).
 * Embeds the availability calendar (the ONLY way to pick dates — the date fields are read-only),
 * stepper controls for the party and every quantity, and one uniform list of options + resources.
 * Loads property detail + options + resources, shows a LIVE quote (computed server-side via the
 * plugin proxy → GuestFlow pricing engine), then submits a booking request (a draft devis, never a
 * confirmed reservation).
 *
 * No pricing/availability logic lives here: the quote and the availability flag come from the server.
 * The client-side blocked-range guard is a UX convenience; `/quote`'s `available` stays authoritative.
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  // Month and weekday names come from the locale the SERVER resolved for this page, not from a
  // list frozen in French. They were the last French left in an otherwise English drawer: every
  // label here already goes through GF.t(), and the runtime already publishes GF.locale — only
  // the calendar's own headings had been missed (specs/site-english-version.md rule 43).
  //
  // Built once, from a week that really starts on a Monday (2024-01-01 was one), so the order
  // matches the grid below rather than the locale's own first day.
  var MONTHS = (function () {
    var fallback = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    try {
      var f = new Intl.DateTimeFormat(GF.locale || 'fr-FR', { month: 'long' });
      var out = [];
      for (var m = 0; m < 12; m++) { out.push(f.format(new Date(2024, m, 1))); }
      return out;
    } catch (e) { return fallback; }
  })();

  var DOW = GF.weekdays();

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayIso() { return isoOf(new Date()); }
  function addDaysIso(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  // Numeric month on purpose: the read-only date fields sit two-per-row in a narrow drawer, and
  // « 28 septembre 2026 » was clipped mid-word where « 28/09/2026 » fits whole. Day/month/year is
  // read the same way in French and in British English, so this one format serves both.
  function shortDate(s) { var d = new Date(s + 'T00:00:00'); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  // GuestFlow specs/google-vacation-rentals-feed.md rule 19 — the landing link Google builds carries
  // the stay: ?checkin=DD/MM/YYYY&checkout=DD/MM/YYYY&guests=N. A malformed, impossible or past value
  // is ignored silently and the block opens empty, as without the link.
  function frDateParam(name) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(queryParam(name) || '');
    if (!m) return null;
    var iso = m[3] + '-' + m[2] + '-' + m[1];
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) || isoOf(d) !== iso ? null : iso;
  }
  function stayFromUrl() {
    var start = frDateParam('checkin');
    var end = frDateParam('checkout');
    var datesOk = !!(start && end && start >= todayIso() && end > start);
    var rawGuests = queryParam('guests') || '';
    var guests = /^\d{1,2}$/.test(rawGuests) ? parseInt(rawGuests, 10) : 0;
    return { start: datesOk ? start : null, end: datesOk ? end : null, guests: guests >= 1 ? guests : null };
  }

  function init(container) {
    var propertyId = parseInt(container.dataset.propertyId, 10) || 0;
    var showOptions = container.dataset.showOptions !== '0';
    var payOnline = container.dataset.payOnline === '1';
    // « Proposer aussi une demande sans paiement » (specs/booking-drawer-friction.md rule 1) only means
    // something next to an online payment: a request-only block already sends nothing but a request.
    var offerRequest = payOnline && container.dataset.offerRequest === '1';

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
      showOptions ? GF.api('GET', '/properties/' + propertyId + '/options') : Promise.resolve({ status: 200, body: { data: { ungrouped: [], groups: [] } } }),
      showOptions ? GF.api('GET', '/properties/' + propertyId + '/resources') : Promise.resolve({ status: 200, body: { data: [] } }),
      // The CGV version the guest will accept (specs/terms-acceptance-record.md rule 10). Absent when
      // nothing is published: GuestFlow then refuses the request itself, with its own message.
      GF.api('GET', '/terms'),
    ]).then(function (r) {
      if (r[0].status < 200 || r[0].status >= 300 || !r[0].body || !r[0].body.data) {
        container.innerHTML = '';
        container.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(r[0])));
        return;
      }
      // No CGV published while GuestFlow requires them: every request would be refused at the end,
      // so the form is not offered at all (specs/wordpress-plugin.md rule 21).
      var termsError = r[3].body && r[3].body.error;
      if (termsError && termsError.code === 'TERMS_NOT_CONFIGURED' && termsError.details && termsError.details[0]
        && termsError.details[0].bookingClosed === true) {
        container.innerHTML = '';
        container.appendChild(GF.el('div', { class: 'gf-error', role: 'status' }, GF.t('bookingClosed')));
        return;
      }
      var termsData = (r[3].status >= 200 && r[3].status < 300 && r[3].body && r[3].body.data) || null;
      build(container, propertyId, r[0].body.data, (r[1].body && r[1].body.data) || {}, (r[2].body && r[2].body.data) || [], payOnline, termsData, offerRequest);
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

    // A reload of the return page must not count the payment twice (specs/site-traffic-analytics.md rule 10).
    function trackPaidOnce(d) {
      try {
        var key = 'gf_paid_' + devisId;
        if (window.sessionStorage.getItem(key)) return;
        window.sessionStorage.setItem(key, '1');
      } catch (e) { /* no storage: count it */ }
      GF.track('booking-paid', { lodging: GF.slug(d.propertyName) });
    }

    function poll() {
      var qs = token ? ('?token=' + encodeURIComponent(token)) : '';
      GF.api('GET', '/booking-requests/' + devisId + '/status' + qs).then(function (res) {
        var d = (res.body && res.body.data) || {};
        if (d.status === 'confirmed' || d.status === 'conflict') {
          if (d.status === 'confirmed') trackPaidOnce(d);
          recap(d);
          return;
        }
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

  function build(container, propertyId, detail, options, resources, payOnline, termsData, offerRequest) {
    var f = {}; // field refs
    var debounceTimer = null;
    var lastQuote = null;
    // Funnel events (specs/site-traffic-analytics.md rule 10) fire once per step change: the quote
    // recomputes on every stepper click, the funnel must not count those.
    var lodging = GF.slug(detail.name);
    var tracked = {};
    function trackOnce(name, key, props) {
      if (tracked[name] === key) return;
      tracked[name] = key;
      GF.track(name, Object.assign({ lodging: lodging }, props || {}));
    }
    function nightsOf(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

    // ---- state (steppers render FROM this, never from input values) ----
    var state = {
      start: null, end: null,
      checkInTime: detail.defaultCheckIn || '16:00',
      checkOutTime: detail.defaultCheckOut || '10:00',
      adults: 2, teens: 0, children: 0, babies: 0, babyBeds: 0,
      opt: {}, res: {},
      // Cancellation insurance (specs/cancellation-insurance.md §3.4): null = not answered yet.
      // Never pre-set — the visitor must choose, and the submit stays locked until they do.
      insurance: null,
    };

    // The cot resource is couchage, not a supplement line: it feeds the devis `babyBeds` field via
    // the conditional baby-beds stepper (spec rule 12), exactly like the previous popup.
    //
    // Recognised by the API's `isBabyBed` flag, never by its title. Matching « Lit bébé » worked only
    // while the API answered in French: once the catalogue translated the resource, an English page
    // received « Baby bed », the test missed, and the cot was offered in the extras to every visitor —
    // babies or none. The name test survives as the fallback for a GuestFlow older than the flag: the
    // plugin updates itself from its own manifest, so it can run ahead of the server.
    var babyRes = null;
    var supplements = (resources || []).filter(function (x) {
      var n = ((x.name || '') + ' ' + (x.nameEn || '')).toLowerCase();
      var isCot = x.isBabyBed === true
        || (x.isBabyBed === undefined && (n.indexOf('lit bébé') >= 0 || n.indexOf('lit bebe') >= 0 || n.indexOf('baby bed') >= 0));
      if (isCot) { babyRes = x; return false; }
      return true;
    });

    // Hide ONLY the time-derived auto-options (arrival/departure are driven by the date/time
    // fields, not a quantity). Paid add-ons (bed/bathroom linen, breakfast, …) stay selectable.
    // See specs/wordpress-plugin.md.
    // `baby_bed` joins them (specs/baby-bed-supplement.md §3.5 rule 18): the cot supplement is
    // derived from the baby-beds stepper below, so offering it as a tickable line would let the
    // visitor order it twice.
    var HIDDEN_AUTO = { early_check_in: 1, late_check_out: 1, baby_bed: 1 };
    function selectable(list) {
      return (list || []).filter(function (o) { return !HIDDEN_AUTO[o.autoOptionType]; });
    }
    // The options payload is grouped server-side (specs/option-categories.md §4.4):
    // `{ ungrouped, groups: [{ category, options }] }`. Tolerate a bare array so a stale proxy
    // cache from before the change still renders (everything then lands in the flat list).
    var pickable = selectable(Array.isArray(options) ? options : (options && options.ungrouped));
    var optionGroups = (!Array.isArray(options) && options && options.groups ? options.groups : [])
      .map(function (g) { return { category: g.category, options: selectable(g.options) }; })
      .filter(function (g) { return g.options.length > 0; });
    // The insurance travels in its own key, already excluded from ungrouped/groups server-side
    // (specs/cancellation-insurance.md §3.3 rule 18). Absent (unconfigured, or a stale proxy cache
    // from before the change) → no block and no mandatory question, the funnel behaves as before.
    var insurance = (!Array.isArray(options) && options && options.cancellationInsurance) || null;
    // Which categories the visitor has unfolded. Collapsed by default (rule 15).
    var openGroups = {};

    function persons() { return (state.adults || 0) + (state.teens || 0) + (state.children || 0); }

    // ---- availability (blocked nights), loaded forward as the visitor navigates ----
    var blocked = {};
    var loadedTo = null; // ISO date up to which blockedDates are known
    // Per bookable arrival, its minimum stay and earliest departure; per free night, its price — both
    // computed by GuestFlow (specs/booking-drawer-friction.md rules 10 + 13). `hasWindows` stays false
    // against a GuestFlow older than that: the calendar then behaves exactly as before.
    var arrivals = {};
    var nightPrices = {};
    var hasWindows = false;
    function isBlocked(d) { return !!blocked[d]; }
    function arrivalOf(d) { return hasWindows ? arrivals[d] || null : null; }
    function isShortDeparture(d) {
      var a = state.start && arrivalOf(state.start);
      return !!(a && d > state.start && d < a.earliestDeparture);
    }
    function longDate(iso) { return GF.date(iso + 'T00:00:00', { day: 'numeric', month: 'long' }); }
    function rangeHasBlocked(a, b) { var c = a; while (c < b) { if (isBlocked(c)) return true; c = addDaysIso(c, 1); } return false; }

    // The first bookable arrival on or after each window the server was asked about
    // (`nextAvailableDate`, specs/wp-booking-widget-redesign.md rule 30): [{ from, next }], `next`
    // null when there is none within a year. A GuestFlow older than the field answers without it:
    // nothing is recorded, and the calendar simply shows no way out, as before.
    var nextReplies = [];
    function recordNext(from, data) {
      if (data && Object.prototype.hasOwnProperty.call(data, 'nextAvailableDate')) nextReplies.push({ from: from, next: data.nextAvailableDate || null });
    }
    // What the answers already received say about « the first bookable arrival on or after `day` »:
    // an answer from an earlier day settles it unless its arrival lies before `day`. undefined = unknown.
    function knownNextFrom(day) {
      for (var i = 0; i < nextReplies.length; i++) {
        var r = nextReplies[i];
        if (r.from <= day && (r.next === null || r.next >= day)) return r.next;
      }
      return undefined;
    }
    function nextFreeFrom(startIso, untilIso) {
      var known = knownNextFrom(startIso);
      if (known !== undefined) return Promise.resolve(known);
      return GF.api('GET', '/properties/' + propertyId + '/availability?from=' + startIso + '&to=' + untilIso).then(function (res) {
        var data = res.status >= 200 && res.status < 300 && res.body && res.body.data;
        recordNext(startIso, data);
        return (data && data.nextAvailableDate) || null;
      });
    }

    function ensureAvailability(untilIso) {
      if (loadedTo && untilIso <= loadedTo) return Promise.resolve();
      var from = loadedTo || todayIso();
      return GF.api('GET', '/properties/' + propertyId + '/availability?from=' + from + '&to=' + untilIso).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data) {
          var data = res.body.data;
          (data.blockedDates || []).forEach(function (x) { blocked[x] = true; });
          recordNext(from, data);
          if (Array.isArray(data.arrivals)) {
            hasWindows = true;
            data.arrivals.forEach(function (a) { arrivals[a.date] = a; });
            (data.nightPrices || []).forEach(function (n) { nightPrices[n.date] = n.price; });
          }
          loadedTo = untilIso;
        }
      });
    }

    // ---- calendar (range select — the ONLY way to set the dates, spec §3.1-4) ----
    var calBase = firstOfMonth(new Date());
    var calMonths = GF.el('div', { class: 'gf-cal-wrap' });
    // Spoken as it changes: the hint is where a refused date explains itself (rule 15).
    var calHint = GF.el('div', { class: 'gf-cal-hint', role: 'status', 'aria-live': 'polite' });
    // « Prochaine disponibilité » — shown only when the two visible months hold no bookable arrival (rule 30).
    var calNext = GF.el('div', { class: 'gf-cal-next', 'aria-live': 'polite' });
    // What the day states mean (rule 31): free, taken, and the stay being chosen.
    var calLegend = GF.el('div', { class: 'gf-cal-legend', 'aria-hidden': 'true' },
      GF.el('span', {}, GF.el('i', { class: 'gf-sw-free' }), GF.t('legendFree')),
      GF.el('span', {}, GF.el('i', { class: 'gf-sw-taken' }), GF.t('legendTaken')),
      GF.el('span', {}, GF.el('i', { class: 'gf-sw-stay' }), GF.t('stayRecap'))
    );
    var calPrev = GF.el('button', { class: 'gf-cal-nav', type: 'button', 'aria-label': GF.t('calPrevMonth'), onClick: function () { navCal(-1); } }, '‹');
    var calBox = GF.el('div', { class: 'gf-cal-box' },
      GF.el('div', { class: 'gf-cal-topbar' },
        calPrev,
        GF.el('strong', {}, GF.t('selectDates')),
        GF.el('button', { class: 'gf-cal-nav', type: 'button', 'aria-label': GF.t('calNextMonth'), onClick: function () { navCal(1); } }, '›')
      ),
      calNext, calMonths, calHint, calLegend
    );

    // The month strip slides the way the visitor asked to go (CSS handles reduced motion).
    var slideDir = 0;
    function navCal(dir) {
      var next = addMonths(calBase, dir);
      if (next < firstOfMonth(new Date())) return; // past months hold nothing selectable
      calBase = next;
      slideDir = dir;
      renderCal();
    }
    // « Voir » rebuilds the grid under the button that held the focus: the focus moves to the day
    // the box announced, so a keyboard or screen-reader user lands where the eye does.
    var focusDay = null;
    function jumpTo(iso) {
      var target = firstOfMonth(new Date(iso + 'T00:00:00'));
      slideDir = target > calBase ? 1 : -1;
      calBase = target;
      focusDay = iso;
      renderCal();
    }

    // `hint` overrides the default « pick a date » nudge. It is NOT optional sugar: availability
    // resolves asynchronously, so a caller that set an error message before calling renderCal saw it
    // wiped one microtask later by the default — which is how a refused stay ended up greying the
    // next button while saying only « Sélectionnez votre date de départ ».
    var renderSeq = 0;
    function renderCal(hint) {
      var windowStart = isoOf(calBase);
      var windowEnd = isoOf(addMonths(calBase, 2));
      var seq = ++renderSeq;
      ensureAvailability(windowEnd).then(function () {
        if (seq !== renderSeq) return;
        // A re-render rebuilds every day: the one that held the focus gets it back.
        var focused = focusDay || (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.gfDay : null);
        focusDay = null;
        calMonths.innerHTML = '';
        for (var i = 0; i < 2; i++) calMonths.appendChild(monthGrid(addMonths(calBase, i)));
        if (focused) {
          var again = calMonths.querySelector('[data-gf-day="' + focused + '"]');
          if (again) again.focus({ preventScroll: true });
        }
        if (slideDir) {
          calMonths.classList.remove('gf-slide-next', 'gf-slide-prev');
          void calMonths.offsetWidth; // restart the animation on a quick second click
          calMonths.classList.add(slideDir > 0 ? 'gf-slide-next' : 'gf-slide-prev');
          slideDir = 0;
        }
        calPrev.disabled = calBase <= firstOfMonth(new Date());
        renderNextFree(seq, windowStart, windowEnd, hint);
        if (hint) { setHint(hint.msg, hint.isError); return; }
        setHint(defaultHint());
      });
    }

    // Nothing to book in the two months on screen: say when the first bookable arrival is, and offer
    // to go there. The date is the server's — it knows the minimum stay and the arrival days, which a
    // free cell does not show. The answers already received are reused; a window with no free cell
    // and no answer about it asks once more.
    function renderNextFree(seq, windowStart, windowEnd, hint) {
      calNext.innerHTML = '';
      var today = todayIso();
      var from = windowStart > today ? windowStart : today;
      if (knownNextFrom(from) === undefined) {
        for (var d = from; d < windowEnd; d = addDaysIso(d, 1)) { if (!isBlocked(d)) return; }
      }
      nextFreeFrom(from, windowEnd).then(function (next) {
        if (seq !== renderSeq || !next || next < windowEnd) return;
        var label = GF.date(new Date(next + 'T00:00:00'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        calNext.appendChild(GF.el('span', {}, GF.t('nextAvailable', label)));
        calNext.appendChild(GF.el('button', { type: 'button', class: 'gf-cal-next-go', onClick: function () { jumpTo(next); } }, GF.t('nextAvailableGo')));
        // The prompt to pick an arrival would contradict the box: nothing here can be picked.
        if (!hint) setHint('');
      });
    }

    // What the next click will do, spelled out. A complete range is still editable — nothing else
    // on screen says so, and a visitor who had to guess ended up rebuilding the whole selection.
    function defaultHint() {
      if (!state.start) return GF.t('pickArrival');
      if (!state.end) return GF.t('pickDeparture');
      return GF.t('changeDeparture');
    }

    function setHint(msg, isError) {
      calHint.textContent = msg || '';
      calHint.className = 'gf-cal-hint' + (isError ? ' gf-cal-hint-error' : '');
      // A refusal the visitor never scrolls to explains nothing. The calendar is two months tall on
      // a phone, so a date picked low in the grid can leave the message off-screen.
      if (isError && calHint.scrollIntoView) calHint.scrollIntoView({ block: 'nearest' });
    }

    function monthGrid(monthDate) {
      var year = monthDate.getFullYear();
      var month = monthDate.getMonth();
      var grid = GF.el('div', { class: 'gf-cal-grid' });
      DOW.forEach(function (d) { grid.appendChild(GF.el('div', { class: 'gf-cal-dow', 'aria-hidden': 'true' }, d)); });
      var lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-based
      for (var i = 0; i < lead; i++) grid.appendChild(GF.el('div', { class: 'gf-cal-day gf-empty-cell' }));
      var days = new Date(year, month + 1, 0).getDate();
      var today = todayIso();
      for (var d = 1; d <= days; d++) {
        var ds = year + '-' + pad(month + 1) + '-' + pad(d);
        // Only a night that is actually taken is closed. A date sitting before the arrival, or one
        // whose range would cross a taken night, stays clickable and lands a new arrival: closing
        // them killed half the calendar as soon as an arrival was picked.
        var past = ds < today;
        var taken = !past && isBlocked(ds);
        // With the server's windows, a date that can neither start a stay nor end the current one
        // is closed like a taken night (specs/booking-drawer-friction.md rule 10, first edge case).
        var asDeparture = state.start && ds > state.start && !rangeHasBlocked(state.start, ds);
        if (!past && !taken && hasWindows && !asDeparture && ds !== state.start && !arrivalOf(ds)) taken = true;
        var disabled = past || taken;
        var short = !disabled && isShortDeparture(ds);
        // Past and taken never look alike (rule 31): a past day is noise, a taken night is news.
        var cls = 'gf-cal-day' + (past ? ' gf-past' : (taken ? ' gf-taken' : ''));
        if (state.start && ds === state.start) cls += ' gf-edge';
        if (state.end && ds === state.end) cls += ' gf-edge';
        if (state.start && state.end && ds > state.start && ds < state.end) cls += ' gf-range';
        if (short) cls += ' gf-short';
        // Under the day: the minimum a too-short departure misses, or the night's price (rules 11, 13).
        var under = null;
        if (short) under = GF.el('small', { class: 'gf-cal-price', 'aria-hidden': 'true' }, GF.t('minShort', arrivalOf(state.start).minNights));
        else if (!disabled && nightPrices[ds] != null) under = GF.el('small', { class: 'gf-cal-price', 'aria-hidden': 'true' }, String(Math.round(nightPrices[ds])));
        // Read in full, with its state (rule 15): « vendredi 6 novembre 2026, indisponible ».
        var isEdge = (state.start && ds === state.start) || (state.end && ds === state.end);
        var btn = GF.el('button', {
          type: 'button', class: cls, disabled: disabled ? 'disabled' : null,
          'aria-label': GF.dayLabel(year, month, d, taken),
          'aria-pressed': isEdge ? 'true' : 'false',
          'aria-disabled': short ? 'true' : null,
          'data-gf-day': ds,
          onClick: (function (iso) { return function (ev) { onPick(iso, ev && ev.currentTarget); }; })(ds),
        }, String(d), under);
        grid.appendChild(btn);
      }
      var label = MONTHS[month] + ' ' + year;
      return GF.el('div', { class: 'gf-cal-month' }, GF.el('div', { class: 'gf-cal-title' }, label), grid);
    }

    // The arrival anchors the selection (spec §3.4): once it is set, every later date is a
    // departure — whether one was already chosen or not — so a stay is lengthened or shortened in
    // one click. Clicking the arrival itself is the way out: it starts the choice over.
    function onPick(ds, btn) {
      if (state.start && ds === state.start) { clearDates(); return; }
      // A departure under the minimum is refused where it is tapped, and the earliest valid one is
      // named (specs/booking-drawer-friction.md rule 11) — the visitor no longer learns the rule from
      // a refused quote.
      if (isShortDeparture(ds)) {
        if (btn) { btn.classList.remove('gf-shake'); void btn.offsetWidth; btn.classList.add('gf-shake'); }
        setHint(GF.t('minNightsPick', arrivalOf(state.start).minNights, longDate(arrivalOf(state.start).earliestDeparture)), true);
        GF.track('booking-unavailable', { lodging: lodging, reason: 'min-nights-tap' });
        return;
      }
      if (!state.start || ds < state.start) { state.start = ds; state.end = null; afterDatesChange(arrivalHint(ds)); return; }
      if (rangeHasBlocked(state.start, ds)) { state.start = ds; state.end = null; afterDatesChange({ msg: GF.t('rangeBlocked'), isError: true }); return; }
      state.end = ds;
      afterDatesChange();
    }

    // Rule 12: right after the arrival, say how far the stay must go.
    function arrivalHint(ds) {
      var a = arrivalOf(ds);
      return a && a.minNights > 1 ? { msg: GF.t('minNightsFrom', longDate(a.earliestDeparture), a.minNights) } : undefined;
    }

    function clearDates() {
      state.start = null;
      state.end = null;
      afterDatesChange();
    }

    function afterDatesChange(hint) {
      if (state.start && state.end) trackOnce('booking-dates', state.start + '|' + state.end, { nights: nightsOf(state.start, state.end) });
      f.startDisplay.value = state.start ? shortDate(state.start) : '—';
      f.endDisplay.value = state.end ? shortDate(state.end) : '—';
      f.clearDates.disabled = !state.start && !state.end;
      renderCal(hint);
      scheduleQuote();
    }

    // A field and its label, tied by `for` so a screen reader names the input (rule 15).
    function field(labelText, input, extraClass) {
      var id = GF.uid('gf-field');
      input.setAttribute('id', id);
      return GF.el('div', { class: 'gf-field' + (extraClass ? ' ' + extraClass : '') }, GF.el('label', { for: id }, labelText), input);
    }

    // ---- read-only date recap + time selects (spec §3.3, §3.5) ----
    f.startDisplay = GF.el('input', { type: 'text', class: 'gf-ro', readonly: 'readonly', tabindex: '-1', 'aria-readonly': 'true', value: '—' });
    f.endDisplay = GF.el('input', { type: 'text', class: 'gf-ro', readonly: 'readonly', tabindex: '-1', 'aria-readonly': 'true', value: '—' });
    f.checkInTime = GF.el('input', { type: 'time', value: state.checkInTime, onInput: function () { state.checkInTime = f.checkInTime.value; scheduleQuote(); } });
    f.checkOutTime = GF.el('input', { type: 'time', value: state.checkOutTime, onInput: function () { state.checkOutTime = f.checkOutTime.value; scheduleQuote(); } });

    // Second way out of a selection, sitting next to the values it clears (the first is clicking
    // the arrival in the grid). Disabled while there is nothing to clear.
    f.clearDates = GF.el('button', {
      type: 'button', class: 'gf-dates-clear', disabled: 'disabled',
      title: GF.t('clearDates'), 'aria-label': GF.t('clearDates'),
      onClick: function () { clearDates(); },
    }, '✕', GF.el('span', {}, GF.t('clearDatesShort')));

    // The dates, then the two times on a row of their own: sharing one row, « Heure de départ »
    // wrapped alone onto a second line (specs/wp-booking-widget-redesign.md rule 32).
    var datesRow = GF.el('div', { class: 'gf-row' },
      field(GF.t('startDate'), f.startDisplay),
      field(GF.t('endDate'), f.endDisplay),
      GF.el('div', { class: 'gf-field gf-field-clear' }, f.clearDates)
    );
    var timesRow = GF.el('div', { class: 'gf-row gf-row-times' },
      field(GF.t('checkInTime'), f.checkInTime, 'gf-field-time'),
      field(GF.t('checkOutTime'), f.checkOutTime, 'gf-field-time')
    );

    // ---- stepper (− n +), the single quantity control of the widget (spec §3.6-7, ≥44px) ----
    // `name` is the line the stepper counts: its buttons read « Ajouter : Adultes » (rule 15).
    function stepper(get, set, min, max, name) {
      var val = GF.el('span', { class: 'gf-step-val' }, String(get()));
      function ceiling() { return (typeof max === 'function') ? max() : (max == null ? 99 : max); }
      // Repaint WITHOUT asking for a new quote: the quote itself is what tells us the number moved
      // (a cap lowered it), and re-quoting from here would loop.
      function repaint() {
        val.textContent = String(get());
        inc.disabled = get() >= ceiling();
      }
      function apply(v) { set(v); repaint(); scheduleQuote(); }
      var dec = GF.el('button', { type: 'button', class: 'gf-step-btn', 'aria-label': GF.t('stepRemove', name || ''), onClick: function () { apply(Math.max(min, get() - 1)); } }, '−');
      var inc = GF.el('button', {
        type: 'button', class: 'gf-step-btn', 'aria-label': GF.t('stepAdd', name || ''),
        onClick: function () { apply(Math.min(ceiling(), get() + 1)); },
      }, '+');
      val.setAttribute('aria-live', 'polite');
      var node = GF.el('span', { class: 'gf-step', role: 'group', 'aria-label': name || null }, dec, val, inc);
      node.gfRepaint = repaint;
      repaint();
      return node;
    }

    // Uniform row: [title + subtitle] … [price italic] [stepper] — one layout for guests, options
    // and resources (spec §3.7). `note`/`desc` render under the row when provided.
    function line(title, subtitle, priceText, control, extras) {
      var main = GF.el('div', { class: 'gf-line-main' },
        GF.el('div', { class: 'gf-line-title' }, title),
        subtitle ? GF.el('div', { class: 'gf-line-sub' }, subtitle) : null
      );
      var head = GF.el('div', { class: 'gf-line-head' },
        main,
        priceText ? GF.el('span', { class: 'gf-line-price' }, priceText) : null,
        control
      );
      var wrap = GF.el('div', { class: 'gf-line' }, head);
      (extras || []).forEach(function (x) { if (x) wrap.appendChild(x); });
      return wrap;
    }

    // ---- Voyageurs (spec §3.6) ----
    // The cot supplement's unit price, straight from the catalogue the API serves — the plugin never
    // hardcodes an amount (specs/baby-bed-supplement.md §3.5 rule 17). 0 / absent = this logement
    // does not charge for cots, and the row keeps its « selon disponibilité » wording.
    var babyBedPrice = (function () {
      var all = Array.isArray(options) ? options : [].concat(
        (options && options.ungrouped) || [],
        ((options && options.groups) || []).reduce(function (acc, g) { return acc.concat(g.options || []); }, [])
      );
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].autoOptionType === 'baby_bed') return Number(all[i].price || 0);
      }
      return 0;
    })();
    var babyBedsSub = babyBedPrice > 0
      ? GF.t('babyBedsSubPriced', GF.euro(babyBedPrice))
      : GF.t('babyBedsSub');

    var babyBedsHolder = GF.el('div', {});
    function renderBabyBeds() {
      babyBedsHolder.innerHTML = '';
      if (state.babies > 0 && babyRes) {
        babyBedsHolder.appendChild(line(GF.t('babyBedsLabel'), babyBedsSub, null,
          stepper(function () { return state.babyBeds; }, function (v) { state.babyBeds = Math.min(v, state.babies); }, 0, function () { return state.babies; }, GF.t('babyBedsLabel'))));
      } else {
        state.babyBeds = 0;
      }
    }

    // Capacity — ONE total for everyone over 2, babies apart (GuestFlow
    // specs/property-capacity-single-total.md §3 rule 13). Capping the steppers here is what stops a
    // visitor composing an occupancy the API would reject with 409 OVER_CAPACITY at submit time.
    // The server never advertises 0 any more (it falls back to the included guests, then 2 —
    // specs/site-extra-guest-line.md rule 6); `|| 2` only covers an older server, with the same floor.
    var maxGuests = Number(detail.maxGuests || detail.maxAdults || 0) || 2;
    var maxBabies = Number(detail.maxBabies || 0);
    // The widget opens on 2 adults — a 1-guest property would start over capacity.
    if (state.adults > maxGuests) state.adults = maxGuests;
    // Rule 19 — the party size of the link, when the property can host it.
    var stayInUrl = stayFromUrl();
    if (stayInUrl.guests && stayInUrl.guests <= maxGuests) state.adults = stayInUrl.guests;
    function guestCap(get) {
      return function () {
        return get() + Math.max(0, maxGuests - persons());
      };
    }
    var capacityNote = GF.t('capacity') + ' : ' + maxGuests + ' ' + GF.t('guestsUnit')
      + (maxBabies ? ' · ' + maxBabies + ' ' + GF.t('babiesUnit') : '');
    // The base price covers a number of guests; every one beyond pays a supplement the live summary
    // prices (specs/site-extra-guest-line.md rule 4). No amount here: it depends on season and tiers.
    var includedGuests = Number(detail.basePriceIncludedGuests || 0);
    var includedNote = (includedGuests > 0 && maxGuests > includedGuests)
      ? GF.t('includedGuestsNote', includedGuests)
      : null;

    var guestsBox = GF.el('div', { class: 'gf-section' },
      GF.el('div', { class: 'gf-section-title' }, GF.t('travelers')),
      GF.el('div', { class: 'gf-line-sub' }, capacityNote),
      includedNote ? GF.el('div', { class: 'gf-line-sub' }, includedNote) : null,
      GF.el('div', { class: 'gf-lines' },
        line(GF.t('adults'), null, null, stepper(function () { return state.adults; }, function (v) { state.adults = v; renderSupplements(); }, 1, guestCap(function () { return state.adults; }), GF.t('adults'))),
        line(GF.t('teens'), GF.t('teensAges'), null, stepper(function () { return state.teens; }, function (v) { state.teens = v; renderSupplements(); }, 0, guestCap(function () { return state.teens; }), GF.t('teens'))),
        line(GF.t('children'), GF.t('childrenAges'), null, stepper(function () { return state.children; }, function (v) { state.children = v; renderSupplements(); }, 0, guestCap(function () { return state.children; }), GF.t('children'))),
        line(GF.t('babies'), GF.t('babiesAges'), null, stepper(function () { return state.babies; }, function (v) { state.babies = v; if (state.babyBeds > v) state.babyBeds = v; renderBabyBeds(); }, 0, function () { return maxBabies; }, GF.t('babies'))),
        babyBedsHolder
      )
    );

    // Per-option server caps and the nodes that render them. Filled by each quote, read by the
    // steppers: a cap is a stay's property, not the catalogue's (specs/site-meal-portions.md).
    var optionCaps = {};
    var optionNodes = {};

    // ---- Options & suppléments — ONE uniform list (spec §3.7-14) ----
    var supplementsList = GF.el('div', { class: 'gf-lines' });
    var groupsHolder = GF.el('div', {});
    var supplementsBox = (pickable.length || supplements.length || optionGroups.length)
      ? GF.el('div', { class: 'gf-section' }, GF.el('div', { class: 'gf-section-title' }, GF.t('supplements')), supplementsList, groupsHolder)
      : null;

    function priceText(item) {
      if (!item.price) return null;
      return GF.euro(item.price) + (item.priceUnitLabel ? ' · ' + item.priceUnitLabel : '');
    }

    // One selectable option row. `onChange` lets a category refresh its picked count without
    // re-rendering the whole list (which would steal focus mid-click).
    function optionLine(o, onChange) {
      if (!(o.id in state.opt)) state.opt[o.id] = 0;
      var progressive = o.priceType === 'per_participant_progressive';
      if (progressive && state.opt[o.id] > Math.max(1, persons())) state.opt[o.id] = Math.max(1, persons());
      var titleGroup = [o.title || ''];
      var extras = [];
      if (o.description) {
        var descBox = GF.el('div', { class: 'gf-line-desc', style: 'display:none' }, o.description);
        extras.push(descBox);
        titleGroup.push(GF.el('button', {
          type: 'button', class: 'gf-info-btn', title: o.description, 'aria-label': GF.t('moreInfo'),
          onClick: (function (box) { return function () { box.style.display = box.style.display === 'none' ? 'block' : 'none'; }; })(descBox),
        }, 'ⓘ'));
      }
      // No « à planifier » note on options — it belongs to host-scheduled resources only (spec §3.9).
      // The cap of a per-person card option (« 12 petits déjeuners au maximum ») is the server's to
      // decide and arrives with each quote, so it is read at click time from `optionCaps`
      // (specs/site-meal-portions.md rules 7-8).
      var max = function () {
        var server = optionCaps[o.id];
        if (progressive) return Math.max(1, persons());
        return server == null ? 99 : server;
      };
      // Where that cap explains itself, once the stay has dates and guests.
      var hint = GF.el('div', { class: 'gf-line-note', style: 'display:none' }, '');
      extras.push(hint);
      var step = stepper(
        function () { return state.opt[o.id]; },
        function (v) { state.opt[o.id] = v; if (onChange) onChange(); },
        0,
        max,
        o.title || ''
      );
      optionNodes[o.id] = { step: step, hint: hint, onChange: onChange };
      return line(
        GF.el('span', {}, titleGroup),
        o.quantityLabel || null,
        priceText(o),
        step,
        extras
      );
    }

    // A collapsible category (specs/option-categories.md §3 rules 15-16). Options the visitor has
    // already picked render ABOVE the fold and stay visible when the section is closed — a folded
    // section must never hide a charge.
    function renderGroup(group) {
      // Pinned = picked by the visitor, OR flagged `alwaysVisible` in the catalogue (rule 9bis) —
      // that's how « Petit déjeuner » keeps showing even though it now sits inside a category.
      function isPinned(o) { return o.alwaysVisible === true || (state.opt[o.id] || 0) > 0; }
      var open = Boolean(openGroups[group.category]);

      // The count is what's actually SELECTED — an always-visible line nobody picked must not
      // inflate it.
      function selectedCount() {
        return group.options.filter(function (o) { return (state.opt[o.id] || 0) > 0; }).length;
      }
      var countNode = GF.el('span', { class: 'gf-group-count' }, selectedCount() ? String(selectedCount()) : '');
      var head = GF.el('button', {
        type: 'button',
        class: 'gf-group-head',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': GF.t('categoryAria', group.category),
      },
        GF.el('span', { class: 'gf-group-title' }, group.category),
        countNode,
        GF.el('span', { class: 'gf-group-chevron' })
      );

      var pinnedBox = GF.el('div', { class: 'gf-lines' });
      var bodyLines = GF.el('div', { class: 'gf-lines' });
      var body = GF.el('div', { class: 'gf-group-body' + (open ? ' is-open' : '') }, bodyLines);
      var toggle = GF.el('button', { type: 'button', class: 'gf-group-toggle' }, '');

      // One node per option, built once. Picking a line MOVES its node between the pinned box and
      // the folded body instead of re-rendering the group — a re-render would rebuild the stepper
      // the visitor is clicking and steal its focus.
      var nodes = {};
      group.options.forEach(function (o) { nodes[o.id] = optionLine(o, sync); });

      // Re-home the lines in the category's own order, so one that becomes pinned lands in its
      // right place rather than at the end. Only nodes actually out of position are touched —
      // re-inserting a node that is already correct would blur whatever is focused inside it.
      function place(container, list) {
        list.forEach(function (o, i) {
          var node = nodes[o.id];
          if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
        });
      }
      function sync() {
        // Moving a node across parents blurs whatever is focused inside it — which is exactly what
        // happens to the « + » button on the click that takes a line from 0 to 1. Restore it, or a
        // keyboard user loses their place mid-interaction.
        var active = document.activeElement;
        var refocus = active && pinnedBox.parentNode && pinnedBox.parentNode.contains(active) ? active : null;
        place(pinnedBox, group.options.filter(isPinned));
        place(bodyLines, group.options.filter(function (o) { return !isPinned(o); }));
        if (refocus && document.activeElement !== refocus) refocus.focus();
        var n = selectedCount();
        countNode.textContent = n ? String(n) : '';
        syncToggle();
      }

      function syncToggle() {
        var pinnedCount = group.options.filter(isPinned).length;
        var restCount = group.options.length - pinnedCount;
        // Nothing left to reveal → no affordance, rather than a button opening an empty box.
        if (restCount === 0) { toggle.style.display = 'none'; return; }
        toggle.style.display = '';
        toggle.textContent = openGroups[group.category]
          ? GF.t('collapse')
          : (pinnedCount ? GF.t('showOthers', restCount) : GF.t('showCategory', restCount));
      }
      function flip() {
        openGroups[group.category] = !openGroups[group.category];
        var nowOpen = Boolean(openGroups[group.category]);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        body.className = 'gf-group-body' + (nowOpen ? ' is-open' : '');
        syncToggle();
      }
      head.addEventListener('click', flip);
      toggle.addEventListener('click', flip);
      sync();

      return GF.el('div', { class: 'gf-group' }, head, pinnedBox, body, toggle);
    }

    function renderSupplements() {
      supplementsList.innerHTML = '';
      // The rows are rebuilt from scratch here, so the registry must not keep pointing at the old
      // nodes (this runs when the party changes, which is also when the caps move).
      optionNodes = {};
      pickable.forEach(function (o) { supplementsList.appendChild(optionLine(o)); });
      supplements.forEach(function (r) {
        if (!(r.id in state.res)) state.res[r.id] = 0;
        var extras = [];
        // The offered allowance, worded by the server (« 1 h offerte par séjour »). It belongs on the
        // row, not only in the summary: the visitor decides here, and a price alone read as « every
        // hour costs 30 € ».
        if (r.freeLabel) extras.push(GF.el('div', { class: 'gf-line-free' }, r.freeLabel));
        if (r.showsSchedulingNote) extras.push(GF.el('div', { class: 'gf-line-note' }, GF.t('toBeScheduled')));
        supplementsList.appendChild(line(
          r.name || '',
          r.quantityLabel || null,
          priceText(r),
          stepper(function () { return state.res[r.id]; }, function (v) { state.res[r.id] = v; }, 0, null, r.name || ''),
          extras
        ));
      });
      groupsHolder.innerHTML = '';
      optionGroups.forEach(function (g) { groupsHolder.appendChild(renderGroup(g)); });
    }

    // ---- Assurance annulation — its own block, with a mandatory Oui/Non choice (spec §3.4) ----
    // Rendered between the supplements and the price summary: the visitor sees what the stay costs
    // to insure just before committing, and cannot submit without answering.
    var insuranceAmount = GF.el('span', { class: 'gf-line-price' }, insurance ? insurance.priceLabel : '');
    var insuranceNotice = GF.el('div', { 'aria-live': 'polite' });
    var insuranceYes = null;
    var insuranceNo = null;
    var insuranceBox = null;
    if (insurance) {
      var paintInsurance = function () {
        insuranceYes.className = 'gf-choice' + (state.insurance === true ? ' gf-choice-on' : '');
        insuranceNo.className = 'gf-choice' + (state.insurance === false ? ' gf-choice-on' : '');
        insuranceYes.setAttribute('aria-pressed', state.insurance === true ? 'true' : 'false');
        insuranceNo.setAttribute('aria-pressed', state.insurance === false ? 'true' : 'false');
      };
      var answer = function (value) {
        return function () {
          if (state.insurance === value) return;
          state.insurance = value;
          insuranceNotice.innerHTML = '';
          paintInsurance();
          recompute();
        };
      };
      insuranceYes = GF.el('button', { type: 'button', class: 'gf-choice', onClick: answer(true) }, GF.t('insuranceYes'));
      insuranceNo = GF.el('button', { type: 'button', class: 'gf-choice', onClick: answer(false) }, GF.t('insuranceNo'));
      insuranceBox = GF.el('div', { class: 'gf-section gf-insurance' },
        GF.el('div', { class: 'gf-section-title' }, insurance.title || GF.t('insuranceTitle')),
        insurance.description ? GF.el('div', { class: 'gf-line-sub' }, insurance.description) : null,
        GF.el('div', { class: 'gf-insurance-price' }, insuranceAmount),
        GF.el('div', { class: 'gf-choices' }, insuranceYes, insuranceNo),
        insuranceNotice
      );
      paintInsurance();
    }

    // The quote and its refusals are spoken as they arrive (rule 15).
    var summary = GF.el('div', { class: 'gf-summary', 'aria-live': 'polite' });
    var warn = GF.el('div', { 'aria-live': 'polite' });

    // Contact + message + honeypot. The keyboard each field opens, and what autofill puts in it.
    f.firstName = GF.el('input', { type: 'text', autocomplete: 'given-name', enterkeyhint: 'next' });
    f.lastName = GF.el('input', { type: 'text', autocomplete: 'family-name', enterkeyhint: 'next' });
    f.email = GF.el('input', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', enterkeyhint: 'next' });
    f.phone = GF.el('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', enterkeyhint: 'next' });
    f.message = GF.el('textarea', { rows: '3' });
    f.hp = GF.el('input', { type: 'text', tabindex: '-1', autocomplete: 'off' });

    // Refused on the field (specs/wordpress-plugin.md rule 28): each required input has its own line
    // under it, filled by the local presence/format check or by the server's `details[].message`.
    var CONTACT = ['firstName', 'lastName', 'email', 'phone'];
    var fieldBox = {};
    var fieldError = {};
    var refusedOnce = false;
    function contactField(key, labelText, extraClass) {
      var input = f[key];
      var errId = GF.uid('gf-err');
      // Named by `aria-describedby` and reached with the focus: no live region per field, which
      // would read every refusal of the form at once.
      fieldError[key] = GF.el('div', { class: 'gf-field-error', id: errId });
      input.setAttribute('aria-required', 'true');
      input.setAttribute('aria-describedby', errId);
      // Live only once a submit was refused: no red while the visitor is still typing.
      input.addEventListener('input', function () { if (refusedOnce) showFieldError(key, localFieldError(key)); });
      fieldBox[key] = field(labelText, input, extraClass);
      fieldBox[key].appendChild(fieldError[key]);
      return fieldBox[key];
    }
    function showFieldError(key, msg) {
      fieldBox[key].classList.toggle('is-invalid', !!msg);
      f[key].setAttribute('aria-invalid', msg ? 'true' : 'false');
      fieldError[key].textContent = msg || '';
    }
    // UX only: presence, and the browser's own e-mail format check. The server decides.
    function localFieldError(key) {
      if (!f[key].value.trim()) return GF.t('fieldRequired');
      // The browser's check accepts « nom@domaine »; a domain without its extension is refused too.
      if (key === 'email' && ((f.email.validity && !f.email.validity.valid)
        || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim()))) return GF.t('emailInvalid');
      return '';
    }

    // `gf-field-email` takes a row of its own in a narrow layout: an address cut in half cannot be
    // checked by the visitor who typed it (rule 23).
    var contact = GF.el('div', {},
      GF.el('div', { class: 'gf-row' },
        contactField('firstName', GF.t('firstName') + ' *'),
        contactField('lastName', GF.t('lastName') + ' *')
      ),
      GF.el('div', { class: 'gf-row' },
        contactField('email', GF.t('email') + ' *', 'gf-field-email'),
        contactField('phone', GF.t('phone') + ' *')
      ),
      GF.el('div', { class: 'gf-row' }, field(GF.t('message'), f.message)),
      GF.el('div', { class: 'gf-hp', 'aria-hidden': 'true' }, GF.el('label', {}, GF.t('honeypot'), f.hp))
    );

    // CGV acceptance (specs/terms-acceptance-record.md rules 10-13): never pre-ticked; the version
    // travels with the request and GuestFlow records it. Rebuilt when GuestFlow answers that a newer
    // version was published meanwhile.
    var terms = termsData ? { version: termsData.version } : null;
    var cgvBox = GF.el('div', {});
    var cgvNotice = GF.el('div', { 'aria-live': 'polite' });
    function paintCgv() {
      cgvBox.innerHTML = '';
      if (!terms) return;
      var link = GF.cgvPageUrl + (GF.cgvPageUrl.indexOf('?') >= 0 ? '&' : '?') + 'v=' + terms.version;
      f.cgv = GF.el('input', { type: 'checkbox', onChange: function () { cgvNotice.innerHTML = ''; } });
      cgvBox.appendChild(GF.el('label', { class: 'gf-cgv-accept' },
        f.cgv,
        GF.el('span', {},
          GF.t('cgvAcceptBefore'),
          GF.el('a', { href: link, target: '_blank', rel: 'noopener', class: 'gf-link' }, GF.t('cgvAcceptLink')),
          '.'
        )
      ));
      cgvBox.appendChild(cgvNotice);
    }
    paintCgv();

    // Online payment is asked for by the block, and possible only while GuestFlow has a payment provider
    // connected (specs/public-online-payment.md rule 12): until then the button sends a plain request
    // rather than a devis the payment would fail on. A GuestFlow older than the flag keeps the block's
    // choice.
    function paysNow() {
      return payOnline && !(lastQuote && lastQuote.payment && lastQuote.payment.onlineReady === false);
    }
    function submitLabel() {
      if (!paysNow()) return GF.t('sendRequest');
      return payLabel(lastQuote);
    }
    // With two actions the primary says what is paid now (specs/booking-drawer-friction.md rule 2):
    // « Payer 642,80 € », or the acompte.
    function payLabel(q) {
      var depositMode = q && q.payment && q.payment.mode === 'deposit' && q.deposit && q.deposit.amount;
      if (!offerRequest) return depositMode ? GF.t('payDeposit') : GF.t('payOnline');
      if (depositMode) return GF.t('payDepositAmount', GF.euro(q.deposit.amount));
      if (!q) return GF.t('payOnline');
      return GF.t('payAmount', GF.euro(q.totalStayPrice != null ? q.totalStayPrice : q.finalPrice));
    }
    // The request a failed payment left behind (rule 16): retrying the same stay pays for that devis
    // instead of creating another one. { key, requestId, token, reference }
    var pendingRequest = null;
    f.submit = GF.el('button', { class: 'gf-btn', type: 'button', disabled: 'disabled', onClick: submit }, submitLabel());
    // Rules 2-4: beside the payment, the same request without paying — no payment link is created. It
    // keeps `gf-btn-alt`: the Solio drawer finds the engine's submit as `.gf-btn:not(.gf-btn-alt)`.
    f.submitAlt = offerRequest
      ? GF.el('button', { class: 'gf-btn gf-btn-alt', type: 'button', disabled: 'disabled', onClick: function () { submit('request'); } }, GF.t('sendRequestNoPay'))
      : null;
    var altHint = offerRequest ? GF.el('div', { class: 'gf-request-hint' }, GF.t('requestNoPayHint')) : null;
    var feedback = GF.el('div', { 'aria-live': 'polite' });

    // The submit button's state, in one place: the copies of it (the sticky bar, the summary card)
    // follow every change — and so does the Solio drawer, which watches this very button.
    var summaryCta = null;
    function setSubmit(disabled, text) {
      f.submit.disabled = !!disabled;
      if (text != null) f.submit.textContent = text;
      if (summaryCta) { summaryCta.disabled = f.submit.disabled; summaryCta.textContent = f.submit.textContent; }
      if (f.submitAlt) {
        f.submitAlt.disabled = f.submit.disabled;
        if (!disabled) f.submitAlt.textContent = GF.t('sendRequestNoPay');
        // Without a payment possible right now the primary already sends a plain request.
        f.submitAlt.hidden = !paysNow();
        if (altHint) altHint.hidden = !paysNow();
      }
      syncBar();
    }

    // ---- Sticky bar (specs/wp-booking-widget-redesign.md rule 32) ----
    // The server's total and one button that follows the step: pick the dates, reach the contact
    // form, send. Shown by CSS only below 900 px of block width, and only while it is a direct child
    // of the block (the Solio drawer has a bar of its own).
    var barAmount = GF.el('b', {});
    var barNote = GF.el('small', {}, GF.t('pickArrival'));
    var barCta = GF.el('button', { type: 'button', class: 'gfb-cta', onClick: onBarCta }, GF.t('barPickDates'));
    var bar = GF.el('div', { class: 'gf-bar' }, GF.el('div', { class: 'gf-bar-amt', 'aria-live': 'polite' }, barAmount, barNote), barCta);
    var contactInView = false;
    function barMode() {
      if (!lastQuote || lastQuote.available === false) return 'dates';
      return contactInView ? 'send' : 'next';
    }
    function syncBar() {
      var mode = barMode();
      if (mode === 'send') { barCta.textContent = f.submit.textContent; barCta.disabled = f.submit.disabled; return; }
      barCta.disabled = false;
      barCta.textContent = GF.t(mode === 'dates' ? 'barPickDates' : 'barContinue');
    }
    function onBarCta() {
      var mode = barMode();
      if (mode === 'send') { submit(); return; }
      var target = mode === 'dates' ? calBox : contact;
      if (target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    function reducedMotion() {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    }
    // The amount cross-fades in place — no counting animation, no layout move (tabular figures).
    function setBarAmount(text, note) {
      barNote.textContent = note || '';
      if (barAmount.textContent === text) return;
      if (!text || !barAmount.textContent || reducedMotion()) { barAmount.textContent = text; return; }
      barAmount.classList.add('is-changing');
      setTimeout(function () { barAmount.textContent = text; barAmount.classList.remove('is-changing'); }, 90);
    }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { contactInView = en.isIntersecting; });
        syncBar();
      }, { threshold: 0.35 }).observe(contact);
    }

    // Holds the bar's place in the flow while it floats (below).
    var barAnchor = GF.el('div', { class: 'gf-bar-anchor', 'aria-hidden': 'true' });
    var form = GF.el('div', { class: 'gf-booking' },
      GF.el('h3', { class: 'gf-booking-name' }, detail.name || ''),
      // The party decides the price and the capacity, so it is asked before the dates
      // (specs/booking-drawer-friction.md rule 7).
      guestsBox, calBox, datesRow, timesRow, supplementsBox, insuranceBox, summary, warn, contact, cgvBox, altHint, f.submit, f.submitAlt, feedback, barAnchor, bar
    );
    // Every direct child is an engine element (specs/wordpress-plugin.md rule 29): it carries the
    // colour tokens wherever the Solio drawer moves it, and the stylesheet never reaches the site's
    // own `gf-*` elements.
    Array.prototype.forEach.call(form.children, function (child) { child.classList.add('gf-engine'); });
    // How many rows the left column holds on a wide block, where the summary spans them all (rule 33).
    form.style.setProperty('--gf-rows', String(form.children.length - 1));
    container.innerHTML = '';
    container.appendChild(form);

    // ---- The bar when `position: sticky` cannot work (rule 32) ----
    // A theme ancestor with `overflow: hidden` (common: `overflow-x: hidden` on a page wrapper)
    // becomes the bar's scroll box, and a sticky bar then never leaves the bottom of the block. In
    // that case the bar is pinned to the viewport while the block is on screen and its own place
    // in the flow is still below, and the anchor keeps that place so nothing jumps when it lands.
    function stickyDefeated() {
      var root = document.documentElement;
      var rootClips = /(hidden|auto|scroll)/.test(getComputedStyle(root).overflowX + getComputedStyle(root).overflowY);
      for (var n = form.parentElement; n && n !== root; n = n.parentElement) {
        var cs = getComputedStyle(n);
        if (!/(hidden|auto|scroll)/.test(cs.overflowX + cs.overflowY)) continue;
        // The body's overflow belongs to the viewport unless the root clips too.
        if (n === document.body && !rootClips) continue;
        // A box that really scrolls is where sticky works, as intended.
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return false;
        return true;
      }
      return false;
    }
    var floatMode = false;
    var formOnScreen = false;
    var anchorState = { below: true, whole: false };
    function placeBar() {
      var shown = getComputedStyle(bar).display !== 'none';
      var float = floatMode && shown && formOnScreen && anchorState.below && !anchorState.whole;
      if (float && !bar.classList.contains('is-floating')) barAnchor.style.height = bar.getBoundingClientRect().height + 'px';
      if (!float) barAnchor.style.height = '';
      bar.classList.toggle('is-floating', float);
    }
    if (window.IntersectionObserver) {
      floatMode = stickyDefeated();
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { formOnScreen = en.isIntersecting; });
        placeBar();
      }, { threshold: [0, 1] }).observe(form);
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { anchorState = { below: en.boundingClientRect.top > 0, whole: en.isIntersecting && en.intersectionRatio >= 0.99 }; });
        placeBar();
      }, { threshold: [0, 0.99, 1] }).observe(barAnchor);
      window.addEventListener('resize', function () { floatMode = stickyDefeated(); placeBar(); });
    }

    function gatherStay() {
      var opts = [];
      Object.keys(state.opt).forEach(function (id) {
        if (state.opt[id] > 0) opts.push({ optionId: parseInt(id, 10), quantity: state.opt[id] });
      });
      // « Oui » = one insurance line. The server prices it; the site never computes an amount.
      if (insurance && state.insurance === true) {
        opts.push({ optionId: insurance.optionId, quantity: 1 });
      }
      var ress = [];
      Object.keys(state.res).forEach(function (id) {
        if (state.res[id] > 0) ress.push({ resourceId: parseInt(id, 10), quantity: state.res[id] });
      });
      return {
        propertyId: propertyId,
        startDate: state.start,
        endDate: state.end,
        checkInTime: state.checkInTime,
        checkOutTime: state.checkOutTime,
        adults: state.adults,
        children: state.children,
        teens: state.teens,
        babies: state.babies,
        babyBeds: state.babyBeds,
        options: opts,
        resources: ress,
      };
    }

    function scheduleQuote() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, 400);
    }

    function recompute() {
      var stay = gatherStay();
      if (!stay.startDate || !stay.endDate) {
        summary.innerHTML = '';
        // What the next click does, as under the calendar: once the arrival is set, the departure.
        summary.appendChild(GF.el('div', { class: 'gf-empty' }, defaultHint()));
        warn.innerHTML = '';
        lastQuote = null;
        setBarAmount('', defaultHint());
        setSubmit(true);
        return;
      }
      summary.innerHTML = '';
      summary.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('loading')));
      GF.api('POST', '/quote', stay).then(function (res) {
        var datesKey = stay.startDate + '|' + stay.endDate;
        if (res.status < 200 || res.status >= 300 || !res.body || !res.body.data) {
          trackOnce('booking-unavailable', datesKey + '|error', { reason: 'error' });
          summary.innerHTML = '';
          summary.appendChild(GF.el('div', { class: 'gf-error' }, GF.errorMessage(res)));
          lastQuote = null;
          setBarAmount('', GF.errorMessage(res));
          setSubmit(true);
          return;
        }
        var q = res.body.data;
        // Min-nights breach: the chosen period stays on screen (spec §3.4). Clearing the departure
        // moved the page under the visitor 400 ms after their click, and the next click then had to
        // rebuild what they had just chosen; now that same click simply pushes the departure later.
        if (q.minNightsBreached) {
          trackOnce('booking-unavailable', datesKey + '|min-nights', { reason: 'min-nights' });
          renderCal({ msg: GF.t('minNights', q.minNights) + ' ' + GF.t('minNightsExtend'), isError: true });
          summary.innerHTML = '';
          summary.appendChild(GF.el('div', { class: 'gf-empty' }, GF.t('minNights', q.minNights)));
          warn.innerHTML = '';
          lastQuote = null;
          setBarAmount('', GF.t('minNights', q.minNights));
          setSubmit(true);
          return;
        }
        // Maximum stay or changeover days (plugin 1.17.1): GuestFlow writes the sentence, in the
        // page's language; the period stays on screen like a minimum-stay breach.
        if (q.stayRefusal) {
          trackOnce('booking-unavailable', datesKey + '|stay-rules', { reason: 'stay-rules' });
          renderCal({ msg: q.stayRefusal, isError: true });
          summary.innerHTML = '';
          summary.appendChild(GF.el('div', { class: 'gf-empty' }, q.stayRefusal));
          warn.innerHTML = '';
          lastQuote = null;
          setBarAmount('', q.stayRefusal);
          setSubmit(true);
          return;
        }
        lastQuote = q;
        drawSummary(q);
        if (q.available === false) trackOnce('booking-unavailable', datesKey + '|taken', { reason: 'taken' });
        else trackOnce('booking-quote', datesKey, { nights: q.nights, guests: persons() });
      });
    }

    // What the server priced and what it allows (specs/site-meal-portions.md rules 3 + 8). The
    // quantity comes back lowered when the stay can't serve what was asked — the drawer follows it
    // rather than showing a number the price no longer matches.
    function applyOptionLimits(q) {
      (q.options || []).forEach(function (o) {
        var node = optionNodes[o.optionId];
        if (!node || state.opt[o.optionId] === o.quantity) return;
        state.opt[o.optionId] = o.quantity;
        node.step.gfRepaint();
        if (node.onChange) node.onChange();
      });
      optionCaps = {};
      (q.optionLimits || []).forEach(function (l) { optionCaps[l.optionId] = l.maxQuantity; });
      Object.keys(optionNodes).forEach(function (id) {
        var node = optionNodes[id];
        var limit = (q.optionLimits || []).filter(function (l) { return String(l.optionId) === String(id); })[0];
        node.hint.textContent = limit ? limit.hint : '';
        node.hint.style.display = limit ? 'block' : 'none';
        node.step.gfRepaint();
      });
    }

    function drawSummary(q) {
      applyOptionLimits(q);
      summary.innerHTML = '';
      function sline(label, value, cls) { return GF.el('div', { class: 'gf-summary-line ' + (cls || '') }, GF.el('span', {}, label), GF.el('span', {}, value)); }
      // Shown only when the summary is the card of a wide block (rule 33).
      summary.appendChild(GF.el('div', { class: 'gf-summary-head' }, GF.t('stayRecap')));
      summary.appendChild(GF.el('div', { class: 'gf-summary-dates' }, shortDate(state.start) + ' → ' + shortDate(state.end)));
      summary.appendChild(sline(q.nights + ' ' + GF.t(q.nights === 1 ? 'night' : 'nights'), GF.euro(q.accommodationTotal)));
      // Without this row the listed lines do not add up to the total.
      if (q.extraGuests) {
        summary.appendChild(sline(GF.t('extraGuests', q.extraGuests.count), q.extraGuests.offered ? GF.t('offered') : GF.euro(q.extraGuests.total)));
      }
      (q.options || []).forEach(function (o) {
        summary.appendChild(sline(o.title + ' ×' + o.quantity, o.offered ? GF.t('offered') : GF.euro(o.total)));
      });
      (q.resources || []).forEach(function (r) {
        // `offeredNote` carries the partial case (2 h ordered, 1 h free); a line that costs nothing at
        // all reads « Offert » in the amount column rather than « 0,00 € », which looked like a bug.
        var label = (r.name || '') + ' ×' + r.quantity + (r.offeredNote ? ' · ' + r.offeredNote : '');
        summary.appendChild(sline(label, (r.offered || !r.total) ? GF.t('offered') : GF.euro(r.total)));
      });
      if (q.touristTax && q.touristTax.total) summary.appendChild(sline(GF.t('touristTax'), GF.euro(q.touristTax.total)));
      // Headline total = totalStayPrice (tax-INCLUSIVE) — what the guest actually pays online.
      // finalPrice is tax-exclusive; showing it as "Total" under a tax line understated the charge.
      summary.appendChild(sline(GF.t('total'), GF.euro(q.totalStayPrice != null ? q.totalStayPrice : q.finalPrice), 'gf-summary-total'));
      // Indicative, computed by GuestFlow — absent against an older server (booking-drawer-friction rule 9).
      if (q.perPersonPerNight != null) {
        summary.appendChild(GF.el('div', { class: 'gf-summary-pp' }, GF.t('perPersonPerNight', GF.euro(q.perPersonPerNight))));
      }
      // Deposit mode (server-decided): the site charges the acompte now, the solde is emailed later. The
      // server OMITS the deposit/balance blocks in full mode, so these lines only appear when relevant.
      var depositMode = q.payment && q.payment.mode === 'deposit';
      if (depositMode && q.deposit && q.deposit.amount) {
        summary.appendChild(sline(GF.t('depositNow'), GF.euro(q.deposit.amount)));
        if (q.balance && q.balance.amount) {
          var balLabel = q.balance.dueDate ? GF.t('balanceDueBefore', q.balance.dueDate) : GF.t('balance');
          summary.appendChild(sline(balLabel, GF.euro(q.balance.amount)));
        }
      }
      var total = q.totalStayPrice != null ? q.totalStayPrice : q.finalPrice;
      var nightsText = q.nights + ' ' + GF.t(q.nights === 1 ? 'night' : 'nights');
      setBarAmount(GF.euro(total), nightsText + (q.touristTax && q.touristTax.total ? ' · ' + GF.t('taxIncluded') : ''));
      summaryCta = GF.el('button', { type: 'button', class: 'gfb-cta gf-summary-cta', onClick: submit }, submitLabel());
      summary.appendChild(summaryCta);

      // The insurance amount is priced by the server for THIS stay, taken or not (spec §3.3
      // rule 19), so the visitor decides on a real amount rather than on a percentage.
      if (insurance) {
        var ins = q.cancellationInsurance;
        insuranceAmount.textContent = (ins && ins.amount != null)
          ? GF.euro(ins.amount)
          : insurance.priceLabel;
      }

      warn.innerHTML = '';
      var ok = true;
      if (q.available === false) { warn.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('datesUnavailable'))); ok = false; }
      // Button reflects what the guest pays now (« Payer l'acompte » vs « Payer en ligne »), or that
      // nothing is paid now.
      setSubmit(!ok, submitLabel());
    }

    // Bring a refused requirement into view and give it the focus — the page may be long, and the
    // visitor's eye is on the button they just pressed.
    //
    // `gf:refused` (bubbling, cancelable, detail { field, element }) tells a host that re-homes the
    // engine's children — the Solio drawer and its two screens — which requirement refused, so it
    // can show the screen that holds it (specs/wordpress-plugin.md rule 28). `field` is `insurance`,
    // `firstName` | `lastName` | `email` | `phone`, `terms` or `feedback`. A host that calls
    // `preventDefault()` brings the field into view and focuses it itself; otherwise the engine does.
    function reveal(node, focusTarget, field) {
      if (node && node.dispatchEvent) {
        var handled = false;
        try {
          handled = !node.dispatchEvent(new CustomEvent('gf:refused', {
            bubbles: true, cancelable: true, detail: { field: field || '', element: focusTarget || node },
          }));
        } catch (e) { /* an old browser without CustomEvent: the engine still reveals the field */ }
        if (handled) return;
      }
      if (focusTarget && focusTarget.focus) focusTarget.focus({ preventScroll: true });
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    // Every requirement refuses the same way (specs/wordpress-plugin.md rule 28): marked where it
    // sits, all at once, and the first one in reading order is brought into view with the focus.
    // Refused ON CLICK rather than by greying the button out: a disabled button never says why.
    function refuseMissing() {
      var firstProblem = null;
      // The insurance answer is mandatory (specs/cancellation-insurance.md §3.4 rule 23).
      insuranceNotice.innerHTML = '';
      if (insurance && state.insurance === null) {
        insuranceNotice.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('insuranceRequired')));
        firstProblem = { reason: 'insurance', field: 'insurance', node: insuranceBox, focus: insuranceYes };
      }
      CONTACT.forEach(function (key) {
        var msg = localFieldError(key);
        showFieldError(key, msg);
        if (msg && !firstProblem) firstProblem = { reason: 'fields', field: key, node: fieldBox[key], focus: f[key] };
      });
      cgvNotice.innerHTML = '';
      if (terms && !f.cgv.checked) {
        cgvNotice.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.t('cgvRequired')));
        if (!firstProblem) firstProblem = { reason: 'terms', field: 'terms', node: cgvBox, focus: f.cgv };
      }
      if (!firstProblem) return false;
      refusedOnce = true;
      reveal(firstProblem.node, firstProblem.focus, firstProblem.field);
      GF.track('booking-refused', { lodging: lodging, reason: firstProblem.reason });
      return true;
    }

    // The server's refusal of a contact field, under that field (rule 28). `details[].message` is
    // the server's sentence; a GuestFlow older than it is answered with the plugin's own two words.
    function refuseFromServer(err) {
      var keyOf = { 'guest.firstName': 'firstName', 'guest.lastName': 'lastName', 'guest.email': 'email', 'guest.phone': 'phone' };
      var firstKey = null;
      ((err && err.details) || []).forEach(function (d) {
        var key = d && keyOf[d.field];
        if (!key) return;
        var invalid = d.reason ? d.reason === 'emailInvalid' : (d.issue !== 'required' && f[key].value.trim() !== '');
        var fallback = GF.t(invalid ? 'emailInvalid' : 'fieldRequired');
        showFieldError(key, d.message || fallback);
        if (!firstKey || CONTACT.indexOf(key) < CONTACT.indexOf(firstKey)) firstKey = key;
      });
      if (!firstKey) return false;
      refusedOnce = true;
      reveal(fieldBox[firstKey], f[firstKey], firstKey);
      return true;
    }

    // ── Proof of work (GuestFlow specs/public-request-abuse-and-grouping.md rules 1-5) ──────────────
    // A challenge is fetched as soon as the form opens and solved in a Web Worker while the guest
    // fills it in. A challenge is spent by one request, so a fresh one is prepared after every send.
    // GuestFlow refuses a request sent less than 3 s after its challenge was issued, and one older than
    // 15 min: the first is waited out, the second re-fetched. Without a challenge (an older GuestFlow,
    // a network error) the request goes without one, and GuestFlow decides.
    var CHALLENGE_MIN_MS = 3200;
    var CHALLENGE_REFRESH_MS = 14 * 60 * 1000;
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

    // Fallback when no Worker can start (an asset host on another origin): small slices on the page.
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

    // `mode` is 'request' from the « sans payer » button; any other call (the button, the bar, the
    // summary card, which pass their click event) pays when a payment is possible.
    function submit(mode) {
      feedback.innerHTML = '';
      if (!lastQuote) return;
      if (refuseMissing()) return;
      var first = f.firstName.value.trim(), last = f.lastName.value.trim(), email = f.email.value.trim(), phone = f.phone.value.trim();
      var stay = gatherStay();
      var body = Object.assign({}, stay, {
        guest: { firstName: first, lastName: last, email: email, phone: phone },
        message: f.message.value.trim(),
        _hp: f.hp.value,
      });
      if (terms) body.termsVersion = terms.version;
      var paying = mode !== 'request' && paysNow();
      // The stay alone decides a retry (rule 27): a corrected message or phone keeps the same devis.
      var requestKey = JSON.stringify(stay);
      if (paying && pendingRequest && pendingRequest.key === requestKey) {
        setSubmit(true, GF.t('preparingPayment'));
        startPayment(pendingRequest.requestId, pendingRequest.token);
        return;
      }
      // Where the visit came from (specs/site-traffic-analytics.md rule 14). Optional: without it the
      // request reads « Origine inconnue », it is never refused.
      var attribution = GF.attribution();
      if (attribution) body.attribution = attribution;
      send(body, mode, paying, requestKey, false);
    }

    function send(body, mode, paying, requestKey, retried) {
      function busy(text) {
        if (mode === 'request' && f.submitAlt) {
          setSubmit(true);
          f.submitAlt.textContent = text;
        } else {
          setSubmit(true, text);
        }
      }
      var entry = currentProof();
      // « Vérification… » only when the guest is faster than the worker.
      if (!entry.solved) busy(GF.t('verifying'));
      entry.promise.then(function (p) {
        delete body.challenge;
        delete body.nonce;
        if (p) {
          body.challenge = p.challenge;
          body.nonce = p.nonce;
        }
        busy(paying ? GF.t('preparingPayment') : GF.t('sending'));
        var wait = p ? Math.max(0, entry.receivedAt + CHALLENGE_MIN_MS - Date.now()) : 0;
        return new Promise(function (resolve) { setTimeout(resolve, wait); });
      }).then(function () {
        return GF.api('POST', '/booking-requests', body);
      }).then(function (res) {
        // The challenge is spent whatever the answer: the next send gets a fresh one.
        prepareProof();
        var refusal = res.body && res.body.error;
        // A challenge refused once (expired while the tab slept, a network change) is retried once
        // with a fresh one, without the guest doing anything.
        if (!retried && refusal && refusal.code === 'CHALLENGE_INVALID' && refusal.details && refusal.details[0]
          && refusal.details[0].issue !== 'missing') {
          send(body, mode, paying, requestKey, true);
          return;
        }
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data) {
          GF.track('booking-requested', { lodging: lodging, nights: nightsOf(body.startDate, body.endDate), guests: persons(), mode: paying ? 'pay' : 'request' });
          if (paying) {
            pendingRequest = {
              key: requestKey, requestId: res.body.data.requestId, token: res.body.data.publicToken, reference: res.body.data.reference || '',
            };
            startPayment(pendingRequest.requestId, pendingRequest.token);
            return;
          }
          container.innerHTML = '';
          // Rule 13 — the same stay sent again updated the guest's open request.
          var sentText = res.body.data.updated && res.body.data.requestedOn
            ? GF.t('requestUpdated', GF.date(res.body.data.requestedOn + 'T00:00:00'))
            : GF.t('requestSent', res.body.data.reference || '');
          container.appendChild(GF.el('div', { class: 'gf-success' }, sentText));
          return;
        }
        setSubmit(false, submitLabel());
        // A newer CGV version was published while the guest was filling the form (rule 13): offer
        // that one, unticked, and let GuestFlow's message say why.
        var err = res.body && res.body.error;
        GF.track('booking-error', { lodging: lodging, reason: err && err.code === 'TERMS_OUTDATED' ? 'terms-outdated' : 'server' });
        if (err && err.code === 'TERMS_OUTDATED' && err.details && err.details[0] && err.details[0].currentVersion) {
          terms = { version: err.details[0].currentVersion };
          paintCgv();
          cgvNotice.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.errorMessage(res)));
          reveal(cgvBox, f.cgv, 'terms');
          return;
        }
        if (err && err.code === 'VALIDATION_FAILED' && refuseFromServer(err)) return;
        feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, GF.errorMessage(res)));
        reveal(feedback, null, 'feedback');
      });
    }

    // Use case 2: create/reuse the Qonto FULL link for the just-created devis and send the visitor to
    // the hosted payment page. Qonto returns them to this same page with ?gf_payment=<id>&gf_token=<t>
    // (the status view above then polls until confirmed). Amount + availability are enforced
    // server-side; the per-devis token authorises both the pay call and the return-page status poll.
    // Only an https page may receive the visitor: anything else (javascript:, data:, http:) is a
    // payment error, never a navigation.
    function isHttpsUrl(url) {
      if (typeof url !== 'string' || url === '') return false;
      try { return new URL(url).protocol === 'https:'; } catch (e) { return false; }
    }

    function startPayment(devisId, token) {
      if (!devisId || !token) { paymentError(); return; }
      // `property` comes back too: a generic booking page knows the lodging only from the address.
      var returnPath = window.location.pathname + '?property=' + propertyId + '&gf_payment=' + devisId + '&gf_token=' + encodeURIComponent(token);
      GF.api('POST', '/booking-requests/' + devisId + '/pay', { returnPath: returnPath, token: token }).then(function (res) {
        if (res.status >= 200 && res.status < 300 && res.body && res.body.data && isHttpsUrl(res.body.data.paymentUrl)) {
          feedback.innerHTML = '';
          feedback.appendChild(GF.el('div', { class: 'gf-loading' }, GF.t('redirectingPayment')));
          GF.track('booking-pay', { lodging: lodging });
          window.location.href = res.body.data.paymentUrl;
          return;
        }
        paymentError(res);
      });
    }

    // The request is recorded whatever the payment did: say so, with its reference, so a visitor who
    // stops here knows GuestFlow has it (rule 16).
    function paymentError(res) {
      setSubmit(false, submitLabel());
      feedback.innerHTML = '';
      feedback.appendChild(GF.el('div', { class: 'gf-inline-warn' }, res ? GF.errorMessage(res) : GF.t('genericError')));
      if (pendingRequest) feedback.appendChild(GF.el('div', { class: 'gf-inline-info' }, GF.t('paymentRetry', pendingRequest.reference)));
    }

    // Rule 19 — the dates of the link, on the month of the arrival; the quote that follows says
    // whether they are still free, as for a stay picked on the calendar.
    if (stayInUrl.start) {
      state.start = stayInUrl.start;
      state.end = stayInUrl.end;
      calBase = firstOfMonth(new Date(stayInUrl.start + 'T00:00:00'));
      f.startDisplay.value = shortDate(state.start);
      f.endDisplay.value = shortDate(state.end);
      f.clearDates.disabled = false;
    }

    renderBabyBeds();
    renderSupplements();
    renderCal();
    recompute();
    // The form is open: start the proof of work now, so it is done before the guest is.
    prepareProof();
  }

  document.querySelectorAll('[data-gf-booking]').forEach(init);
})();
