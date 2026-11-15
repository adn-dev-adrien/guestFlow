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
        add_shortcode('guestflow_gift_voucher', [$this, 'render_gift_voucher']);
        add_shortcode('guestflow_gift_voucher_button', [$this, 'render_gift_voucher_button']);
    }

    /** [guestflow_gift_voucher] — the purchase tunnel, the same block a page can hold (specs/gift-vouchers.md rule 12). */
    public function render_gift_voucher(): string
    {
        return render_block(['blockName' => 'guestflow/gift-voucher', 'attrs' => [], 'innerBlocks' => [], 'innerHTML' => '', 'innerContent' => []]);
    }

    /**
     * [guestflow_gift_voucher_button url="…" label="…"] — a link-button with a gift icon, to sit next to « Réserver ».
     * `url` is the page holding the tunnel; without it the page holding the block is used, and with neither
     * nothing is printed (a button to nowhere is worse than none).
     *
     * @param array|string $atts
     */
    public function render_gift_voucher_button($atts = []): string
    {
        $atts = shortcode_atts(['url' => '', 'label' => '', 'class' => ''], (array) $atts, 'guestflow_gift_voucher_button');
        $url = $atts['url'] !== '' ? $atts['url'] : GF_Settings::instance()->get_gift_voucher_page_url();
        if ($url === '') {
            return '';
        }
        $label = $atts['label'] !== '' ? $atts['label'] : __('Bon cadeau', 'guestflow-booking');
        wp_enqueue_style('guestflow-style');
        $icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
            . '<rect x="3.5" y="9" width="17" height="11.5" rx="1"/><path d="M2.5 9h19V6h-19zM12 6v14.5M12 6c-1.2-2.6-5-3-5-.6C7 6.6 9.6 6 12 6zm0 0c1.2-2.6 5-3 5-.6C17 6.6 14.4 6 12 6z"/></svg>';
        return '<a class="gf-gv-button' . ($atts['class'] !== '' ? ' ' . esc_attr($atts['class']) : '') . '" href="' . esc_url($url) . '">'
            . $icon . '<span>' . esc_html($label) . '</span></a>';
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

        // The terms open in the language of the page they are read on
        // (specs/site-english-version.md rule 25). The visitor's own click still wins afterwards and
        // is still remembered — this only decides which side is showing when the page loads, so an
        // English reader does not land on a French contract.
        $open = GF_Language::current();

        return '<div class="gf-cgv" data-open-lang="' . esc_attr($open) . '">'
            . '<div class="gf-cgv-entete"><div class="gf-cgv-switch">'
            // Text, not flags: Windows draws a flag emoji as two letters, and a flag names a country,
            // not a language (specs/wordpress-plugin.md rule 23).
            . '<button type="button" data-lang="fr" lang="fr" aria-label="Français">FR</button>'
            . '<button type="button" data-lang="en" lang="en" aria-label="English">EN</button>'
            . '</div></div>'
            . '<p class="gf-cgv-version">' . $notice . '</p>'
            . '<div class="gf-cgv-lang" data-lang="fr" data-visible="' . ($open === 'fr' ? '1' : '0') . '" lang="fr">' . $fr . '</div>'
            . '<div class="gf-cgv-lang" data-lang="en" data-visible="' . ($open === 'en' ? '1' : '0') . '" lang="en">' . $en . '</div>'
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
