<?php
/**
 * Plugin Name: Domaine Solio — Booking widget
 * Description: Custom availability calendar (range select) + booking popup for the accommodation
 *              pages. Proxies the GuestFlow public API via the GuestFlow Booking plugin's API client
 *              (key stays server-side). All pricing is computed by GuestFlow (/quote) — nothing here.
 */
if (!defined('ABSPATH')) { exit; }

/* ---- REST proxy (gf-solio/v1) — reuses the plugin's configured GF_Api_Client ---- */
add_action('rest_api_init', function () {
    $ns = 'gf-solio/v1';
    $pub = '__return_true';
    $relay = function ($res) {
        if (!is_array($res)) { return new WP_REST_Response(['error' => 'bad'], 502); }
        return new WP_REST_Response($res['body'] ?? null, (int) ($res['status'] ?? 502));
    };
    $client = function () { return class_exists('GF_Api_Client') ? GF_Api_Client::instance() : null; };

    /**
     * La langue demandee par le tiroir.
     *
     * Elle voyage explicitement plutot que d'etre redecouverte ici : un appel REST n'est pas la page,
     * Polylang n'y voit pas forcement la meme chose, et le tiroir sait, lui, dans quelle langue il
     * s'affiche (specs/site-english-version.md regle 28).
     */
    $langue = function ($r) {
        $brut = $r->get_param('lang');
        if (null === $brut) {
            $corps = $r->get_json_params();
            $brut = is_array($corps) && isset($corps['lang']) ? $corps['lang'] : null;
        }
        return function_exists('gf_langue_normalisee') ? gf_langue_normalisee($brut) : 'fr';
    };

    register_rest_route($ns, '/property/(?P<id>\d+)', ['methods' => 'GET', 'permission_callback' => $pub,
        'callback' => function ($r) use ($relay, $client, $langue) { $c = $client(); return $relay($c ? $c->get('/properties/' . (int) $r['id'], ['lang' => $langue($r)]) : null); }]);
    register_rest_route($ns, '/availability/(?P<id>\d+)', ['methods' => 'GET', 'permission_callback' => $pub,
        'callback' => function ($r) use ($relay, $client) { $c = $client();
            return $relay($c ? $c->get('/properties/' . (int) $r['id'] . '/availability', ['from' => $r['from'], 'to' => $r['to'], 'lang' => $langue($r)]) : null); }]);
    register_rest_route($ns, '/options/(?P<id>\d+)', ['methods' => 'GET', 'permission_callback' => $pub,
        'callback' => function ($r) use ($relay, $client, $langue) { $c = $client(); return $relay($c ? $c->get('/properties/' . (int) $r['id'] . '/options', ['lang' => $langue($r)]) : null); }]);
    register_rest_route($ns, '/resources/(?P<id>\d+)', ['methods' => 'GET', 'permission_callback' => $pub,
        'callback' => function ($r) use ($relay, $client, $langue) { $c = $client(); return $relay($c ? $c->get('/properties/' . (int) $r['id'] . '/resources', ['lang' => $langue($r)]) : null); }]);
    register_rest_route($ns, '/quote', ['methods' => 'POST', 'permission_callback' => $pub,
        'callback' => function ($r) use ($relay, $client, $langue) { $c = $client();
            return $relay($c ? $c->post('/quote', array_merge($r->get_json_params() ?: [], ['lang' => $langue($r)])) : null); }]);
    register_rest_route($ns, '/booking-requests', ['methods' => 'POST',
        'permission_callback' => function ($r) { $n = $r->get_header('X-WP-Nonce'); return is_string($n) && wp_verify_nonce($n, 'wp_rest'); },
        'callback' => function ($r) use ($relay, $client, $langue) { $c = $client();
            // La demande porte sa langue jusqu'au dossier du client : elle decide de la langue de sa
            // confirmation et de son devis PDF (regles 11-12).
            return $relay($c ? $c->post('/booking-requests', array_merge($r->get_json_params() ?: [], ['lang' => $langue($r)])) : null); }]);
});

/* ---- Enqueue widget CSS + JS ---- */
add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.gf-book{ max-width:780px; margin:0 auto; }
.gf-cal{ background:#fff; border:1px solid #e3e6dd; border-radius:14px; padding:16px; }
.gf-cal-nav{ display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.gf-cal-nav button{ border:0; background:#eef2e8; width:36px; height:36px; border-radius:8px; cursor:pointer; font-size:1.2rem; color:#2f3a26; }
.gf-cal-months{ display:flex; gap:22px; flex-wrap:wrap; }
.gf-cal-month{ flex:1; min-width:250px; }
.gf-cal-title{ text-align:center; font-weight:700; color:#2f3a26; margin-bottom:8px; text-transform:capitalize; }
.gf-cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:4px; }
.gf-cal-dow{ text-align:center; font-size:.72rem; color:#9aa08f; padding:2px 0; }
.gf-cal-day{ aspect-ratio:1; border:0; background:#f3f5ef; border-radius:8px; cursor:pointer; font-size:.9rem; color:#2f3a26; padding:0; }
.gf-cal-day:hover:not(:disabled){ background:#dfe7d3; }
.gf-cal-day.gf-empty{ background:transparent; cursor:default; }
.gf-cal-day:disabled{ background:transparent; color:#cfd3c8; cursor:not-allowed; text-decoration:line-through; }
.gf-cal-day.gf-range{ background:#dfe7d3; border-radius:0; }
.gf-cal-day.gf-edge{ background:#5a6b48; color:#fff; font-weight:700; }
.gf-cal-hint{ text-align:center; color:#5a6b48; font-weight:600; margin-top:12px; }

.gf-modal{ position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.55); display:none; align-items:flex-start; justify-content:center; overflow:auto; padding:24px 12px; }
.gf-modal.is-open{ display:flex; }
.gf-card{ background:#fff; border-radius:16px; max-width:580px; width:100%; padding:24px 24px 96px; position:relative; box-shadow:0 16px 50px rgba(0,0,0,.3); }
.gf-card h3{ margin:.2em 0 .6em; font-size:1.5rem; color:#2f3a26; }
.gf-x{ position:absolute; top:14px; right:18px; border:0; background:none; font-size:1.8rem; line-height:1; cursor:pointer; color:#555; }
.gf-dates{ background:#eef2e8; border-radius:10px; padding:12px 16px; font-weight:700; color:#2f3a26; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.gf-sect{ margin:16px 0 6px; font-weight:700; color:#2f3a26; }
.gf-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid #f0f1ec; }
.gf-row:last-child{ border-bottom:0; }
.gf-row .gf-lbl{ flex:1; }
.gf-row .gf-sub{ display:block; font-size:.82rem; color:#8a8f80; font-weight:400; }
.gf-row .gf-partlbl{ color:#5a6b48; font-weight:600; }
.gf-step{ display:inline-flex; align-items:center; gap:0; border:1px solid #d7dccf; border-radius:8px; overflow:hidden; }
.gf-step button{ width:34px; height:34px; border:0; background:#f3f5ef; cursor:pointer; font-size:1.1rem; color:#2f3a26; }
.gf-step span{ min-width:34px; text-align:center; font-weight:700; }
.gf-time{ border:1px solid #d7dccf; border-radius:8px; padding:7px 8px; }
.gf-flex2{ display:flex; gap:12px; flex-wrap:wrap; }
.gf-field{ flex:1; min-width:160px; display:flex; flex-direction:column; gap:4px; margin-top:8px; }
.gf-field label{ font-size:.85rem; color:#2f3a26; font-weight:600; }
.gf-field input{ border:1px solid #d7dccf; border-radius:8px; padding:9px 10px; font-size:1rem; }
.gf-line-total{ font-weight:700; color:#5a6b48; min-width:64px; text-align:right; }
.gf-hp{ position:absolute; left:-9999px; }
.gf-totalbar{ position:absolute; left:0; right:0; bottom:0; background:#2f3a26; color:#fff; border-radius:0 0 16px 16px; padding:14px 22px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.gf-totalbar .gf-amt{ font-size:1.5rem; font-weight:800; }
.gf-totalbar button{ background:#fff; color:#2f3a26; border:0; border-radius:8px; padding:11px 18px; font-weight:700; cursor:pointer; }
.gf-totalbar button:disabled{ opacity:.5; cursor:not-allowed; }
.gf-recap{ font-size:.9rem; color:#555; margin-top:10px; }
.gf-recap div{ display:flex; justify-content:space-between; padding:2px 0; }
.gf-msg{ margin-top:10px; font-weight:600; }
.gf-ok{ background:#5a6b48; color:#fff; border:0; border-radius:8px; padding:11px 28px; font-weight:700; cursor:pointer; font-size:1rem; }
.gf-ok:hover{ background:#4c5b3d; }
@media (max-width:600px){ .gf-card{ padding:20px 16px 92px; } .gf-totalbar .gf-amt{ font-size:1.25rem; } }
CSS;
    wp_register_style('gf-book', false);
    wp_enqueue_style('gf-book');
    wp_add_inline_style('gf-book', $css);

    wp_register_script('gf-book', '', [], null, true);
    wp_enqueue_script('gf-book');
    wp_add_inline_script('gf-book', 'window.GF_BOOK=' . wp_json_encode([
        'rest'  => esc_url_raw(rest_url('gf-solio/v1')),
        'nonce' => wp_create_nonce('wp_rest'),
        // La langue du tunnel, decidee par la page (specs/site-english-version.md regle 28). Le
        // dictionnaire part avec la configuration plutot que d'etre reconstruit en JavaScript :
        // c'est PHP qui sait quelle page est servie.
        'lang'  => function_exists('gf_langue') ? gf_langue() : 'fr',
        't'     => gf_booking_dictionnaire(),
    ]) . ';', 'before');
    wp_add_inline_script('gf-book', gf_booking_js());
});


/**
 * Ce que le tunnel dit, dans les deux langues.
 *
 * Meme forme que les autres dictionnaires du projet : deux tableaux de cles identiques. Les mois et
 * les jours en font partie — un calendrier anglais qui affiche « septembre » est un calendrier
 * francais avec des boutons anglais.
 *
 * Les montants, eux, ne changent pas de convention : « 1 234,56 € » dans les deux, comme le devis
 * PDF joint a la confirmation (regle 10).
 */
function gf_booking_dictionnaire() {
    $langue = function_exists('gf_langue') ? gf_langue() : 'fr';
    $fr = array(
        'mois'            => array('janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'),
        'jours'           => array('lun','mar','mer','jeu','ven','sam','dim'),
        'choisirDates'    => 'Choisissez vos dates',
        'choisirArrivee'  => 'Sélectionnez votre date d’arrivée',
        'choisirDepart'   => 'Sélectionnez votre date de départ',
        'nuit'            => 'nuit',
        'nuits'           => 'nuits',
        'sejourMin'       => 'Séjour minimum :',
        'vousAvezChoisi'  => 'vous avez choisi',
        'periodePlusLongue' => 'Choisissez une période plus longue.',
        'votreSejour'     => 'Votre séjour',
        'arrivee'         => 'Arrivée',
        'depart'          => 'Départ',
        'voyageurs'       => 'Voyageurs',
        'options'         => 'Options',
        'supplements'     => 'Suppléments',
        'vosCoordonnees'  => 'Vos coordonnées',
        'prenom'          => 'Prénom *',
        'nom'             => 'Nom *',
        'email'           => 'E-mail *',
        'telephone'       => 'Téléphone *',
        'nePasRemplir'    => 'Ne pas remplir',
        'totalSejour'     => 'Total du séjour',
        'envoyer'         => 'Envoyer la demande',
        'envoiEnCours'    => 'Envoi…',
        'du'              => 'Du',
        'au'              => 'au',
        'modifierDates'   => 'Modifier les dates',
        'aucunSupplement' => 'Aucun supplément.',
        'litsBebe'        => '🍼 Lit(s) bébé souhaité(s) ?',
        'litsBebeNote'    => 'Gratuit, selon disponibilité',
        'aucuneOption'    => 'Aucune option pour ce logement.',
        'tarifDegressif'  => 'Tarif dégressif · dès',
        'parParticipant'  => '/ participant',
        'nbParticipants'  => 'Nombre de participants',
        'taxeSejour'      => 'Taxe de séjour',
        'indisponible'    => 'Indisponible',
        'indisponibleCriteres' => 'Indisponible pour ces critères.',
        'offert'          => 'Offert',
        'coordonneesManquantes' => 'Merci de renseigner vos coordonnées.',
        'emailInvalide'   => 'Merci de saisir une adresse e-mail valide.',
        'erreurGenerique' => 'Une erreur est survenue.',
        'merci'           => 'Merci',
        'demandeEnvoyee'  => 'Votre demande de réservation a bien été envoyée. Nous revenons vers vous très vite pour confirmer votre séjour.',
        'adultes'         => 'Adultes',
        'ados'            => 'Ados',
        'enfants'         => 'Enfants',
        'bebes'           => 'Bébés',
        'ansAdultes'      => '',
        'ansAdos'         => '12 à 18 ans',
        'ansEnfants'      => '2 à 12 ans',
        'ansBebes'        => '0 à 2 ans',
        'verifDuree'      => 'Vérification de la durée minimale…',
        'nuitIndisponible' => 'Ces dates incluent une nuit indisponible. Choisissez une autre période.',
        'aPartirDe'       => 'À partir de',
    );
    $en = array(
        'mois'            => array('January','February','March','April','May','June','July','August','September','October','November','December'),
        'jours'           => array('Mon','Tue','Wed','Thu','Fri','Sat','Sun'),
        'choisirDates'    => 'Choose your dates',
        'choisirArrivee'  => 'Select your arrival date',
        'choisirDepart'   => 'Select your departure date',
        'nuit'            => 'night',
        'nuits'           => 'nights',
        'sejourMin'       => 'Minimum stay:',
        'vousAvezChoisi'  => 'you chose',
        'periodePlusLongue' => 'Please choose a longer period.',
        'votreSejour'     => 'Your stay',
        'arrivee'         => 'Arrival',
        'depart'          => 'Departure',
        'voyageurs'       => 'Guests',
        'options'         => 'Options',
        'supplements'     => 'Extras',
        'vosCoordonnees'  => 'Your details',
        'prenom'          => 'First name *',
        'nom'             => 'Surname *',
        'email'           => 'Email *',
        'telephone'       => 'Telephone *',
        'nePasRemplir'    => 'Do not fill in',
        'totalSejour'     => 'Total for the stay',
        'envoyer'         => 'Send the request',
        'envoiEnCours'    => 'Sending…',
        'du'              => 'From',
        'au'              => 'to',
        'modifierDates'   => 'Change the dates',
        'aucunSupplement' => 'No extras.',
        'litsBebe'        => '🍼 Cot(s) required?',
        'litsBebeNote'    => 'Free, subject to availability',
        'aucuneOption'    => 'No options for this property.',
        'tarifDegressif'  => 'Sliding scale · from',
        'parParticipant'  => '/ participant',
        'nbParticipants'  => 'Number of participants',
        'taxeSejour'      => 'Tourist tax',
        'indisponible'    => 'Unavailable',
        'indisponibleCriteres' => 'Unavailable for these criteria.',
        'offert'          => 'Included',
        'coordonneesManquantes' => 'Please fill in your details.',
        'emailInvalide'   => 'Please enter a valid email address.',
        'erreurGenerique' => 'Something went wrong.',
        'merci'           => 'Thank you',
        'demandeEnvoyee'  => 'Your booking request has been sent. We will come back to you very shortly to confirm your stay.',
        'adultes'         => 'Adults',
        'ados'            => 'Teenagers',
        'enfants'         => 'Children',
        'bebes'           => 'Babies',
        'ansAdultes'      => '',
        'ansAdos'         => '12 to 18 years',
        'ansEnfants'      => '2 to 12 years',
        'ansBebes'        => '0 to 2 years',
        'verifDuree'      => 'Checking the minimum stay…',
        'nuitIndisponible' => 'These dates include a night that is not available. Please choose another period.',
        'aPartirDe'       => 'From',
    );
    return 'en' === $langue ? $en : $fr;
}

function gf_booking_js() {
    return <<<'JS'
(function(){
  var CFG = window.GF_BOOK || {};
  // Tout ce que le visiteur lit vient d'ici. Le repli francais n'est pas du zele : une version
  // ancienne de ce fichier, servie depuis un cache, n'enverrait pas de dictionnaire.
  var T = CFG.t || {};
  var MONTHS = T.mois || ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var DOW = T.jours || ['lun','mar','mer','jeu','ven','sam','dim'];
  // « 3 nuits » / « 3 nights » : l'accord se decide la ou les deux langues different.
  function nuits(n){ return n + ' ' + (n > 1 ? (T.nuits || 'nuits') : (T.nuit || 'nuit')); }
  // La langue accompagne chaque lecture : le relais REST ne peut pas la deviner depuis la page.
  function L(){ return '?lang=' + (CFG.lang || 'fr'); }
  function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function addDays(s,n){ var d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return iso(d); }
  function euro(n){ return (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.',',')+' €'; }
  function api(path, opts){ return fetch(CFG.rest+path, opts).then(function(r){ return r.json().then(function(b){ return {status:r.status, body:b}; }); }); }

  document.querySelectorAll('.gf-book').forEach(function(root){
    var pid = parseInt(root.getAttribute('data-property'),10); if(!pid) return;
    var state = { pid:pid, property:null, blocked:new Set(), options:[], resources:[], babyResId:null, submitted:false,
      view:new Date(), start:null, end:null,
      cfg:{ adults:2, teens:0, children:0, babies:0, babyBeds:0, checkInTime:'16:00', checkOutTime:'10:00', opt:{}, res:{} },
      quote:null, quoteTimer:null };
    state.view.setDate(1);

    root.innerHTML = '<div class="gf-cal"><div class="gf-cal-nav"><button type="button" data-nav="-1">‹</button>'
      + '<strong>'+(T.choisirDates||'Choisissez vos dates')+'</strong><button type="button" data-nav="1">›</button></div>'
      + '<div class="gf-cal-months"></div><div class="gf-cal-hint"></div></div>';
    var monthsEl = root.querySelector('.gf-cal-months');
    var hintEl = root.querySelector('.gf-cal-hint');
    root.querySelector('[data-nav="-1"]').onclick=function(){ state.view.setMonth(state.view.getMonth()-1); renderCal(); };
    root.querySelector('[data-nav="1"]').onclick=function(){ state.view.setMonth(state.view.getMonth()+1); renderCal(); };

    // initial loads
    var today=new Date(); today.setHours(0,0,0,0);
    var to=new Date(); to.setFullYear(to.getFullYear()+1);
    Promise.all([
      api('/property/'+pid+L()),
      api('/availability/'+pid+'?from='+iso(today)+'&to='+iso(to)+'&lang='+(CFG.lang||'fr')),
      api('/options/'+pid+L()),
      api('/resources/'+pid+L())
    ]).then(function(r){
      if(r[0].body && r[0].body.data){ state.property=r[0].body.data;
        state.cfg.checkInTime = r[0].body.data.defaultCheckIn || '16:00';
        state.cfg.checkOutTime = r[0].body.data.defaultCheckOut || '10:00'; }
      (((r[1].body||{}).data||{}).blockedDates||[]).forEach(function(d){ state.blocked.add(d); });
      state.options = ((r[2].body||{}).data||[]).filter(function(o){ return o.autoOptionType!=='early_check_in' && o.autoOptionType!=='late_check_out'; });
      var res = ((r[3].body||{}).data||[]);
      state.resources = res.filter(function(x){ var n=(x.name||'').toLowerCase(); if(n.indexOf('lit bébé')>=0||n.indexOf('lit bebe')>=0){ state.babyResId=x.id; return false; } return true; });
      renderCal();
    });

    function isBlocked(d){ return state.blocked.has(d); }
    function rangeHasBlocked(a,b){ var c=a; while(c<b){ if(isBlocked(c)) return true; c=addDays(c,1); } return false; }

    function renderCal(){
      monthsEl.innerHTML='';
      for(var m=0;m<2;m++){ monthsEl.appendChild(buildMonth(state.view.getFullYear(), state.view.getMonth()+m)); }
      hintEl.textContent = state.start && !state.end ? (T.choisirDepart||'Sélectionnez votre date de départ') : (state.start && state.end ? '' : (T.choisirArrivee||'Sélectionnez votre date d’arrivée'));
    }
    function buildMonth(y, mRaw){
      var d=new Date(y,mRaw,1); var year=d.getFullYear(), mon=d.getMonth();
      var wrap=document.createElement('div'); wrap.className='gf-cal-month';
      wrap.innerHTML='<div class="gf-cal-title">'+MONTHS[mon]+' '+year+'</div>';
      var grid=document.createElement('div'); grid.className='gf-cal-grid';
      DOW.forEach(function(w){ var e=document.createElement('div'); e.className='gf-cal-dow'; e.textContent=w; grid.appendChild(e); });
      var first=new Date(year,mon,1); var lead=(first.getDay()+6)%7;
      for(var i=0;i<lead;i++){ var x=document.createElement('div'); x.className='gf-cal-day gf-empty'; grid.appendChild(x); }
      var days=new Date(year,mon+1,0).getDate();
      var todayIso=iso(new Date());
      for(var day=1;day<=days;day++){
        var ds=year+'-'+String(mon+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
        var b=document.createElement('button'); b.type='button'; b.className='gf-cal-day'; b.textContent=day;
        var pickingStart = (!state.start || state.end);
        var disabled = ds<todayIso || (pickingStart ? isBlocked(ds) : (ds<state.start || rangeHasBlocked(state.start, ds)));
        if(disabled) b.disabled=true;
        if(state.start && ds===state.start) b.classList.add('gf-edge');
        if(state.end && ds===state.end) b.classList.add('gf-edge');
        if(state.start && state.end && ds>state.start && ds<state.end) b.classList.add('gf-range');
        b.addEventListener('click', (function(ds){ return function(){ onPick(ds); }; })(ds));
        grid.appendChild(b);
      }
      wrap.appendChild(grid); return wrap;
    }
    function checkMinNightsThenOpen(start, end){
      hintEl.innerHTML=(T.verifDuree||'Vérification de la durée minimale…');
      api('/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ propertyId:state.pid, startDate:start, endDate:end, adults:state.cfg.adults, teens:state.cfg.teens, children:state.cfg.children, babies:state.cfg.babies, options:[], resources:[] }) })
        .then(function(res){
          var q = res.body && res.body.data;
          if(q && q.minNightsBreached){
            var nights=Math.round((new Date(end)-new Date(start))/86400000);
            state.end=null; renderCal();
            hintEl.innerHTML='<span style="color:#b00;font-weight:600">'+(T.sejourMin||'Séjour minimum :')+' '+nuits(q.minNights)+' ('+(T.vousAvezChoisi||'vous avez choisi')+' '+nuits(nights)+'). '+(T.periodePlusLongue||'Choisissez une période plus longue.')+'</span>';
            return;
          }
          hintEl.innerHTML='';
          openModal();
        });
    }
    function onPick(ds){
      if(state.start && !state.end && ds===state.start){ state.start=null; renderCal(); return; }
      if(!state.start || state.end){ state.start=ds; state.end=null; renderCal(); return; }
      if(ds<=state.start){ state.start=ds; state.end=null; renderCal(); return; }
      if(rangeHasBlocked(state.start, ds)){ alert(T.nuitIndisponible||'Ces dates incluent une nuit indisponible. Choisissez une autre période.'); state.start=ds; state.end=null; renderCal(); return; }
      state.end=ds; renderCal(); checkMinNightsThenOpen(state.start, ds);
    }

    // ---------- MODAL ----------
    var modal=null;
    function openModal(){ if(!modal) buildModal(); fillModal(); modal.classList.add('is-open'); document.body.style.overflow='hidden'; scheduleQuote(); }
    function closeModal(){ modal.classList.remove('is-open'); document.body.style.overflow=''; if(state.submitted){ if(modal){ modal.remove(); } modal=null; state.submitted=false; state.start=null; state.end=null; renderCal(); } }
    function buildModal(){
      modal=document.createElement('div'); modal.className='gf-modal';
      modal.innerHTML='<div class="gf-card"><button class="gf-x" type="button">&times;</button>'
        +'<h3>'+(T.votreSejour||'Votre séjour')+'</h3><div class="gf-dates"></div>'
        +'<div class="gf-flex2"><div class="gf-field"><label>'+(T.arrivee||'Arrivée')+'</label><input class="gf-ci" type="time"></div>'
        +'<div class="gf-field"><label>'+(T.depart||'Départ')+'</label><input class="gf-co" type="time"></div></div>'
        +'<div class="gf-sect">'+(T.voyageurs||'Voyageurs')+'</div><div class="gf-people"></div>'
        +'<div class="gf-babybed"></div>'
        +'<div class="gf-sect">'+(T.options||'Options')+'</div><div class="gf-opts"></div>'
        +'<div class="gf-sect">'+(T.supplements||'Suppléments')+'</div><div class="gf-res"></div>'
        +'<div class="gf-recap"></div>'
        +'<div class="gf-sect">'+(T.vosCoordonnees||'Vos coordonnées')+'</div>'
        +'<div class="gf-flex2"><div class="gf-field"><label>'+(T.prenom||'Prénom *')+'</label><input class="gf-fn" type="text" name="given-name" autocomplete="given-name" autocapitalize="words"></div>'
        +'<div class="gf-field"><label>'+(T.nom||'Nom *')+'</label><input class="gf-ln" type="text" name="family-name" autocomplete="family-name" autocapitalize="words"></div></div>'
        +'<div class="gf-flex2"><div class="gf-field"><label>'+(T.email||'E-mail *')+'</label><input class="gf-em" type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"></div>'
        +'<div class="gf-field"><label>'+(T.telephone||'Téléphone *')+'</label><input class="gf-ph" type="tel" name="tel" autocomplete="tel" inputmode="tel"></div></div>'
        +'<input class="gf-hp" tabindex="-1" autocomplete="off" placeholder="'+(T.nePasRemplir||'Ne pas remplir')+'">'
        +'<div class="gf-msg"></div>'
        +'<div class="gf-totalbar"><div><span style="font-size:.85rem">'+(T.totalSejour||'Total du séjour')+'</span><div class="gf-amt">…</div></div>'
        +'<button class="gf-submit" type="button" disabled>'+(T.envoyer||'Envoyer la demande')+'</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('.gf-x').onclick=closeModal;
      modal.addEventListener('click',function(e){ if(e.target===modal) closeModal(); });
      var ci=modal.querySelector('.gf-ci'), co=modal.querySelector('.gf-co');
      ci.onchange=function(){ state.cfg.checkInTime=ci.value; scheduleQuote(); };
      co.onchange=function(){ state.cfg.checkOutTime=co.value; scheduleQuote(); };
      modal.querySelector('.gf-submit').onclick=submit;
    }
    function stepper(getV, setV, min, max){
      var wrap=document.createElement('div'); wrap.className='gf-step';
      var dec=document.createElement('button'); dec.type='button'; dec.textContent='−';
      var val=document.createElement('span'); val.textContent=getV();
      var inc=document.createElement('button'); inc.type='button'; inc.textContent='+';
      dec.onclick=function(){ var v=Math.max(min, getV()-1); setV(v); val.textContent=v; scheduleQuote(); };
      inc.onclick=function(){ var mx=(typeof max==='function')?max():(max==null?99:max); var v=Math.min(mx, getV()+1); setV(v); val.textContent=v; scheduleQuote(); };
      wrap.appendChild(dec); wrap.appendChild(val); wrap.appendChild(inc); return wrap;
    }
    function row(labelHtml, control, totalEl){
      var r=document.createElement('div'); r.className='gf-row';
      var l=document.createElement('div'); l.className='gf-lbl'; l.innerHTML=labelHtml; r.appendChild(l);
      if(totalEl) r.appendChild(totalEl);
      r.appendChild(control); return r;
    }
    function fillModal(){
      var nights=Math.round((new Date(state.end)-new Date(state.start))/86400000);
      var dd=modal.querySelector('.gf-dates');
      dd.innerHTML='<span>'+(T.du||'Du')+' '+frDate(state.start)+' '+(T.au||'au')+' '+frDate(state.end)+' · '+nuits(nights)+'</span>'
        +'<button class="gf-editdates" type="button" style="margin-left:12px;border:0;background:#5a6b48;color:#fff;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">'+(T.modifierDates||'Modifier les dates')+'</button>';
      dd.querySelector('.gf-editdates').onclick=function(){
        // Re-pick on the calendar (availability-constrained). Config is preserved in state.cfg.
        state.start=null; state.end=null; renderCal(); closeModal();
        root.querySelector('.gf-cal').scrollIntoView({behavior:'smooth', block:'center'});
      };
      modal.querySelector('.gf-ci').value=state.cfg.checkInTime;
      modal.querySelector('.gf-co').value=state.cfg.checkOutTime;
      // people
      var p=modal.querySelector('.gf-people'); p.innerHTML='';
      var defs=[['adults',T.adultes||'Adultes',T.ansAdultes||'',1],['teens',T.ados||'Ados',T.ansAdos||'12 à 18 ans',0],
                ['children',T.enfants||'Enfants',T.ansEnfants||'2 à 12 ans',0],['babies',T.bebes||'Bébés',T.ansBebes||'0 à 2 ans',0]];
      defs.forEach(function(d){ p.appendChild(row('<span class="gf-lbl">'+d[1]+(d[2]?'<span class="gf-sub">'+d[2]+'</span>':'')+'</span>',
        stepper(function(){return state.cfg[d[0]];}, function(v){ state.cfg[d[0]]=v; if(d[0]==='babies'){ if(v<state.cfg.babyBeds) state.cfg.babyBeds=v; renderBabyBed(); } else { renderOpts(); } }, d[3]))); });
      renderBabyBed();
      // options
      renderOpts();
      // resources
      var rs=modal.querySelector('.gf-res'); rs.innerHTML='';
      if(!state.resources.length){ rs.innerHTML='<div class="gf-sub">'+(T.aucunSupplement||'Aucun supplément.')+'</div>'; }
      state.resources.forEach(function(re){
        if(!(re.id in state.cfg.res)) state.cfg.res[re.id]=0;
        var tot=document.createElement('span'); tot.className='gf-line-total'; tot.dataset.resTotal=re.id;
        rs.appendChild(row('<span class="gf-lbl">'+re.name+'<span class="gf-sub">'+priceLabel(re)+'</span></span>',
          stepper(function(){return state.cfg.res[re.id];}, function(v){ state.cfg.res[re.id]=v; }, 0), tot));
      });
    }
    function renderBabyBed(){
      var w=modal.querySelector('.gf-babybed'); w.innerHTML='';
      if(state.cfg.babies>0 && state.babyResId){
        w.appendChild(row('<span class="gf-lbl">'+(T.litsBebe||'🍼 Lit(s) bébé souhaité(s) ?')+'<span class="gf-sub">'+(T.litsBebeNote||'Gratuit, selon disponibilité')+'</span></span>',
          stepper(function(){return state.cfg.babyBeds;}, function(v){ state.cfg.babyBeds=Math.min(v,state.cfg.babies); }, 0, state.cfg.babies)));
      } else { state.cfg.babyBeds=0; }
    }
    function priceLabel(x){
      // Le serveur ecrit deja ce libelle, dans la bonne langue et avec la bonne regle
      // (publicLabels.js) : on l'affiche tel quel. Le repli local ne sert qu'aux payloads d'avant
      // cette version — ajouter une option ne doit rien demander au site.
      if (x.priceUnitLabel) return (T.aPartirDe||'À partir de')+' '+euro(x.price)+' '+x.priceUnitLabel;
      var unit = x.priceType==='per_person'?' / pers.' : x.priceType==='per_person_per_night'?' / pers. / nuit' : x.priceType==='per_night'?' / nuit' : '';
      return (T.aPartirDe||'À partir de')+' '+euro(x.price)+unit;
    }
    function persons(){ return (Number(state.cfg.adults)||0)+(Number(state.cfg.teens)||0)+(Number(state.cfg.children)||0); }
    function renderOpts(){
      var o=modal.querySelector('.gf-opts'); o.innerHTML='';
      if(!state.options.length){ o.innerHTML='<div class="gf-sub">'+(T.aucuneOption||'Aucune option pour ce logement.')+'</div>'; return; }
      state.options.forEach(function(op){
        if(!(op.id in state.cfg.opt)) state.cfg.opt[op.id]=0;
        var prog = op.priceType==='per_participant_progressive';
        if(prog) state.cfg.opt[op.id]=Math.min(state.cfg.opt[op.id], Math.max(1, persons()));
        var tot=document.createElement('span'); tot.className='gf-line-total'; tot.dataset.optTotal=op.id;
        var sub = prog ? (T.tarifDegressif||'Tarif dégressif · dès')+' '+euro(op.price)+' '+(T.parParticipant||'/ participant') : priceLabel(op);
        var lbl = '<span class="gf-lbl">'+op.title+'<span class="gf-sub">'+sub+'</span>'
          + (prog?'<span class="gf-sub gf-partlbl">'+(T.nbParticipants||'Nombre de participants')+'</span>':'') + '</span>';
        var mx = prog ? function(){ return Math.max(1, persons()); } : null;
        o.appendChild(row(lbl,
          stepper(function(){return state.cfg.opt[op.id];}, function(v){ state.cfg.opt[op.id]=v; }, 0, mx), tot));
      });
    }
    function frDate(s){ var d=new Date(s+'T00:00:00'); return d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear(); }

    function buildPayload(){
      var opts=[]; Object.keys(state.cfg.opt).forEach(function(id){ if(state.cfg.opt[id]>0) opts.push({optionId:+id, quantity:state.cfg.opt[id]}); });
      var ress=[]; Object.keys(state.cfg.res).forEach(function(id){ if(state.cfg.res[id]>0) ress.push({resourceId:+id, quantity:state.cfg.res[id]}); });
      return { propertyId:state.pid, startDate:state.start, endDate:state.end,
        checkInTime:state.cfg.checkInTime, checkOutTime:state.cfg.checkOutTime,
        adults:state.cfg.adults, teens:state.cfg.teens, children:state.cfg.children, babies:state.cfg.babies, babyBeds:state.cfg.babyBeds,
        options:opts, resources:ress, lang: CFG.lang || 'fr' };
    }
    function scheduleQuote(){ clearTimeout(state.quoteTimer); state.quoteTimer=setTimeout(doQuote, 350); }
    function doQuote(){
      var amt=modal.querySelector('.gf-amt'); amt.textContent='…';
      api('/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(buildPayload()) })
        .then(function(res){
          if(res.status<200||res.status>=300||!res.body||!res.body.data){ amt.textContent='—'; modal.querySelector('.gf-submit').disabled=true;
            modal.querySelector('.gf-msg').textContent=(res.body&&res.body.error&&res.body.error.message)||(T.indisponibleCriteres||'Indisponible pour ces critères.'); return; }
          modal.querySelector('.gf-msg').textContent=''; state.quote=res.body.data; renderQuote(res.body.data);
        });
    }
    function renderQuote(q){
      modal.querySelector('.gf-amt').textContent=euro(q.totalStayPrice!=null?q.totalStayPrice:q.finalPrice);
      modal.querySelector('.gf-submit').disabled = !q.available || !!q.minNightsBreached;
      // line totals
      var byOpt={}; (q.options||[]).forEach(function(o){ byOpt[o.optionId]=o; });
      modal.querySelectorAll('[data-opt-total]').forEach(function(el){ var o=byOpt[el.dataset.optTotal]; el.textContent=o?(o.offered?'Offert':euro(o.total)):''; });
      var byRes={}; (q.resources||[]).forEach(function(r){ byRes[r.resourceId]=r; });
      modal.querySelectorAll('[data-res-total]').forEach(function(el){ var r=byRes[el.dataset.resTotal]; el.textContent=r?(r.offered?'Offert':euro(r.total)):''; });
      var recap=modal.querySelector('.gf-recap'); var rows='';
      rows+='<div><span>Hébergement ('+q.nights+' nuit'+(q.nights>1?'s':'')+')</span><span>'+euro(q.accommodationTotal)+'</span></div>';
      if(q.optionsTotal>0) rows+='<div><span>Options</span><span>'+euro(q.optionsTotal)+'</span></div>';
      if(q.resourcesTotal>0) rows+='<div><span>Suppléments</span><span>'+euro(q.resourcesTotal)+'</span></div>';
      if(q.touristTax&&q.touristTax.total>0) rows+='<div><span>'+(T.taxeSejour||'Taxe de séjour')+'</span><span>'+euro(q.touristTax.total)+'</span></div>';
      if(q.minNightsBreached) rows+='<div style="color:#b00"><span>'+(T.sejourMin||'Séjour minimum :')+' '+nuits(q.minNights)+'</span><span></span></div>';
      if(!q.available) rows+='<div style="color:#b00"><span>'+(T.indisponible||'Indisponible')+'</span><span></span></div>';
      recap.innerHTML=rows;
    }
    function submit(){
      var fn=modal.querySelector('.gf-fn').value.trim(), ln=modal.querySelector('.gf-ln').value.trim();
      var em=modal.querySelector('.gf-em').value.trim(), ph=modal.querySelector('.gf-ph').value.trim();
      var msg=modal.querySelector('.gf-msg');
      if(!fn||!ln||!em||!ph){ msg.style.color='#b00'; msg.textContent=(T.coordonneesManquantes||'Merci de renseigner vos coordonnées.'); return; }
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ msg.style.color='#b00'; msg.textContent=(T.emailInvalide||'Merci de saisir une adresse e-mail valide.'); modal.querySelector('.gf-em').focus(); return; }
      var payload=buildPayload();
      payload.guest={firstName:fn,lastName:ln,email:em,phone:ph}; payload._hp=modal.querySelector('.gf-hp').value;
      var btn=modal.querySelector('.gf-submit'); btn.disabled=true; btn.textContent='Envoi…';
      api('/booking-requests', { method:'POST', headers:{'Content-Type':'application/json','X-WP-Nonce':CFG.nonce}, body:JSON.stringify(payload) })
        .then(function(res){
          if(res.status>=200&&res.status<300){ state.submitted=true; modal.querySelector('.gf-card').innerHTML='<button class="gf-x" type="button">&times;</button><h3>'+(T.merci||'Merci')+' '+fn+' !</h3><p>'+(T.demandeEnvoyee||'Votre demande de réservation a bien été envoyée. Nous revenons vers vous très vite pour confirmer votre séjour.')+'</p><div style="text-align:center;margin-top:18px"><button type="button" class="gf-ok">OK</button></div>';
            modal.querySelector('.gf-x').onclick=closeModal; modal.querySelector('.gf-ok').onclick=closeModal; }
          else { msg.style.color='#b00'; msg.textContent=(res.body&&res.body.error&&res.body.error.message)||(T.erreurGenerique||'Une erreur est survenue.'); btn.disabled=false; btn.textContent=(T.envoyer||'Envoyer la demande'); }
        });
    }
  });
})();
JS;
}
