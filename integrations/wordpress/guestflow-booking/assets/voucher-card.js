/**
 * The voucher card that turns (specs/gift-vouchers/gift-voucher-campaigns.md rule 66, build-free plain ES): one A6 card, its front the campaign's picture (rule 62) and its back drawn in HTML
 * as GuestFlow's PDF draws it. Shared by the purchase form (the preview) and the page shown after payment (the real voucher).
 *
 * It writes nothing of the back itself. GuestFlow sends the dimensions (`layout`, turned here into CSS custom properties), the fixed words (`texts`), the logo, the company's
 * name, town and website, the printed link, the QR code and the lines; the page hands over what the buyer typed. A back is drawn only when GuestFlow sent one; without it
 * the card is its front alone.
 *
 *   GFBooking.voucherCard({
 *     title,                 string   alternative text of the front
 *     front,                 () → img node | null   called once per drawing of the front (the card, the zoom, the print sheet)
 *     back,                  the offer's `back` ({ layout, texts, logoUrl, companyName, identity, website, link, previewQrSvg }) | null
 *     preview,               true before payment: the « Aperçu » pill and the grey code
 *     print,                 true to allow print(): both faces side by side at 105 × 148 mm, laid on <body> only while the page is printed
 *     startOnBack,           true to open on the back (the page after payment)
 *   }) → null (nothing to draw) | {
 *     node,                  the card, its « Recto / Verso » control and « Agrandir »
 *     set({ title, recipient, sender, message, lines, validUntil, code, qrSvg, link, steps }),   what the back says now
 *     turn(toBack),          isBack(),          reveal(),          print()
 *   }
 */
(function () {
  var GF = window.GFBooking;
  if (!GF) return;

  var PT_PER_MM = 0.35278;

  function kebab(key) { return key.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }

  // The first `{key}` only, as GuestFlow's own filling does; the value is taken literally.
  function fill(template, key, value) { return String(template || '').replace('{' + key + '}', function () { return value; }); }

  // An amount written the way the PDF writes it (« 1 234,50 € », plain spaces): the same function as GuestFlow's `formatEuros`, a test holds the two together.
  GF.cardEuros = function (cents) {
    var abs = Math.abs(cents);
    var whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (cents < 0 ? '-' : '') + whole + ',' + String(abs % 100).padStart(2, '0') + ' €';
  };

  // The QR code is an SVG that GuestFlow draws; the page refuses anything that is not a plain SVG before it writes it as markup.
  function plainSvg(svg) {
    return typeof svg === 'string' && /^<svg[\s>]/.test(svg.trim()) && !/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(svg);
  }

  // The logo is read through the plugin's proxy, never from GuestFlow: only the hash of its bytes is taken from the address GuestFlow gives.
  function logoSrc(url) {
    var hash = /[?&]v=([0-9a-f]{8,64})(?:&|$)/.exec(String(url || ''));
    return hash ? GF.restUrl + '/gift-vouchers/logo?v=' + hash[1] : '';
  }

  function div(cls, text) {
    var n = document.createElement('div');
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function span(cls, text) {
    var n = document.createElement('span');
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ── The back: one drawing, repainted when the state changes ───────────────────────────────────
  function drawBack(back, preview) {
    var layout = back.layout;
    var texts = back.texts;
    var root = div('gf-verso');
    root.style.setProperty('--m-trim', String(layout.trimMm.width));
    Object.keys(layout).forEach(function (key) {
      if (/Mm$/.test(key) && typeof layout[key] === 'number') root.style.setProperty('--m-' + kebab(key.replace(/Mm$/, '')), String(layout[key]));
    });
    ['pt', 'lines'].forEach(function (group) {
      Object.keys(layout[group] || {}).forEach(function (key) {
        root.style.setProperty('--' + (group === 'pt' ? 'p' : 'l') + '-' + kebab(key), String(layout[group][key]));
      });
    });
    root.style.setProperty('--lh-sans', String((layout.lineHeight || {}).sans || 1.326));
    root.style.setProperty('--lh-serif', String((layout.lineHeight || {}).serif || 1.371));

    var pill = preview ? span('gf-v-pill', GF.t('gvPreviewPill')) : null;
    var logo = div('gf-v-logo');
    var qr = div('gf-v-qr');
    var title = div('gf-v-t gf-v-title gf-v-clamp');
    var subtitle = div('gf-v-t gf-v-subtitle gf-v-clamp');
    var scan = div('gf-v-t gf-v-scan', texts.scan);
    var link = div('gf-v-t gf-v-link gf-v-clamp');
    var steps = div('gf-v-steps');
    var codeLabel = div('gf-v-t gf-v-code-label', texts.codeLabel);
    var code = div('gf-v-t gf-v-code');
    var includes = div('gf-v-t gf-v-includes gf-v-clamp');
    var message = div('gf-v-t gf-v-message gf-v-clamp');
    var valid = div('gf-v-t gf-v-valid');
    var safe = div('gf-v-safe');

    function drawLogo() {
      logo.innerHTML = '';
      logo.className = 'gf-v-logo';
      if (logoSrc(back.logoUrl)) {
        var img = document.createElement('img');
        img.alt = back.companyName || '';
        img.decoding = 'async';
        img.src = logoSrc(back.logoUrl);
        img.addEventListener('error', function () { logo.innerHTML = ''; logo.className = 'gf-v-logo is-name'; logo.appendChild(div('gf-v-t gf-v-clamp', back.companyName || '')); });
        logo.appendChild(img);
      } else {
        logo.className = 'gf-v-logo is-name';
        logo.appendChild(div('gf-v-t gf-v-clamp', back.companyName || ''));
      }
    }
    drawLogo();

    // The three steps are the server's: a voucher for a stay has its own (rule 20), sent with the back.
    var drawnSteps = null;
    function drawSteps(list) {
      drawnSteps = list;
      steps.innerHTML = '';
      (list || []).forEach(function (text, i) {
        var row = div('gf-v-step');
        row.appendChild(span('gf-v-disc', String(i + 1)));
        row.appendChild(div('gf-v-t gf-v-step-text', text));
        steps.appendChild(row);
      });
    }
    drawSteps(texts.steps);

    // Rules 18-20 of the week-weekend spec: the logo, the kicker, the title and the subtitle, the QR code in its frame, the three steps, the one rectangle of the code, the small lines.
    safe.appendChild(logo);
    safe.appendChild(div('gf-v-t gf-v-kicker', texts.title));
    safe.appendChild(title);
    safe.appendChild(subtitle);
    var frame = div('gf-v-qrframe');
    frame.appendChild(qr);
    safe.appendChild(frame);
    safe.appendChild(scan);
    safe.appendChild(link);
    safe.appendChild(steps);
    var box = div('gf-v-codebox');
    box.appendChild(codeLabel);
    box.appendChild(code);
    safe.appendChild(box);
    safe.appendChild(includes);
    safe.appendChild(message);
    safe.appendChild(valid);

    var foot = div('gf-v-foot');
    foot.appendChild(div('gf-v-t gf-v-identity', back.identity || back.companyName || ''));
    var legal = div('gf-v-legal');
    legal.appendChild(span('gf-v-t', texts.legal));

    if (pill) root.appendChild(pill);
    root.appendChild(safe);
    root.appendChild(foot);
    root.appendChild(legal);

    var drawnQr = null;
    function update(s) {
      if (s.qrSvg !== drawnQr) {
        drawnQr = s.qrSvg;
        qr.innerHTML = plainSvg(s.qrSvg) ? s.qrSvg : '';
      }
      if ((s.steps || texts.steps) !== drawnSteps) drawSteps(s.steps || texts.steps);
      title.textContent = s.title || back.title || '';
      var who = s.sender && s.recipient ? fill(fill(texts.subtitle, 'sender', s.sender), 'recipient', s.recipient)
        : (s.sender ? fill(texts.subtitleSender, 'sender', s.sender) : (s.recipient ? fill(texts.subtitleRecipient, 'recipient', s.recipient) : ''));
      subtitle.textContent = who;
      subtitle.hidden = !who;
      link.textContent = s.link || back.link || '';
      includes.textContent = (s.lines || []).length ? fill(texts.includes, 'lines', (s.lines || []).join(' · ')) : '';
      includes.hidden = !includes.textContent;
      message.textContent = s.message || '';
      message.hidden = !s.message;
      code.textContent = s.code || texts.codePlaceholder;
      code.classList.toggle('is-wait', !s.code);
      valid.textContent = s.validUntil ? fill(texts.validUntil, 'date', s.validUntil) : '';
    }
    return { node: root, update: update };
  }

  GF.voucherCard = function (o) {
    var back = o.back && o.back.layout && o.back.texts ? o.back : null;
    var probe = o.front ? o.front() : null;
    if (!back && !probe) return null;
    var state = {
      recipient: '', sender: '', message: '', lines: [], validUntil: '', code: null, qrSvg: back ? back.previewQrSvg : null, link: back ? back.link : '',
    };
    var onBack = !!(o.startOnBack && back);
    var views = [];
    var drawings = [];
    var zoomed = null;
    var zoomButton = null;
    var spare = probe;

    // The front: the picture, or a plain card with the company's name when there is none (or it failed to load).
    function buildFront() {
      var face = div('gf-card-face gf-card-front');
      var picture = spare || (o.front ? o.front() : null);
      spare = null;
      function plain() {
        face.classList.add('is-plain');
        face.appendChild(div('gf-card-plain-name', (back && back.companyName) || o.title || ''));
      }
      if (picture) {
        picture.classList.add('gf-card-front-img');
        picture.alt = o.title || '';
        picture.addEventListener('error', function () {
          if (picture.parentNode) picture.parentNode.removeChild(picture);
          plain();
        });
        face.appendChild(picture);
      } else {
        plain();
      }
      return face;
    }

    function buildBack() {
      var face = div('gf-card-face gf-card-backface');
      var a6 = div('gf-card-a6');
      var drawing = drawBack(back, !!o.preview);
      a6.appendChild(drawing.node);
      face.appendChild(a6);
      drawing.update(state);
      drawings.push(drawing);
      face.gfDrawing = drawing;
      return face;
    }

    // One drawing of the card that turns: the main one, and the one in the zoom.
    function makeView() {
      var flip = div('gf-card-flip');
      var inner = div('gf-card-inner');
      var view = { flip: flip, frontFace: buildFront(), backFace: back ? buildBack() : null };
      inner.appendChild(view.frontFace);
      if (view.backFace) inner.appendChild(view.backFace);
      flip.appendChild(inner);
      views.push(view);
      return view;
    }

    function paintView(view) {
      view.flip.classList.toggle('is-back', onBack);
      view.frontFace.setAttribute('aria-hidden', onBack ? 'true' : 'false');
      if (view.backFace) view.backFace.setAttribute('aria-hidden', onBack ? 'false' : 'true');
    }

    var main = makeView();
    var node = div('gf-vcard');
    node.setAttribute('data-face', onBack ? 'back' : 'front');
    node.appendChild(main.flip);

    var faceButtons = [];
    if (back) {
      var bar = div('gf-card-bar');
      var group = div('gf-card-seg');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', GF.t('gvFaceGroup'));
      [[false, 'gvFront'], [true, 'gvBack']].forEach(function (face) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = GF.t(face[1]);
        b.addEventListener('click', function () { api.turn(face[0]); });
        faceButtons.push({ node: b, back: face[0] });
        group.appendChild(b);
      });
      zoomButton = document.createElement('button');
      zoomButton.type = 'button';
      zoomButton.className = 'gf-card-zoom-btn';
      zoomButton.textContent = GF.t('gvEnlarge');
      zoomButton.addEventListener('click', openZoom);
      bar.appendChild(group);
      bar.appendChild(zoomButton);
      node.appendChild(bar);
      main.flip.classList.add('is-zoomable');
      main.flip.addEventListener('click', openZoom);
    }

    function paint() {
      views.forEach(paintView);
      node.setAttribute('data-face', onBack ? 'back' : 'front');
      faceButtons.forEach(function (b) { b.node.setAttribute('aria-pressed', String(b.back === onBack)); });
    }

    // « Agrandir »: the same card, larger, in a dialog; a click on it turns it, Escape and « Fermer » close it, the focus goes back to the button.
    function closeZoom() {
      if (!zoomed) return;
      document.removeEventListener('keydown', zoomKeys, true);
      var gone = zoomed;
      zoomed = null;
      views.splice(views.indexOf(gone.view), 1);
      if (gone.view.backFace) drawings.splice(drawings.indexOf(gone.view.backFace.gfDrawing), 1);
      if (gone.node.parentNode) gone.node.parentNode.removeChild(gone.node);
      if (gone.opener && gone.opener.focus) gone.opener.focus();
    }
    function zoomKeys(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeZoom(); return; }
      if (e.key === 'Tab' && zoomed) {
        // The dialog holds two stops, the card (it turns) and « Fermer »: Tab and Shift+Tab cycle between them.
        e.preventDefault();
        var order = [zoomed.view.flip, zoomed.close];
        var at = order.indexOf(document.activeElement);
        order[(at + (e.shiftKey ? order.length - 1 : 1) + (at < 0 ? 1 : 0)) % order.length].focus();
      }
    }
    function openZoom() {
      if (zoomed || !back) return;
      var opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : zoomButton;
      var view = makeView();
      view.flip.classList.add('is-zoomed');
      view.flip.setAttribute('role', 'button');
      view.flip.setAttribute('tabindex', '0');
      view.flip.setAttribute('aria-label', GF.t('gvTurnCard'));
      view.flip.addEventListener('click', function () { api.turn(!onBack); });
      view.flip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.turn(!onBack); } });
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'gf-card-zoom-close';
      close.textContent = GF.t('gvClose');
      close.addEventListener('click', closeZoom);
      var box = div('gf-card-zoom-box');
      box.appendChild(view.flip);
      box.appendChild(close);
      var overlay = div('gf-card-zoom');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', GF.t('gvZoomLabel'));
      overlay.appendChild(box);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeZoom(); });
      document.body.appendChild(overlay);
      zoomed = { node: overlay, view: view, close: close, opener: opener };
      document.addEventListener('keydown', zoomKeys, true);
      paintView(view);
      close.focus();
    }

    // The print sheet: both faces side by side at their real size, laid directly on <body> (a sticky card would anchor it) and the page size set for the print only.
    function print() {
      if (!back) return;
      var sheet = div('gf-card-sheet');
      var pageSize = document.createElement('style');
      pageSize.textContent = '@page { size: 210mm 148mm; margin: 0; }';
      var sFront = buildFront();
      var sBack = buildBack();
      sFront.classList.add('is-sheet');
      sBack.classList.add('is-sheet');
      sheet.appendChild(sFront);
      sheet.appendChild(sBack);
      document.head.appendChild(pageSize);
      document.body.appendChild(sheet);
      document.body.classList.add('gf-gv-printing-sheet');
      function done() {
        window.removeEventListener('afterprint', done);
        document.body.classList.remove('gf-gv-printing-sheet');
        [sheet, pageSize].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        drawings.splice(drawings.indexOf(sBack.gfDrawing), 1);
      }
      window.addEventListener('afterprint', done);
      window.print();
    }

    var api = {
      node: node,
      set: function (next) {
        Object.keys(next).forEach(function (k) { state[k] = next[k]; });
        drawings.forEach(function (d) { d.update(state); });
      },
      turn: function (toBack) {
        if (!back) return;
        onBack = !!toBack;
        paint();
      },
      isBack: function () { return onBack; },
      print: function () { if (o.print) print(); },
      // Brings the card back into view (a phone: it sits above the form), without animation under reduced motion.
      reveal: function () {
        if (!node.scrollIntoView) return;
        var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        node.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
      },
    };
    paint();
    return api;
  };
})();
