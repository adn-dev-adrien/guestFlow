<?php
/**
 * Plugin Name: Domaine Solio — Footer styling
 * Description: Styles the "nuit étoilée" site footer: manifesto line, practical links, legal line, ADN Dev credit.
 */
if (!defined('ABSPATH')) { exit; }
add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.gf-footer{ text-align:center; padding:56px 24px 46px; background:var(--gf-nuit,#161C16); color:#D8D4C4; }
.gf-footer-logo{ width:54px; height:auto; display:inline-block; margin:0 auto 12px; }
.gf-footer-name{ font-family:'Marcellus',serif; font-weight:400; letter-spacing:.18em; text-transform:uppercase;
  color:#EFE8D6; font-size:1.15rem; margin-bottom:14px; }
.gf-footer-tag{ max-width:560px; margin:0 auto 22px; color:#B9B5A5; font-size:1.02rem; line-height:1.65; }
.gf-footer-manifesto{ font-family:'Marcellus',serif; color:#E8C286; font-size:1.05rem; letter-spacing:.04em;
  margin:0 auto 26px; }
.gf-footer-links{ display:flex; flex-wrap:wrap; justify-content:center; gap:8px 26px; margin:0 auto 26px; padding:0; list-style:none; }
.gf-footer-links a{ color:#D8D4C4; text-decoration:none; font-size:.8rem; font-weight:700;
  text-transform:uppercase; letter-spacing:.14em; }
.gf-footer-links a:hover{ color:#E8C286; }
.gf-footer-legal{ margin:0; color:#8B8878; font-size:.78rem; letter-spacing:.3px; }
.gf-credit{ margin:30px auto 0; max-width:560px;
  background:linear-gradient(90deg,transparent,#3A4236 35%,#3A4236 65%,transparent) no-repeat 0 15px / 100% 1px; }
.gf-credit-link{ display:inline-grid; grid-template-columns:auto auto; justify-content:center; align-items:baseline; gap:6px 7px;
  min-height:44px; color:#8B8878; text-decoration:none; font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.2em; }
.gf-credit-helix{ grid-column:1 / -1; grid-row:1; justify-self:center; width:34px; height:auto; box-sizing:content-box;
  padding:0 14px; background:var(--gf-nuit,#161C16); overflow:visible; }
.gf-credit-name{ color:#C9C4B2; transition:color .3s ease; }
.gf-credit-link:hover .gf-credit-name, .gf-credit-link:focus-visible .gf-credit-name{ color:#E8C286; }
.gf-credit-link:hover .gf-credit-helix, .gf-credit-link:focus-visible .gf-credit-helix{ animation:gf-credit-spin 1.4s cubic-bezier(.45,.05,.35,1); }
.gf-credit-link:focus-visible{ outline:1px dashed #E8C286; outline-offset:4px; }
@keyframes gf-credit-spin{ from{ transform:rotateY(0) } to{ transform:rotateY(360deg) } }
@media (prefers-reduced-motion:reduce){ .gf-credit-link .gf-credit-helix{ animation:none; } }
@media (max-width:640px){ body:has(.gf-resa-declencheur) .gf-footer{ padding-bottom:104px; } }
CSS;
    wp_register_style('gf-footer', false);
    wp_enqueue_style('gf-footer');
    wp_add_inline_style('gf-footer', $css);
});
