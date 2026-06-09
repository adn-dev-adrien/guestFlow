<?php
/**
 * Uninstall cleanup — remove the plugin option and every cached transient.
 * Runs only on real uninstall (not deactivation).
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('guestflow_booking_settings');

// Remove all gf_cache_* transients (and their timeouts).
global $wpdb;
$like = $wpdb->esc_like('_transient_gf_cache_') . '%';
$like_to = $wpdb->esc_like('_transient_timeout_gf_cache_') . '%';
$wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $like, $like_to));
