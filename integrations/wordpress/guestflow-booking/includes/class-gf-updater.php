<?php
/**
 * Native WordPress updates for the GuestFlow Booking plugin
 * (specs/wordpress-plugin-self-update.md).
 *
 * The plugin asks its own GuestFlow instance which build is the newest, through the public API it
 * already talks to, and hands WordPress the GitHub release asset. From there the stock updater does
 * the work: the badge in Extensions, the details modal, the update button.
 *
 * Three rules this class never bends:
 *   - the download URL must be a GitHub release asset over HTTPS; anything else and no update is
 *     offered at all (a manifest must not be able to make WordPress install an arbitrary archive);
 *   - the archive installed is the one the release published: its file name carries the manifest's
 *     version, that version is newer than the installed one, and its SHA-256 matches the release's
 *     `SHA256SUMS` — checked before WordPress unpacks anything (rules 9-10);
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
        add_filter('upgrader_pre_download', [$this, 'verified_download'], 10, 3);
    }

    /** `guestflow-booking/guestflow-booking.php` — the key WordPress indexes plugins by. */
    private function basename(): string
    {
        return plugin_basename(GF_BOOKING_FILE);
    }

    /** Where GuestFlow's release workflow publishes the plugin archive (`browser_download_url`). */
    private const PACKAGE_PREFIX = '/adn-dev-adrien/guestFlow/releases/download/';

    /**
     * Only an asset of a GuestFlow release on github.com, only over HTTPS. Anything else — another
     * repository, a raw CDN host that names no repository — is treated as no manifest at all.
     */
    private function is_allowed_package(string $url): bool
    {
        $parts = wp_parse_url($url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https') {
            return false;
        }
        if (strtolower($parts['host'] ?? '') !== 'github.com' || isset($parts['port']) || isset($parts['user'])) {
            return false;
        }
        $path = (string) ($parts['path'] ?? '');
        return preg_match('#^' . preg_quote(self::PACKAGE_PREFIX, '#') . 'v\d+\.\d+\.\d+[^/]*/guestflow-booking-\d+\.\d+\.\d+\.zip$#', $path) === 1;
    }

    /** `1.17.1` out of `…/guestflow-booking-1.17.1.zip`, or '' for any other URL. */
    private function package_version(string $url): string
    {
        $path = (string) (wp_parse_url($url, PHP_URL_PATH) ?? '');
        return preg_match('#/guestflow-booking-(\d+\.\d+\.\d+)\.zip$#', $path, $m) === 1 ? $m[1] : '';
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
            || !$this->is_allowed_package($package)
            || $this->package_version($package) !== $version) {
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
            'author'        => 'GuestFlow',
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

    /**
     * `upgrader_pre_download`: for a GuestFlow Booking archive only, download it ourselves and hand
     * WordPress the file once it is proven to be the published one — a newer version than the
     * installed one, listed with this exact SHA-256 in the `SHA256SUMS` of the same release. Anything
     * else is a WP_Error and WordPress installs nothing. Other packages pass through untouched.
     */
    public function verified_download($reply, $package, $upgrader = null)
    {
        if ($reply !== false || !is_string($package) || !$this->is_allowed_package($package)) {
            return $reply;
        }
        $version = $this->package_version($package);
        if ($version === '' || version_compare($version, GF_BOOKING_VERSION, '<=')) {
            return new WP_Error('gf_package_version', __('Mise à jour refusée : cette archive n’est pas plus récente que la version installée.', 'guestflow-booking'));
        }

        $sums = wp_safe_remote_get(substr($package, 0, strrpos($package, '/')) . '/SHA256SUMS', ['timeout' => 30]);
        $expected = is_wp_error($sums) || (int) wp_remote_retrieve_response_code($sums) !== 200
            ? ''
            : $this->checksum_for((string) wp_remote_retrieve_body($sums), basename((string) wp_parse_url($package, PHP_URL_PATH)));
        if ($expected === '') {
            return new WP_Error('gf_package_checksum', __('Mise à jour refusée : l’empreinte de l’archive est introuvable dans la version publiée.', 'guestflow-booking'));
        }

        if (!function_exists('download_url')) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
        }
        $file = download_url($package, 300);
        if (is_wp_error($file)) {
            return $file;
        }
        $actual = hash_file('sha256', $file);
        if (!is_string($actual) || !hash_equals($expected, strtolower($actual))) {
            wp_delete_file($file);
            return new WP_Error('gf_package_checksum', __('Mise à jour refusée : l’archive téléchargée ne correspond pas à la version publiée.', 'guestflow-booking'));
        }
        return $file;
    }

    /** The SHA-256 a `sha256sum` listing gives a file name, lower-case, or ''. */
    private function checksum_for(string $listing, string $name): string
    {
        foreach (preg_split('/\r?\n/', $listing) as $line) {
            if (preg_match('/^([0-9a-fA-F]{64})\s+\*?(\S+)$/', trim($line), $m) === 1 && $m[2] === $name) {
                return strtolower($m[1]);
            }
        }
        return '';
    }

    /** After any install/update, forget the cached manifest so the next check is honest. */
    public function flush_cache(): void
    {
        delete_transient(self::TRANSIENT);
    }
}
