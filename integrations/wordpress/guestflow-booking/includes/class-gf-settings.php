<?php
/**
 * Settings (Réglages → GuestFlow) + option storage. Holds the GuestFlow API base URL, the API key
 * (masked; a wp-config constant takes precedence), cache TTLs, the default property, and the booking
 * page URL. The API key is read ONLY here / by the API client — never enqueued to the browser.
 *
 * Q1: if GUESTFLOW_API_KEY is defined in wp-config.php it wins and the option field is disabled.
 *
 * Everything but the URL and the key is derived (specs/wordpress-plugin.md rule 14): the property is
 * chosen by name from GuestFlow's list, the two pages are found by their content (or created), and a
 * reverse proxy on the local network is trusted without being listed.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Settings
{
    private static ?GF_Settings $instance = null;

    public static function instance(): GF_Settings
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /** The block and the shortcode each page is recognised by (rule 14). */
    private const PAGE_MARKERS = [
        'booking' => '<!-- wp:guestflow/booking',
        'cgv'     => '[guestflow_cgv]',
    ];
    private const DETECTED_TRANSIENT = 'gf_detected_pages';
    private const CREATE = '__create__';

    public function boot(): void
    {
        add_action('admin_menu', [$this, 'add_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_ajax_gf_test_connection', [$this, 'ajax_test_connection']);
        // A page saved, trashed or deleted may be the one holding the block or the shortcode.
        add_action('save_post_page', [$this, 'forget_detected_pages']);
        add_action('deleted_post', [$this, 'forget_detected_pages']);
    }

    public function defaults(): array
    {
        return [
            'api_base_url'           => '',
            'api_key'                => '',
            'ssl_verify'             => 1,
            'cache_ttl'              => 600,
            'availability_cache_ttl' => 300,
            'default_property_id'    => 0,
            'booking_page_url'       => '',
            'cgv_page_url'           => '',
            'trusted_proxies'        => '',
            'trust_local_proxies'    => 1,
        ];
    }

    public function all(): array
    {
        $stored = get_option(GF_BOOKING_OPTION, []);
        return wp_parse_args(is_array($stored) ? $stored : [], $this->defaults());
    }

    public function get(string $key, $fallback = null)
    {
        $all = $this->all();
        return array_key_exists($key, $all) ? $all[$key] : $fallback;
    }

    /**
     * Page showing [guestflow_cgv]; the booking checkbox links to it (default: /cgv/), in the
     * language this request is served in.
     *
     * The setting holds one URL, and that URL names one page in one language. Left as it is, an
     * English visitor was asked to accept terms written in French — the acceptance is recorded with
     * a version number, so it has to be the text they could actually read
     * (specs/site-english-version.md rule 48).
     */
    public function get_cgv_page_url(): string
    {
        $url = trim((string) $this->get('cgv_page_url', ''));
        if ($url === '') {
            $detected = $this->detected_page('cgv');
            $url = $detected ? (string) get_permalink($detected) : home_url('/cgv/');
        }
        return self::in_current_language($url);
    }

    /**
     * The page the properties block links to with ?property=ID: the one set here, else the published
     * page holding the booking block (rule 14). '' when there is none.
     */
    public function get_booking_page_url(): string
    {
        $url = trim((string) $this->get('booking_page_url', ''));
        if ($url !== '') {
            return $url;
        }
        $detected = $this->detected_page('booking');
        return $detected ? (string) get_permalink($detected) : '';
    }

    /** The oldest published page whose content holds the block or shortcode of `$kind`, or 0. */
    public function detected_page(string $kind): int
    {
        $cache = get_transient(self::DETECTED_TRANSIENT);
        $cache = is_array($cache) ? $cache : [];
        if (!array_key_exists($kind, $cache)) {
            global $wpdb;
            $like = '%' . $wpdb->esc_like(self::PAGE_MARKERS[$kind]) . '%';
            $cache[$kind] = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'page' AND post_status = 'publish' AND post_content LIKE %s ORDER BY ID ASC LIMIT 1",
                $like
            ));
            set_transient(self::DETECTED_TRANSIENT, $cache, DAY_IN_SECONDS);
        }
        return (int) $cache[$kind];
    }

    public function forget_detected_pages(): void
    {
        delete_transient(self::DETECTED_TRANSIENT);
    }

    /**
     * The same page, in the language of this request.
     *
     * Falls back to the URL it was given whenever the answer would be a guess: no Polylang, a URL
     * that resolves to no page, or a page with no translation. A visitor reading terms in the wrong
     * language is a defect; a visitor reading no terms at all would be worse.
     */
    private static function in_current_language(string $url): string
    {
        if (!function_exists('pll_get_post') || !class_exists('GF_Language')) {
            return $url;
        }
        $id = url_to_postid($url);
        if (!$id) {
            return $url;
        }
        $translated = pll_get_post($id, GF_Language::current());
        if (!$translated) {
            return $url;
        }
        $permalink = get_permalink($translated);
        return is_string($permalink) && $permalink !== '' ? $permalink : $url;
    }

    /** Reverse proxies in front of WordPress whose X-Forwarded-For is believed (visitor IP). */
    public function get_trusted_proxies(): array
    {
        return self::parse_ip_list((string) $this->get('trusted_proxies', ''));
    }

    /** A proxy on the local network or the machine itself is trusted without being listed (rule 14). */
    public function trusts_local_proxies(): bool
    {
        return (bool) $this->get('trust_local_proxies', 1);
    }

    /** Valid IP addresses found in a comma / space / newline separated list. */
    public static function parse_ip_list(string $raw): array
    {
        $parts = preg_split('/[\s,;]+/', $raw) ?: [];
        return array_values(array_unique(array_filter($parts, static function ($ip) {
            return filter_var($ip, FILTER_VALIDATE_IP) !== false;
        })));
    }

    public function get_base_url(): string
    {
        return untrailingslashit(trim((string) $this->get('api_base_url', '')));
    }

    /** wp-config constant wins (Q1); otherwise the stored option. */
    public function get_api_key(): string
    {
        if (defined('GUESTFLOW_API_KEY') && trim((string) GUESTFLOW_API_KEY) !== '') {
            return trim((string) GUESTFLOW_API_KEY);
        }
        return trim((string) $this->get('api_key', ''));
    }

    public function key_from_constant(): bool
    {
        return defined('GUESTFLOW_API_KEY') && trim((string) GUESTFLOW_API_KEY) !== '';
    }

    /**
     * Whether to verify the GuestFlow server's TLS certificate. Default ON (secure). Set to false
     * ONLY for a trusted local/LAN server using a self-signed certificate. The wp-config constant
     * GUESTFLOW_SSL_VERIFY wins over the stored option (so production can pin it).
     */
    public function get_ssl_verify(): bool
    {
        if (defined('GUESTFLOW_SSL_VERIFY')) {
            return (bool) GUESTFLOW_SSL_VERIFY;
        }
        return (bool) $this->get('ssl_verify', true);
    }

    public function ssl_verify_from_constant(): bool
    {
        return defined('GUESTFLOW_SSL_VERIFY');
    }

    public function is_configured(): bool
    {
        return $this->get_base_url() !== '' && $this->get_api_key() !== '';
    }

    // ----- admin UI -----

    public function add_menu(): void
    {
        add_options_page(
            __('GuestFlow Booking', 'guestflow-booking'),
            __('GuestFlow', 'guestflow-booking'),
            'manage_options',
            'guestflow-booking',
            [$this, 'render_page']
        );
    }

    public function register_settings(): void
    {
        register_setting('gf_booking', GF_BOOKING_OPTION, [
            'type'              => 'array',
            'sanitize_callback' => [$this, 'sanitize'],
            'default'           => $this->defaults(),
        ]);
    }

    public function sanitize($input): array
    {
        $input = is_array($input) ? $input : [];
        $current = $this->all();
        $out = $this->defaults();

        $out['api_base_url']           = esc_url_raw(trim((string) ($input['api_base_url'] ?? '')));
        // Unchecked checkboxes are simply absent from the POST → treat that as "off".
        $out['ssl_verify']             = empty($input['ssl_verify']) ? 0 : 1;
        $out['cache_ttl']              = max(0, (int) ($input['cache_ttl'] ?? 600));
        $out['availability_cache_ttl'] = max(0, (int) ($input['availability_cache_ttl'] ?? 300));
        $out['default_property_id']    = max(0, (int) ($input['default_property_id'] ?? 0));
        $out['booking_page_url']       = $this->sanitize_page_choice('booking', $input['booking_page_url'] ?? '');
        $out['cgv_page_url']           = $this->sanitize_page_choice('cgv', $input['cgv_page_url'] ?? '');
        $out['trusted_proxies']        = implode(', ', self::parse_ip_list((string) ($input['trusted_proxies'] ?? '')));
        $out['trust_local_proxies']    = empty($input['trust_local_proxies']) ? 0 : 1;

        // Key field: empty submission keeps the existing key (the field is masked); a non-empty
        // value replaces it. When the constant is set, the option key is irrelevant.
        $submitted_key = trim((string) ($input['api_key'] ?? ''));
        $out['api_key'] = $submitted_key !== '' ? $submitted_key : (string) ($current['api_key'] ?? '');

        // Settings changed → drop cached responses so the new config takes effect immediately.
        $this->flush_cache();

        return $out;
    }

    /**
     * A page picker's answer (rule 14): '' = the page found by its content, a URL = that page, and
     * « Créer la page » = a new published page holding the block or the shortcode — or the one that
     * already does, so a second save (WordPress sanitizes a new option twice) never makes a duplicate.
     */
    private function sanitize_page_choice(string $kind, $raw): string
    {
        $raw = trim((string) $raw);
        if ($raw !== self::CREATE) {
            return esc_url_raw($raw);
        }
        $this->forget_detected_pages();
        $existing = $this->detected_page($kind);
        if ($existing) {
            return esc_url_raw((string) get_permalink($existing));
        }
        $page = $kind === 'cgv'
            ? ['post_title' => __('Conditions générales', 'guestflow-booking'), 'post_name' => 'cgv',
               'post_content' => "<!-- wp:shortcode -->\n[guestflow_cgv]\n<!-- /wp:shortcode -->"]
            : ['post_title' => __('Réserver', 'guestflow-booking'), 'post_name' => 'reserver',
               'post_content' => '<!-- wp:guestflow/booking /-->'];
        $id = wp_insert_post($page + ['post_type' => 'page', 'post_status' => 'publish'], true);
        $this->forget_detected_pages();
        if (is_wp_error($id) || !$id) {
            return '';
        }
        return esc_url_raw((string) get_permalink($id));
    }

    /** GuestFlow's properties as [id => name], or null when GuestFlow cannot be read right now. */
    private function fetch_properties(): ?array
    {
        if (!$this->is_configured()) {
            return null;
        }
        $res = GF_Api_Client::instance()->get('/properties');
        if ($res['status'] < 200 || $res['status'] >= 300 || !is_array($res['body']['data'] ?? null)) {
            return null;
        }
        $out = [];
        foreach ($res['body']['data'] as $p) {
            if (isset($p['id'])) {
                $out[(int) $p['id']] = (string) ($p['name'] ?? ('#' . (int) $p['id']));
            }
        }
        return $out;
    }

    /** One page picker: automatic (with what it found), every published page, or « Créer la page ». */
    private function render_page_select(string $kind, string $id, string $name, string $current): void
    {
        $pages = get_pages(['post_status' => 'publish', 'sort_column' => 'post_title']);
        $detected = $this->detected_page($kind);
        $auto = $detected
            ? sprintf(/* translators: %s: page title */ __('Automatique : « %s »', 'guestflow-booking'), get_the_title($detected))
            : ($kind === 'cgv' ? __('Automatique : /cgv/', 'guestflow-booking') : __('Automatique : aucune page trouvée', 'guestflow-booking'));
        $known = false;
        echo '<select name="' . esc_attr($name) . '" id="' . esc_attr($id) . '">';
        echo '<option value=""' . selected($current, '', false) . '>' . esc_html($auto) . '</option>';
        foreach ($pages as $page) {
            $url = (string) get_permalink($page);
            $is = $current !== '' && untrailingslashit($current) === untrailingslashit($url);
            $known = $known || $is;
            echo '<option value="' . esc_attr($url) . '"' . ($is ? ' selected' : '') . '>' . esc_html(get_the_title($page) ?: $url) . '</option>';
        }
        if ($current !== '' && !$known) {
            echo '<option value="' . esc_attr($current) . '" selected>' . esc_html($current) . '</option>';
        }
        if (!$detected) {
            echo '<option value="' . esc_attr(self::CREATE) . '">' . esc_html__('Créer la page', 'guestflow-booking') . '</option>';
        }
        echo '</select>';
    }

    private function flush_cache(): void
    {
        global $wpdb;
        $like = $wpdb->esc_like('_transient_gf_cache_') . '%';
        $like_to = $wpdb->esc_like('_transient_timeout_gf_cache_') . '%';
        $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $like, $like_to));
    }

    public function render_page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $o = $this->all();
        $constant = $this->key_from_constant();
        $has_key = $this->get_api_key() !== '';
        $properties = $this->fetch_properties();
        // A public-address proxy is the one case the local rule does not cover: name it so it can be
        // pasted into the list (rule 14).
        $remote = isset($_SERVER['REMOTE_ADDR']) ? trim((string) $_SERVER['REMOTE_ADDR']) : '';
        $proxy_hint = (!empty($_SERVER['HTTP_X_FORWARDED_FOR']) && $remote !== '' && !GF_Api_Client::is_local_ip($remote)
            && !in_array($remote, $this->get_trusted_proxies(), true)) ? $remote : '';
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('GuestFlow Booking', 'guestflow-booking'); ?></h1>

            <?php if (!$this->is_configured()) : ?>
                <div class="notice notice-warning"><p>
                    <?php echo esc_html__("Configuration incomplète : renseignez l'URL de l'API et la clé pour activer les blocs.", 'guestflow-booking'); ?>
                </p></div>
            <?php endif; ?>

            <form action="options.php" method="post">
                <?php settings_fields('gf_booking'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="gf_api_base_url"><?php echo esc_html__("URL de l'API GuestFlow", 'guestflow-booking'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[api_base_url]" id="gf_api_base_url" type="url"
                                   class="regular-text" placeholder="https://guestflow.example.com"
                                   value="<?php echo esc_attr($o['api_base_url']); ?>" />
                            <p class="description"><?php echo esc_html__("Dans GuestFlow : Paramètres › Intégrations › Site internet.", 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_api_key"><?php echo esc_html__("Clé d'API", 'guestflow-booking'); ?></label></th>
                        <td>
                            <?php if ($constant) : ?>
                                <input type="password" class="regular-text" value="********" disabled />
                                <p class="description"><?php echo esc_html__("Définie via la constante GUESTFLOW_API_KEY dans wp-config.php (prioritaire).", 'guestflow-booking'); ?></p>
                            <?php else : ?>
                                <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[api_key]" id="gf_api_key" type="password"
                                       class="regular-text" autocomplete="off"
                                       placeholder="<?php echo $has_key ? esc_attr('••••••••  (' . esc_html__('inchangée', 'guestflow-booking') . ')') : ''; ?>" />
                                <p class="description"><?php echo esc_html__("Dans GuestFlow : Paramètres › Intégrations › Site internet. Vide : la clé actuelle est conservée.", 'guestflow-booking'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php echo esc_html__('Vérification SSL', 'guestflow-booking'); ?></th>
                        <td>
                            <?php if ($this->ssl_verify_from_constant()) : ?>
                                <label><input type="checkbox" checked disabled /> <?php echo esc_html__('Vérifier le certificat TLS du serveur GuestFlow', 'guestflow-booking'); ?></label>
                                <p class="description"><?php echo esc_html__('Définie via la constante GUESTFLOW_SSL_VERIFY dans wp-config.php (prioritaire).', 'guestflow-booking'); ?></p>
                            <?php else : ?>
                                <label>
                                    <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[ssl_verify]" type="checkbox" value="1" <?php checked(1, (int) $o['ssl_verify']); ?> />
                                    <?php echo esc_html__('Vérifier le certificat TLS du serveur GuestFlow', 'guestflow-booking'); ?>
                                </label>
                                <p class="description"><?php echo esc_html__("Laissez coché en production. Décochez UNIQUEMENT pour un serveur local/LAN à certificat auto-signé (sinon la connexion échoue avec un code 502).", 'guestflow-booking'); ?></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_default_property"><?php echo esc_html__('Logement par défaut', 'guestflow-booking'); ?></label></th>
                        <td>
                            <?php if (is_array($properties)) : ?>
                                <?php $selected_property = (int) $o['default_property_id'] ?: (count($properties) === 1 ? (int) array_key_first($properties) : 0); ?>
                                <select name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[default_property_id]" id="gf_default_property">
                                    <option value="0"<?php selected($selected_property, 0); ?>><?php echo esc_html__('Aucun', 'guestflow-booking'); ?></option>
                                    <?php foreach ($properties as $pid => $pname) : ?>
                                        <option value="<?php echo esc_attr((string) $pid); ?>"<?php selected($selected_property, $pid); ?>><?php echo esc_html($pname); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            <?php else : ?>
                                <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[default_property_id]" id="gf_default_property" type="number" min="0" value="<?php echo esc_attr((string) $o['default_property_id']); ?>" />
                                <p class="description"><?php echo esc_html__('Liste des logements disponible une fois la connexion établie.', 'guestflow-booking'); ?></p>
                            <?php endif; ?>
                            <p class="description"><?php echo esc_html__('Affiché par un bloc de réservation qui ne précise pas de logement.', 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_booking_page"><?php echo esc_html__('Page de réservation', 'guestflow-booking'); ?></label></th>
                        <td>
                            <?php $this->render_page_select('booking', 'gf_booking_page', GF_BOOKING_OPTION . '[booking_page_url]', (string) $o['booking_page_url']); ?>
                            <p class="description"><?php echo esc_html__("Les cartes de logements pointent vers cette page avec ?property=ID. Automatique : la page qui contient le bloc de réservation.", 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_cgv_page"><?php echo esc_html__('Page des conditions générales', 'guestflow-booking'); ?></label></th>
                        <td>
                            <?php $this->render_page_select('cgv', 'gf_cgv_page', GF_BOOKING_OPTION . '[cgv_page_url]', (string) $o['cgv_page_url']); ?>
                            <p class="description"><?php echo esc_html__("La case « J'ai lu et j'accepte » du formulaire de réservation y renvoie. Automatique : la page qui contient le shortcode [guestflow_cgv].", 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                </table>

                <details class="gf-advanced">
                    <summary><strong><?php echo esc_html__('Réglages avancés', 'guestflow-booking'); ?></strong></summary>
                    <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><?php echo esc_html__('Proxys du réseau local', 'guestflow-booking'); ?></th>
                        <td>
                            <label>
                                <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[trust_local_proxies]" type="checkbox" value="1" <?php checked(1, (int) $o['trust_local_proxies']); ?> />
                                <?php echo esc_html__('Reconnaître un reverse proxy à adresse privée', 'guestflow-booking'); ?>
                            </label>
                            <p class="description"><?php echo esc_html__("Un proxy du réseau local ou de la machine (10/8, 172.16/12, 192.168/16, 127/8) transmet l'adresse du visiteur sans réglage.", 'guestflow-booking'); ?></p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_trusted_proxies"><?php echo esc_html__('Proxys de confiance', 'guestflow-booking'); ?></label></th>
                        <td>
                            <input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[trusted_proxies]" id="gf_trusted_proxies" type="text" class="regular-text"
                                   value="<?php echo esc_attr($o['trusted_proxies']); ?>" placeholder="203.0.113.10" />
                            <p class="description"><?php echo esc_html__("Uniquement pour un proxy à adresse publique placé devant WordPress (séparées par des virgules). La preuve d'acceptation des CGV et la limite anti-spam reposent sur l'adresse du visiteur.", 'guestflow-booking'); ?></p>
                            <?php if ($proxy_hint !== '') : ?>
                                <p class="description"><strong><?php echo esc_html(sprintf(/* translators: %s: IP address */ __('Proxy détecté devant WordPress : %s.', 'guestflow-booking'), $proxy_hint)); ?></strong></p>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_cache_ttl"><?php echo esc_html__('Cache lecture (s)', 'guestflow-booking'); ?></label></th>
                        <td><input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[cache_ttl]" id="gf_cache_ttl" type="number" min="0" value="<?php echo esc_attr((string) $o['cache_ttl']); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="gf_avail_ttl"><?php echo esc_html__('Cache disponibilités (s)', 'guestflow-booking'); ?></label></th>
                        <td><input name="<?php echo esc_attr(GF_BOOKING_OPTION); ?>[availability_cache_ttl]" id="gf_avail_ttl" type="number" min="0" value="<?php echo esc_attr((string) $o['availability_cache_ttl']); ?>" /></td>
                    </tr>
                    </table>
                </details>
                <?php submit_button(); ?>
            </form>

            <hr />
            <h2><?php echo esc_html__('Test de connexion', 'guestflow-booking'); ?></h2>
            <p>
                <button type="button" class="button" id="gf-test-connection"><?php echo esc_html__('Tester la connexion', 'guestflow-booking'); ?></button>
                <span id="gf-test-result" role="status" aria-live="polite" style="margin-left:8px;"></span>
            </p>
            <script>
            (function () {
                var btn = document.getElementById('gf-test-connection');
                var out = document.getElementById('gf-test-result');
                if (!btn) return;
                function run() {
                    out.textContent = <?php echo wp_json_encode(__('Test en cours…', 'guestflow-booking')); ?>;
                    var body = new FormData();
                    body.append('action', 'gf_test_connection');
                    body.append('_ajax_nonce', <?php echo wp_json_encode(wp_create_nonce('gf_test_connection')); ?>);
                    fetch(<?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>, { method: 'POST', credentials: 'same-origin', body: body })
                        .then(function (r) { return r.json(); })
                        .then(function (j) { out.textContent = (j && j.data && j.data.message) ? j.data.message : '?'; })
                        .catch(function () { out.textContent = <?php echo wp_json_encode(__('Échec du test.', 'guestflow-booking')); ?>; });
                }
                btn.addEventListener('click', run);
                // Configured: the result shows on arrival, no click needed (rule 14).
                <?php if ($this->is_configured()) : ?>run();<?php endif; ?>
            })();
            </script>
        </div>
        <?php
    }

    /**
     * GuestFlow answers but its website booking is off (`{"error":"PLUGIN_INACTIVE"}`) or not installed
     * (404 `NOT_FOUND` on /public/v1) — not a network failure (specs/wordpress-plugin.md rule 18).
     */
    public static function is_module_off(array $res): bool
    {
        $error = $res['body']['error'] ?? null;
        if ($error === 'PLUGIN_INACTIVE') {
            return true;
        }
        return (int) $res['status'] === 404 && is_array($error) && ($error['code'] ?? '') === 'NOT_FOUND';
    }

    public function ajax_test_connection(): void
    {
        check_ajax_referer('gf_test_connection');
        if (!current_user_can('manage_options')) {
            wp_send_json_error(['message' => __('Non autorisé.', 'guestflow-booking')], 403);
        }
        if (!$this->is_configured()) {
            wp_send_json_error(['message' => __("Clé ou URL d'API non configurée.", 'guestflow-booking')]);
        }
        $res = GF_Api_Client::instance()->get('/properties');
        if ($res['status'] >= 200 && $res['status'] < 300) {
            $count = is_array($res['body']['data'] ?? null) ? count($res['body']['data']) : 0;
            wp_send_json_success(['message' => sprintf(
                /* translators: %d: number of properties */
                __('Connexion réussie — %d logement(s).', 'guestflow-booking'),
                $count
            )]);
        }
        if ($res['status'] === 401) {
            wp_send_json_error(['message' => __("Échec d'authentification : clé invalide.", 'guestflow-booking')]);
        }
        if (self::is_module_off($res)) {
            wp_send_json_error(['message' => __('Module « Réservation depuis le site » inactif dans GuestFlow.', 'guestflow-booking')]);
        }
        wp_send_json_error(['message' => sprintf(
            /* translators: %d: HTTP status code */
            __('Serveur injoignable ou erreur (code %d).', 'guestflow-booking'),
            (int) $res['status']
        )]);
    }
}
