<?php
/**
 * Plugin Name: Domaine Solio — GuestFlow blocks brand accent
 * Description: Points the GuestFlow Booking blocks' accent variable at the site's brand green so the
 *              widget (calendar selection, steppers, buttons) matches the Domaine Solio palette.
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_enqueue_scripts', function () {
    wp_register_style('gf-brand', false);
    wp_enqueue_style('gf-brand');
    wp_add_inline_style('gf-brand', '.gf-block{--gf-accent:#B87B2A;}');
}, 99);
