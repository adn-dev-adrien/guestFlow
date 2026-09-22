<?php
/**
 * [guestflow_cgv] — the CGV published in GuestFlow (specs/terms-acceptance-record.md §3.2 rule 8).
 *
 * Renders the current version, or version N when the URL carries ?v=N (the link of the booking
 * checkbox and of the confirmation email), in the FR/EN markup the site's language switch expects
 * (.gf-cgv-entete / .gf-cgv-switch / .gf-cgv-lang). The HTML is produced and frozen by GuestFlow;
 * it still goes through wp_kses_post on the way out.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Shortcodes
{
    private const CURRENT_TTL = 60;

    private static ?GF_Shortcodes $instance = null;

    public static function instance(): GF_Shortcodes
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot(): void
    {
        add_shortcode('guestflow_cgv', [$this, 'render_cgv']);
    }

    public function render_cgv(): string
    {
        $current = $this->fetch('/terms', self::CURRENT_TTL);
        if ($current === null) {
            return '<p class="gf-cgv-indisponible">' . esc_html__('Les conditions générales sont momentanément indisponibles.', 'guestflow-booking') . '</p>';
        }

        $asked = isset($_GET['v']) ? absint(wp_unslash($_GET['v'])) : 0;
        $shown = $current;
        $notice = '';
        if ($asked > 0 && $asked !== (int) $current['version']) {
            $older = $this->fetch("/terms/{$asked}", (int) GF_Settings::instance()->get('cache_ttl', 600));
            if ($older !== null) {
                $shown = $older;
                $notice = sprintf(
                    /* translators: 1: version shown, 2: its date, 3: current version */
                    __('Version %1$d du %2$s — la version en vigueur est la %3$d.', 'guestflow-booking'),
                    (int) $older['version'],
                    $this->date_label($older['publishedAt']),
                    (int) $current['version']
                );
                $notice = esc_html($notice) . ' <a href="' . esc_url(remove_query_arg('v')) . '">'
                    . esc_html__('Lire la version en vigueur', 'guestflow-booking') . '</a>';
            } else {
                $notice = esc_html__('Version introuvable : voici la version en vigueur.', 'guestflow-booking');
            }
        }
        if ($notice === '') {
            $notice = esc_html(sprintf(
                /* translators: 1: version, 2: date */
                __('Version %1$d, en vigueur depuis le %2$s.', 'guestflow-booking'),
                (int) $shown['version'],
                $this->date_label($shown['publishedAt'])
            ));
        }

        $fr = wp_kses_post((string) ($shown['html']['fr'] ?? ''));
        $en = wp_kses_post((string) ($shown['html']['en'] ?? ''));

        return '<div class="gf-cgv">'
            . '<div class="gf-cgv-entete"><div class="gf-cgv-switch">'
            . '<button type="button" data-lang="fr" aria-label="Français">🇫🇷</button>'
            . '<button type="button" data-lang="en" aria-label="English">🇬🇧</button>'
            . '</div></div>'
            . '<p class="gf-cgv-version">' . $notice . '</p>'
            . '<div class="gf-cgv-lang" data-lang="fr" data-visible="1" lang="fr">' . $fr . '</div>'
            . '<div class="gf-cgv-lang" data-lang="en" data-visible="0" lang="en">' . $en . '</div>'
            . '</div>';
    }

    /** `data` of a successful public call, cached; null when GuestFlow has nothing to show. */
    private function fetch(string $path, int $ttl): ?array
    {
        $key = GF_Cache::key($path);
        $cached = GF_Cache::get($key);
        if ($cached === false) {
            $res = GF_Api_Client::instance()->get($path);
            if ($res['status'] >= 200 && $res['status'] < 300) {
                $cached = $res['body'];
                GF_Cache::set($key, $cached, $ttl);
            } else {
                $cached = GF_Cache::get_stale($key);
            }
        }
        return (is_array($cached) && isset($cached['data']) && is_array($cached['data'])) ? $cached['data'] : null;
    }

    private function date_label(string $iso): string
    {
        $ts = strtotime($iso);
        return $ts ? wp_date('d/m/Y', $ts) : '';
    }
}
