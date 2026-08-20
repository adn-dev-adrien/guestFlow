<?php
/**
 * Native WordPress updates for the GuestFlow Booking plugin
 * (specs/wordpress-plugin-self-update.md).
 *
 * The plugin asks its own GuestFlow instance which build is the newest, through the public API it
 * already talks to, and hands WordPress the GitHub release asset. From there the stock updater does
 * the work: the badge in Extensions, the details modal, the update button.
 *
 * Two rules this class never bends:
 *   - the download URL must be a GitHub release asset over HTTPS; anything else and no update is
 *     offered at all (a manifest must not be able to make WordPress install an arbitrary archive);
 *   - a GuestFlow that is unreachable, unconfigured or out of date reports "no update" and stays
 *     silent — a booking API being down must never break the site's admin.
 */

if (!defined('ABSPATH')) {
    exit;
}

class GF_Updater
{
    private const TRANSIENT = 'gf_booking_update_manifest';
    private const TTL = 12 * HOUR_IN_SECONDS;
    private const SLUG = 'guestflow-booking';

    private static ?GF_Updater $instance = null;

    public static function instance(): GF_Updater
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function register(): void
    {
        add_filter('pre_set_site_transient_update_plugins', [$this, 'inject_update']);
        add_filter('plugins_api', [$this, 'plugin_information'], 10, 3);
        add_action('upgrader_process_complete', [$this, 'flush_cache'], 10, 0);
    }

    /** `guestflow-booking/guestflow-booking.php` — the key WordPress indexes plugins by. */
    private function basename(): string
    {
        return plugin_basename(GF_BOOKING_FILE);
    }

    /**
     * Only a GitHub release asset, only over HTTPS. Anything else is treated as no manifest at all.
     */
    private function is_allowed_package(string $url): bool
    {
        $parts = wp_parse_url($url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https') {
            return false;
        }
        $allowed = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
        return in_array(strtolower($parts['host'] ?? ''), $allowed, true);
    }

    /**
     * The manifest, cached for 12 h. Returns null when GuestFlow is unreachable, unconfigured, has
     * nothing published, or answers something unusable.
     */
    private function manifest(): ?array
    {
        $cached = get_transient(self::TRANSIENT);
        if (is_array($cached)) {
            return $cached;
        }
        if ($cached === 'none') {
            return null;
        }

        $response = GF_Api_Client::instance()->get('/plugin-update');
        $body = is_array($response['body'] ?? null) ? $response['body'] : [];

        $version = isset($body['version']) ? (string) $body['version'] : '';
        $package = isset($body['download_url']) ? (string) $body['download_url'] : '';

        if ((int) ($response['status'] ?? 0) !== 200
            || $version === ''
            || !preg_match('/^\d+\.\d+\.\d+$/', $version)
            || !$this->is_allowed_package($package)) {
            // Remember the miss for a short while so a broken or old GuestFlow is not polled on
            // every admin page load.
            set_transient(self::TRANSIENT, 'none', HOUR_IN_SECONDS);
            return null;
        }

        $manifest = [
            'version'      => $version,
            'package'      => $package,
            'requires'     => (string) ($body['requires'] ?? ''),
            'requires_php' => (string) ($body['requires_php'] ?? ''),
            'tested'       => (string) ($body['tested'] ?? ''),
            'last_updated' => (string) ($body['last_updated'] ?? ''),
            'changelog'    => (string) ($body['sections']['changelog'] ?? ''),
        ];
        set_transient(self::TRANSIENT, $manifest, self::TTL);
        return $manifest;
    }

    /**
     * Tell WordPress an update exists. Called on every update check, so it must be cheap and it
     * must never throw.
     */
    public function inject_update($transient)
    {
        if (!is_object($transient)) {
            return $transient;
        }
        $manifest = $this->manifest();
        if ($manifest === null || version_compare($manifest['version'], GF_BOOKING_VERSION, '<=')) {
            return $transient;
        }

        $update = (object) [
            'id'           => self::SLUG,
            'slug'         => self::SLUG,
            'plugin'       => $this->basename(),
            'new_version'  => $manifest['version'],
            'package'      => $manifest['package'],
            'url'          => 'https://github.com/adn-dev-adrien/guestFlow',
            'requires'     => $manifest['requires'],
            'requires_php' => $manifest['requires_php'],
            'tested'       => $manifest['tested'],
        ];

        if (!isset($transient->response) || !is_array($transient->response)) {
            $transient->response = [];
        }
        $transient->response[$this->basename()] = $update;
        return $transient;
    }

    /** Fill the "Voir les détails" modal with the release notes. */
    public function plugin_information($result, $action, $args)
    {
        if ($action !== 'plugin_information' || (($args->slug ?? '') !== self::SLUG)) {
            return $result;
        }
        $manifest = $this->manifest();
        if ($manifest === null) {
            return $result;
        }

        return (object) [
            'name'          => 'GuestFlow Booking',
            'slug'          => self::SLUG,
            'version'       => $manifest['version'],
            'author'        => 'Adrien',
            'homepage'      => 'https://github.com/adn-dev-adrien/guestFlow',
            'requires'      => $manifest['requires'],
            'requires_php'  => $manifest['requires_php'],
            'tested'        => $manifest['tested'],
            'last_updated'  => $manifest['last_updated'],
            'download_link' => $manifest['package'],
            'sections'      => [
                'description' => __('Disponibilités, devis et demandes de réservation depuis GuestFlow.', 'guestflow-booking'),
                'changelog'   => $manifest['changelog'],
            ],
        ];
    }

    /** After any install/update, forget the cached manifest so the next check is honest. */
    public function flush_cache(): void
    {
        delete_transient(self::TRANSIENT);
    }
}
