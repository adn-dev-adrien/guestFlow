<?php
/**
 * Plugin Name: Domaine Solio — Global site styles
 * Description: Site-wide design system "forêt et heure dorée" (2026-09 redesign): self-hosted
 *              Marcellus (display) + Karla (body), sapin/lichen/ocre/paper palette, square ocre
 *              buttons, header/dropdown/carousel/FAQ styles & behaviour. Drop-in mu-plugin.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_enqueue_scripts', function () {
    // Fonts are self-hosted (no request to fonts.googleapis.com): woff2 files live in
    // uploads/fonts/, declared by solio-fonts.css (Marcellus 400, Karla variable + italic).
    wp_enqueue_style(
        'gf-fonts',
        '/wp-content/uploads/fonts/solio-fonts.css',
        [],
        '20260905'
    );
    $css = <<<'CSS'
:root{
  --gf-paper:#F5F0E6; --gf-card:#FDFAF3; --gf-ink:#22271F; --gf-ink-soft:#5C6153;
  --gf-sapin:#2E3B2A; --gf-green:#5a6b48; --gf-dark:#2E3B2A;
  --gf-ocre:#B87B2A; --gf-ocre-deep:#9A6318; --gf-nuit:#161C16; --gf-line:#DCD4C2;
}
body{ font-family:'Karla',Helvetica,Arial,sans-serif; color:var(--gf-ink); font-size:17px;
  line-height:1.65; background:var(--gf-paper); }
h1,h2,h3,h4,h5{ font-family:'Marcellus',Georgia,'Times New Roman',serif; color:var(--gf-dark);
  font-weight:400; line-height:1.18; text-wrap:balance; }
h1{ font-size:2.6rem; text-transform:uppercase; letter-spacing:.06em; }
h2{ font-size:2rem; text-transform:uppercase; letter-spacing:.05em; }
h3{ font-size:1.35rem; letter-spacing:.02em; }
@media (max-width:600px){ h1{ font-size:1.9rem; } h2{ font-size:1.5rem; } }
strong,b{ font-weight:700; }
.entry-content a, .wp-block-post-content a{ color:var(--gf-ocre-deep); }

/* Surtitre signature : petites capitales espacées en ocre au-dessus d'un titre. */
.gf-eyebrow{ font-family:'Karla',sans-serif; font-size:.78rem; font-weight:700;
  text-transform:uppercase; letter-spacing:.38em; color:var(--gf-ocre-deep); }

/* Boutons : ocre plein, capitales espacées, angles vifs. */
.wp-block-button__link{
  background-color:var(--gf-ocre); color:#fff; border-radius:2px;
  font-family:'Karla',sans-serif; font-size:.8rem; font-weight:700;
  text-transform:uppercase; letter-spacing:.22em; padding:15px 28px 14px;
  transition:background-color .25s ease;
}
.wp-block-button__link:hover{ background-color:var(--gf-ocre-deep); color:#fff; }
.is-style-outline .wp-block-button__link{
  background:transparent; color:var(--gf-sapin); border:1px solid var(--gf-sapin);
}
.is-style-outline .wp-block-button__link:hover{ background:var(--gf-sapin); color:var(--gf-paper); }

/* ---- Global header ---- */
.gf-header{ position:sticky; top:0; z-index:1000; display:flex; align-items:center; justify-content:space-between;
  padding:18px 28px; background:linear-gradient(180deg,rgba(14,18,14,.66),rgba(14,18,14,0)); }
.gf-header .gf-logo{ color:#fff; font-family:'Marcellus',serif; font-size:1.4rem; font-weight:400;
  text-transform:uppercase; letter-spacing:.14em; text-decoration:none; text-shadow:0 1px 4px rgba(0,0,0,.45); }
.gf-header .gf-nav{ display:flex; gap:26px; align-items:center; }
.gf-header .gf-nav > a, .gf-header .gf-dd-label{ color:#fff; text-decoration:none; font-weight:700;
  font-size:.8rem; text-transform:uppercase; letter-spacing:.14em; text-shadow:0 1px 3px rgba(0,0,0,.45); }
.gf-header .gf-nav > a:hover, .gf-header .gf-dd-label:hover{ color:#E8C286; }
.gf-header .gf-nav > a.gf-cta{ border:1px solid rgba(232,194,134,.85); padding:9px 16px 8px; border-radius:2px; color:#E8C286; }
.gf-header .gf-nav > a.gf-cta:hover{ background:var(--gf-ocre); border-color:var(--gf-ocre); color:#fff; }
/* dropdown (conservé pour transition et petites entrées éventuelles) */
.gf-header .gf-dropdown{ position:relative; }
.gf-header .gf-nav > a, .gf-header .gf-nav > .gf-dropdown{ display:flex; align-items:center; }
.gf-header .gf-dd-label{ cursor:pointer; display:block; }
.gf-header .gf-dd-menu{ display:none; position:absolute; top:100%; left:0; background:rgba(14,18,14,.97);
  min-width:240px; border-radius:2px; padding:6px 0; box-shadow:0 8px 24px rgba(0,0,0,.25); }
.gf-header .gf-dropdown:hover .gf-dd-menu{ display:block; }
.gf-header .gf-dd-menu a{ display:block; padding:11px 18px; color:#fff; text-decoration:none; font-weight:500; }
.gf-header .gf-dd-menu a:hover{ background:rgba(255,255,255,.08); }
.gf-header .gf-dd-right .gf-dd-menu{ left:auto; right:0; min-width:280px; }
.gf-header .gf-dd-menu a small{ display:block; color:#B9B5A5; font-weight:400; font-size:.72rem;
  letter-spacing:.02em; text-transform:none; margin-top:2px; }
.gf-header .gf-dropdown > .gf-dd-label.gf-cta{ border:1px solid rgba(232,194,134,.85); padding:9px 16px 8px;
  border-radius:2px; color:#E8C286; }
.gf-header .gf-dropdown:hover > .gf-dd-label.gf-cta{ background:var(--gf-ocre); border-color:var(--gf-ocre); color:#fff; }
.gf-header .gf-burger, .gf-header .gf-burger-cb{ display:none; }
@media (max-width:1080px){
  .gf-header{ padding:14px 18px; }
  .gf-header .gf-burger{ display:block; color:#fff; font-size:2rem; line-height:1; cursor:pointer; text-shadow:0 1px 3px rgba(0,0,0,.4); }
  .gf-header .gf-nav{ display:none; position:absolute; top:100%; left:0; right:0; flex-direction:column; gap:0;
    background:rgba(14,18,14,.97); padding:6px 0; }
  .gf-header .gf-nav > a{ padding:14px 22px; border-top:1px solid rgba(255,255,255,.08); font-size:.92rem; width:100%; box-sizing:border-box; }
  .gf-header .gf-nav > a.gf-cta{ border:none; border-top:1px solid rgba(255,255,255,.08); border-radius:0; padding:14px 22px; color:#E8C286; }
  .gf-header .gf-burger-cb:checked ~ .gf-nav{ display:flex; }
  .gf-header .gf-dropdown{ width:100%; }
  .gf-header .gf-dd-label{ display:block; padding:14px 22px; border-top:1px solid rgba(255,255,255,.08); }
  .gf-header .gf-dd-menu{ display:block; position:static; background:transparent; box-shadow:none; padding:0; min-width:0; }
  .gf-header .gf-dd-menu a{ padding:12px 38px; border-top:1px solid rgba(255,255,255,.06); font-size:.9rem; }
}

/* ---- Testimonials auto-carousel ---- */
.gf-carousel{ max-width:880px; margin:24px auto 0; overflow:hidden; }
.gf-carousel .gf-track{ display:flex; transition:transform .6s ease; }
.gf-carousel .gf-slide{ min-width:100%; box-sizing:border-box; padding:0 6px; }
.gf-carousel .gf-slide img{ width:100%; height:auto; border-radius:4px; display:block; }
.gf-carousel .gf-dots{ display:flex; justify-content:center; gap:8px; margin-top:14px; }
.gf-carousel .gf-dots button{ width:10px; height:10px; border-radius:50%; border:0; background:var(--gf-line); cursor:pointer; padding:0; }
.gf-carousel .gf-dots button.is-active{ background:var(--gf-ocre); }

/* ---- FAQ accordion (native <details>) ---- */
.gf-faq{ max-width:840px; margin:8px auto 0; }
.gf-faq details{ border:1px solid var(--gf-line); border-radius:4px; margin-bottom:10px; background:var(--gf-card); }
.gf-faq summary{ cursor:pointer; padding:15px 18px; font-weight:700; color:var(--gf-dark); list-style:none; position:relative; }
.gf-faq summary::-webkit-details-marker{ display:none; }
.gf-faq summary::after{ content:"+"; position:absolute; right:18px; font-size:1.3rem; line-height:1; color:var(--gf-ocre-deep); }
.gf-faq details[open] summary::after{ content:"\2212"; }
.gf-faq details[open] summary{ border-bottom:1px solid var(--gf-line); }
.gf-faq .gf-faq-a{ padding:14px 18px 16px; }
.gf-faq .gf-faq-a ul{ margin:.4em 0 0 1.1em; }

/* ---- Page sections (redesign 2026-09) ---- */
.gf-hero{ position:relative; min-height:86vh; display:flex; align-items:flex-end; overflow:hidden;
  margin-top:-86px; background:var(--gf-nuit); }
.gf-hero .gf-hero-media{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center 35%; }
/* La video du hero joue partout ; le poster tient l'ecran jusqu'a la premiere image.
   La source est choisie par le script du pied de page : 540p (~2 Mo) sous 601 px, 1080p au-dela. */
.gf-hero .gf-hero-video{ display:block; }
.gf-hero .gf-hero-img:has(~ .gf-hero-video){ display:none; }
.gf-hero::after{ content:""; position:absolute; inset:0;
  background:linear-gradient(to top, rgba(10,14,10,.74) 0%, rgba(10,14,10,.22) 45%, rgba(10,14,10,.12) 100%); }
.gf-hero-inner{ position:relative; z-index:2; width:100%; max-width:1140px; margin:0 auto; padding:0 26px 58px; color:#F7F2E6; }
.gf-hero-kicker{ font-size:.8rem; font-weight:700; letter-spacing:.42em; text-transform:uppercase; color:#E8C286; margin:0 0 14px; }
.gf-hero-inner h1{ color:#FBF7EC; font-size:clamp(2.4rem,6vw,4.4rem); letter-spacing:.08em; margin:0; text-shadow:0 2px 30px rgba(0,0,0,.45); }
.gf-hero-tagline{ font-family:'Marcellus',serif; font-size:clamp(1.05rem,2vw,1.35rem); max-width:34em; margin:14px 0 24px; color:#EFE8D6; text-shadow:0 1px 16px rgba(0,0,0,.5); }
.gf-hero-ctas{ display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
.gf-btn{ display:inline-flex; align-items:center; justify-content:center; background:var(--gf-ocre); color:#fff !important;
  font-family:'Karla',sans-serif; font-size:.8rem; font-weight:700; line-height:1; text-transform:uppercase;
  letter-spacing:.22em; padding:16px 28px; border-radius:2px; text-decoration:none; transition:background .25s ease; }
.gf-btn:hover{ background:var(--gf-ocre-deep); }
.gf-btn-ghost{ background:transparent; border:1px solid rgba(247,242,230,.7); }
.gf-btn-ghost:hover{ background:rgba(247,242,230,.14); }
.gf-btn-forest{ background:transparent; border:1px solid var(--gf-sapin); color:var(--gf-sapin) !important; }
.gf-btn-forest:hover{ background:var(--gf-sapin); color:var(--gf-paper) !important; }
.gf-section{ max-width:1140px; margin:0 auto; padding:64px 22px 10px; }
.gf-section-narrow{ max-width:820px; }
.gf-center{ text-align:center; }
.gf-lead{ font-size:1.14rem; line-height:1.7; }
.gf-proofs{ display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-top:36px; }
@media (max-width:1000px){ .gf-proofs{ grid-template-columns:1fr 1fr; } }
@media (max-width:560px){ .gf-proofs{ grid-template-columns:1fr; } }
.gf-proof{ margin:0; }
.gf-proof img{ width:100%; height:230px !important; object-fit:cover; border-radius:4px; display:block; }
.gf-proof h3{ font-size:1.08rem; margin:14px 0 4px; }
.gf-proof p{ font-size:.95rem; color:var(--gf-ink-soft); margin:0; }
.gf-doors{ display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:36px; }
@media (max-width:760px){ .gf-doors{ grid-template-columns:1fr; } }
.gf-door{ background:var(--gf-card); border:1px solid var(--gf-line); border-radius:4px; overflow:hidden;
  display:flex; flex-direction:column; }
.gf-door img{ width:100%; height:320px !important; object-fit:cover; display:block; }
.gf-door-in{ padding:24px 26px 28px; display:flex; flex-direction:column; gap:10px; align-items:flex-start; flex:1; }
.gf-door-sub{ color:var(--gf-ocre-deep); font-size:.74rem; font-weight:700; text-transform:uppercase; letter-spacing:.2em; margin:0; }
.gf-door h3{ margin:0; font-size:1.5rem; text-transform:uppercase; letter-spacing:.05em; }
.gf-door p{ margin:0 0 6px; flex:1; }
.gf-band{ background:transparent; color:var(--gf-ink); text-align:center; padding:64px 22px 26px; margin-top:20px; }
.gf-band-quote{ font-family:'Marcellus',serif; font-size:clamp(1.2rem,2.6vw,1.65rem); color:var(--gf-ocre-deep); max-width:26em; margin:0 auto 20px; }
.gf-stars{ letter-spacing:.35em; margin:0 0 6px; color:var(--gf-ocre); }
.gf-band a.gf-band-link{ color:var(--gf-ink-soft); }
.gf-band .gf-btn{ margin-top:24px; }

/* Le diaporama MetaSlider laissait un grand vide avant la section suivante. */
.wp-block-post-content .metaslider{ margin-bottom:0 !important; }
/* Diapos aux formats d'origine (recadrage desactive) : on plafonne juste la hauteur,
   l'image reste entiere et centree — jamais etiree, jamais rognee. */
.metaslider .flexslider .slides li img{ max-height:620px; width:auto !important; max-width:100%;
  margin:0 auto; display:block; }
.metaslider .flexslider{ background:transparent; }
/* Pas de points de navigation sous les diaporamas : les fleches suffisent. */
.metaslider .flex-control-nav{ display:none !important; }

/* ---- Bande immersive ciel etoile ---- */
.gf-band-ciel{ position:relative; min-height:56vh; overflow:hidden; background:#060806; margin:56px 0 0; }
.gf-band-ciel img{ position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.gf-band-ciel .gf-band-ciel-txt{ position:relative; z-index:2; display:flex; align-items:flex-end; justify-content:center;
  min-height:56vh; padding:0 22px 46px; text-align:center; }
.gf-band-ciel .gf-band-ciel-txt p{ font-family:'Marcellus',serif; color:#EFE8D6; font-size:clamp(1.15rem,2.4vw,1.6rem);
  letter-spacing:.04em; max-width:26em; margin:0; text-shadow:0 1px 18px rgba(0,0,0,.8); }

/* ---- Selecteur de langue des CGV (drapeaux, en haut a droite) ---- */
.gf-cgv-entete{ display:flex; align-items:center; justify-content:flex-end; margin-bottom:8px; }
.gf-cgv-switch{ display:flex; gap:8px; }
.gf-cgv-switch button{ font-size:22px; line-height:1; padding:8px 12px; border:1px solid var(--gf-line);
  border-radius:4px; background:var(--gf-card); cursor:pointer; opacity:.45; transition:opacity .2s, border-color .2s; }
.gf-cgv-switch button.is-active{ opacity:1; border-color:var(--gf-ocre); box-shadow:0 0 0 1px var(--gf-ocre); }
.gf-cgv-lang[data-visible="0"]{ display:none; }

/* ---- Split media/text rows ---- */
.gf-split{ display:grid; grid-template-columns:1fr 1fr; gap:36px; align-items:center; margin:46px 0; }
.gf-split img{ width:100%; height:340px !important; object-fit:cover; border-radius:4px; display:block; }
.gf-split h2{ margin-top:0; }
.gf-split .gf-split-media{ margin:0; }
.gf-split.gf-rev .gf-split-media{ order:2; }
@media (max-width:760px){ .gf-split{ grid-template-columns:1fr; gap:18px; } .gf-split.gf-rev .gf-split-media{ order:0; } .gf-split img{ height:230px !important; } }

/* ---- Text tile cards ---- */
.gf-tiles{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:34px; }
@media (max-width:900px){ .gf-tiles{ grid-template-columns:1fr 1fr; } }
@media (max-width:560px){ .gf-tiles{ grid-template-columns:1fr; } }
.gf-tile{ background:var(--gf-card); border:1px solid var(--gf-line); border-radius:4px; padding:20px 22px; }
.gf-tile.gf-tile-photo{ padding:0; overflow:hidden; display:flex; flex-direction:column; }
.gf-tile-photo > a > img{ width:100%; height:170px; object-fit:cover; display:block; }
.gf-tile-photo .gf-tile-in{ padding:16px 20px 20px; }
.gf-tile h3 a{ color:inherit; text-decoration:none; }
.gf-tile h3 a:hover{ color:var(--gf-ocre-deep); }
.gf-tile .gf-tile-cat{ color:var(--gf-ocre-deep); font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.2em; margin:0 0 8px; }
.gf-tile h3{ font-size:1.1rem; margin:0 0 6px; }
.gf-tile p{ font-size:.95rem; color:var(--gf-ink-soft); margin:0; }
CSS;

    wp_add_inline_style('gf-fonts', $css);
});

/* Testimonials carousel behaviour. No-ops on pages without the track. */
add_action('wp_footer', function () {
    ?>
<script>
(function(){
  // Selecteur de langue des CGV : un drapeau, une langue, jamais les deux melangees.
  var blocs = document.querySelectorAll('.gf-cgv-lang');
  if (blocs.length) {
    var boutons = document.querySelectorAll('.gf-cgv-switch button');
    var montrer = function (lang) {
      blocs.forEach(function(b){ b.dataset.visible = (b.dataset.lang === lang) ? '1' : '0'; });
      boutons.forEach(function(b){ b.classList.toggle('is-active', b.dataset.lang === lang); });
      try { localStorage.setItem('gf-cgv-lang', lang); } catch (e) {}
    };
    boutons.forEach(function(b){ b.addEventListener('click', function(){ montrer(b.dataset.lang); }); });
    var memo = 'fr';
    try { memo = localStorage.getItem('gf-cgv-lang') || 'fr'; } catch (e) {}
    montrer(memo === 'en' ? 'en' : 'fr');
  }
})();
(function(){
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.gf-hero-video[data-src-desktop]').forEach(function(v){
    if (reduced) { v.removeAttribute('autoplay'); return; }
    var small = window.matchMedia('(max-width: 600px)').matches;
    var src = small ? (v.dataset.srcMobile || v.dataset.srcDesktop) : v.dataset.srcDesktop;
    var source = document.createElement('source');
    source.src = src; source.type = 'video/mp4';
    v.appendChild(source); v.load();
    var p = v.play(); if (p && p.catch) { p.catch(function(){}); }
  });
  if (reduced) {
    document.querySelectorAll('.gf-hero-video').forEach(function(v){ v.removeAttribute('autoplay'); v.pause(); });
  }
})();
(function(){
  var track=document.getElementById('gf-testi-track'); if(!track) return;
  var dotsWrap=document.getElementById('gf-testi-dots');
  var n=track.children.length, i=0, timer=null;
  if (dotsWrap){ for (var d=0; d<n; d++){ (function(idx){ var b=document.createElement('button');
    b.addEventListener('click',function(){ go(idx); restart(); }); dotsWrap.appendChild(b); })(d); } }
  function render(){ track.style.transform='translateX(-'+(i*100)+'%)';
    if(dotsWrap){ var ds=dotsWrap.children; for(var k=0;k<ds.length;k++){ ds[k].className=(k===i?'is-active':''); } } }
  function go(x){ i=((x%n)+n)%n; render(); }
  function restart(){ clearInterval(timer); timer=setInterval(function(){ go(i+1); },4500); }
  render(); restart();
})();
</script>
    <?php
});
