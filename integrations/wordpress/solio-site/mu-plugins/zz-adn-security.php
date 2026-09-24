<?php
/**
 * Plugin Name: ADN Security Hardening
 * Description: Durcissement WordPress — XML-RPC, énumération d'utilisateurs, Application Passwords, divulgation de version. Ajouté le 2026-08-24 (audit sécurité VM 103). Retirer ce seul fichier suffit à annuler.
 * Version: 1.0.0
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

/* 1. XML-RPC désactivé : supprime le SSRF via pingback et l'amplification
 *    brute-force (system.multicall). Aucun usage Jetpack/appli mobile ici. */
add_filter( 'xmlrpc_enabled', '__return_false' );
add_filter( 'xmlrpc_methods', function () { return array(); } );
add_filter( 'pings_open', '__return_false' );
add_filter( 'wp_headers', function ( $headers ) {
	unset( $headers['X-Pingback'] );
	return $headers;
} );

/* 2. Application Passwords désactivés (contournent la 2FA, brute-force REST). */
add_filter( 'wp_is_application_passwords_available', '__return_false' );

/* 3. Énumération d'utilisateurs via l'API REST fermée aux non-authentifiés.
 *    On ne retire QUE les routes /users — le reste de l'API REST (blocs,
 *    plugin de réservation) reste intact. */
add_filter( 'rest_endpoints', function ( $endpoints ) {
	if ( ! is_user_logged_in() ) {
		foreach ( array( '/wp/v2/users', '/wp/v2/users/(?P<id>[\d]+)' ) as $route ) {
			if ( isset( $endpoints[ $route ] ) ) {
				unset( $endpoints[ $route ] );
			}
		}
	}
	return $endpoints;
} );

/* 4. Énumération via ?author=N et les archives d'auteur fermées aux
 *    non-authentifiés (ils révélaient le login de l'administrateur). */
add_action( 'template_redirect', function () {
	if ( is_author() && ! is_user_logged_in() ) {
		wp_safe_redirect( home_url( '/' ), 301 );
		exit;
	}
} );
add_action( 'init', function () {
	if ( ! is_admin() && ! wp_doing_ajax() && isset( $_GET['author'] ) && ! is_user_logged_in() ) {
		wp_safe_redirect( home_url( '/' ), 301 );
		exit;
	}
} );
add_filter( 'wp_sitemaps_add_provider', function ( $provider, $name ) {
	return ( 'users' === $name ) ? false : $provider;
}, 10, 2 );

/* 5. Divulgation de version supprimée. */
remove_action( 'wp_head', 'wp_generator' );
add_filter( 'the_generator', '__return_empty_string' );

/* 6. Message de login générique : ne révèle pas si l'identifiant existe. */
add_filter( 'login_errors', function () {
	return __( 'Identifiants incorrects.', 'default' );
} );
