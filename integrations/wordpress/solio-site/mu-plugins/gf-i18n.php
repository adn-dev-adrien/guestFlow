<?php
/**
 * Plugin Name: Domaine Solio — Langues
 * Description: La langue du site : ce qu'elle vaut pour la page courante, ce que chaque chaine dit
 *              dans les deux langues, le selecteur de l'en-tete, et la bascule automatique a la
 *              premiere visite. Un seul fichier, parce que la raison pour laquelle un visiteur lit
 *              de l'anglais doit se relire d'un seul endroit.
 *              specs/site-english-version.md §6 et regles 22-29.
 */

if (!defined('ABSPATH')) {
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Quelle langue, pour cette page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * « fr » ou « en », jamais autre chose.
 *
 * Polylang decide, parce que c'est lui qui sait quelle page est servie. A defaut, la locale de
 * WordPress. A defaut encore, le francais : le site est francais, et une langue inconnue ne doit
 * jamais casser une page.
 */
function gf_langue() {
    static $langue = null;
    if (null !== $langue) {
        return $langue;
    }
    $brut = '';
    if (function_exists('pll_current_language')) {
        $slug = pll_current_language('slug');
        if (is_string($slug) && '' !== $slug) {
            $brut = $slug;
        }
    }
    if ('' === $brut) {
        $brut = function_exists('get_locale') ? (string) get_locale() : 'fr';
    }
    $langue = gf_langue_normalisee($brut);
    return $langue;
}

/**
 * Reduit n'importe quoi — « en_GB », « en-US », « EN » — a « fr » ou « en ».
 */
function gf_langue_normalisee($valeur) {
    $brut = strtolower(trim((string) $valeur));
    if ('' === $brut) {
        return 'fr';
    }
    $base = explode('-', str_replace('_', '-', $brut))[0];
    return 'en' === $base ? 'en' : 'fr';
}

/**
 * Le site a-t-il vraiment deux langues ?
 *
 * Tant que l'anglais n'existe pas, rien ne doit l'annoncer : ni selecteur, ni bascule automatique,
 * ni alternative hreflang (regle 23). La question se pose sur du CONTENU PUBLIE, pas sur une langue
 * declaree dans les reglages de Polylang — c'est exactement le defaut que cette spec repare.
 */
function gf_site_bilingue() {
    static $bilingue = null;
    if (null !== $bilingue) {
        return $bilingue;
    }
    $bilingue = false;
    if (function_exists('pll_languages_list')) {
        $langues = pll_languages_list(array('fields' => 'slug'));
        if (is_array($langues) && count($langues) > 1) {
            // Une langue declaree sans une seule page publiee n'est pas une langue du site.
            $compte = wp_count_posts('page');
            $bilingue = isset($compte->publish) && $compte->publish > 0 && gf_pages_anglaises_existent();
        }
    }
    return $bilingue;
}

/**
 * Au moins une page publiee en anglais. Mesure, pas declaration.
 */
function gf_pages_anglaises_existent() {
    if (!function_exists('pll_get_post_language')) {
        return false;
    }
    // « lang » est l'argument que Polylang comprend, et c'est le seul qui marche ici.
    // « suppress_filters » ne le desarme PAS : il filtre par « pre_get_posts », si bien qu'une
    // requete lancee depuis une page francaise ne voyait que les pages francaises et concluait
    // que l'anglais n'existe pas. Mesure du 2026-09-24 : 7 pages vues sur 14, selecteur absent de
    // tout le site francais alors que les sept traductions etaient publiees (regle 42).
    $pages = get_posts(array(
        'post_type'   => 'page',
        'post_status' => 'publish',
        'numberposts' => 1,
        'fields'      => 'ids',
        'lang'        => 'en',
    ));
    return !empty($pages);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ce que le site dit, dans les deux langues
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le dictionnaire du site. Meme forme que celui du serveur : deux tableaux de cles identiques, et
 * un echec BRUYANT sur une cle inconnue — une cle affichee a un visiteur est un bogue qu'il vaut
 * mieux voir en recette qu'en production.
 */
function gf_i18n_dictionnaire() {
    static $d = null;
    if (null !== $d) {
        return $d;
    }
    $d = array(
        'fr' => array(
            'nav_accueil'      => 'Accueil',
            'nav_le_domaine'   => 'Le Domaine',
            'nav_autour'       => 'Autour de nous',
            'nav_contact'      => 'Accès & contact',
            'nav_reserver'     => 'Réserver',
            'nav_granja_note'  => 'le gîte · toute l’année · 10 personnes',
            'nav_estiva_note'  => 'la tente safari · avril à mi-octobre · 5 personnes',
            'langue_courante'  => 'FR',
            'langue_choisir'   => 'Changer de langue',
            'langue_francais'  => 'Français',
            'langue_anglais'   => 'English',
            'pied_manifeste'   => '« Treize hectares de silence. Deux hébergements. Et personne d’autre. »',
            'pied_cgv'         => 'Conditions générales',
            'pied_legal'       => '© 2026 Domaine Solio · Satillieu, Ardèche verte',

            // Les encadres factuels rendus par gf-seo-blocks.php. Les VALEURS vivent dans
            // gf-seo-facts.php a cote de leur jumelle francaise ; ici, seuls les libelles.
            'bloc_essentiel'   => 'L’essentiel',
            'bloc_equipements' => 'Équipements',
            'bloc_faq'         => 'Questions fréquentes',
            'fait_superficie'  => 'Superficie',
            'fait_arrivee'     => 'Arrivée / départ',
            'fait_saison'      => 'Saison',
            'fait_wifi'        => 'Wifi',
            'fait_animaux'     => 'Animaux',
            'fait_non_fumeur'  => 'Non-fumeur',
            'fait_accessibilite' => 'Accessibilité',
            'val_arrivee_entre' => 'entre %1$s et %2$s',
            'val_arrivee_des'  => 'à partir de %s',
            'val_depart_avant' => ', départ avant %s',
            'val_wifi_non'     => 'non — ici, on se connecte à la nature plutôt qu’à internet',
            'val_chiens_oui'   => 'chiens acceptés',
            'val_chiens_non'   => 'chiens non acceptés',
            'val_non_fumeur'   => 'oui, hébergement entièrement non-fumeur',
            'val_pmr_non'      => 'non adapté aux personnes à mobilité réduite',
            'val_prix_variable' => 'un tarif variable selon la saison',
        ),
        'en' => array(
            'nav_accueil'      => 'Home',
            'nav_le_domaine'   => 'The Estate',
            'nav_autour'       => 'Around us',
            'nav_contact'      => 'Getting here & contact',
            'nav_reserver'     => 'Book',
            'nav_granja_note'  => 'the gîte · all year round · 10 guests',
            'nav_estiva_note'  => 'the safari tent · April to mid-October · 5 guests',
            'langue_courante'  => 'EN',
            'langue_choisir'   => 'Change language',
            'langue_francais'  => 'Français',
            'langue_anglais'   => 'English',
            'pied_manifeste'   => '“Thirteen hectares of silence. Two places to stay. And nobody else.”',
            'pied_cgv'         => 'Terms and conditions',
            'pied_legal'       => '© 2026 Domaine Solio · Satillieu, Ardèche verte',

            'bloc_essentiel'   => 'The essentials',
            'bloc_equipements' => 'Facilities',
            'bloc_faq'         => 'Frequently asked questions',
            'fait_superficie'  => 'Floor area',
            'fait_arrivee'     => 'Check-in / check-out',
            'fait_saison'      => 'Season',
            'fait_wifi'        => 'Wifi',
            'fait_animaux'     => 'Pets',
            'fait_non_fumeur'  => 'Non-smoking',
            'fait_accessibilite' => 'Accessibility',
            'val_arrivee_entre' => 'between %1$s and %2$s',
            'val_arrivee_des'  => 'from %s',
            'val_depart_avant' => ', departure before %s',
            'val_wifi_non'     => 'no — here you connect to nature rather than to the internet',
            'val_chiens_oui'   => 'dogs welcome',
            'val_chiens_non'   => 'dogs not accepted',
            'val_non_fumeur'   => 'yes, entirely non-smoking',
            'val_pmr_non'      => 'not suitable for guests with reduced mobility',
            'val_prix_variable' => 'a rate that varies with the season',
        ),
    );
    return $d;
}

/**
 * Une chaine du site, dans la langue courante.
 *
 * @param string $cle
 * @param string|null $langue Force la langue ; sinon celle de la page.
 */
function gf_t($cle, $langue = null) {
    $d = gf_i18n_dictionnaire();
    $l = $langue ? gf_langue_normalisee($langue) : gf_langue();
    if (!isset($d[$l][$cle])) {
        if (defined('WP_DEBUG') && WP_DEBUG) {
            trigger_error(sprintf('gf_t: clé inconnue « %s » (%s)', $cle, $l), E_USER_WARNING);
        }
        return isset($d['fr'][$cle]) ? $d['fr'][$cle] : '';
    }
    return $d[$l][$cle];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Les adresses, d'une langue a l'autre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les chemins francais et leur equivalent anglais.
 *
 * Les slugs redactionnels se traduisent (regle 30, question 2 tranchee le 2026-09-24). Les noms
 * propres restent — mais ils ne peuvent pas rester SEULS : mesure du 2026-09-24, Polylang est
 * configure en repertoire avec la langue par defaut sans prefixe, et dans ce montage deux pages
 * qui portent le meme slug sont indissociables. « /en/contact/ » renvoyait un 301 vers la page
 * FRANCAISE. Chaque slug anglais est donc distinct du francais, et la ou un nom propre est en jeu
 * il est simplement qualifie : « la-granja-gite », « estiva-safari-tent » (regle 41).
 */
function gf_chemins_traduits() {
    return array(
        '/'                 => '/en/',
        '/la-granja/'       => '/en/la-granja-gite/',
        '/estiva/'          => '/en/estiva-safari-tent/',
        '/le-domaine/'      => '/en/the-estate/',
        '/autour-de-nous/'  => '/en/around-us/',
        '/contact/'         => '/en/getting-here/',
        '/cgv/'             => '/en/terms/',
    );
}

/**
 * La traduction de la page courante, ou l'accueil anglais a defaut.
 *
 * Jamais un 404, jamais une entree grisee sans explication : une page sans traduction envoie vers
 * l'accueil de l'autre langue, ce qui est au moins un endroit ou la suite existe.
 */
function gf_url_traduite($vers) {
    $vers = gf_langue_normalisee($vers);

    // Polylang sait faire mieux que n'importe quelle table, quand il est la.
    if (function_exists('pll_get_post') && is_singular()) {
        $id = get_queried_object_id();
        $traduit = pll_get_post($id, $vers);
        if ($traduit && 'publish' === get_post_status($traduit)) {
            return get_permalink($traduit);
        }
    }

    $chemin = '/' . ltrim((string) wp_parse_url(add_query_arg(array()), PHP_URL_PATH), '/');
    $table = gf_chemins_traduits();
    if ('en' === $vers && isset($table[$chemin])) {
        return home_url($table[$chemin]);
    }
    if ('fr' === $vers) {
        $inverse = array_flip($table);
        if (isset($inverse[$chemin])) {
            return home_url($inverse[$chemin]);
        }
    }
    return home_url('en' === $vers ? '/en/' : '/');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. La bascule automatique, a la premiere visite seulement
// ─────────────────────────────────────────────────────────────────────────────

const GF_COOKIE_LANGUE = 'gf_lang';

/**
 * Envoie un visiteur qui n'a jamais choisi vers la version de son navigateur.
 *
 * Huit conditions, et chacune repare un degat connu (§6) :
 *   1. le site a vraiment deux langues ;
 *   2. la requete est un GET de page, pas une API, pas l'administration ;
 *   3. le visiteur n'a jamais choisi (pas de cookie) ;
 *   4. ce n'est pas un robot — Googlebot doit recevoir l'URL demandee, sinon le maillage hreflang
 *      decrit un site qui repond autre chose ;
 *   5. l'URL ne porte AUCUN parametre — le retour de paiement Qonto revient en
 *      « /la-granja/?gf_payment=… », et une redirection qui perd ces parametres perd un client au
 *      milieu de son paiement ;
 *   6. la page a vraiment une traduction ;
 *   7. la langue visee differe de celle servie ;
 *   8. la reponse est un 302 avec « Vary », jamais un 301 : la correspondance est propre a chaque
 *      visiteur, mise en cache comme permanente elle servirait la langue de l'un au suivant.
 */
function gf_bascule_automatique() {
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
        return;
    }
    if (!isset($_SERVER['REQUEST_METHOD']) || 'GET' !== strtoupper((string) $_SERVER['REQUEST_METHOD'])) {
        return;
    }
    if (!gf_site_bilingue()) {
        return;
    }
    if (isset($_COOKIE[GF_COOKIE_LANGUE])) {
        return;
    }
    if (!empty($_GET)) {
        return;
    }
    if (gf_requete_de_robot()) {
        return;
    }

    $voulue = gf_langue_du_navigateur();
    if (null === $voulue || $voulue === gf_langue()) {
        return;
    }

    $cible = gf_url_traduite($voulue);
    $courante = home_url(add_query_arg(array()));
    if (!$cible || untrailingslashit($cible) === untrailingslashit($courante)) {
        return;
    }

    header('Vary: Accept-Language, Cookie', false);
    wp_redirect($cible, 302);
    exit;
}
add_action('template_redirect', 'gf_bascule_automatique', 1);

/**
 * La langue que le navigateur demande, reduite a ce que le site sait servir.
 *
 * **Une langue que le site ne parle pas donne l'anglais**, pas le francais (decide le 2026-09-24) :
 * un Allemand, un Neerlandais ou un Espagnol suivra bien plus volontiers l'anglais. Un navigateur
 * qui ne declare rien ne declenche rien — c'est souvent un outil, pas une personne.
 *
 * @return string|null « fr », « en », ou null quand rien n'est declare.
 */
function gf_langue_du_navigateur() {
    $entete = isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? (string) $_SERVER['HTTP_ACCEPT_LANGUAGE'] : '';
    $entete = trim($entete);
    if ('' === $entete) {
        return null;
    }
    // On ne lit que la premiere langue : celle que la personne a mise en tete est celle qu'elle veut.
    $premiere = trim(explode(',', $entete)[0]);
    $premiere = trim(explode(';', $premiere)[0]);
    if ('' === $premiere) {
        return null;
    }
    $base = strtolower(explode('-', str_replace('_', '-', $premiere))[0]);
    return 'fr' === $base ? 'fr' : 'en';
}

/**
 * Un robot connu. La liste est volontairement courte : elle sert a ne PAS rediriger, donc une
 * erreur par excès n'a aucun cout, et une erreur par defaut en a un.
 */
function gf_requete_de_robot() {
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? strtolower((string) $_SERVER['HTTP_USER_AGENT']) : '';
    if ('' === $ua) {
        return true;
    }
    foreach (array('bot', 'crawl', 'spider', 'slurp', 'facebookexternalhit', 'preview', 'headless', 'lighthouse', 'curl', 'wget', 'python-requests') as $marqueur) {
        if (false !== strpos($ua, $marqueur)) {
            return true;
        }
    }
    return false;
}

/**
 * Le choix du visiteur, retenu un an. Pose par le selecteur, jamais par la bascule automatique :
 * c'est ce qui fait la difference entre « on vous a propose » et « vous avez decide ».
 */
function gf_memorise_choix_langue() {
    if (is_admin() || !isset($_GET['gf_set_lang'])) {
        return;
    }
    $choix = gf_langue_normalisee(wp_unslash($_GET['gf_set_lang']));
    setcookie(GF_COOKIE_LANGUE, $choix, array(
        'expires'  => time() + YEAR_IN_SECONDS,
        'path'     => '/',
        'secure'   => is_ssl(),
        'httponly' => false,
        'samesite' => 'Lax',
    ));
    $_COOKIE[GF_COOKIE_LANGUE] = $choix;
}
add_action('init', 'gf_memorise_choix_langue', 1);

/**
 * Efface le jeton de l'adresse une fois le choix retenu.
 *
 * Sans cela chaque page traduite existerait en deux adresses — avec et sans « ?gf_set_lang » — et
 * les moteurs indexeraient la seconde. Le cookie est deja pose a ce stade : la redirection ne perd
 * rien, et elle est permanente parce que la page servie, elle, est bien la meme.
 */
function gf_nettoie_jeton_langue() {
    if (is_admin() || !isset($_GET['gf_set_lang'])) {
        return;
    }
    $propre = remove_query_arg('gf_set_lang', home_url(add_query_arg(array())));
    wp_redirect($propre, 301);
    exit;
}
add_action('template_redirect', 'gf_nettoie_jeton_langue', 0);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Le selecteur, dans l'en-tete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le selecteur de langue : un globe, la langue courante, un menu de deux entrees.
 *
 * Il n'invente rien — c'est le `.gf-dropdown` qui sert deja le menu « Reserver », avec ses marges,
 * son panneau et son repli en accordeon sur telephone. Une seule difference, voulue : sur telephone
 * il reste REPLIE par defaut, parce que la langue est un reglage que neuf visiteurs sur dix ne
 * touchent pas, alors que « Reserver » est la destination du menu (§6).
 *
 * Chaque entree est un vrai lien, nomme dans sa propre langue, avec `hreflang` et `aria-current` :
 * pas de drapeau — un drapeau nomme un pays, pas une langue, et la page anglaise sert bien au-dela
 * du Royaume-Uni.
 */
function gf_selecteur_langue_html() {
    if (!gf_site_bilingue()) {
        return '';
    }
    $courante = gf_langue();
    $icone = function_exists('gf_seo_icone') ? gf_seo_icone('globe', array('width' => 18, 'height' => 18)) : '';
    $chevron = function_exists('gf_seo_icone') ? gf_seo_icone('chevron', array('width' => 12, 'height' => 12, 'stroke' => 2, 'class' => 'gf-lang-chev')) : '';

    $entree = function ($code, $libelle) use ($courante) {
        $url = add_query_arg('gf_set_lang', $code, gf_url_traduite($code));
        return '<a href="' . esc_url($url) . '"'
            . ' lang="' . esc_attr($code) . '" hreflang="' . esc_attr($code) . '"'
            . ($code === $courante ? ' aria-current="page"' : '')
            . '>' . esc_html($libelle) . '</a>';
    };

    return '<div class="gf-dropdown gf-lang-dd" data-lang="' . esc_attr($courante) . '">'
        . '<span class="gf-dd-label gf-lang-label" role="button" tabindex="0"'
        . ' aria-expanded="false" aria-label="' . esc_attr(gf_t('langue_choisir')) . '">'
        . $icone . '<span>' . esc_html(gf_t('langue_courante')) . '</span>' . $chevron
        . '</span>'
        . '<div class="gf-dd-menu">'
        . $entree('fr', gf_t('langue_francais'))
        . $entree('en', gf_t('langue_anglais'))
        . '</div></div>';
}

/**
 * Pose le selecteur dans l'en-tete, juste avant « Reserver ».
 *
 * L'en-tete est du HTML fige dans une partie de modele : on le reecrit au rendu plutot que dans la
 * source, exactement comme la case du menu telephone (gf-site-style.php). La source peut etre
 * resauvegardee depuis l'administration sans rien perdre.
 */
add_filter('render_block', function ($html) {
    if (false === strpos($html, 'gf-nav') || false !== strpos($html, 'gf-lang-dd')) {
        return $html;
    }
    $selecteur = gf_selecteur_langue_html();
    if ('' === $selecteur) {
        return $html;
    }
    // Avant le menu « Reserver » : le bouton reste le dernier element de la barre, la ou l'oeil le
    // cherche. Sur telephone la feuille de style le remonte en tete du menu (ordre CSS).
    $pose = preg_replace('~(<div class="gf-dropdown gf-dd-right">)~', $selecteur . '$1', $html, 1);
    return null === $pose ? $html : $pose;
}, 6);

/**
 * Traduit la navigation de l'en-tete quand la page est anglaise.
 *
 * Les libelles ET les adresses : un menu anglais qui renvoie vers les pages francaises n'est pas un
 * menu anglais.
 */
add_filter('render_block', function ($html) {
    if ('en' !== gf_langue() || false === strpos($html, 'gf-nav')) {
        return $html;
    }
    $libelles = array(
        '>Accueil<'          => '>' . gf_t('nav_accueil') . '<',
        '>Le Domaine<'       => '>' . gf_t('nav_le_domaine') . '<',
        '>Autour de nous<'   => '>' . gf_t('nav_autour') . '<',
        '>Accès &amp; contact<' => '>' . gf_t('nav_contact') . '<',
        '>Accès & contact<'  => '>' . gf_t('nav_contact') . '<',
        '>R&eacute;server<'  => '>' . gf_t('nav_reserver') . '<',
        '>Réserver<'         => '>' . gf_t('nav_reserver') . '<',
        'le g&icirc;te &middot; toute l&rsquo;ann&eacute;e &middot; 10 personnes' => gf_t('nav_granja_note'),
        'la tente safari &middot; avril &agrave; mi-octobre &middot; 5 personnes' => gf_t('nav_estiva_note'),
    );
    $html = strtr($html, $libelles);

    // Les adresses suivent. Le plus long d'abord, sinon « / » avalerait tout le reste.
    $chemins = gf_chemins_traduits();
    uksort($chemins, function ($a, $b) { return strlen($b) - strlen($a); });
    foreach ($chemins as $fr => $en) {
        $html = str_replace('href="' . $fr . '"', 'href="' . $en . '"', $html);
        $html = str_replace('href="' . $fr . '#reserver"', 'href="' . $en . '#reserver"', $html);
    }
    return $html;
}, 7);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Le pied de page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traduit le pied de page, libelles et adresses.
 *
 * Meme mecanique que l'en-tete, et meme raison : le contenu est fige dans une partie de modele, en
 * base, donc on le reecrit au rendu. « Domaine Solio » et les noms des hebergements ne bougent pas
 * — ce sont des noms propres (regle 9).
 */
add_filter('render_block', function ($html) {
    if ('en' !== gf_langue() || false === strpos($html, 'gf-footer-links')) {
        return $html;
    }
    $html = strtr($html, array(
        '&laquo;&nbsp;Treize hectares de silence. Deux h&eacute;bergements. Et personne d&rsquo;autre.&nbsp;&raquo;' => esc_html(gf_t('pied_manifeste')),
        '>Le Domaine<'              => '>' . gf_t('nav_le_domaine') . '<',
        '>Acc&egrave;s &amp; contact<' => '>' . gf_t('nav_contact') . '<',
        '>Conditions g&eacute;n&eacute;rales<' => '>' . gf_t('pied_cgv') . '<',
    ));

    $chemins = gf_chemins_traduits();
    uksort($chemins, function ($a, $b) { return strlen($b) - strlen($a); });
    foreach ($chemins as $fr => $en) {
        $html = str_replace('href="' . $fr . '"', 'href="' . $en . '"', $html);
    }
    return $html;
}, 7);
