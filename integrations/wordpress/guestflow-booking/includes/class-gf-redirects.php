<?php
/**
 * The two permanent links printed on the gift voucher cards (specs/gift-voucher-campaigns.md rule 9):
 *
 *   /<base>/offrir/<slug>   → the purchase page of the campaign, as GuestFlow says it today
 *   /<base>/utiliser        → the page holding « Réserver une séance » (or its alias « Utiliser un bon cadeau »), where the fragment `#bon=<code>` fills the code field
 *
 * Both are redirections, so a page moved on the site never breaks a printed card. `<base>` is the connector's
 * setting (default `bon-cadeau`). With the plugin off in GuestFlow, or GuestFlow unreachable, `offrir` leads to the
 * home page; a campaign GuestFlow does not know (unknown, one-shot, closed) leads to the purchase page itself;
 * `utiliser` leads to the session page whatever the vouchers do, since that page also sells sessions on its own.
 * The fragment of the address — `#bon=<code>` of a QR code — is never read here: a browser keeps it across the 302.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Redirects
{
    private const QUERY_KIND = 'gf_gv_link';
    private const QUERY_SLUG = 'gf_gv_slug';
    // The base the rewrite rules were last flushed for: a change of the setting flushes once, on the next request.
    private const FLUSHED_OPTION = 'guestflow_booking_rewrite_base';
    private const TARGET_TTL = 60;

    private static ?GF_Redirects $instance = null;

    public static function instance(): GF_Redirects
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot(): void
    {
        add_action('init', [$this, 'sync_rules']);
        add_filter('query_vars', [$this, 'query_vars']);
        add_action('template_redirect', [$this, 'redirect'], 1);
    }

    /** The two rules for `$base`. */
    public static function add_rules(string $base): void
    {
        $quoted = preg_quote($base, '/');
        add_rewrite_rule('^' . $quoted . '/offrir/([a-z0-9]+(?:-[a-z0-9]+)*)/?$', 'index.php?' . self::QUERY_KIND . '=offrir&' . self::QUERY_SLUG . '=$matches[1]', 'top');
        add_rewrite_rule('^' . $quoted . '/utiliser/?$', 'index.php?' . self::QUERY_KIND . '=utiliser', 'top');
    }

    /** Registers the rules on every request, and flushes the stored ones when the base changed. */
    public function sync_rules(): void
    {
        $base = GF_Settings::instance()->get_gift_voucher_link_base();
        self::add_rules($base);
        if (get_option(self::FLUSHED_OPTION) !== $base) {
            flush_rewrite_rules(false);
            update_option(self::FLUSHED_OPTION, $base, false);
        }
    }

    /** Plugin activation: the rules exist from the first request after it. */
    public static function activate(): void
    {
        $base = GF_Settings::instance()->get_gift_voucher_link_base();
        self::add_rules($base);
        flush_rewrite_rules(false);
        update_option(self::FLUSHED_OPTION, $base, false);
    }

    public static function deactivate(): void
    {
        flush_rewrite_rules(false);
        delete_option(self::FLUSHED_OPTION);
    }

    public function query_vars(array $vars): array
    {
        $vars[] = self::QUERY_KIND;
        $vars[] = self::QUERY_SLUG;
        return $vars;
    }

    public function redirect(): void
    {
        $kind = (string) get_query_var(self::QUERY_KIND);
        if ($kind !== 'offrir' && $kind !== 'utiliser') {
            return;
        }
        $target = $kind === 'offrir'
            ? $this->offer_target((string) get_query_var(self::QUERY_SLUG))
            : $this->use_target();
        nocache_headers();
        wp_redirect($target, 302, 'GuestFlow Booking'); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- the target is validated against this site
        exit;
    }

    /** Where `/offrir/<slug>` leads right now. */
    private function offer_target(string $slug): string
    {
        $home = home_url('/');
        $settings = GF_Settings::instance();
        if (!$settings->is_configured() || $slug === '') {
            return $home;
        }
        $purchase = $settings->get_gift_voucher_page_url();
        $path = '/gift-vouchers/links/' . rawurlencode($slug);
        $key = GF_Cache::key($path);
        $answer = GF_Cache::get($key);
        if ($answer === false) {
            $res = GF_Api_Client::instance()->get($path);
            $status = (int) $res['status'];
            if ($status >= 200 && $status < 300) {
                $answer = $res['body'];
                GF_Cache::set($key, $answer, self::TARGET_TTL);
            } elseif (GF_Settings::vouchers_off($res)) {
                return $home;
            } elseif ($status === 404) {
                // A campaign GuestFlow does not offer (unknown, one-shot, closed): the purchase page lists what is on sale.
                return $purchase !== '' ? $purchase : $home;
            } else {
                $answer = GF_Cache::get_stale($key);
                if ($answer === false) {
                    return $home;
                }
            }
        }
        $target = is_array($answer) && isset($answer['data']['target']) && is_string($answer['data']['target']) ? $answer['data']['target'] : '';
        $safe = $target !== '' ? wp_validate_redirect(esc_url_raw($target), '') : '';
        if ($safe !== '') {
            return $safe;
        }
        return $purchase !== '' ? $purchase : $home;
    }

    /** Where `/utiliser` leads: the page holding the session tunnel (specs/site-outside-resource-booking.md rule 18), the home page when the connector is not set up or no page holds it. */
    private function use_target(): string
    {
        $settings = GF_Settings::instance();
        if (!$settings->is_configured()) {
            return home_url('/');
        }
        $page = $settings->get_gift_voucher_use_page_url();
        return $page !== '' ? $page : home_url('/');
    }
}
