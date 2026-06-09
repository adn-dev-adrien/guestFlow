/**
 * Shared frontend runtime for the GuestFlow blocks (build-free, plain ES).
 *
 * `window.GFBooking` is created by wp_localize_script (config + i18n) BEFORE this file runs; here we
 * augment it with small helpers used by every block's view.js: a fetch wrapper that targets the
 * plugin's own REST proxy (carrying the wp_rest nonce — the GuestFlow key never reaches the browser),
 * a DOM element builder, a euro formatter, and an i18n helper with %s/%d substitution.
 */
(function () {
  var GF = window.GFBooking || (window.GFBooking = {});

  GF.t = function (key) {
    var str = (GF.i18n && GF.i18n[key]) || key;
    var args = Array.prototype.slice.call(arguments, 1);
    var i = 0;
    return str.replace(/%[sd]/g, function () { return args[i++]; });
  };

  GF.euro = function (n) {
    var v = Number(n || 0);
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v);
    } catch (e) {
      return v.toFixed(2) + ' €';
    }
  };

  // Build a DOM node: el('div', { class: 'x', onclick: fn }, child, child, ...)
  GF.el = function (tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var val = attrs[k];
      if (val == null || val === false) return;
      if (k === 'class') node.className = val;
      else if (k === 'html') node.innerHTML = val;
      else if (k.indexOf('on') === 0 && typeof val === 'function') node.addEventListener(k.slice(2).toLowerCase(), val);
      else if (k === 'dataset') Object.keys(val).forEach(function (d) { node.dataset[d] = val[d]; });
      else node.setAttribute(k, val);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c != null && c !== false) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      else node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  };

  // Call the plugin REST proxy. Returns a promise resolving to { status, body }.
  GF.api = function (method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-WP-Nonce': GF.nonce },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(GF.restUrl + path, opts).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; })
        .catch(function () { return { status: r.status, body: {} }; });
    }).catch(function () {
      return { status: 0, body: { error: { code: 'NETWORK', message: GF.t('genericError') } } };
    });
  };

  GF.errorMessage = function (res) {
    if (res && res.body && res.body.error && res.body.error.message) return res.body.error.message;
    return GF.t('genericError');
  };
})();
