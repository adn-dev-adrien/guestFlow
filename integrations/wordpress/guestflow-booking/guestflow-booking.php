<?php
/**
 * Plugin Name:       GuestFlow Booking
 * Plugin URI:        https://github.com/adn-dev-adrien/guestFlow
 * Description:       Affiche les disponibilités, calcule des devis et envoie des demandes de réservation vers GuestFlow via son API publique. Le site ne parle qu'au proxy PHP du plugin ; la clé d'API reste côté serveur.
 * Version:           1.3.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            Adrien
 * Text Domain:       guestflow-booking
 * Domain Path:       /languages
 *
 * GuestFlow Booking is a thin proxy + renderer. All business logic (pricing,
 * availability, validation) lives in GuestFlow's backend; this plugin only relays
 * ready-to-render payloads and renders Gutenberg blocks. The GuestFlow API key is
 * read server-side only (wp-config constant or masked option) and is NEVER exposed
 * to the browser. See specs/wordpress-plugin.md + specs/public-api.md in the repo.
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

define('GF_BOOKING_VERSION', '1.3.0');
define('GF_BOOKING_FILE', __FILE__);
define('GF_BOOKING_DIR', plugin_dir_path(__FILE__));
define('GF_BOOKING_URL', plugin_dir_url(__FILE__));
define('GF_BOOKING_OPTION', 'guestflow_booking_settings');

require_once GF_BOOKING_DIR . 'includes/class-gf-cache.php';
require_once GF_BOOKING_DIR . 'includes/class-gf-settings.php';
require_once GF_BOOKING_DIR . 'includes/class-gf-api-client.php';
require_once GF_BOOKING_DIR . 'includes/class-gf-rest-proxy.php';
require_once GF_BOOKING_DIR . 'includes/class-gf-blocks.php';
require_once GF_BOOKING_DIR . 'includes/class-gf-plugin.php';

add_action('plugins_loaded', static function () {
    load_plugin_textdomain('guestflow-booking', false, dirname(plugin_basename(__FILE__)) . '/languages');
    GF_Plugin::instance();
});
