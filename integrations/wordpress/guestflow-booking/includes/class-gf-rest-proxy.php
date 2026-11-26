<?php
/**
 * REST proxy — registers `/wp-json/guestflow/v1/*` routes that the blocks call from the browser, and
 * relays them server-side to GuestFlow's `/public/v1` with the API key injected. Reads are cached and
 * fall back to a stale copy on upstream failure; the booking-request write requires a valid WP REST
 * nonce (defense in depth — GuestFlow still enforces honeypot + rate limit). The browser never sees
 * the GuestFlow base URL or key.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class GF_Rest_Proxy
{
    private const TERMS_CURRENT_TTL = 60;

    private const NS = 'guestflow/v1';
    // The public offer carries `available`, which flips when a payment provider is connected: a short
    // copy, like the terms.
    private const VOUCHER_OFFER_TTL = 60;
    private const SESSION_RESOURCES_TTL = 60;
    private static ?GF_Rest_Proxy $instance = null;

    public static function instance(): GF_Rest_Proxy
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot(): void
    {
        add_action('rest_api_init', [$this, 'register_routes']);
        // ONE place, before any handler runs, rather than a line repeated in eleven of them: a route
        // added later would otherwise ask GuestFlow in the wrong language and nothing would say so.
        add_filter('rest_pre_dispatch', [$this, 'adopt_request_language'], 10, 3);
        add_filter('rest_pre_serve_request', [$this, 'serve_voucher_pdf'], 10, 3);
    }

    /**
     * Serve this request in the language the page says it is being read in.
     *
     * A REST call carries no page, so Polylang has nothing to read and `GF_Language` would resolve
     * the site's own locale — French. Every upstream call, every cache key and every label would
     * follow it, which is how an English page listed its options and price units in French while the
     * rest of the drawer was translated (specs/site-english-version.md rule 56).
     *
     * Only our own namespace, and never a rejection: an absent or unknown `lang` reads as French,
     * exactly as the public API treats it (rule 1).
     *
     * @param mixed            $result  Untouched — this filter reads, it never short-circuits.
     * @param WP_REST_Server   $server
     * @param WP_REST_Request  $request
     * @return mixed
     */
    public function adopt_request_language($result, $server, $request)
    {
        if ($request instanceof WP_REST_Request
            && strpos((string) $request->get_route(), '/' . self::NS . '/') === 0) {
            $lang = $request->get_param('lang');
            if (is_string($lang) && $lang !== '') {
                GF_Language::set($lang);
            }
        }
        return $result;
    }

    public function register_routes(): void
    {
        $public = '__return_true';

        register_rest_route(self::NS, '/properties', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_properties'],
        ]);
        register_rest_route(self::NS, '/properties/(?P<id>\d+)', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_property'],
        ]);
        register_rest_route(self::NS, '/properties/(?P<id>\d+)/options', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_options'],
        ]);
        register_rest_route(self::NS, '/properties/(?P<id>\d+)/resources', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_resources'],
        ]);
        register_rest_route(self::NS, '/properties/(?P<id>\d+)/availability', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_availability'],
        ]);
        // CGV (specs/terms-acceptance-record.md §3.2): the current version the booking block offers,
        // and a published version by number (immutable).
        register_rest_route(self::NS, '/terms', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_terms'],
        ]);
        register_rest_route(self::NS, '/terms/(?P<version>\d+)', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_terms_version'],
        ]);
        register_rest_route(self::NS, '/quote', [
            'methods'             => 'POST',
            'permission_callback' => $public,
            'callback'            => [$this, 'post_quote'],
        ]);
        // The proof-of-work challenge the drawer solves before sending (GuestFlow
        // specs/public-request-abuse-and-grouping.md rule 2). A fixed upstream path: nothing the browser
        // sends reaches the URL. Never cached — each challenge is single-use and bound to the visitor.
        register_rest_route(self::NS, '/booking-requests/challenge', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_booking_challenge'],
        ]);
        register_rest_route(self::NS, '/booking-requests', [
            'methods'             => 'POST',
            'permission_callback' => [$this, 'verify_nonce'],
            'callback'            => [$this, 'post_booking_request'],
        ]);
        // Online full-payment (specs/public-online-payment.md): create/reuse the Qonto link for a
        // booking-request devis (nonce-protected write), then poll its status from the success page.
        register_rest_route(self::NS, '/booking-requests/(?P<id>\d+)/pay', [
            'methods'             => 'POST',
            'permission_callback' => [$this, 'verify_nonce'],
            'callback'            => [$this, 'post_pay'],
        ]);
        register_rest_route(self::NS, '/booking-requests/(?P<id>\d+)/status', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_payment_status'],
        ]);

        // Gift vouchers (specs/gift-vouchers.md §4.3): a fixed list of upstream paths. An id is an integer,
        // a token base64url; nothing else the browser sends reaches an upstream URL. Reads of an order are
        // never cached — they carry a capability token.
        register_rest_route(self::NS, '/gift-vouchers/offer', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_voucher_offer'],
        ]);
        // The price of what the giver composed: the engine's lines, total and VAT. Computes, writes nothing.
        register_rest_route(self::NS, '/gift-vouchers/offer/price', [
            'methods'             => 'POST',
            'permission_callback' => $public,
            'callback'            => [$this, 'post_voucher_price'],
        ]);
        // « Utiliser un bon cadeau » (specs/gift-voucher-campaigns.md rules 23-32): the code is always in the body.
        foreach (['use' => 'post_voucher_use', 'use/slots' => 'post_voucher_use_slots', 'use/quote' => 'post_voucher_use_quote', 'use/confirm' => 'post_voucher_use_confirm'] as $path => $callback) {
            register_rest_route(self::NS, '/gift-vouchers/' . $path, [
                'methods'             => 'POST',
                'permission_callback' => [$this, 'verify_nonce'],
                'callback'            => [$this, $callback],
            ]);
        }
        // « Réserver une séance » (specs/site-outside-resource-booking.md §4.4): a fixed list of upstream paths; the reference of a payment is a 32-character hex token.
        register_rest_route(self::NS, '/sessions/resources', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_session_resources'],
        ]);
        foreach (['slots' => 'post_session_slots', 'quote' => 'post_session_quote', 'confirm' => 'post_session_confirm'] as $path => $callback) {
            register_rest_route(self::NS, '/sessions/' . $path, [
                'methods'             => 'POST',
                'permission_callback' => [$this, 'verify_nonce'],
                'callback'            => [$this, $callback],
            ]);
        }
        register_rest_route(self::NS, '/sessions/status/(?P<ref>[0-9a-f]{32})', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_session_status'],
        ]);
        // The return page of a voucher's remainder: by the use's own reference (32 hex characters), no code, no name.
        register_rest_route(self::NS, '/gift-vouchers/use/status/(?P<ref>[0-9a-f]{32})', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_voucher_use_status'],
        ]);
        register_rest_route(self::NS, '/gift-vouchers/check', [
            'methods'             => 'POST',
            'permission_callback' => [$this, 'verify_nonce'],
            'callback'            => [$this, 'post_voucher_check'],
        ]);
        register_rest_route(self::NS, '/gift-vouchers/orders', [
            'methods'             => 'POST',
            'permission_callback' => [$this, 'verify_nonce'],
            'callback'            => [$this, 'post_voucher_order'],
        ]);
        register_rest_route(self::NS, '/gift-vouchers/orders/(?P<id>\d+)/pay', [
            'methods'             => 'POST',
            'permission_callback' => [$this, 'verify_nonce'],
            'callback'            => [$this, 'post_voucher_pay'],
        ]);
        // specs/gift-voucher-campaigns.md rule 62 — the front a campaign sells, read from GuestFlow at its versioned address.
        register_rest_route(self::NS, '/gift-vouchers/campaigns/(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)/visual', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_campaign_visual'],
        ]);
        // Rule 66 — the company's logo for the back of the voucher card, at the address GuestFlow hashes.
        register_rest_route(self::NS, '/gift-vouchers/logo', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_voucher_logo'],
        ]);
        register_rest_route(self::NS, '/gift-vouchers/orders/(?P<id>\d+)/pdf', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_voucher_pdf'],
        ]);
        // Rule 66 — the front frozen on the voucher (what the PDF prints), for the card shown after payment.
        register_rest_route(self::NS, '/gift-vouchers/orders/(?P<id>\d+)/front', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_voucher_front'],
        ]);
        register_rest_route(self::NS, '/gift-vouchers/orders/(?P<id>\d+)', [
            'methods'             => 'GET',
            'permission_callback' => $public,
            'callback'            => [$this, 'get_voucher_order'],
        ]);
    }

    /** Write protection: only the plugin's own frontend (carrying the wp_rest nonce) may POST here. */
    public function verify_nonce(WP_REST_Request $request): bool
    {
        $nonce = $request->get_header('X-WP-Nonce');
        return is_string($nonce) && $nonce !== '' && (bool) wp_verify_nonce($nonce, 'wp_rest');
    }

    // ----- read handlers (cached) -----

    public function get_properties(WP_REST_Request $request): WP_REST_Response
    {
        return $this->proxy_get('/properties', [], (int) GF_Settings::instance()->get('cache_ttl', 600));
    }

    public function get_property(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        return $this->proxy_get("/properties/{$id}", [], (int) GF_Settings::instance()->get('cache_ttl', 600));
    }

    public function get_options(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        return $this->proxy_get("/properties/{$id}/options", [], (int) GF_Settings::instance()->get('cache_ttl', 600));
    }

    public function get_resources(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        return $this->proxy_get("/properties/{$id}/resources", [], (int) GF_Settings::instance()->get('cache_ttl', 600));
    }

    public function get_availability(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        $query = [];
        $from = $request->get_param('from');
        $to = $request->get_param('to');
        if ($from) {
            $query['from'] = sanitize_text_field((string) $from);
        }
        if ($to) {
            $query['to'] = sanitize_text_field((string) $to);
        }
        return $this->proxy_get("/properties/{$id}/availability", $query, (int) GF_Settings::instance()->get('availability_cache_ttl', 300));
    }

    /** Short TTL: a new publication must reach the form quickly (a stale one is answered 409 anyway). */
    public function get_terms(WP_REST_Request $request): WP_REST_Response
    {
        return $this->proxy_get('/terms', [], self::TERMS_CURRENT_TTL);
    }

    public function get_terms_version(WP_REST_Request $request): WP_REST_Response
    {
        $version = (int) $request['version'];
        return $this->proxy_get("/terms/{$version}", [], (int) GF_Settings::instance()->get('cache_ttl', 600));
    }

    // ----- write / compute handlers (no cache) -----

    public function post_quote(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        $res = GF_Api_Client::instance()->post('/quote', $body);
        return $this->relay($res);
    }

    public function post_booking_request(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        // The browser only says which version was ticked (`termsVersion`). The proof around it — who,
        // from where — is added by GuestFlow from the headers this server sets, never from the body.
        unset($body['termsAcceptance'], $body['acceptedAt']);
        $res = GF_Api_Client::instance()->post('/booking-requests', $body);
        return $this->relay($res);
    }

    public function get_booking_challenge(WP_REST_Request $request): WP_REST_Response
    {
        $res = GF_Api_Client::instance()->get('/booking-requests/challenge');
        $response = $this->relay($res);
        $response->header('Cache-Control', 'no-store');
        return $response;
    }

    public function post_pay(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        $body = (array) $request->get_json_params();
        // Forward only the same-origin return path (GuestFlow allowlists it against PUBLIC_SITE_ORIGIN)
        // and the per-devis capability token that authorises paying THIS devis.
        $forward = [];
        if (isset($body['returnPath']) && is_string($body['returnPath'])) {
            $forward['returnPath'] = $body['returnPath'];
        }
        if (isset($body['token']) && is_string($body['token'])) {
            $forward['token'] = $body['token'];
        }
        $res = GF_Api_Client::instance()->post("/booking-requests/{$id}/pay", $forward);
        return $this->relay($res);
    }

    public function get_payment_status(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        // Never cached — the success page polls this until the payment confirms. The per-devis token
        // (echoed by the success page from the return URL) authorises reading THIS devis's status.
        $query = [];
        $token = $request->get_param('token');
        if (is_string($token) && $token !== '') {
            $query['token'] = sanitize_text_field($token);
        }
        $res = GF_Api_Client::instance()->get("/booking-requests/{$id}/status", $query);
        return $this->relay($res);
    }

    // ----- gift vouchers -----

    public function get_voucher_offer(WP_REST_Request $request): WP_REST_Response
    {
        return $this->proxy_get('/gift-vouchers/offer', [], self::VOUCHER_OFFER_TTL);
    }

    public function post_voucher_check(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/check', $this->voucher_fields($body, ['code' => 'string'])));
    }

    public function post_voucher_order(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        $forward = $this->voucher_fields($body, [
            'slug'            => 'string',
            'extraMinutes'    => 'int',
            'addOns'          => 'addons',
            'amountCents'     => 'int',
            'recipientFirstName' => 'string',
            'recipientLastName'  => 'string',
            'senderName'      => 'string',
            'message'         => 'string',
            'email'           => 'string',
            'termsVersionId'  => 'int',
            'language'        => 'string',
        ]);
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/orders', $forward));
    }

    public function post_voucher_price(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        $forward = $this->voucher_fields($body, ['slug' => 'string', 'amountCents' => 'int', 'extraMinutes' => 'int', 'addOns' => 'addons']);
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/offer/price', $forward));
    }

    public function post_voucher_use(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/use', $this->voucher_fields($body, ['code' => 'string'])));
    }

    public function post_voucher_use_slots(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/use/slots', $this->voucher_fields($body, [
            'code' => 'string', 'from' => 'string', 'to' => 'string', 'extraMinutes' => 'int',
        ])));
    }

    public function post_voucher_use_quote(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/use/quote', $this->voucher_fields($body, [
            'code' => 'string', 'start' => 'string', 'extraMinutes' => 'int', 'addOns' => 'addons',
        ])));
    }

    public function post_voucher_use_confirm(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/gift-vouchers/use/confirm', $this->voucher_fields($body, [
            'code' => 'string', 'start' => 'string', 'extraMinutes' => 'int', 'addOns' => 'addons', 'email' => 'string', 'phone' => 'string',
            'name' => 'string', 'firstName' => 'string', 'lastName' => 'string', 'people' => 'int', 'termsVersionId' => 'int', 'returnPath' => 'path',
        ])));
    }

    // ----- sessions (specs/site-outside-resource-booking.md §4.4) -----

    public function get_session_resources(WP_REST_Request $request): WP_REST_Response
    {
        return $this->proxy_get('/sessions/resources', [], self::SESSION_RESOURCES_TTL);
    }

    public function post_session_slots(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/sessions/slots', $this->voucher_fields($body, [
            'resourceId' => 'int', 'from' => 'string', 'to' => 'string', 'minutes' => 'int',
        ])));
    }

    public function post_session_quote(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/sessions/quote', $this->voucher_fields($body, [
            'resourceId' => 'int', 'start' => 'string', 'minutes' => 'int', 'addOns' => 'addons',
        ])));
    }

    public function post_session_confirm(WP_REST_Request $request): WP_REST_Response
    {
        $body = (array) $request->get_json_params();
        return $this->relay(GF_Api_Client::instance()->post('/sessions/confirm', $this->voucher_fields($body, [
            'resourceId' => 'int', 'start' => 'string', 'minutes' => 'int', 'addOns' => 'addons', 'people' => 'int',
            'firstName' => 'string', 'lastName' => 'string', 'email' => 'string', 'phone' => 'string', 'termsVersionId' => 'int', 'returnPath' => 'path',
        ])));
    }

    public function get_session_status(WP_REST_Request $request): WP_REST_Response
    {
        $ref = (string) $request['ref'];
        $response = $this->relay(GF_Api_Client::instance()->get('/sessions/status/' . $ref));
        $response->header('Cache-Control', 'no-store');
        return $response;
    }

    public function get_voucher_use_status(WP_REST_Request $request): WP_REST_Response
    {
        $ref = (string) $request['ref'];
        $response = $this->relay(GF_Api_Client::instance()->get('/gift-vouchers/use/status/' . $ref));
        $response->header('Cache-Control', 'no-store');
        return $response;
    }

    public function post_voucher_pay(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        $body = (array) $request->get_json_params();
        $token = isset($body['token']) && is_string($body['token']) ? $body['token'] : '';
        if (!$this->is_token($token)) {
            return $this->voucher_not_found();
        }
        $forward = ['token' => $token];
        $return = isset($body['returnPath']) && is_string($body['returnPath']) ? $body['returnPath'] : '';
        if ($this->is_site_path($return)) {
            $forward['returnPath'] = $return;
        }
        return $this->relay(GF_Api_Client::instance()->post("/gift-vouchers/orders/{$id}/pay", $forward));
    }

    public function get_voucher_order(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        $token = (string) $request->get_param('token');
        if (!$this->is_token($token)) {
            return $this->voucher_not_found();
        }
        $response = $this->relay(GF_Api_Client::instance()->get("/gift-vouchers/orders/{$id}", ['token' => $token]));
        $response->header('Cache-Control', 'no-store');
        return $response;
    }

    public function get_voucher_pdf(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        $token = (string) $request->get_param('token');
        if (!$this->is_token($token)) {
            return $this->voucher_not_found();
        }
        $res = GF_Api_Client::instance()->get_raw("/gift-vouchers/orders/{$id}/pdf", ['token' => $token]);
        if (($res['type'] ?? '') !== 'application/pdf') {
            return $this->relay($res);
        }
        $response = new WP_REST_Response($res['body'], 200);
        $response->header('Content-Type', 'application/pdf');
        $response->header('Content-Disposition', 'inline; filename="bon-cadeau.pdf"');
        $response->header('Cache-Control', 'private, no-store');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    /** The voucher's frozen front (rule 66): a JPEG by order id and token, never kept; anything else is a 404 and the card draws a plain front. */
    public function get_voucher_front(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request['id'];
        $token = (string) $request->get_param('token');
        if (!$this->is_token($token)) {
            return $this->voucher_not_found();
        }
        $res = GF_Api_Client::instance()->get_raw("/gift-vouchers/orders/{$id}/front", ['token' => $token]);
        if (($res['type'] ?? '') !== 'image/jpeg') {
            return $this->voucher_not_found();
        }
        $response = new WP_REST_Response($res['body'], 200);
        $response->header('Content-Type', 'image/jpeg');
        $response->header('Cache-Control', 'private, no-store');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    /**
     * A campaign's front for the purchase page (rule 62): the bytes and GuestFlow's cache header as they come — a year
     * at the version on sale, never kept for an older one. Only digits reach the version parameter.
     */
    public function get_campaign_visual(WP_REST_Request $request): WP_REST_Response
    {
        $slug = (string) $request['slug'];
        $version = (string) $request->get_param('v');
        $query = preg_match('/^\d{1,12}$/', $version) ? ['v' => $version] : [];
        $res = GF_Api_Client::instance()->get_raw('/gift-vouchers/campaigns/' . rawurlencode($slug) . '/visual', $query);
        if (($res['type'] ?? '') !== 'image/jpeg') {
            $response = new WP_REST_Response(['error' => ['code' => 'VISUAL_NOT_FOUND']], 404);
            $response->header('Cache-Control', 'no-store');
            return $response;
        }
        $cache = (string) ($res['cache'] ?? '');
        $response = new WP_REST_Response($res['body'], 200);
        $response->header('Content-Type', 'image/jpeg');
        $response->header('Cache-Control', strpos($cache, 'immutable') !== false ? 'public, max-age=31536000, immutable' : 'no-store');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    /** The company's logo for the voucher's back (rule 66): the PNG and GuestFlow's cache header as they come; only hex reaches the hash parameter. */
    public function get_voucher_logo(WP_REST_Request $request): WP_REST_Response
    {
        $hash = (string) $request->get_param('v');
        $query = preg_match('/^[0-9a-f]{8,64}$/', $hash) ? ['v' => $hash] : [];
        $res = GF_Api_Client::instance()->get_raw('/gift-vouchers/logo', $query);
        if (($res['type'] ?? '') !== 'image/png') {
            $response = new WP_REST_Response(['error' => ['code' => 'LOGO_NOT_FOUND']], 404);
            $response->header('Cache-Control', 'no-store');
            return $response;
        }
        $cache = (string) ($res['cache'] ?? '');
        $response = new WP_REST_Response($res['body'], 200);
        $response->header('Content-Type', 'image/png');
        $response->header('Cache-Control', strpos($cache, 'immutable') !== false ? 'public, max-age=31536000, immutable' : 'no-store');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    /** Sends the PDF and picture bytes as they are: the REST server would otherwise JSON-encode them. */
    public function serve_voucher_pdf($served, $result, $request)
    {
        if ($served || !($result instanceof WP_REST_Response) || !($request instanceof WP_REST_Request)) {
            return $served;
        }
        $headers = $result->get_headers();
        $route = (string) $request->get_route();
        $type = $headers['Content-Type'] ?? '';
        $binary = (($type === 'application/pdf' || $type === 'image/jpeg') && strpos($route, '/' . self::NS . '/gift-vouchers/orders/') === 0)
            || ($type === 'image/jpeg' && strpos($route, '/' . self::NS . '/gift-vouchers/campaigns/') === 0)
            || ($type === 'image/png' && $route === '/' . self::NS . '/gift-vouchers/logo');
        if ($result->get_status() === 200 && is_string($result->get_data()) && $binary) {
            echo $result->get_data(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- a PDF file or a JPEG, not markup
            return true;
        }
        return $served;
    }

    /** Picks the named fields of a body, each cast to its type: nothing else is forwarded. */
    private function voucher_fields(array $body, array $types): array
    {
        $out = [];
        foreach ($types as $name => $type) {
            if (!array_key_exists($name, $body)) {
                continue;
            }
            if ($type === 'int' && is_numeric($body[$name])) {
                $out[$name] = (int) $body[$name];
            } elseif ($type === 'string' && is_string($body[$name])) {
                $out[$name] = $body[$name];
            } elseif ($type === 'path' && is_string($body[$name]) && $this->is_site_path($body[$name])) {
                $out[$name] = $body[$name];
            } elseif ($type === 'addons' && is_array($body[$name])) {
                $out[$name] = $this->voucher_add_ons($body[$name]);
            }
        }
        // The proof of work of the request, relayed untouched: GuestFlow verifies it.
        if (isset($body['challenge']) && is_array($body['challenge'])) {
            $out['challenge'] = $body['challenge'];
        }
        if (isset($body['nonce']) && is_string($body['nonce'])) {
            $out['nonce'] = $body['nonce'];
        }
        return $out;
    }

    /** The options a giver or a recipient adds: only `{ articleRef, qty }` entries are forwarded, GuestFlow judges them. */
    private function voucher_add_ons(array $entries): array
    {
        $list = [];
        foreach ($entries as $entry) {
            if (is_array($entry) && isset($entry['articleRef']) && is_string($entry['articleRef']) && isset($entry['qty']) && is_numeric($entry['qty'])) {
                $list[] = ['articleRef' => $entry['articleRef'], 'qty' => (int) $entry['qty']];
            }
        }
        return $list;
    }

    /** Only a path of this very site: GuestFlow builds the address from its own site origin and allowlists it again. */
    private function is_site_path(string $path): bool
    {
        return $path !== '' && $path[0] === '/' && strpos($path, '//') !== 0 && strlen($path) <= 200;
    }

    /** The capability token of an order: 24 random bytes as base64url, so 32 characters; bounds leave room. */
    private function is_token(string $token): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9_-]{16,128}$/', $token);
    }

    private function voucher_not_found(): WP_REST_Response
    {
        return new WP_REST_Response(
            ['error' => ['code' => 'VOUCHER_ORDER_NOT_FOUND', 'message' => __('Bon introuvable.', 'guestflow-booking')]],
            404
        );
    }

    // ----- helpers -----

    private function proxy_get(string $path, array $query, int $ttl): WP_REST_Response
    {
        $key = GF_Cache::key($path, $query);

        $cached = GF_Cache::get($key);
        if ($cached !== false) {
            return new WP_REST_Response($cached, 200);
        }

        $res = GF_Api_Client::instance()->get($path, $query);
        if ($res['status'] >= 200 && $res['status'] < 300) {
            GF_Cache::set($key, $res['body'], $ttl);
            return new WP_REST_Response($res['body'], $res['status']);
        }

        // Upstream failed — serve the last good value if still within the grace window.
        $stale = GF_Cache::get_stale($key);
        if ($stale !== false) {
            return new WP_REST_Response($stale, 200);
        }

        return $this->relay($res);
    }

    /** Relay an upstream {status, body}; never expose that the key is wrong (401 → 503). */
    private function relay(array $res): WP_REST_Response
    {
        if ((int) $res['status'] === 401) {
            return new WP_REST_Response(
                ['error' => ['code' => 'SERVICE_UNAVAILABLE', 'message' => __('Service de réservation indisponible.', 'guestflow-booking')]],
                503
            );
        }
        return new WP_REST_Response($res['body'], (int) $res['status']);
    }
}
