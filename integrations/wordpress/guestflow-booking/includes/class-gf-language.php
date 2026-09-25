<?php
/**
 * GF_Language — which language this request is being served in.
 *
 * Resolved once per request and reused everywhere: the upstream calls to GuestFlow, the strings the
 * blocks render, the locale the browser formats numbers and dates with. One answer, so the drawer
 * cannot end up half French and half English on the same page.
 *
 * Order (specs/site-english-version.md rule 22):
 *   1. Polylang's current language, when Polylang is active — it is what actually decides which
 *      page the visitor is reading;
 *   2. otherwise WordPress's own locale, reduced to its two-letter prefix;
 *   3. otherwise French.
 *
 * Only `fr` and `en` exist. Anything else — a site translated into German tomorrow, a malformed
 * locale — reads as French rather than failing: the booking funnel must survive a language it does
 * not know (rule 1).
 */

if (!defined('ABSPATH')) {
    exit;
}

class GF_Language
{
    private const SUPPORTED = ['fr', 'en'];
    private const FALLBACK = 'fr';

    /** @var string|null Resolved once per request; null until then. */
    private static $current = null;

    /**
     * The language code for this request: 'fr' or 'en'.
     */
    public static function current(): string
    {
        if (self::$current !== null) {
            return self::$current;
        }
        self::$current = self::normalise(self::detect());
        return self::$current;
    }

    /**
     * The full locale to hand the browser, so `Intl` formats dates and numbers the way the page
     * reads. Not a cosmetic detail: « 1 234,56 € » and « July 10 » disagreeing on one screen is how
     * a visitor decides a site is broken.
     *
     * British English on purpose — `en_GB` is the locale Polylang already declares for this site.
     */
    public static function locale(): string
    {
        return self::current() === 'en' ? 'en-GB' : 'fr-FR';
    }

    /**
     * True when the site really has something to switch to: Polylang present and declaring more
     * than one language. The site's own switcher hangs on this (rule 27), and so does the decision
     * not to advertise an English version that does not exist.
     */
    public static function is_multilingual(): bool
    {
        if (!function_exists('pll_languages_list')) {
            return false;
        }
        $list = pll_languages_list(['fields' => 'slug']);
        return is_array($list) && count($list) > 1;
    }

    /**
     * Reduce anything — a slug, a locale, a header fragment — to a supported code.
     *
     * `en_GB`, `en-GB`, `EN` and `en` all mean English; everything else means French. Deliberately
     * permissive, and deliberately silent: a language token is never worth an error.
     */
    public static function normalise($value): string
    {
        $raw = strtolower(trim((string) $value));
        if ($raw === '') {
            return self::FALLBACK;
        }
        $base = explode('-', str_replace('_', '-', $raw))[0];
        return in_array($base, self::SUPPORTED, true) ? $base : self::FALLBACK;
    }

    /**
     * The raw signal, before normalisation.
     */
    private static function detect(): string
    {
        if (function_exists('pll_current_language')) {
            $slug = pll_current_language('slug');
            if (is_string($slug) && $slug !== '') {
                return $slug;
            }
        }
        return function_exists('get_locale') ? (string) get_locale() : self::FALLBACK;
    }

    /**
     * State the language of this request, ahead of every guess.
     *
     * A REST request carries no page, so `pll_current_language()` has nothing to read and the
     * detection falls back to the site's own locale. The browser therefore has to say which language
     * the page it is on is written in, and this is where that answer lands — before any guess
     * (specs/site-english-version.md rule 56).
     *
     * Normalised like everything else: an unknown value reads as French rather than failing.
     */
    public static function set($value): void
    {
        self::$current = self::normalise($value);
    }

    /**
     * Reset the memoised value. Tests only — a request has one language and resolves it once.
     */
    public static function reset(): void
    {
        self::$current = null;
    }
}
