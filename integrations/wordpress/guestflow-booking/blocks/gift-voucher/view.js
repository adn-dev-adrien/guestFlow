/**
 * Gift voucher tunnel frontend (build-free, plain ES) — specs/gift-vouchers/gift-vouchers.md §3.C, §3.D and §6.
 *
 * Its own small state machine, independent of the booking block (rule 12): it shares only the runtime
 * (`GF.api`, `GF.el`, `GF.t`), `assets/voucher-parts.js` (proof of work, stepper, amounts) and the field styles.
 *
 *   loading → [campaign choice] → form ─(pay)→ [redirect to the hosted payment page]
 *   ?gf_voucher=<id>&gf_token=<t> → waiting (poll) → voucher | failed | link expired (« Recommencer ») | still pending
 *
 * specs/gift-vouchers/gift-voucher-campaigns.md rules 16-19: the page lists the campaigns on sale grouped by kind; a card address
 * (`#campagne=<slug>`) opens one directly. EVERY way into a campaign — the address, a click on the chooser, a single
 * offer — goes through `open()`, the one place that builds the form, so a campaign opened by its card address works
 * exactly like one chosen on the site. A `lodging` campaign keeps the free-amount tunnel; a `resource` campaign
 * draws the server's contents, its extra time and add-ons, and the server's price (`POST /offer/price`).
 *
 * Rule 66 — the card at the head of the form is `GF.voucherCard` (assets/voucher-card.js): the campaign's front and the back GuestFlow sends, which turns by
 * itself when the buyer types in « Pour », « De la part de » or « Un mot » or changes the extras. The same card, with the real code and QR code, is the page after payment.
 *
 * No money logic lives here: the bounds, the priced ideas, the validity, the lines, the total, the VAT and the voucher
 * come from GuestFlow. The one rule the client repeats is the amount's shape, as a hint before a request is
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
  var PRICE_DEBOUNCE_MS = 300;
  var WIDE_BLOCK = 600;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  var money = GF.voucherMoney;

  // The address of a printed card: `#campagne=<slug>` (specs/gift-vouchers/gift-voucher-campaigns.md rule 9).
  function hashCampaign() {
    var found = /[#&]campagne=([^&]+)/.exec(window.location.hash || '');
    if (!found) return '';
    try { return decodeURIComponent(found[1]); } catch (e) { return ''; }
  }

  function centsToField(cents) {
    return (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)).replace('.', ',');
  }

  function dateOf(iso) {
    return GF.date(new Date(String(iso) + 'T00:00:00'));
  }

  // Rule 62 — the front a campaign sells, read from GuestFlow at its versioned address. A picture that fails to load
  // leaves no hole: the node goes, and `onGone` lets the caller undo the room it made for it.
  function front(campaign, cls, lazy, onGone) {
    var visual = campaign && campaign.visual;
    if (!visual || !visual.versionId) return null;
    var img = GF.el('img', {
      class: cls,
      src: GF.restUrl + '/gift-vouchers/campaigns/' + encodeURIComponent(campaign.slug) + '/visual?v=' + encodeURIComponent(visual.versionId),
      alt: cls === 'gf-gv-front' ? campaign.title : '',
      width: String(visual.width),
      height: String(visual.height),
      decoding: 'async',
      loading: lazy ? 'lazy' : 'eager',
    });
    img.addEventListener('error', function () {
      if (img.parentNode) img.parentNode.removeChild(img);
      if (onGone) onGone();
    });
    return img;
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
      if (GF.voucherInactive(res)) { GF.voucherHide(container); return; }
      var offer = res.status >= 200 && res.status < 300 && res.body && res.body.data;
      container.innerHTML = '';
      if (!offer) {
        container.appendChild(GF.el('div', { class: 'gf-error', role: 'status' }, GF.errorMessage(res)));
        return;
      }
      mount(container, offer);
    });
  }

  // The price an offer is announced at: the lowest of its periods, « dès » when it sells two (week-weekend-and-print spec rule 11).
  function fromPrice(c) {
    return (c.periods && c.periods.length > 1 ? GF.t('gvExtrasFrom', money(c.totalCents)) : money(c.totalCents));
  }

  // ── Campaigns: the chooser, and the one `open()` every entry goes through ─────────────────────
  function mount(container, offer) {
    if (!Array.isArray(offer.campaigns)) { buildForm(container, offer, null, null); return; }
    var campaigns = offer.campaigns;
    if (!campaigns.length) {
      container.appendChild(GF.el('p', { class: 'gf-inline-info gf-gv-soon', role: 'status' }, GF.t('gvSoon')));
      return;
    }
    var stage = GF.el('div', { class: 'gf-gv-stage' });
    container.appendChild(stage);

    // Rule 63 — the switcher heads an open campaign: one compact card per campaign on sale, in the chooser's order.
    function switcher(current) {
      var nav = GF.el('nav', { class: 'gf-gv-switch', 'aria-label': GF.t('gvYourGift') }, GF.el('p', { class: 'gf-gv-switch-label', 'aria-hidden': 'true' }, GF.t('gvYourGift')));
      var row = GF.el('div', { class: 'gf-gv-switch-row' });
      ['lodging', 'resource'].forEach(function (kind) {
        campaigns.filter(function (c) { return c.kind === kind; }).forEach(function (c) {
          var price = c.kind === 'resource' ? (c.totalCents != null ? fromPrice(c) : '') : GF.t('gvFreeAmount');
          var opt = GF.el('button', { type: 'button', class: 'gf-gv-switch-opt', 'data-slug': c.slug });
          var thumb = front(c, 'gf-gv-switch-thumb', true, null);
          if (thumb) opt.appendChild(thumb);
          opt.appendChild(GF.el('span', { class: 'gf-gv-switch-text' },
            GF.el('b', {}, c.title),
            price ? GF.el('span', {}, price) : null));
          if (c.slug === current.slug) opt.setAttribute('aria-current', 'true');
          else opt.addEventListener('click', function () { open(c.slug, true, true); });
          row.appendChild(opt);
        });
      });
      nav.appendChild(row);
      return nav;
    }

    function chooser() {
      stage.innerHTML = '';
      var root = GF.el('div', { class: 'gf-gv' }, GF.el('h3', { class: 'gf-gv-title' }, GF.t('gvTitle')));
      [['lodging', 'gvKindLodging'], ['resource', 'gvKindResource']].forEach(function (group) {
        var mine = campaigns.filter(function (c) { return c.kind === group[0]; });
        if (!mine.length) return;
        var list = GF.el('div', { class: 'gf-gv-offers' });
        mine.forEach(function (c) {
          var detail = c.kind === 'resource' && c.contents && c.contents[0] ? c.contents[0].detail : GF.t('gvFreeAmount');
          var card = GF.el('button', { type: 'button', class: 'gf-gv-offer', 'data-slug': c.slug });
          var thumb = front(c, 'gf-gv-offer-thumb', true, function () { card.classList.remove('has-thumb'); });
          if (thumb) { card.classList.add('has-thumb'); card.appendChild(thumb); }
          card.appendChild(GF.el('span', { class: 'gf-gv-offer-text' },
            GF.el('b', {}, c.title),
            detail ? GF.el('span', { class: 'gf-gv-offer-detail' }, detail) : null,
            c.kind === 'resource' && c.totalCents != null ? GF.el('span', { class: 'gf-gv-offer-price' }, fromPrice(c)) : null));
          card.addEventListener('click', function () { open(c.slug, true); });
          list.appendChild(card);
        });
        root.appendChild(GF.el('div', { class: 'gf-gv-kind' }, GF.el('div', { class: 'gf-gv-group-label' }, GF.t(group[1])), list));
      });
      stage.appendChild(root);
    }

    // The one way into a campaign (rule 16): its address, the chooser and a single offer all land here.
    var opened = '';
    function open(slug, remember, fromSwitch) {
      var campaign = campaigns.filter(function (c) { return c.slug === slug; })[0];
      if (!campaign) { opened = ''; chooser(); return; }
      if (opened === slug && stage.firstChild) return; // the address changed to the campaign already open: keep what the visitor has composed
      opened = slug;
      if (remember && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + '#campagne=' + encodeURIComponent(slug));
      }
      stage.innerHTML = '';
      buildForm(stage, offer, campaign, campaigns.length > 1 ? switcher(campaign) : null);
      var here = stage.querySelector('.gf-gv-switch-opt[aria-current="true"]');
      if (here) here.parentNode.scrollLeft = here.offsetLeft - 2; // the row only: the page must not move
      // The card that had the focus was just rebuilt: hand it to the new current card, so a keyboard or
      // screen-reader visitor stays in the switcher and hears the offer now open.
      if (here && fromSwitch) here.focus({ preventScroll: true });
    }

    window.addEventListener('hashchange', function () { var slug = hashCampaign(); if (slug) open(slug, false); });
    var asked = hashCampaign();
    open(asked || (campaigns.length === 1 ? campaigns[0].slug : ''), false);
  }

  // ── Purchase form ───────────────────────────────────────────────────────────────────────────
  // `campaign` is null for an older GuestFlow that lists no campaigns: the one free-amount tunnel it has always sold.
  function buildForm(container, offer, campaign, switchNode) {
    var isResource = !!campaign && campaign.kind === 'resource';
    var src = campaign && !isResource ? campaign : offer;
    var available = offer.available === true;
    var min = Number(src.minAmountCents) || 0;
    var max = Number(src.maxAmountCents) || 0;
    var months = Number((campaign || offer).validityMonths) || 0;
    var ideas = Array.isArray(src.ideas) ? src.ideas : [];
    var termsVersionId = (campaign && campaign.termsVersionId != null ? campaign.termsVersionId : offer.termsVersionId) || 0;
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
    var recipientLastInput = GF.el('input', { type: 'text', maxlength: NAME_MAX, autocomplete: 'off' });
    var senderInput = GF.el('input', { type: 'text', maxlength: NAME_MAX, autocomplete: 'off' });
    var messageInput = GF.el('textarea', { maxlength: MESSAGE_MAX, rows: 3 });
    var counter = GF.el('p', { class: 'gf-gv-hint gf-gv-counter', id: GF.uid('gf-gv-count') }, '0 / ' + MESSAGE_MAX);
    var emailInput = GF.el('input', { type: 'email', inputmode: 'email', autocomplete: 'email' });

    var recipientField = GF.el('div', { class: 'gf-gv-names' },
      field('recipient', GF.t('gvFirstName'), false, recipientInput),
      field('recipientLast', GF.t('gvLastName'), false, recipientLastInput));
    var senderField = field('sender', GF.t('gvSender'), true, senderInput);
    var messageField = field('message', GF.t('gvWord'), true, messageInput, null, [counter]);
    var emailField = field('email', GF.t('gvEmail'), false, emailInput);

    // Terms (rule 13): the version GuestFlow offers, read on the page the booking checkbox also links to.
    var termsInput = GF.el('input', { type: 'checkbox' });
    // Rule 37 — the terms are the campaign's activity's: the page opens the current text of that activity.
    var termsUrl = '';
    if (GF.cgvPageUrl) {
      var joiner = GF.cgvPageUrl.indexOf('?') === -1 ? '?' : '&';
      var termsVersion = campaign && campaign.termsVersion != null ? campaign.termsVersion : offer.termsVersion;
      var query = (isResource ? ['activity=resource'] : []).concat(termsVersion ? ['v=' + encodeURIComponent(termsVersion)] : []);
      termsUrl = query.length ? GF.cgvPageUrl + joiner + query.join('&') : GF.cgvPageUrl;
    }
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

    // ── A composed voucher (rule 17): the server's contents, extra time and add-ons, and the server's price ──
    var composeBlock = null;
    var extrasFold = null;
    var recap = null;
    var extraMinutes = 0;
    var periods = isResource && Array.isArray(campaign.periods) ? campaign.periods : [];
    var period = periods.length ? periods[0].period : '';
    var periodControl = null;
    var addOnQty = {};
    var priced = null;
    var pricedError = '';
    var priceSeq = 0;
    var priceTimer = null;
    if (isResource) {
      // The lines GuestFlow wrote for the period picked (« 1 h en journée · week-end »): a campaign that sells two sends those of each.
      var includes = GF.el('ul', { class: 'gf-gv-items' });
      var drawIncludes = function () {
        includes.innerHTML = '';
        ((campaign.contentsByPeriod && campaign.contentsByPeriod[period]) || campaign.contents || []).forEach(function (line) {
          includes.appendChild(GF.el('li', {}, (line.qty > 1 ? line.qty + ' × ' : '') + line.label, line.detail ? GF.el('span', { class: 'gf-gv-offer-detail' }, ' — ' + line.detail) : null));
        });
      };
      drawIncludes();
      // The fold opens on the figures of the period the page starts on (the server's, per period), not on the top-level ones.
      var extraTimeOf = function (code) {
        var by = campaign.extraTime && campaign.extraTime.pricesByPeriod;
        return by && by[code] ? Object.assign({}, campaign.extraTime, { prices: by[code] }) : campaign.extraTime;
      };
      extrasFold = GF.voucherExtrasFold({
        extraTime: extraTimeOf(period),
        addOns: campaign.addOns,
        onExtraTime: function (n) { extraMinutes = n; turnToBack(); changed(); },
        onAddOn: function (ref, n) { addOnQty[ref] = n; turnToBack(); changed(); },
      });
      recap = GF.el('div', { class: 'gf-gv-recap', 'aria-live': 'polite' });
      // Rule 11 — the giver picks the week or the weekend inside the campaign, each with the server's price; a single period is just sent.
      if (periods.length > 1) {
        var periodWord = { week: 'gvPeriodWeek', weekend: 'gvPeriodWeekend' };
        periodControl = GF.el('div', { class: 'gf-gv-period', role: 'radiogroup', 'aria-label': GF.t('gvPeriod') },
          periods.map(function (p) {
            var btn = GF.el('button', {
              type: 'button', class: 'gf-gv-period-opt', role: 'radio', 'data-period': p.period, 'aria-checked': p.period === period ? 'true' : 'false',
            }, GF.el('b', {}, GF.t(periodWord[p.period] || p.label)), GF.el('span', {}, money(p.priceCents)));
            btn.addEventListener('click', function () {
              period = p.period;
              Array.prototype.forEach.call(periodControl.children, function (n) { n.setAttribute('aria-checked', n.getAttribute('data-period') === period ? 'true' : 'false'); });
              priced = null;
              drawIncludes();
              periodHint.textContent = hintOf(period);
              // The extra-time steps are priced for the period (rule 11): the fold shows those of the one picked.
              if (extrasFold && campaign.extraTime && campaign.extraTime.pricesByPeriod) extrasFold.updateExtraTimePrices(campaign.extraTime.pricesByPeriod[period]);
              turnToBack();
              drawRecap();
              askPrice();
            });
            return btn;
          }));
      }
      // What the period means (the server's words), under the control; with a single period it is the fact that period is sold for.
      var hintOf = function (code) {
        for (var i = 0; i < periods.length; i += 1) if (periods[i].period === code) return periods[i].hint || '';
        return '';
      };
      var periodHint = periods.length ? GF.el('p', { class: 'gf-gv-hint gf-gv-period-hint' }, hintOf(period)) : null;
      composeBlock = GF.el('div', { class: 'gf-gv-compose' },
        GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvIncludes')), includes,
        periodControl ? GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvPeriod')) : null, periodControl, periodHint,
        campaign.band ? GF.el('p', { class: 'gf-gv-hint' }, GF.t('gvBand', campaign.band.label, campaign.band.from, campaign.band.to)) : null,
        extrasFold, recap);
    }

    function composeRequest() {
      var req = { slug: campaign.slug, extraMinutes: extraMinutes, addOns: [] };
      if (period) req.period = period;
      Object.keys(addOnQty).forEach(function (ref) { if (addOnQty[ref] > 0) req.addOns.push({ articleRef: ref, qty: addOnQty[ref] }); });
      return req;
    }

    function drawRecap() {
      if (!recap) return;
      recap.innerHTML = '';
      if (extrasFold) extrasFold.update(priced ? priced.extrasCents : (pricedError ? undefined : null));
      if (pricedError) { recap.appendChild(GF.el('p', { class: 'gf-gv-alert', role: 'alert' }, pricedError)); return; }
      if (!priced) { recap.appendChild(GF.el('p', { class: 'gf-gv-hint' }, GF.t('loading'))); return; }
      recap.appendChild(GF.el('div', { class: 'gf-gv-group-label' }, GF.t('gvRecap')));
      (priced.lines || []).forEach(function (line) {
        recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line' },
          GF.el('span', {}, (line.qty > 1 ? line.qty + ' × ' : '') + line.label, line.detail ? GF.el('small', {}, line.detail) : null),
          GF.el('b', {}, GF.euro(line.totalCents / 100))));
      });
      recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line gf-gv-recap-total' }, GF.el('span', {}, GF.t('gvTotalTtc')), GF.el('b', {}, GF.euro(priced.totalCents / 100))));
      (priced.vat || []).forEach(function (row) {
        recap.appendChild(GF.el('div', { class: 'gf-gv-recap-line gf-gv-recap-vat' },
          GF.el('span', {}, GF.t('gvVat', String(row.rate).replace('.', ','))), GF.el('span', {}, GF.euro(row.cents / 100))));
      });
    }

    function askPrice() {
      priceSeq += 1;
      var mine = priceSeq;
      GF.api('POST', '/gift-vouchers/offer/price', composeRequest()).then(function (res) {
        if (mine !== priceSeq) return;
        var data = res.status >= 200 && res.status < 300 && res.body && res.body.data;
        priced = data || null;
        pricedError = data ? '' : (res.body && res.body.error && res.body.error.message) || GF.errorMessage(res);
        drawRecap();
        sync();
      });
    }

    // Every change of the composition asks the server for the price again; the answers that come back late are dropped.
    function changed() {
      priced = null;
      pricedError = '';
      drawRecap();
      sync();
      if (priceTimer) clearTimeout(priceTimer);
      priceTimer = setTimeout(askPrice, PRICE_DEBOUNCE_MS);
    }

    // On a narrow block (a phone) the card is above the form, out of sight while typing: it does not turn by itself there, a link under « Un mot » does.
    // Measured as the stylesheet's container query measures it: the block's content box, without its padding and border.
    function wide() {
      var host = root.closest('[data-gf-gift-voucher]') || root;
      var style = window.getComputedStyle ? window.getComputedStyle(host) : {};
      var inner = host.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      return inner >= WIDE_BLOCK;
    }
    function turnToBack() { if (card && back && wide()) card.turn(true); }
    if (switchNode) root.appendChild(switchNode);
    // Rules 62, 66 — the card heads the form: above the title on a phone, a sticky column beside it on a wide block.
    var lead = GF.el('div', { class: 'gf-gv-lead' });
    var back = offer.back && campaign && campaign.back ? offer.back : null;
    var card = campaign ? GF.voucherCard({
      title: campaign.title,
      front: function () { return front(campaign, 'gf-card-front-img', false, null); },
      back: back,
      preview: true,
    }) : null;
    if (card) {
      lead.classList.add('has-card');
      lead.appendChild(GF.el('div', { class: 'gf-card-col' }, card.node));
    }
    var peek = null;
    if (card && back) {
      peek = GF.el('button', { type: 'button', class: 'gf-gv-peek' }, GF.t('gvSeeBack'));
      peek.addEventListener('click', function () {
        card.turn(true);
        card.reveal();
      });
    }
    var main = GF.el('div', { class: 'gf-gv-main' });
    main.appendChild(GF.el('h3', { class: 'gf-gv-title' }, campaign ? campaign.title : GF.t('gvTitle')));
    if (months) main.appendChild(GF.el('p', { class: 'gf-gv-intro' }, GF.t(isResource ? 'gvIntroSession' : 'gvIntro', months)));
    main.appendChild(GF.el('div', { class: 'gf-gv-two' },
      GF.el('div', { class: 'gf-gv-form' },
        isResource ? composeBlock : amountField, isResource ? null : ideasBlock, recipientField, senderField, messageField, peek, emailField,
        termsLabel, termsErr, alertBox, payBtn, soon)));
    // Rule 19 — whoever has received a voucher is led to the page that books the session; no link when no page holds the block.
    if (GF.sessionPageUrl) {
      main.appendChild(GF.el('div', { class: 'gf-gv-uselink' },
        GF.el('span', {}, GF.t('sbHaveVoucher')),
        GF.el('a', { class: 'gf-link', href: GF.sessionPageUrl }, GF.t('sbBookSession'))));
    }
    lead.appendChild(main);
    root.appendChild(lead);

    function showAlert(message) {
      alertBox.textContent = message || '';
      if (message) alertBox.removeAttribute('hidden'); else alertBox.setAttribute('hidden', 'hidden');
    }

    // Rule 66 — the lines under « Votre bon comprend » are GuestFlow's own: the campaign's, then the line it wrote for the extra time and the quantity of each option chosen. The page
    // only picks among them; for a lodging voucher it puts the amount typed into the template.
    function cardLines(cents) {
      var b = campaign.back;
      if (!isResource) {
        return [String(b.lineTemplate || '').replace('{amount}', function () { return cents != null ? GF.cardEuros(cents) : '… €'; })];
      }
      // A campaign that sells two periods sends the lines of each (rule 20): the page shows those of the period the giver picked.
      var lines = ((b.linesByPeriod && b.linesByPeriod[period]) || b.lines || []).slice();
      if (extraMinutes > 0 && b.extraTime && b.extraTime[extraMinutes]) lines.push(b.extraTime[extraMinutes]);
      (campaign.addOns || []).forEach(function (a) {
        var qty = addOnQty[a.articleRef] || 0;
        var line = qty > 0 && b.addOns && b.addOns[a.articleRef] ? b.addOns[a.articleRef][qty] : null;
        if (line) lines.push(line);
      });
      return lines;
    }

    function sync() {
      var a = isResource ? { cents: priced ? priced.totalCents : null } : parseAmount();
      var shown = touched && a.error ? a.error : '';
      setError('amount', shown);
      amountHint.hidden = !!shown;
      chips.forEach(function (c) { c.node.setAttribute('aria-pressed', a.cents != null && c.cents === a.cents ? 'true' : 'false'); });
      counter.textContent = messageInput.value.length + ' / ' + MESSAGE_MAX;
      if (payBtn && !busy) payBtn.textContent = a.cents != null ? GF.t('gvPay', GF.euro(a.cents / 100)) : GF.t('gvPayBare');
      if (card && back) {
        card.set({
          title: (campaign.back.titles && campaign.back.titles[period]) || campaign.back.title || campaign.title,
          recipient: recipientInput.value.trim(),
          sender: senderInput.value.trim(),
          message: messageInput.value.trim(),
          lines: cardLines(a.cents),
          validUntil: campaign.back.validUntil,
          steps: campaign.back.steps,
        });
      }
    }

    amountInput.addEventListener('input', function () { touched = true; });
    [amountInput, recipientInput, senderInput, messageInput].forEach(function (n) { n.addEventListener('input', sync); });
    // The card shows the first name only, as the PDF does; the last name turns it too, being typed in the same place.
    [recipientInput, recipientLastInput, senderInput, messageInput].forEach(function (n) { n.addEventListener('input', turnToBack); });
    recipientInput.addEventListener('input', function () { setError('recipient', ''); });
    recipientLastInput.addEventListener('input', function () { setError('recipientLast', ''); });
    emailInput.addEventListener('input', function () { setError('email', ''); });
    termsInput.addEventListener('change', function () { setError('terms', ''); });
    sync();
    if (isResource) { drawRecap(); askPrice(); }

    // Rule 13 — every refusal on its field, the first one focused.
    function validate() {
      var first = null;
      var a = isResource ? { cents: priced ? priced.totalCents : null } : parseAmount();
      touched = true;
      if (!isResource && a.error) { setError('amount', a.error); amountHint.hidden = true; first = first || amountInput; }
      if (!recipientInput.value.trim()) { setError('recipient', GF.t('gvFirstEmpty')); first = first || recipientInput; }
      if (!recipientLastInput.value.trim()) { setError('recipientLast', GF.t('gvLastEmpty')); first = first || recipientLastInput; }
      var mail = emailInput.value.trim();
      if (!EMAIL_RE.test(mail)) {
        setError('email', mail ? GF.t('emailInvalid') : GF.t('gvEmailEmpty'));
        first = first || emailInput;
      }
      if (!termsInput.checked) { setError('terms', GF.t('gvTermsRequired')); first = first || termsInput; }
      if (first) { first.focus(); return null; }
      if (isResource && !priced) { showAlert(pricedError || GF.t('loading')); return null; }
      return a.cents;
    }

    // ── Proof of work: the same challenge the booking request solves (specs/gift-vouchers/gift-vouchers.md rule 15) ──
    var proof = GF.voucherProof();
    // The work starts when the form is in front of the visitor or touched, never on a mere page view.
    if (available) proof.observe(root);

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
      if (code === 'PAYMENT_LINK_EXPIRED') { pending = null; showAlert(text); return; }
      if (code === 'RECIPIENT_FIRST_NAME_REQUIRED') { setError('recipient', text); recipientInput.focus(); return; }
      if (code === 'RECIPIENT_LAST_NAME_REQUIRED') { setError('recipientLast', text); recipientLastInput.focus(); return; }
      if (code === 'EMAIL_INVALID') { setError('email', text); emailInput.focus(); return; }
      if (code === 'TERMS_REQUIRED' || code === 'TERMS_NOT_ACCEPTED' || code === 'TERMS_OUTDATED') { setError('terms', text); termsInput.focus(); return; }
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
        GF.voucherGo(url);
      });
    }

    function createOrder(body, fingerprint, retried) {
      proof.attach(body, {
        solving: function () { setBusy(true, GF.t('verifying')); },
        sending: function () { setBusy(true, GF.t('sending')); },
      }).then(function () {
        return GF.api('POST', '/gift-vouchers/orders', body);
      }).then(function (res) {
        proof.spend(); // a challenge is spent by one request, whatever the answer
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
      var body = isResource ? composeRequest() : { amountCents: cents };
      if (!isResource && campaign && campaign.slug) body.slug = campaign.slug;
      body.recipientFirstName = recipientInput.value.trim();
      body.recipientLastName = recipientLastInput.value.trim();
      body.senderName = senderInput.value.trim();
      body.message = messageInput.value.trim();
      body.email = emailInput.value.trim();
      body.termsVersionId = termsVersionId;
      body.language = GF.lang || 'fr';
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

    function voucherPage(order, shared) {
      var v = order.voucher;
      var code = v.code ? VC.format(VC.normalise(v.code)) : null;
      var state = order.state;
      var notes = [];
      if (state === 'expired') notes.push(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvExpired', dateOf(v.expiresOn))));
      else if (state === 'exhausted') notes.push(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvExhausted')));
      else if (state === 'cancelled') notes.push(GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvCancelled')));
      else if (v.balanceCents != null && v.balanceCents < v.amountCents) notes.push(GF.el('div', { class: 'gf-inline-info', role: 'status' }, GF.t('gvBalance', GF.euro(v.balanceCents / 100))));
      var frontUrl = GF.restUrl + '/gift-vouchers/orders/' + orderId + '/front?token=' + encodeURIComponent(token);
      var pdfUrl = GF.restUrl + '/gift-vouchers/orders/' + orderId + '/pdf?token=' + encodeURIComponent(token) + '&lang=' + encodeURIComponent(GF.lang || 'fr');
      var print = GF.el('button', { type: 'button', class: 'gf-btn gf-btn-alt' }, GF.t('gvPrint'));
      print.addEventListener('click', function () {
        if (card) { card.print(); return; }
        document.body.classList.add('gf-gv-printing');
        window.addEventListener('afterprint', function done() {
          document.body.classList.remove('gf-gv-printing');
          window.removeEventListener('afterprint', done);
        });
        window.print();
      });
      var after = GF.el('div', { class: 'gf-gv-form gf-gv-after' },
        GF.el('div', { class: 'gf-gv-actions' },
          GF.el('a', { class: 'gf-btn', href: pdfUrl, target: '_blank', rel: 'noopener' }, GF.t('gvDownload')),
          print),
        GF.el('p', {}, GF.t('gvHowTo')),
        GF.el('p', {}, GF.t('gvLinkStays')));
      var lead = GF.el('div', { class: 'gf-gv-lead' });
      var voucherBack = v.back || null;
      var card = null;
      // Rule 66 — the card the PDF holds: its back first, with the real code and the real QR code; the offer carries what is common to every back (layout, words, logo).
      card = voucherBack && shared ? GF.voucherCard({
        title: v.title || '',
        // The front frozen on the voucher, the one the PDF prints; none → the plain front.
        front: voucherBack.front ? function () { return GF.el('img', { src: frontUrl, alt: '', decoding: 'async' }); } : null,
        back: shared,
        preview: false,
        print: true,
        startOnBack: true,
      }) : null;
      if (card) {
        card.set({
          title: voucherBack.title || v.title || '', recipient: v.recipientName || '', sender: v.senderName || '', message: v.message || '', lines: voucherBack.lines, validUntil: voucherBack.validUntil, code: code, qrSvg: voucherBack.qrSvg, link: voucherBack.link, steps: voucherBack.steps,
        });
        lead.classList.add('has-card');
        lead.appendChild(GF.el('div', { class: 'gf-card-col' }, card.node));
      } else if (code) {
        // No back to draw (the company has no website): the code still has to be on the page.
        lead.appendChild(GF.el('div', { class: 'gf-gv-codebox gf-gv-printzone' },
          GF.el('div', { class: 'gf-gv-lbl' }, GF.t('gvCode')), GF.el('div', { class: 'gf-gv-code' }, code)));
      }
      lead.appendChild(GF.el('div', { class: 'gf-gv-main' }, after));
      say(GF.el('div', {}, GF.el('h3', { class: 'gf-gv-title' }, GF.t('gvReady')), notes, lead));
    }

    function stop(className, key) { say(GF.el('div', { class: className, role: 'status' }, GF.t(key))); }

    // The payment link lived its hour: nothing was paid, the form starts again on the page the visitor left.
    function expired() {
      var again = GF.el('button', { type: 'button', class: 'gf-btn gf-btn-alt' }, GF.t('gvRestart'));
      again.addEventListener('click', function () {
        var url = new URL(window.location.href);
        url.searchParams.delete('gf_voucher');
        url.searchParams.delete('gf_token');
        window.location.assign(url.toString());
      });
      say(GF.el('div', {},
        GF.el('div', { class: 'gf-inline-warn', role: 'status' }, GF.t('gvLinkExpired')),
        again));
    }

    function poll() {
      GF.api('GET', '/gift-vouchers/orders/' + orderId + '?token=' + encodeURIComponent(token)).then(function (res) {
        if (res.status === 404) { stop('gf-inline-warn', 'gvNotFound'); return; }
        var order = (res.body && res.body.data) || {};
        if (order.voucher) {
          if (!order.voucher.back) { voucherPage(order, null); return; }
          GF.api('GET', '/gift-vouchers/offer').then(function (offerRes) {
            var offer = offerRes.status >= 200 && offerRes.status < 300 && offerRes.body && offerRes.body.data;
            voucherPage(order, offer && offer.back ? offer.back : null);
          });
          return;
        }
        if (order.state === 'link-expired') { expired(); return; }
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
