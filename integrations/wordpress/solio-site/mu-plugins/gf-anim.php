<?php
/**
 * Plugin Name: Domaine Solio — Uniform animation card photos
 * Description: Forces every photo in the "Nos animations à réserver" cards (.gf-anim columns,
 *              page Expériences & Options) to the same display size: full card width, fixed
 *              height, centered crop. Overrides the per-image inline width/aspect-ratio.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_enqueue_scripts', function () {
    $css = <<<CSS
.gf-anim .wp-block-image{ width:100% !important; margin:0 0 8px !important; }
.gf-anim .wp-block-image img{
  width:100% !important;
  height:230px !important;
  aspect-ratio:auto !important;
  object-fit:cover !important;
  border-radius:14px 14px 0 0 !important;
  display:block;
}
@media (max-width:600px){
  .gf-anim .wp-block-image img{ height:190px !important; }
}

/* Equal-height cards with the price pinned to the bottom (aligned across a row) */
.gf-anim .wp-block-column{ display:flex; flex-direction:column; }
.gf-anim .wp-block-column > .wp-block-group{ flex:1; display:flex; flex-direction:column; }
.gf-anim .wp-block-column > .wp-block-group > :last-child{ margin-top:auto; padding-top:8px; }
CSS;
    wp_register_style('gf-anim', false);
    wp_enqueue_style('gf-anim');
    wp_add_inline_style('gf-anim', $css);
});
