<?php
/**
 * Minimal WordPress and WooCommerce stand-ins for the woo-extension hidden tests.
 *
 * The goal is tolerance: a reasonable plugin should be able to call any common
 * WordPress or WooCommerce API it needs. Calls are recorded in $GLOBALS['bench']
 * so run.php can report observable behaviour (notices, options, output).
 * A call to a function that is not stubbed raises PHP's own "Call to undefined
 * function" Error, which run.php reports verbatim so the gap is visible.
 */

namespace {

	if ( ! defined( 'ABSPATH' ) ) {
		define( 'ABSPATH', __DIR__ . '/wp-root/' );
	}
	foreach ( array(
		'WPINC'               => 'wp-includes',
		'WP_CONTENT_DIR'      => ABSPATH . 'wp-content',
		'WP_PLUGIN_DIR'       => ABSPATH . 'wp-content/plugins',
		'WP_LANG_DIR'         => ABSPATH . 'wp-content/languages',
		'WP_DEBUG'            => false,
		'WC_VERSION'          => '10.2.0',
		'WC_PLUGIN_FILE'      => ABSPATH . 'wp-content/plugins/woocommerce/woocommerce.php',
		'WC_ABSPATH'          => ABSPATH . 'wp-content/plugins/woocommerce/',
		'MINUTE_IN_SECONDS'   => 60,
		'HOUR_IN_SECONDS'     => 3600,
		'DAY_IN_SECONDS'      => 86400,
		'WEEK_IN_SECONDS'     => 604800,
		'YEAR_IN_SECONDS'     => 31536000,
		'OBJECT'              => 'OBJECT',
		'ARRAY_A'             => 'ARRAY_A',
		'ARRAY_N'             => 'ARRAY_N',
		'COOKIEPATH'          => '/',
		'COOKIE_DOMAIN'       => '',
		'WP_DEFAULT_THEME'    => 'twentytwentyfive',
	) as $bench_const => $bench_value ) {
		if ( ! defined( $bench_const ) ) {
			define( $bench_const, $bench_value );
		}
	}

	$GLOBALS['bench'] = array(
		'filters'        => array(),
		'did'            => array(),
		'current'        => array(),
		'options'        => array(),
		'transients'     => array(),
		'notices'        => array(), // Current notice queue (like the WC session).
		'notice_log'     => array(), // Every notice ever added or printed.
		'warnings'       => array(),
		'user'           => null,
		'is_admin'       => false,
		'is_cart'        => false,
		'is_checkout'    => false,
		'cart'           => null,
		'activation'     => array(),
		'deactivation'   => array(),
		'uninstall'      => array(),
		'textdomains'    => array(),
		'menu_pages'     => array(),
		'redirects'      => array(),
		'nonce_checks'   => array(),
		'cap_checks'     => array(),
		'unknown_calls'  => array(),
		'features'       => array(),
		'registered'     => array(),
		'admin_messages' => array(),
	);

	/** Thrown by wp_die() and friends so run.php can continue. */
	class Bench_Wp_Die extends \Exception {}

	function bench_unknown( $what ) {
		$GLOBALS['bench']['unknown_calls'][ $what ] = true;
	}

	// ------------------------------------------------------------------ hooks.

	function _bench_cb_id( $cb ) {
		if ( is_string( $cb ) ) {
			return $cb;
		}
		if ( $cb instanceof \Closure ) {
			return 'closure#' . spl_object_id( $cb );
		}
		if ( is_object( $cb ) ) {
			return 'invokable#' . spl_object_id( $cb );
		}
		if ( is_array( $cb ) && 2 === count( $cb ) ) {
			$target = is_object( $cb[0] ) ? spl_object_id( $cb[0] ) : (string) $cb[0];
			return $target . '::' . $cb[1];
		}
		return serialize( $cb );
	}

	function add_filter( $tag, $cb, $priority = 10, $accepted = 1 ) {
		$GLOBALS['bench']['filters'][ $tag ][ (int) $priority ][ _bench_cb_id( $cb ) ] = array( $cb, (int) $accepted );
		return true;
	}
	function add_action( $tag, $cb, $priority = 10, $accepted = 1 ) {
		return add_filter( $tag, $cb, $priority, $accepted );
	}
	function has_filter( $tag, $cb = false ) {
		if ( empty( $GLOBALS['bench']['filters'][ $tag ] ) ) {
			return false;
		}
		if ( false === $cb ) {
			return true;
		}
		$id = _bench_cb_id( $cb );
		foreach ( $GLOBALS['bench']['filters'][ $tag ] as $priority => $cbs ) {
			if ( isset( $cbs[ $id ] ) ) {
				return $priority;
			}
		}
		return false;
	}
	function has_action( $tag, $cb = false ) {
		return has_filter( $tag, $cb );
	}
	function remove_filter( $tag, $cb, $priority = 10 ) {
		$id = _bench_cb_id( $cb );
		if ( isset( $GLOBALS['bench']['filters'][ $tag ][ (int) $priority ][ $id ] ) ) {
			unset( $GLOBALS['bench']['filters'][ $tag ][ (int) $priority ][ $id ] );
			return true;
		}
		return false;
	}
	function remove_action( $tag, $cb, $priority = 10 ) {
		return remove_filter( $tag, $cb, $priority );
	}
	function remove_all_filters( $tag, $priority = false ) {
		if ( false === $priority ) {
			unset( $GLOBALS['bench']['filters'][ $tag ] );
		} else {
			unset( $GLOBALS['bench']['filters'][ $tag ][ (int) $priority ] );
		}
		return true;
	}
	function remove_all_actions( $tag, $priority = false ) {
		return remove_all_filters( $tag, $priority );
	}

	function _bench_run_filters( $tag, array $args, $is_action ) {
		$GLOBALS['bench']['current'][] = $tag;
		$done                          = array();
		try {
			while ( true ) {
				$priorities = isset( $GLOBALS['bench']['filters'][ $tag ] ) ? array_keys( $GLOBALS['bench']['filters'][ $tag ] ) : array();
				sort( $priorities );
				$next = null;
				foreach ( $priorities as $p ) {
					foreach ( array_keys( $GLOBALS['bench']['filters'][ $tag ][ $p ] ) as $id ) {
						if ( ! isset( $done[ $p . '|' . $id ] ) ) {
							$next = array( $p, $id );
							break 2;
						}
					}
				}
				if ( null === $next ) {
					break;
				}
				$done[ $next[0] . '|' . $next[1] ] = true;
				list( $cb, $accepted )             = $GLOBALS['bench']['filters'][ $tag ][ $next[0] ][ $next[1] ];
				$result                            = call_user_func_array( $cb, array_slice( $args, 0, max( 0, $accepted ) ) );
				if ( ! $is_action ) {
					$args[0] = $result;
				}
			}
		} finally {
			array_pop( $GLOBALS['bench']['current'] );
		}
		return $args[0] ?? null;
	}
	function apply_filters( $tag, $value = null, ...$rest ) {
		$GLOBALS['bench']['did'][ 'filter:' . $tag ] = ( $GLOBALS['bench']['did'][ 'filter:' . $tag ] ?? 0 ) + 1;
		return _bench_run_filters( $tag, array_merge( array( $value ), $rest ), false );
	}
	function apply_filters_ref_array( $tag, $args ) {
		return apply_filters( $tag, ...$args );
	}
	function apply_filters_deprecated( $tag, $args, $version = '', $replacement = '', $message = '' ) {
		return apply_filters( $tag, ...$args );
	}
	function do_action( $tag, ...$args ) {
		$GLOBALS['bench']['did'][ $tag ] = ( $GLOBALS['bench']['did'][ $tag ] ?? 0 ) + 1;
		if ( empty( $args ) ) {
			$args = array( '' );
		}
		_bench_run_filters( $tag, $args, true );
	}
	function do_action_ref_array( $tag, $args ) {
		do_action( $tag, ...$args );
	}
	function do_action_deprecated( $tag, $args, $version = '', $replacement = '', $message = '' ) {
		do_action( $tag, ...$args );
	}
	function did_action( $tag ) {
		return $GLOBALS['bench']['did'][ $tag ] ?? 0;
	}
	function did_filter( $tag ) {
		return $GLOBALS['bench']['did'][ 'filter:' . $tag ] ?? 0;
	}
	function current_filter() {
		$c = $GLOBALS['bench']['current'];
		return $c ? end( $c ) : false;
	}
	function current_action() {
		return current_filter();
	}
	function doing_filter( $tag = null ) {
		if ( null === $tag ) {
			return ! empty( $GLOBALS['bench']['current'] );
		}
		return in_array( $tag, $GLOBALS['bench']['current'], true );
	}
	function doing_action( $tag = null ) {
		return doing_filter( $tag );
	}
	function __return_true() {
		return true;
	}
	function __return_false() {
		return false;
	}
	function __return_null() {
		return null;
	}
	function __return_zero() {
		return 0;
	}
	function __return_empty_array() {
		return array();
	}
	function __return_empty_string() {
		return '';
	}

	// --------------------------------------------------------- plugin API.

	function register_activation_hook( $file, $cb ) {
		$GLOBALS['bench']['activation'][] = $cb;
	}
	function register_deactivation_hook( $file, $cb ) {
		$GLOBALS['bench']['deactivation'][] = $cb;
	}
	function register_uninstall_hook( $file, $cb ) {
		$GLOBALS['bench']['uninstall'][] = $cb;
	}
	function plugin_basename( $file ) {
		$file = wp_normalize_path( $file );
		return basename( dirname( $file ) ) . '/' . basename( $file );
	}
	function plugin_dir_path( $file ) {
		return trailingslashit( dirname( $file ) );
	}
	function plugin_dir_url( $file ) {
		return trailingslashit( 'https://shop.example/wp-content/plugins/' . basename( dirname( $file ) ) );
	}
	function plugins_url( $path = '', $plugin = '' ) {
		$base = 'https://shop.example/wp-content/plugins';
		if ( $plugin ) {
			$base .= '/' . basename( dirname( $plugin ) );
		}
		return $base . ( $path ? '/' . ltrim( $path, '/' ) : '' );
	}
	function is_plugin_active( $plugin ) {
		return in_array( $plugin, (array) get_option( 'active_plugins', array() ), true );
	}
	function is_plugin_active_for_network( $plugin ) {
		return false;
	}
	function is_plugin_inactive( $plugin ) {
		return ! is_plugin_active( $plugin );
	}
	function get_file_data( $file, $headers, $context = '' ) {
		$data = is_readable( $file ) ? (string) file_get_contents( $file, false, null, 0, 8192 ) : '';
		$out  = array();
		foreach ( $headers as $key => $label ) {
			$out[ $key ] = preg_match( '/^(?:[ \t]*<\?php)?[ \t\/*#@]*' . preg_quote( $label, '/' ) . ':(.*)$/mi', $data, $m ) ? trim( preg_replace( '/\s*(?:\*\/|\?>).*/', '', $m[1] ) ) : '';
		}
		return $out;
	}
	function get_plugin_data( $file, $markup = true, $translate = true ) {
		return get_file_data(
			$file,
			array(
				'Name'        => 'Plugin Name',
				'Version'     => 'Version',
				'TextDomain'  => 'Text Domain',
				'DomainPath'  => 'Domain Path',
				'RequiresWP'  => 'Requires at least',
				'RequiresPHP' => 'Requires PHP',
			)
		);
	}
	function get_plugins( $folder = '' ) {
		return array( 'woocommerce/woocommerce.php' => array( 'Name' => 'WooCommerce', 'Version' => WC_VERSION ) );
	}
	function deactivate_plugins( $plugins, $silent = false, $network = null ) {
	}
	function load_plugin_textdomain( $domain, $deprecated = false, $path = false ) {
		$GLOBALS['bench']['textdomains'][] = $domain;
		return true;
	}
	function load_textdomain( $domain, $mofile, $locale = null ) {
		$GLOBALS['bench']['textdomains'][] = $domain;
		return true;
	}
	function unload_textdomain( $domain, $reloadable = false ) {
		return true;
	}
	function is_textdomain_loaded( $domain ) {
		return in_array( $domain, $GLOBALS['bench']['textdomains'], true );
	}
	function get_locale() {
		return 'en_US';
	}
	function get_user_locale( $user = 0 ) {
		return 'en_US';
	}
	function determine_locale() {
		return 'en_US';
	}
	function is_rtl() {
		return false;
	}

	// ------------------------------------------------------------- i18n.

	function translate( $text, $domain = 'default' ) {
		return $text;
	}
	function __( $text, $domain = 'default' ) {
		return $text;
	}
	function _e( $text, $domain = 'default' ) {
		echo $text;
	}
	function _x( $text, $context, $domain = 'default' ) {
		return $text;
	}
	function _ex( $text, $context, $domain = 'default' ) {
		echo $text;
	}
	function _n( $single, $plural, $number, $domain = 'default' ) {
		return 1 === (int) $number ? $single : $plural;
	}
	function _nx( $single, $plural, $number, $context, $domain = 'default' ) {
		return _n( $single, $plural, $number );
	}
	function _n_noop( $singular, $plural, $domain = null ) {
		return array( 0 => $singular, 1 => $plural, 'singular' => $singular, 'plural' => $plural, 'context' => null, 'domain' => $domain );
	}
	function _nx_noop( $singular, $plural, $context, $domain = null ) {
		return array( 0 => $singular, 1 => $plural, 'singular' => $singular, 'plural' => $plural, 'context' => $context, 'domain' => $domain );
	}
	function translate_nooped_plural( $nooped, $count, $domain = 'default' ) {
		return 1 === (int) $count ? $nooped['singular'] : $nooped['plural'];
	}
	function esc_html__( $text, $domain = 'default' ) {
		return esc_html( $text );
	}
	function esc_html_e( $text, $domain = 'default' ) {
		echo esc_html( $text );
	}
	function esc_html_x( $text, $context, $domain = 'default' ) {
		return esc_html( $text );
	}
	function esc_attr__( $text, $domain = 'default' ) {
		return esc_attr( $text );
	}
	function esc_attr_e( $text, $domain = 'default' ) {
		echo esc_attr( $text );
	}
	function esc_attr_x( $text, $context, $domain = 'default' ) {
		return esc_attr( $text );
	}
	function translate_user_role( $name, $domain = 'default' ) {
		return $name;
	}
	function number_format_i18n( $number, $decimals = 0 ) {
		return number_format( (float) $number, (int) $decimals );
	}

	// ------------------------------------------------- escaping, sanitising.

	function esc_html( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8', false );
	}
	function esc_attr( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8', false );
	}
	function esc_textarea( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
	}
	function esc_xml( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES | ENT_XML1, 'UTF-8', false );
	}
	function esc_js( $text ) {
		return addslashes( (string) $text );
	}
	function esc_url( $url, $protocols = null, $context = 'display' ) {
		return (string) $url;
	}
	function esc_url_raw( $url, $protocols = null ) {
		return (string) $url;
	}
	function sanitize_url( $url, $protocols = null ) {
		return (string) $url;
	}
	function esc_sql( $data ) {
		return is_array( $data ) ? array_map( 'esc_sql', $data ) : addslashes( (string) $data );
	}
	function tag_escape( $tag ) {
		return strtolower( preg_replace( '/[^a-zA-Z0-9_:]/', '', (string) $tag ) );
	}
	function wp_kses( $content, $allowed_html = array(), $allowed_protocols = array() ) {
		return (string) $content;
	}
	function wp_kses_post( $data ) {
		return (string) $data;
	}
	function wp_kses_data( $data ) {
		return (string) $data;
	}
	function wp_kses_post_deep( $data ) {
		return $data;
	}
	function wp_kses_allowed_html( $context = '' ) {
		return array(
			'span'   => array( 'class' => true ),
			'bdi'    => array(),
			'strong' => array(),
			'em'     => array(),
			'a'      => array( 'href' => true, 'class' => true ),
			'br'     => array(),
		);
	}
	function wp_strip_all_tags( $text, $remove_breaks = false ) {
		$text = preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $text );
		$text = strip_tags( $text );
		if ( $remove_breaks ) {
			$text = preg_replace( '/[\r\n\t ]+/', ' ', $text );
		}
		return trim( $text );
	}
	function sanitize_text_field( $str ) {
		if ( is_object( $str ) || is_array( $str ) ) {
			return '';
		}
		$str = wp_strip_all_tags( (string) $str );
		$str = preg_replace( '/[\r\n\t ]+/', ' ', $str );
		return trim( $str );
	}
	function sanitize_textarea_field( $str ) {
		return trim( wp_strip_all_tags( (string) $str ) );
	}
	function sanitize_key( $key ) {
		return is_scalar( $key ) ? preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) ) : '';
	}
	function sanitize_title( $title, $fallback = '', $context = 'save' ) {
		$t = trim( preg_replace( '/[^a-z0-9]+/', '-', strtolower( (string) $title ) ), '-' );
		return '' === $t ? $fallback : $t;
	}
	function sanitize_title_with_dashes( $title, $raw = '', $context = 'display' ) {
		return sanitize_title( $title );
	}
	function sanitize_html_class( $class, $fallback = '' ) {
		$c = preg_replace( '|%[a-fA-F0-9][a-fA-F0-9]|', '', (string) $class );
		$c = preg_replace( '/[^A-Za-z0-9_-]/', '', $c );
		return '' === $c ? $fallback : $c;
	}
	function sanitize_email( $email ) {
		return filter_var( $email, FILTER_SANITIZE_EMAIL );
	}
	function sanitize_file_name( $name ) {
		return preg_replace( '/[^A-Za-z0-9._-]/', '', (string) $name );
	}
	function sanitize_option( $option, $value ) {
		return apply_filters( "sanitize_option_{$option}", $value, $option, $value );
	}
	function absint( $n ) {
		return abs( (int) $n );
	}
	function wp_unslash( $value ) {
		return stripslashes_deep( $value );
	}
	function wp_slash( $value ) {
		return is_array( $value ) ? array_map( 'wp_slash', $value ) : ( is_string( $value ) ? addslashes( $value ) : $value );
	}
	function stripslashes_deep( $value ) {
		return map_deep(
			$value,
			function ( $v ) {
				return is_string( $v ) ? stripslashes( $v ) : $v;
			}
		);
	}
	function map_deep( $value, $cb ) {
		if ( is_array( $value ) ) {
			foreach ( $value as $k => $v ) {
				$value[ $k ] = map_deep( $v, $cb );
			}
			return $value;
		}
		if ( is_object( $value ) ) {
			foreach ( get_object_vars( $value ) as $k => $v ) {
				$value->$k = map_deep( $v, $cb );
			}
			return $value;
		}
		return call_user_func( $cb, $value );
	}
	function wp_parse_args( $args, $defaults = array() ) {
		if ( is_object( $args ) ) {
			$args = get_object_vars( $args );
		} elseif ( ! is_array( $args ) ) {
			parse_str( (string) $args, $args );
		}
		return is_array( $defaults ) && $defaults ? array_merge( $defaults, $args ) : $args;
	}
	function wp_parse_list( $list ) {
		return is_array( $list ) ? $list : preg_split( '/[\s,]+/', (string) $list, -1, PREG_SPLIT_NO_EMPTY );
	}
	function wp_list_pluck( $list, $field, $index_key = null ) {
		$out = array();
		foreach ( (array) $list as $k => $item ) {
			$v = is_object( $item ) ? ( $item->$field ?? null ) : ( $item[ $field ] ?? null );
			if ( null === $index_key ) {
				$out[ $k ] = $v;
			} else {
				$out[ is_object( $item ) ? $item->$index_key : $item[ $index_key ] ] = $v;
			}
		}
		return $out;
	}
	function wp_list_filter( $list, $args = array(), $operator = 'AND' ) {
		return array_filter(
			(array) $list,
			function ( $item ) use ( $args ) {
				foreach ( $args as $k => $v ) {
					$iv = is_object( $item ) ? ( $item->$k ?? null ) : ( $item[ $k ] ?? null );
					if ( $iv != $v ) { // phpcs:ignore
						return false;
					}
				}
				return true;
			}
		);
	}
	function wp_json_encode( $data, $options = 0, $depth = 512 ) {
		return json_encode( $data, $options, $depth );
	}
	function wp_normalize_path( $path ) {
		return preg_replace( '|(?<=.)/+|', '/', str_replace( '\\', '/', (string) $path ) );
	}
	function trailingslashit( $s ) {
		return untrailingslashit( $s ) . '/';
	}
	function untrailingslashit( $s ) {
		return rtrim( (string) $s, '/\\' );
	}
	function is_wp_error( $thing ) {
		return $thing instanceof WP_Error;
	}
	function wp_validate_boolean( $var ) {
		return is_bool( $var ) ? $var : ( is_string( $var ) && 'false' === strtolower( $var ) ? false : (bool) $var );
	}
	function selected( $selected, $current = true, $display = true ) {
		$r = ( (string) $selected === (string) $current ) ? " selected='selected'" : '';
		if ( $display ) {
			echo $r;
		}
		return $r;
	}
	function checked( $checked, $current = true, $display = true ) {
		$r = ( (string) $checked === (string) $current ) ? " checked='checked'" : '';
		if ( $display ) {
			echo $r;
		}
		return $r;
	}
	function disabled( $disabled, $current = true, $display = true ) {
		$r = ( (string) $disabled === (string) $current ) ? " disabled='disabled'" : '';
		if ( $display ) {
			echo $r;
		}
		return $r;
	}
	function _doing_it_wrong( $function, $message, $version ) {
		$GLOBALS['bench']['warnings'][] = "_doing_it_wrong: $function";
	}
	function _deprecated_function( $function, $version, $replacement = '' ) {
	}
	function _deprecated_argument( $function, $version, $message = '' ) {
	}
	function _deprecated_file( $file, $version, $replacement = '', $message = '' ) {
	}
	function _deprecated_hook( $hook, $version, $replacement = '', $message = '' ) {
	}

	// ----------------------------------------------------------- options.

	function get_option( $name, $default = false ) {
		$name = trim( (string) $name );
		$pre  = apply_filters( "pre_option_{$name}", false, $name, $default );
		if ( false !== $pre ) {
			return $pre;
		}
		if ( ! array_key_exists( $name, $GLOBALS['bench']['options'] ) ) {
			return apply_filters( "default_option_{$name}", $default, $name, func_num_args() > 1 );
		}
		return apply_filters( "option_{$name}", $GLOBALS['bench']['options'][ $name ], $name );
	}
	function update_option( $name, $value, $autoload = null ) {
		$name      = trim( (string) $name );
		$old       = get_option( $name );
		$value     = sanitize_option( $name, $value );
		$value     = apply_filters( "pre_update_option_{$name}", $value, $old, $name );
		$value     = apply_filters( 'pre_update_option', $value, $name, $old );
		$had       = array_key_exists( $name, $GLOBALS['bench']['options'] );
		if ( $had && $value === $old ) {
			return false;
		}
		$GLOBALS['bench']['options'][ $name ] = $value;
		do_action( $had ? "update_option_{$name}" : "add_option_{$name}", $had ? $old : $name, $value, $name );
		return true;
	}
	function add_option( $name, $value = '', $deprecated = '', $autoload = null ) {
		$name = trim( (string) $name );
		if ( array_key_exists( $name, $GLOBALS['bench']['options'] ) ) {
			return false;
		}
		$GLOBALS['bench']['options'][ $name ] = sanitize_option( $name, $value );
		return true;
	}
	function delete_option( $name ) {
		$name = trim( (string) $name );
		if ( ! array_key_exists( $name, $GLOBALS['bench']['options'] ) ) {
			return false;
		}
		unset( $GLOBALS['bench']['options'][ $name ] );
		return true;
	}
	function get_site_option( $name, $default = false, $deprecated = true ) {
		return get_option( $name, $default );
	}
	function update_site_option( $name, $value ) {
		return update_option( $name, $value );
	}
	function add_site_option( $name, $value ) {
		return add_option( $name, $value );
	}
	function delete_site_option( $name ) {
		return delete_option( $name );
	}
	function get_network_option( $network_id, $name, $default = false ) {
		return get_option( $name, $default );
	}
	function delete_network_option( $network_id, $name ) {
		return delete_option( $name );
	}
	function wp_load_alloptions( $force_cache = false ) {
		return $GLOBALS['bench']['options'];
	}
	function get_transient( $name ) {
		return $GLOBALS['bench']['transients'][ $name ] ?? false;
	}
	function set_transient( $name, $value, $expiration = 0 ) {
		$GLOBALS['bench']['transients'][ $name ] = $value;
		return true;
	}
	function delete_transient( $name ) {
		unset( $GLOBALS['bench']['transients'][ $name ] );
		return true;
	}
	function get_site_transient( $name ) {
		return get_transient( $name );
	}
	function set_site_transient( $name, $value, $expiration = 0 ) {
		return set_transient( $name, $value, $expiration );
	}
	function delete_site_transient( $name ) {
		return delete_transient( $name );
	}
	function wp_cache_get( $key, $group = '', $force = false, &$found = null ) {
		$found = false;
		return false;
	}
	function wp_cache_set( $key, $data, $group = '', $expire = 0 ) {
		return true;
	}
	function wp_cache_add( $key, $data, $group = '', $expire = 0 ) {
		return true;
	}
	function wp_cache_delete( $key, $group = '' ) {
		return true;
	}
	function wp_cache_flush() {
		return true;
	}
	function register_setting( $group, $name, $args = array() ) {
		$GLOBALS['bench']['registered'][ $name ] = $group;
		if ( is_callable( $args ) ) {
			$args = array( 'sanitize_callback' => $args );
		}
		if ( is_array( $args ) && ! empty( $args['sanitize_callback'] ) ) {
			add_filter( "sanitize_option_{$name}", $args['sanitize_callback'] );
		}
	}
	function unregister_setting( $group, $name, $deprecated = '' ) {
		unset( $GLOBALS['bench']['registered'][ $name ] );
	}

	// ------------------------------------------------------ multisite.

	function is_multisite() {
		return false;
	}
	function is_main_site( $site_id = null ) {
		return true;
	}
	function is_network_admin() {
		return false;
	}
	function get_current_blog_id() {
		return 1;
	}
	function get_sites( $args = array() ) {
		return array();
	}
	function switch_to_blog( $id ) {
		return true;
	}
	function restore_current_blog() {
		return true;
	}

	// --------------------------------------------------- users and roles.

	class WP_Role {
		public $name;
		public $capabilities;
		public function __construct( $role, $capabilities ) {
			$this->name         = $role;
			$this->capabilities = $capabilities;
		}
		public function has_cap( $cap ) {
			return ! empty( $this->capabilities[ $cap ] );
		}
		public function add_cap( $cap, $grant = true ) {
			$this->capabilities[ $cap ] = $grant;
		}
		public function remove_cap( $cap ) {
			unset( $this->capabilities[ $cap ] );
		}
	}

	class WP_Roles {
		public $roles;
		public $role_objects = array();
		public $role_names   = array();
		public $role_key     = 'wp_user_roles';
		public $use_db       = false;
		public function __construct() {
			$read          = array( 'read' => true );
			$editor        = array( 'read' => true, 'edit_posts' => true, 'edit_others_posts' => true, 'publish_posts' => true, 'moderate_comments' => true );
			$shop          = $editor + array( 'manage_woocommerce' => true, 'view_woocommerce_reports' => true, 'edit_products' => true );
			$admin         = $shop + array( 'manage_options' => true, 'activate_plugins' => true, 'delete_plugins' => true, 'install_plugins' => true, 'edit_users' => true, 'list_users' => true, 'promote_users' => true );
			$this->roles   = array(
				'administrator'      => array( 'name' => 'Administrator', 'capabilities' => $admin ),
				'editor'             => array( 'name' => 'Editor', 'capabilities' => $editor ),
				'author'             => array( 'name' => 'Author', 'capabilities' => array( 'read' => true, 'edit_posts' => true, 'publish_posts' => true ) ),
				'contributor'        => array( 'name' => 'Contributor', 'capabilities' => array( 'read' => true, 'edit_posts' => true ) ),
				'subscriber'         => array( 'name' => 'Subscriber', 'capabilities' => $read ),
				'customer'           => array( 'name' => 'Customer', 'capabilities' => $read ),
				'shop_manager'       => array( 'name' => 'Shop manager', 'capabilities' => $shop ),
				'wholesale_customer' => array( 'name' => 'Wholesale customer', 'capabilities' => $read ),
			);
			foreach ( $this->roles as $slug => $role ) {
				$this->role_objects[ $slug ] = new WP_Role( $slug, $role['capabilities'] );
				$this->role_names[ $slug ]   = $role['name'];
			}
		}
		public function get_names() {
			return $this->role_names;
		}
		public function get_role( $role ) {
			return $this->role_objects[ $role ] ?? null;
		}
		public function is_role( $role ) {
			return isset( $this->role_names[ $role ] );
		}
		public function add_role( $role, $display_name, $capabilities = array() ) {
			return null;
		}
		public function remove_role( $role ) {
		}
		public function for_site( $site_id = null ) {
		}
		public function get_site_id() {
			return 1;
		}
	}
	$GLOBALS['wp_roles'] = new WP_Roles();

	function wp_roles() {
		return $GLOBALS['wp_roles'];
	}
	function get_role( $role ) {
		return wp_roles()->get_role( $role );
	}
	function add_role( $role, $display_name, $capabilities = array() ) {
		return null;
	}
	function remove_role( $role ) {
	}
	function get_editable_roles() {
		return apply_filters( 'editable_roles', wp_roles()->roles );
	}

	class WP_User {
		public $ID         = 0;
		public $roles      = array();
		public $caps       = array();
		public $allcaps    = array();
		public $cap_key    = 'wp_capabilities';
		public $filter     = null;
		public $data;
		public function __construct( $id = 0, $roles = array() ) {
			$this->ID    = (int) $id;
			$this->roles = array_values( $roles );
			foreach ( $this->roles as $r ) {
				$this->caps[ $r ] = true;
				$role             = get_role( $r );
				if ( $role ) {
					$this->allcaps = array_merge( $this->allcaps, $role->capabilities );
				}
				$this->allcaps[ $r ] = true;
			}
			$this->data = (object) array(
				'ID'           => $this->ID,
				'user_login'   => $this->ID ? 'user' . $this->ID : '',
				'user_email'   => $this->ID ? 'user' . $this->ID . '@example.com' : '',
				'display_name' => $this->ID ? 'User ' . $this->ID : '',
				'user_nicename' => $this->ID ? 'user' . $this->ID : '',
			);
		}
		public function __get( $key ) {
			if ( 'id' === $key ) {
				return $this->ID;
			}
			return $this->data->$key ?? null;
		}
		public function __isset( $key ) {
			return isset( $this->data->$key );
		}
		public function exists() {
			return ! empty( $this->ID );
		}
		public function has_cap( $cap, ...$args ) {
			if ( in_array( 'administrator', $this->roles, true ) ) {
				return true;
			}
			return ! empty( $this->allcaps[ $cap ] );
		}
		public function get_role_caps() {
			return $this->allcaps;
		}
		public function add_role( $role ) {
		}
		public function remove_role( $role ) {
		}
		public function set_role( $role ) {
		}
		public function get( $key ) {
			return $this->__get( $key );
		}
		public function has_prop( $key ) {
			return isset( $this->data->$key );
		}
		public function to_array() {
			return get_object_vars( $this->data );
		}
	}

	function wp_get_current_user() {
		return $GLOBALS['bench']['user'] ?? new WP_User( 0, array() );
	}
	function _wp_get_current_user() {
		return wp_get_current_user();
	}
	function get_current_user_id() {
		return wp_get_current_user()->ID;
	}
	function is_user_logged_in() {
		return wp_get_current_user()->exists();
	}
	function current_user_can( $cap, ...$args ) {
		$GLOBALS['bench']['cap_checks'][] = $cap;
		return wp_get_current_user()->has_cap( $cap, ...$args );
	}
	function current_user_can_for_site( $site_id, $cap, ...$args ) {
		return current_user_can( $cap, ...$args );
	}
	function user_can( $user, $cap, ...$args ) {
		if ( ! is_object( $user ) ) {
			$user = get_userdata( $user );
		}
		return $user ? $user->has_cap( $cap ) : false;
	}
	function get_userdata( $id ) {
		$u = wp_get_current_user();
		return ( $u->exists() && (int) $id === $u->ID ) ? $u : false;
	}
	function get_user_by( $field, $value ) {
		$u = wp_get_current_user();
		if ( ! $u->exists() ) {
			return false;
		}
		if ( 'id' === strtolower( $field ) || 'ID' === $field ) {
			return (int) $value === $u->ID ? $u : false;
		}
		return false;
	}
	function get_user_meta( $user_id, $key = '', $single = false ) {
		return $single ? '' : array();
	}
	function update_user_meta( $user_id, $key, $value, $prev = '' ) {
		return true;
	}
	function add_user_meta( $user_id, $key, $value, $unique = false ) {
		return true;
	}
	function delete_user_meta( $user_id, $key, $value = '' ) {
		return true;
	}
	function delete_metadata( $type, $object_id, $key, $value = '', $delete_all = false ) {
		return true;
	}
	function get_users( $args = array() ) {
		return array();
	}

	// ----------------------------------------------------- nonces & admin.

	function wp_create_nonce( $action = -1 ) {
		return 'bench-valid-nonce';
	}
	function wp_verify_nonce( $nonce, $action = -1 ) {
		$GLOBALS['bench']['nonce_checks'][] = $action;
		return 'bench-valid-nonce' === $nonce ? 1 : false;
	}
	function wp_nonce_field( $action = -1, $name = '_wpnonce', $referer = true, $display = true ) {
		$html = '<input type="hidden" id="' . esc_attr( $name ) . '" name="' . esc_attr( $name ) . '" value="bench-valid-nonce" />';
		if ( $display ) {
			echo $html;
		}
		return $html;
	}
	function wp_nonce_url( $url, $action = -1, $name = '_wpnonce' ) {
		return add_query_arg( $name, 'bench-valid-nonce', $url );
	}
	function wp_referer_field( $display = true ) {
		return '';
	}
	function wp_get_referer() {
		return false;
	}
	function wp_get_raw_referer() {
		return false;
	}
	function check_admin_referer( $action = -1, $query_arg = '_wpnonce' ) {
		$nonce  = isset( $_REQUEST[ $query_arg ] ) ? wp_unslash( $_REQUEST[ $query_arg ] ) : '';
		$result = wp_verify_nonce( $nonce, $action );
		if ( ! $result ) {
			throw new Bench_Wp_Die( 'check_admin_referer failed for ' . $action );
		}
		return $result;
	}
	function check_ajax_referer( $action = -1, $query_arg = false, $stop = true ) {
		$nonce = '';
		foreach ( $query_arg ? array( $query_arg ) : array( '_ajax_nonce', '_wpnonce' ) as $k ) {
			if ( isset( $_REQUEST[ $k ] ) ) {
				$nonce = wp_unslash( $_REQUEST[ $k ] );
			}
		}
		$result = wp_verify_nonce( $nonce, $action );
		if ( ! $result && $stop ) {
			throw new Bench_Wp_Die( 'check_ajax_referer failed' );
		}
		return $result;
	}
	function wp_nonce_ays( $action ) {
		throw new Bench_Wp_Die( 'nonce ays' );
	}
	function wp_die( $message = '', $title = '', $args = array() ) {
		throw new Bench_Wp_Die( is_string( $message ) ? $message : 'wp_die' );
	}
	function wp_send_json( $response, $status_code = null, $options = 0 ) {
		echo wp_json_encode( $response );
		throw new Bench_Wp_Die( 'wp_send_json' );
	}
	function wp_send_json_success( $data = null, $status_code = null, $options = 0 ) {
		wp_send_json( array( 'success' => true, 'data' => $data ) );
	}
	function wp_send_json_error( $data = null, $status_code = null, $options = 0 ) {
		wp_send_json( array( 'success' => false, 'data' => $data ) );
	}
	function wp_safe_redirect( $location, $status = 302, $x_redirect_by = 'WordPress' ) {
		$GLOBALS['bench']['redirects'][] = $location;
		return true;
	}
	function wp_redirect( $location, $status = 302, $x_redirect_by = 'WordPress' ) {
		return wp_safe_redirect( $location, $status );
	}
	function wp_validate_redirect( $location, $fallback = '' ) {
		return $location;
	}
	function status_header( $code, $description = '' ) {
	}
	function nocache_headers() {
	}
	function is_admin() {
		return (bool) $GLOBALS['bench']['is_admin'];
	}
	function is_blog_admin() {
		return is_admin();
	}
	function is_user_admin() {
		return false;
	}
	function wp_doing_ajax() {
		return false;
	}
	function wp_doing_cron() {
		return false;
	}
	function wp_is_json_request() {
		return false;
	}
	function wp_is_rest_endpoint() {
		return false;
	}
	function is_ssl() {
		return true;
	}
	function wp_get_environment_type() {
		return 'production';
	}
	function admin_url( $path = '', $scheme = 'admin' ) {
		return 'https://shop.example/wp-admin/' . ltrim( (string) $path, '/' );
	}
	function get_admin_url( $blog_id = null, $path = '', $scheme = 'admin' ) {
		return admin_url( $path );
	}
	function network_admin_url( $path = '', $scheme = 'admin' ) {
		return admin_url( $path );
	}
	function self_admin_url( $path = '', $scheme = 'admin' ) {
		return admin_url( $path );
	}
	function home_url( $path = '', $scheme = null ) {
		return 'https://shop.example/' . ltrim( (string) $path, '/' );
	}
	function site_url( $path = '', $scheme = null ) {
		return home_url( $path );
	}
	function get_site_url( $blog_id = null, $path = '', $scheme = null ) {
		return home_url( $path );
	}
	function get_home_url( $blog_id = null, $path = '', $scheme = null ) {
		return home_url( $path );
	}
	function rest_url( $path = '', $scheme = 'rest' ) {
		return home_url( 'wp-json/' . ltrim( (string) $path, '/' ) );
	}
	function get_bloginfo( $show = '', $filter = 'raw' ) {
		$map = array( 'name' => 'Bench Shop', 'version' => '6.8', 'charset' => 'UTF-8', 'language' => 'en-US', 'url' => home_url(), 'wpurl' => home_url() );
		return $map[ $show ] ?? '';
	}
	function bloginfo( $show = '' ) {
		echo esc_html( get_bloginfo( $show ) );
	}
	function add_query_arg( ...$args ) {
		if ( is_array( $args[0] ) ) {
			$params = $args[0];
			$url    = $args[1] ?? '';
		} else {
			$params = array( $args[0] => $args[1] ?? '' );
			$url    = $args[2] ?? '';
		}
		$url = (string) $url;
		$q   = http_build_query( $params );
		return $q ? $url . ( false === strpos( $url, '?' ) ? '?' : '&' ) . $q : $url;
	}
	function remove_query_arg( $key, $query = false ) {
		return (string) $query;
	}
	function wp_parse_url( $url, $component = -1 ) {
		return parse_url( (string) $url, $component );
	}
	function current_time( $type, $gmt = 0 ) {
		return 'timestamp' === $type || 'U' === $type ? time() : gmdate( 'mysql' === $type ? 'Y-m-d H:i:s' : $type );
	}
	function wp_date( $format, $timestamp = null, $timezone = null ) {
		return gmdate( $format, $timestamp ?? time() );
	}
	function date_i18n( $format, $timestamp = false, $gmt = false ) {
		return gmdate( $format, $timestamp ? $timestamp : time() );
	}
	function add_menu_page( $page_title, $menu_title, $capability, $menu_slug, $cb = '', $icon = '', $position = null ) {
		$GLOBALS['bench']['menu_pages'][] = array( 'parent' => null, 'slug' => $menu_slug, 'cap' => $capability, 'cb' => $cb );
		return 'toplevel_page_' . $menu_slug;
	}
	function add_submenu_page( $parent, $page_title, $menu_title, $capability, $menu_slug, $cb = '', $position = null ) {
		$GLOBALS['bench']['menu_pages'][] = array( 'parent' => $parent, 'slug' => $menu_slug, 'cap' => $capability, 'cb' => $cb );
		return 'admin_page_' . $menu_slug;
	}
	function add_options_page( $page_title, $menu_title, $capability, $menu_slug, $cb = '', $position = null ) {
		return add_submenu_page( 'options-general.php', $page_title, $menu_title, $capability, $menu_slug, $cb );
	}
	function add_management_page( $page_title, $menu_title, $capability, $menu_slug, $cb = '', $position = null ) {
		return add_submenu_page( 'tools.php', $page_title, $menu_title, $capability, $menu_slug, $cb );
	}
	function remove_menu_page( $slug ) {
		return false;
	}
	function remove_submenu_page( $parent, $slug ) {
		return false;
	}
	function get_admin_page_title() {
		return '';
	}
	function get_current_screen() {
		return null;
	}
	function add_settings_section( $id, $title, $cb, $page, $args = array() ) {
	}
	function add_settings_field( $id, $title, $cb, $page, $section = 'default', $args = array() ) {
	}
	function settings_fields( $group ) {
		echo '<input type="hidden" name="option_page" value="' . esc_attr( $group ) . '" />';
		wp_nonce_field( "$group-options" );
	}
	function do_settings_sections( $page ) {
	}
	function do_settings_fields( $page, $section ) {
	}
	function add_settings_error( $setting, $code, $message, $type = 'error' ) {
		$GLOBALS['bench']['admin_messages'][] = array( 'type' => $type, 'text' => $message );
	}
	function get_settings_errors( $setting = '', $sanitize = false ) {
		return array();
	}
	function settings_errors( $setting = '', $sanitize = false, $hide_on_update = false ) {
	}
	function submit_button( $text = null, $type = 'primary', $name = 'submit', $wrap = true, $other = '' ) {
		echo '<button type="submit" name="' . esc_attr( $name ) . '">' . esc_html( $text ?? 'Save Changes' ) . '</button>';
	}
	function get_submit_button( $text = null, $type = 'primary', $name = 'submit', $wrap = true, $other = '' ) {
		return '<button type="submit" name="' . esc_attr( $name ) . '">' . esc_html( $text ?? 'Save Changes' ) . '</button>';
	}
	function wp_enqueue_script( ...$a ) {
	}
	function wp_enqueue_style( ...$a ) {
	}
	function wp_register_script( ...$a ) {
		return true;
	}
	function wp_register_style( ...$a ) {
		return true;
	}
	function wp_dequeue_script( ...$a ) {
	}
	function wp_dequeue_style( ...$a ) {
	}
	function wp_localize_script( ...$a ) {
		return true;
	}
	function wp_add_inline_script( ...$a ) {
		return true;
	}
	function wp_add_inline_style( ...$a ) {
		return true;
	}
	function wp_script_is( ...$a ) {
		return false;
	}
	function wp_style_is( ...$a ) {
		return false;
	}
	function wp_set_script_translations( ...$a ) {
		return true;
	}
	function add_shortcode( $tag, $cb ) {
	}
	function shortcode_exists( $tag ) {
		return false;
	}
	function flush_rewrite_rules( $hard = true ) {
	}
	function wp_next_scheduled( $hook, $args = array() ) {
		return false;
	}
	function wp_schedule_event( ...$a ) {
		return true;
	}
	function wp_schedule_single_event( ...$a ) {
		return true;
	}
	function wp_unschedule_event( ...$a ) {
		return true;
	}
	function wp_clear_scheduled_hook( ...$a ) {
		return 0;
	}
	function wp_unschedule_hook( ...$a ) {
		return 0;
	}
	function is_page( $page = '' ) {
		return false;
	}
	function is_front_page() {
		return false;
	}
	function is_home() {
		return false;
	}
	function is_singular( $types = '' ) {
		return false;
	}
	function is_single( $post = '' ) {
		return false;
	}
	function is_archive() {
		return false;
	}
	function is_search() {
		return false;
	}
	function is_404() {
		return false;
	}
	function is_feed( $feeds = '' ) {
		return false;
	}
	function is_customize_preview() {
		return false;
	}
	function get_the_ID() {
		return 0;
	}
	function get_permalink( $post = 0, $leavename = false ) {
		return home_url();
	}
	function has_block( $block, $post = null ) {
		return false;
	}

	class WP_Error {
		public $errors     = array();
		public $error_data = array();
		public function __construct( $code = '', $message = '', $data = '' ) {
			if ( '' !== $code ) {
				$this->add( $code, $message, $data );
			}
		}
		public function add( $code, $message, $data = '' ) {
			$this->errors[ $code ][] = $message;
			if ( '' !== $data ) {
				$this->error_data[ $code ] = $data;
			}
		}
		public function get_error_messages( $code = '' ) {
			if ( '' === $code ) {
				$all = array();
				foreach ( $this->errors as $messages ) {
					$all = array_merge( $all, $messages );
				}
				return $all;
			}
			return $this->errors[ $code ] ?? array();
		}
		public function get_error_message( $code = '' ) {
			$m = $this->get_error_messages( $code );
			return $m ? $m[0] : '';
		}
		public function get_error_codes() {
			return array_keys( $this->errors );
		}
		public function get_error_code() {
			$c = $this->get_error_codes();
			return $c ? $c[0] : '';
		}
		public function get_error_data( $code = '' ) {
			return $this->error_data[ $code ] ?? null;
		}
		public function has_errors() {
			return ! empty( $this->errors );
		}
		public function remove( $code ) {
			unset( $this->errors[ $code ] );
		}
	}

	/** A permissive $wpdb that understands simple option deletes. */
	class Bench_WPDB {
		public $prefix   = 'wp_';
		public $base_prefix = 'wp_';
		public $options  = 'wp_options';
		public $usermeta = 'wp_usermeta';
		public $postmeta = 'wp_postmeta';
		public $posts    = 'wp_posts';
		public $users    = 'wp_users';
		public $sitemeta = 'wp_sitemeta';
		public $blogid   = 1;
		public $last_error = '';
		public $insert_id  = 0;
		public $queries    = array();
		public function prepare( $query, ...$args ) {
			if ( isset( $args[0] ) && is_array( $args[0] ) ) {
				$args = $args[0];
			}
			$query = str_replace( array( '%s', '%d', '%f', '%i' ), array( "'%s'", '%d', '%F', '`%s`' ), $query );
			return vsprintf( $query, array_map( 'esc_sql', $args ) );
		}
		public function esc_like( $text ) {
			return addcslashes( (string) $text, '_%\\' );
		}
		public function query( $sql ) {
			$this->queries[] = $sql;
			if ( preg_match( "/DELETE\s+FROM\s+`?\w*options`?\s+WHERE\s+option_name\s+(LIKE|=)\s+'([^']*)'/i", (string) $sql, $m ) ) {
				$pattern = stripslashes( $m[2] );
				$n       = 0;
				foreach ( array_keys( $GLOBALS['bench']['options'] ) as $name ) {
					$hit = 'LIKE' === strtoupper( $m[1] )
						? preg_match( '/^' . str_replace( array( '%', '_' ), array( '.*', '.' ), preg_quote( str_replace( array( '\\%', '\\_' ), array( "\x01", "\x02" ), $pattern ), '/' ) ) . '$/', str_replace( array( '%', '_' ), array( "\x01", "\x02" ), $name ) )
						: $name === $pattern;
					if ( $hit ) {
						unset( $GLOBALS['bench']['options'][ $name ] );
						++$n;
					}
				}
				return $n;
			}
			return 0;
		}
		public function get_results( $sql = null, $output = OBJECT ) {
			$this->queries[] = $sql;
			return array();
		}
		public function get_col( $sql = null, $x = 0 ) {
			$this->queries[] = $sql;
			return array();
		}
		public function get_var( $sql = null, $x = 0, $y = 0 ) {
			$this->queries[] = $sql;
			return null;
		}
		public function get_row( $sql = null, $output = OBJECT, $y = 0 ) {
			$this->queries[] = $sql;
			return null;
		}
		public function delete( $table, $where, $format = null ) {
			if ( $table === $this->options && isset( $where['option_name'] ) ) {
				return delete_option( $where['option_name'] ) ? 1 : 0;
			}
			return 0;
		}
		public function insert( $table, $data, $format = null ) {
			return 1;
		}
		public function update( $table, $data, $where, $format = null, $where_format = null ) {
			return 1;
		}
		public function replace( $table, $data, $format = null ) {
			return 1;
		}
		public function get_charset_collate() {
			return '';
		}
		public function __call( $name, $args ) {
			bench_unknown( '$wpdb->' . $name );
			return null;
		}
	}
	$GLOBALS['wpdb'] = new Bench_WPDB();

	// --------------------------------------------------------- WooCommerce.

	class WC_Session_Handler {
		private $data = array();
		public function get( $key, $default = null ) {
			return $this->data[ $key ] ?? $default;
		}
		public function set( $key, $value ) {
			$this->data[ $key ] = $value;
		}
		public function __unset( $key ) {
			unset( $this->data[ $key ] );
		}
		public function has_session() {
			return true;
		}
		public function get_customer_id() {
			return (string) get_current_user_id();
		}
		public function __call( $name, $args ) {
			bench_unknown( 'WC()->session->' . $name );
			return null;
		}
	}

	class WC_Customer {
		public function get_id() {
			return get_current_user_id();
		}
		public function get_role() {
			$roles = wp_get_current_user()->roles;
			return $roles ? $roles[0] : '';
		}
		public function get_email( $context = 'view' ) {
			return wp_get_current_user()->user_email;
		}
		public function get_billing_email( $context = 'view' ) {
			return $this->get_email();
		}
		public function get_is_paying_customer( $context = 'view' ) {
			return false;
		}
		public function is_paying_customer() {
			return false;
		}
		public function get_billing_country( $context = 'view' ) {
			return 'US';
		}
		public function get_shipping_country( $context = 'view' ) {
			return 'US';
		}
		public function get_is_vat_exempt( $context = 'view' ) {
			return false;
		}
		public function is_vat_exempt() {
			return false;
		}
		public function get_meta( $key = '', $single = true, $context = 'view' ) {
			return $single ? '' : array();
		}
		public function __call( $name, $args ) {
			bench_unknown( 'WC()->customer->' . $name );
			return null;
		}
	}

	class WC_Cart {
		public $subtotal;
		public $subtotal_ex_tax;
		public $cart_contents_total;
		public $total;
		public $cart_contents_count;
		public $cart_contents = array();
		public $applied_coupons = array();
		public function __construct( $subtotal, $empty ) {
			$this->subtotal            = (float) $subtotal;
			$this->subtotal_ex_tax     = (float) $subtotal;
			$this->cart_contents_total = (float) $subtotal;
			$this->total               = (float) $subtotal;
			if ( ! $empty ) {
				$this->cart_contents = array(
					'bench-item' => array(
						'key'               => 'bench-item',
						'product_id'        => 42,
						'variation_id'      => 0,
						'quantity'          => 1,
						'line_subtotal'     => (float) $subtotal,
						'line_subtotal_tax' => 0.0,
						'line_total'        => (float) $subtotal,
						'line_tax'          => 0.0,
						'data'              => null,
					),
				);
			}
			$this->cart_contents_count = $empty ? 0 : 1;
		}
		public function get_subtotal() {
			return $this->subtotal;
		}
		public function get_subtotal_tax() {
			return 0.0;
		}
		public function get_displayed_subtotal() {
			return $this->subtotal;
		}
		public function get_cart_subtotal( $compound = false ) {
			return wc_price( $this->subtotal );
		}
		public function get_cart_contents_total() {
			return $this->cart_contents_total;
		}
		public function get_cart_contents_tax() {
			return 0.0;
		}
		public function get_cart_contents_taxes() {
			return array();
		}
		public function get_cart_contents_weight() {
			return 0.0;
		}
		public function get_total( $context = 'view' ) {
			return 'edit' === $context ? $this->total : wc_price( $this->total );
		}
		public function get_totals() {
			return array(
				'subtotal'            => $this->subtotal,
				'subtotal_tax'        => 0,
				'shipping_total'      => 0,
				'shipping_tax'        => 0,
				'discount_total'      => 0,
				'discount_tax'        => 0,
				'cart_contents_total' => $this->cart_contents_total,
				'cart_contents_tax'   => 0,
				'fee_total'           => 0,
				'fee_tax'             => 0,
				'total'               => $this->total,
				'total_tax'           => 0,
			);
		}
		public function get_discount_total() {
			return 0.0;
		}
		public function get_discount_tax() {
			return 0.0;
		}
		public function get_shipping_total() {
			return 0.0;
		}
		public function get_shipping_tax() {
			return 0.0;
		}
		public function get_fee_total() {
			return 0.0;
		}
		public function get_fee_tax() {
			return 0.0;
		}
		public function get_total_tax() {
			return 0.0;
		}
		public function get_taxes_total( $compound = true, $display = true ) {
			return 0.0;
		}
		public function get_fees() {
			return array();
		}
		public function get_cart() {
			return $this->cart_contents;
		}
		public function get_cart_contents() {
			return $this->cart_contents;
		}
		public function get_cart_contents_count() {
			return $this->cart_contents_count;
		}
		public function get_cart_item_quantities() {
			return $this->cart_contents ? array( 42 => 1 ) : array();
		}
		public function get_applied_coupons() {
			return array();
		}
		public function has_discount( $code = '' ) {
			return false;
		}
		public function is_empty() {
			return 0 === $this->cart_contents_count;
		}
		public function needs_shipping() {
			return false;
		}
		public function needs_payment() {
			return $this->total > 0;
		}
		public function display_prices_including_tax() {
			return false;
		}
		public function calculate_totals() {
		}
		public function check_cart_items() {
			do_action( 'woocommerce_check_cart_items' );
			return true;
		}
		public function get_tax_price_display_mode() {
			return 'excl';
		}
		public function get_customer() {
			return WC()->customer;
		}
		public function __get( $key ) {
			bench_unknown( 'WC()->cart->' . $key );
			return null;
		}
		public function __call( $name, $args ) {
			bench_unknown( 'WC()->cart->' . $name . '()' );
			return null;
		}
	}

	class WC_Logger_Bench {
		public function __call( $name, $args ) {
			return null;
		}
	}

	final class WooCommerce {
		public $version = WC_VERSION;
		public $cart;
		public $customer;
		public $session;
		public $countries;
		public $query;
		protected static $instance;
		public static function instance() {
			if ( ! self::$instance ) {
				self::$instance = new self();
			}
			return self::$instance;
		}
		public function plugin_path() {
			return untrailingslashit( WC_ABSPATH );
		}
		public function plugin_url() {
			return 'https://shop.example/wp-content/plugins/woocommerce';
		}
		public function template_path() {
			return 'woocommerce/';
		}
		public function is_rest_api_request() {
			return false;
		}
		public function initialize_cart() {
		}
		public function initialize_session() {
		}
		public function __get( $key ) {
			bench_unknown( 'WC()->' . $key );
			return null;
		}
		public function __call( $name, $args ) {
			bench_unknown( 'WC()->' . $name . '()' );
			return null;
		}
	}
	function WC() {
		return WooCommerce::instance();
	}

	// WooCommerce notices.
	function wc_add_notice( $message, $notice_type = 'success', $data = array() ) {
		$message                                     = apply_filters( 'woocommerce_add_' . $notice_type, $message );
		$GLOBALS['bench']['notices'][ $notice_type ][] = array( 'notice' => $message, 'data' => $data );
		$GLOBALS['bench']['notice_log'][]            = array( 'type' => $notice_type, 'text' => (string) $message, 'via' => 'wc_add_notice' );
	}
	function wc_print_notice( $message, $notice_type = 'success', $data = array(), $return = false ) {
		$GLOBALS['bench']['notice_log'][] = array( 'type' => $notice_type, 'text' => (string) $message, 'via' => 'wc_print_notice' );
		$html                             = '<div class="woocommerce-' . esc_attr( 'success' === $notice_type ? 'message' : $notice_type ) . '" role="alert">' . wc_kses_notice( $message ) . '</div>';
		if ( $return ) {
			return $html;
		}
		echo $html;
	}
	function wc_print_notices( $return = false ) {
		$html = '';
		foreach ( $GLOBALS['bench']['notices'] as $type => $notices ) {
			foreach ( $notices as $n ) {
				$html .= '<div class="woocommerce-' . esc_attr( $type ) . '">' . $n['notice'] . '</div>';
			}
		}
		$GLOBALS['bench']['notices'] = array();
		if ( $return ) {
			return $html;
		}
		echo $html;
	}
	function woocommerce_output_all_notices() {
		echo '<div class="woocommerce-notices-wrapper">';
		wc_print_notices();
		echo '</div>';
	}
	function wc_has_notice( $message, $notice_type = 'success' ) {
		foreach ( $GLOBALS['bench']['notices'][ $notice_type ] ?? array() as $n ) {
			if ( $n['notice'] === $message ) {
				return true;
			}
		}
		return false;
	}
	function wc_notice_count( $notice_type = '' ) {
		if ( '' === $notice_type ) {
			$c = 0;
			foreach ( $GLOBALS['bench']['notices'] as $list ) {
				$c += count( $list );
			}
			return $c;
		}
		return count( $GLOBALS['bench']['notices'][ $notice_type ] ?? array() );
	}
	function wc_get_notices( $notice_type = '' ) {
		return '' === $notice_type ? $GLOBALS['bench']['notices'] : ( $GLOBALS['bench']['notices'][ $notice_type ] ?? array() );
	}
	function wc_set_notices( $notices ) {
		$GLOBALS['bench']['notices'] = (array) $notices;
	}
	function wc_clear_notices() {
		$GLOBALS['bench']['notices'] = array();
	}
	function wc_kses_notice( $message ) {
		return (string) $message;
	}

	// WooCommerce conditionals and URLs.
	function is_cart() {
		return (bool) apply_filters( 'woocommerce_is_cart', $GLOBALS['bench']['is_cart'] );
	}
	function is_checkout() {
		return (bool) apply_filters( 'woocommerce_is_checkout', $GLOBALS['bench']['is_checkout'] || defined( 'WOOCOMMERCE_CHECKOUT' ) );
	}
	function is_checkout_pay_page() {
		return false;
	}
	function is_order_received_page() {
		return false;
	}
	function is_wc_endpoint_url( $endpoint = false ) {
		return false;
	}
	function is_woocommerce() {
		return false;
	}
	function is_shop() {
		return false;
	}
	function is_product() {
		return false;
	}
	function is_product_category( $term = '' ) {
		return false;
	}
	function is_product_tag( $term = '' ) {
		return false;
	}
	function is_product_taxonomy() {
		return false;
	}
	function is_account_page() {
		return false;
	}
	function is_ajax() {
		return false;
	}
	function is_store_notice_showing() {
		return false;
	}
	function wc_get_page_id( $page ) {
		$ids = array( 'cart' => 10, 'checkout' => 11, 'myaccount' => 12, 'shop' => 13 );
		return $ids[ $page ] ?? -1;
	}
	function wc_get_page_permalink( $page, $fallback = null ) {
		return home_url( $page . '/' );
	}
	function wc_get_cart_url() {
		return home_url( 'cart/' );
	}
	function wc_get_checkout_url() {
		return home_url( 'checkout/' );
	}
	function wc_get_account_endpoint_url( $endpoint ) {
		return home_url( 'my-account/' . $endpoint . '/' );
	}
	function wc_current_user_has_role( $role ) {
		return in_array( $role, wp_get_current_user()->roles, true );
	}
	function wc_user_has_role( $user, $role ) {
		if ( ! is_object( $user ) ) {
			$user = get_userdata( $user );
		}
		return $user && in_array( $role, $user->roles, true );
	}
	function wc_get_logger() {
		return new WC_Logger_Bench();
	}
	function wc_doing_it_wrong( $function, $message, $version ) {
		$GLOBALS['bench']['warnings'][] = "wc_doing_it_wrong: $function";
	}
	function wc_deprecated_function( $function, $version, $replacement = null ) {
	}
	function wc_get_template( $template_name, $args = array(), $template_path = '', $default_path = '' ) {
	}
	function wc_get_template_html( $template_name, $args = array(), $template_path = '', $default_path = '' ) {
		return '';
	}
	function wc_help_tip( $tip, $allow_html = false ) {
		return '<span class="woocommerce-help-tip" data-tip="' . esc_attr( $tip ) . '"></span>';
	}
	function wc_string_to_bool( $string ) {
		return is_bool( $string ) ? $string : ( 'yes' === strtolower( (string) $string ) || 1 === $string || 'true' === strtolower( (string) $string ) || '1' === $string );
	}
	function wc_bool_to_string( $bool ) {
		return true === $bool || 'yes' === $bool ? 'yes' : 'no';
	}
	function wc_clean( $var ) {
		if ( is_array( $var ) ) {
			return array_map( 'wc_clean', $var );
		}
		return is_scalar( $var ) ? sanitize_text_field( $var ) : $var;
	}
	function wc_sanitize_textarea( $var ) {
		return sanitize_textarea_field( $var );
	}
	function wc_sanitize_tooltip( $var ) {
		return htmlspecialchars( wp_kses( html_entity_decode( (string) $var ), array() ) );
	}
	function wc_tax_enabled() {
		return false;
	}
	function wc_prices_include_tax() {
		return false;
	}
	function wc_shipping_enabled() {
		return true;
	}
	function wc_coupons_enabled() {
		return true;
	}
	function wc_get_price_decimals() {
		return absint( apply_filters( 'wc_get_price_decimals', get_option( 'woocommerce_price_num_decimals', 2 ) ) );
	}
	function wc_get_price_decimal_separator() {
		return apply_filters( 'wc_get_price_decimal_separator', get_option( 'woocommerce_price_decimal_sep', '.' ) );
	}
	function wc_get_price_thousand_separator() {
		return apply_filters( 'wc_get_price_thousand_separator', get_option( 'woocommerce_price_thousand_sep', ',' ) );
	}
	function get_woocommerce_price_format() {
		return apply_filters( 'woocommerce_price_format', '%1$s%2$s', 'left' );
	}
	function get_woocommerce_currency() {
		return apply_filters( 'woocommerce_currency', get_option( 'woocommerce_currency', 'USD' ) );
	}
	function get_woocommerce_currencies() {
		return array( 'USD' => 'United States (US) dollar', 'EUR' => 'Euro', 'GBP' => 'Pound sterling' );
	}
	function get_woocommerce_currency_symbol( $currency = '' ) {
		$symbols = array( 'USD' => '&#36;', 'EUR' => '&euro;', 'GBP' => '&pound;' );
		$c       = $currency ? $currency : get_woocommerce_currency();
		return apply_filters( 'woocommerce_currency_symbol', $symbols[ $c ] ?? $c, $c );
	}
	function get_woocommerce_currency_symbols() {
		return array( 'USD' => '&#36;', 'EUR' => '&euro;', 'GBP' => '&pound;' );
	}
	function wc_price( $price, $args = array() ) {
		$args     = wp_parse_args(
			$args,
			array(
				'ex_tax_label'       => false,
				'currency'           => '',
				'decimal_separator'  => wc_get_price_decimal_separator(),
				'thousand_separator' => wc_get_price_thousand_separator(),
				'decimals'           => wc_get_price_decimals(),
				'price_format'       => get_woocommerce_price_format(),
			)
		);
		$original = $price;
		$price    = (float) ( is_numeric( $price ) ? $price : 0 );
		$negative = $price < 0;
		$number   = number_format( abs( $price ), (int) $args['decimals'], $args['decimal_separator'], $args['thousand_separator'] );
		$fmt      = ( $negative ? '-' : '' ) . sprintf( $args['price_format'], '<span class="woocommerce-Price-currencySymbol">' . get_woocommerce_currency_symbol( $args['currency'] ) . '</span>', $number );
		$html     = '<span class="woocommerce-Price-amount amount"><bdi>' . $fmt . '</bdi></span>';
		return apply_filters( 'wc_price', $html, $price, $args, $original, $original );
	}
	function wc_format_decimal( $number, $dp = false, $trim_zeros = false ) {
		if ( is_null( $number ) ) {
			$number = '';
		}
		if ( ! is_float( $number ) ) {
			$number = wc_clean( str_replace( array( wc_get_price_decimal_separator() ), '.', (string) $number ) );
			$number = preg_replace( '/[^0-9\.\-]/', '', $number );
		}
		if ( false !== $dp && '' !== $number ) {
			$number = number_format( floatval( $number ), (int) $dp, '.', '' );
		} elseif ( is_float( $number ) ) {
			$number = rtrim( rtrim( sprintf( '%.' . wc_get_price_decimals() . 'F', $number ), '0' ), '.' );
		}
		if ( $trim_zeros && false !== strpos( (string) $number, '.' ) ) {
			$number = rtrim( rtrim( $number, '0' ), '.' );
		}
		return $number;
	}
	function wc_format_localized_price( $value ) {
		return str_replace( '.', wc_get_price_decimal_separator(), (string) $value );
	}
	function wc_format_localized_decimal( $value ) {
		return wc_format_localized_price( $value );
	}
	function wc_add_number_precision( $value, $round = true ) {
		$v = (float) $value * 100;
		return $round ? round( $v ) : $v;
	}
	function wc_remove_number_precision( $value ) {
		return (float) $value / 100;
	}
	function wc_round_tax_total( $value, $precision = null ) {
		return round( (float) $value, 2 );
	}
	function wc_get_container() {
		bench_unknown( 'wc_get_container' );
		return null;
	}
	function woocommerce_admin_fields( $options ) {
		WC_Admin_Settings::output_fields( $options );
	}
	function woocommerce_update_options( $options, $data = null ) {
		return WC_Admin_Settings::save_fields( $options, $data );
	}
	function woocommerce_settings_get_option( $option_name, $default = '' ) {
		return WC_Admin_Settings::get_option( $option_name, $default );
	}

	/** Mirrors the parts of WC_Admin_Settings used by extensions. */
	class WC_Admin_Settings {
		public static function get_option( $option_name, $default = '' ) {
			if ( ! $option_name ) {
				return $default;
			}
			if ( false !== strpos( $option_name, '[' ) ) {
				parse_str( $option_name, $option_array );
				$option_name = current( array_keys( $option_array ) );
				$values      = get_option( $option_name, '' );
				$key         = key( $option_array[ $option_name ] );
				$value       = ( is_array( $values ) && isset( $values[ $key ] ) ) ? $values[ $key ] : null;
			} else {
				$value = get_option( $option_name, null );
			}
			if ( is_array( $value ) ) {
				$value = wp_unslash( $value );
			} elseif ( ! is_null( $value ) ) {
				$value = stripslashes( (string) $value );
			}
			return null === $value ? $default : $value;
		}

		public static function output_fields( $options ) {
			foreach ( (array) $options as $value ) {
				if ( ! isset( $value['type'] ) ) {
					continue;
				}
				$value = wp_parse_args( $value, array( 'id' => '', 'title' => '', 'class' => '', 'css' => '', 'default' => '', 'desc' => '', 'desc_tip' => false, 'placeholder' => '', 'custom_attributes' => array() ) );
				if ( ! isset( $value['value'] ) ) {
					$value['value'] = self::get_option( $value['id'], $value['default'] );
				}
				$name = $value['field_name'] ?? $value['id'];
				switch ( $value['type'] ) {
					case 'title':
						if ( ! empty( $value['title'] ) ) {
							echo '<h2>' . esc_html( $value['title'] ) . '</h2>';
						}
						if ( ! empty( $value['desc'] ) ) {
							echo '<p>' . wp_kses_post( $value['desc'] ) . '</p>';
						}
						echo '<table class="form-table">';
						break;
					case 'sectionend':
						echo '</table>';
						break;
					case 'text':
					case 'password':
					case 'datetime':
					case 'datetime-local':
					case 'date':
					case 'month':
					case 'time':
					case 'week':
					case 'number':
					case 'email':
					case 'url':
					case 'tel':
					case 'color':
					case 'price':
					case 'decimal':
						echo '<tr><th><label for="' . esc_attr( $value['id'] ) . '">' . esc_html( $value['title'] ) . '</label></th><td><input name="' . esc_attr( $name ) . '" id="' . esc_attr( $value['id'] ) . '" type="' . esc_attr( $value['type'] ) . '" value="' . esc_attr( is_scalar( $value['value'] ) ? $value['value'] : '' ) . '" /></td></tr>';
						break;
					case 'textarea':
						echo '<tr><td><textarea name="' . esc_attr( $name ) . '">' . esc_textarea( $value['value'] ) . '</textarea></td></tr>';
						break;
					case 'select':
					case 'multiselect':
						echo '<tr><td><select name="' . esc_attr( $name ) . ( 'multiselect' === $value['type'] ? '[]' : '' ) . '">';
						foreach ( (array) ( $value['options'] ?? array() ) as $k => $label ) {
							echo '<option value="' . esc_attr( $k ) . '">' . esc_html( is_scalar( $label ) ? $label : '' ) . '</option>';
						}
						echo '</select></td></tr>';
						break;
					case 'radio':
						foreach ( (array) ( $value['options'] ?? array() ) as $k => $label ) {
							echo '<input type="radio" name="' . esc_attr( $name ) . '" value="' . esc_attr( $k ) . '" />';
						}
						break;
					case 'checkbox':
						echo '<tr><td><input name="' . esc_attr( $name ) . '" type="checkbox" value="1" /></td></tr>';
						break;
					case 'info':
						echo '<tr><td>' . wp_kses_post( $value['text'] ?? '' ) . '</td></tr>';
						break;
					default:
						do_action( 'woocommerce_admin_field_' . $value['type'], $value );
						break;
				}
			}
		}

		public static function save_fields( $options, $data = null ) {
			if ( is_null( $data ) ) {
				$data = $_POST; // phpcs:ignore
			}
			if ( empty( $data ) ) {
				return false;
			}
			$update_options = array();
			foreach ( (array) $options as $option ) {
				if ( ! isset( $option['id'] ) || ! isset( $option['type'] ) || ( isset( $option['is_option'] ) && false === $option['is_option'] ) ) {
					continue;
				}
				$option_name = $option['field_name'] ?? $option['id'];
				if ( false !== strpos( $option_name, '[' ) ) {
					parse_str( $option_name, $option_name_array );
					$option_name  = current( array_keys( $option_name_array ) );
					$setting_name = key( $option_name_array[ $option_name ] );
					$raw_value    = isset( $data[ $option_name ][ $setting_name ] ) ? wp_unslash( $data[ $option_name ][ $setting_name ] ) : null;
				} else {
					$setting_name = '';
					$raw_value    = isset( $data[ $option_name ] ) ? wp_unslash( $data[ $option_name ] ) : null;
				}
				switch ( $option['type'] ) {
					case 'checkbox':
						$value = '1' === $raw_value || 'yes' === $raw_value ? 'yes' : 'no';
						break;
					case 'textarea':
						$value = wp_kses_post( trim( (string) $raw_value ) );
						break;
					case 'multiselect':
					case 'multi_select_countries':
						$value = array_filter( array_map( 'wc_clean', (array) $raw_value ) );
						break;
					case 'select':
						$allowed = empty( $option['options'] ) ? array() : array_map( 'strval', array_keys( $option['options'] ) );
						if ( empty( $option['default'] ) && empty( $allowed ) ) {
							$value = null;
							break;
						}
						$default = empty( $option['default'] ) ? $allowed[0] : $option['default'];
						$value   = in_array( $raw_value, $allowed, true ) ? $raw_value : $default;
						break;
					default:
						$value = wc_clean( $raw_value );
						break;
				}
				$value = apply_filters( 'woocommerce_admin_settings_sanitize_option', $value, $option, $raw_value );
				$value = apply_filters( "woocommerce_admin_settings_sanitize_option_$option_name", $value, $option, $raw_value );
				if ( is_null( $value ) ) {
					continue;
				}
				if ( $option_name && $setting_name ) {
					if ( ! isset( $update_options[ $option_name ] ) ) {
						$update_options[ $option_name ] = get_option( $option_name, array() );
					}
					if ( ! is_array( $update_options[ $option_name ] ) ) {
						$update_options[ $option_name ] = array();
					}
					$update_options[ $option_name ][ $setting_name ] = $value;
				} else {
					$update_options[ $option_name ] = $value;
				}
				do_action( 'woocommerce_update_option', $option );
			}
			foreach ( $update_options as $name => $value ) {
				update_option( $name, $value );
			}
			return true;
		}

		public static function add_message( $text ) {
			$GLOBALS['bench']['admin_messages'][] = array( 'type' => 'updated', 'text' => $text );
		}
		public static function add_error( $text ) {
			$GLOBALS['bench']['admin_messages'][] = array( 'type' => 'error', 'text' => $text );
		}
		public static function show_messages() {
		}
		public static function get_settings_pages() {
			return $GLOBALS['bench_settings_pages'] ?? array();
		}
	}

	/** Mirrors WC_Settings_Page (WooCommerce 8–10) closely enough for subclasses. */
	abstract class WC_Settings_Page {
		protected $id    = '';
		protected $label = '';
		public function __construct() {
			add_filter( 'woocommerce_settings_tabs_array', array( $this, 'add_settings_page' ), 20 );
			add_action( 'woocommerce_sections_' . $this->id, array( $this, 'output_sections' ) );
			add_action( 'woocommerce_settings_' . $this->id, array( $this, 'output' ) );
			add_action( 'woocommerce_settings_save_' . $this->id, array( $this, 'save' ) );
		}
		public function get_id() {
			return $this->id;
		}
		public function get_label() {
			return $this->label;
		}
		public function add_settings_page( $pages ) {
			$pages[ $this->id ] = $this->label;
			return $pages;
		}
		public function get_settings_for_section( $section_id ) {
			$method = '' === $section_id ? 'get_settings_for_default_section' : "get_settings_for_{$section_id}_section";
			if ( method_exists( $this, $method ) ) {
				$settings = $this->$method();
			} else {
				$settings = $this->get_settings_for_section_core( $section_id );
			}
			return apply_filters( 'woocommerce_get_settings_' . $this->id, $settings, $section_id );
		}
		protected function get_settings_for_section_core( $section_id ) {
			return array();
		}
		public function get_settings( $section_id = null ) {
			if ( null === $section_id ) {
				$section_id = $GLOBALS['current_section'] ?? '';
			}
			return $this->get_settings_for_section( (string) $section_id );
		}
		public function get_sections() {
			return apply_filters( 'woocommerce_get_sections_' . $this->id, $this->get_own_sections() );
		}
		protected function get_own_sections() {
			return array( '' => 'General' );
		}
		public function output_sections() {
			$sections = $this->get_sections();
			if ( count( $sections ) < 2 ) {
				return;
			}
			echo '<ul class="subsubsub">';
			foreach ( $sections as $id => $label ) {
				echo '<li><a href="' . esc_url( admin_url( 'admin.php?page=wc-settings&tab=' . $this->id . '&section=' . sanitize_title( $id ) ) ) . '">' . esc_html( $label ) . '</a></li>';
			}
			echo '</ul>';
		}
		public function output() {
			$settings = $this->get_settings( $GLOBALS['current_section'] ?? '' );
			WC_Admin_Settings::output_fields( $settings );
		}
		public function save() {
			$this->save_settings_for_current_section();
			$this->do_update_options_action();
		}
		protected function save_settings_for_current_section() {
			$settings = $this->get_settings( $GLOBALS['current_section'] ?? '' );
			WC_Admin_Settings::save_fields( $settings );
		}
		protected function do_update_options_action( $section_id = null ) {
			if ( null === $section_id ) {
				$section_id = $GLOBALS['current_section'] ?? '';
			}
			if ( $section_id ) {
				do_action( 'woocommerce_update_options_' . $this->id . '_' . $section_id );
			}
		}
	}

	/** Minimal WC_Settings_API / WC_Integration so subclasses can be declared. */
	abstract class WC_Settings_API {
		public $plugin_id   = 'woocommerce_';
		public $id          = '';
		public $errors      = array();
		public $settings    = array();
		public $form_fields = array();
		protected $data     = array();
		public function get_form_fields() {
			return apply_filters( 'woocommerce_settings_api_form_fields_' . $this->id, array_map( array( $this, 'set_defaults' ), $this->form_fields ) );
		}
		protected function set_defaults( $field ) {
			return $field;
		}
		public function get_option_key() {
			return $this->plugin_id . $this->id . '_settings';
		}
		public function init_settings() {
			$this->settings = get_option( $this->get_option_key(), array() );
		}
		public function get_option( $key, $empty_value = null ) {
			if ( empty( $this->settings ) ) {
				$this->init_settings();
			}
			return $this->settings[ $key ] ?? $empty_value;
		}
		public function update_option( $key, $value = '' ) {
			$this->settings[ $key ] = $value;
			return update_option( $this->get_option_key(), $this->settings );
		}
		public function process_admin_options() {
			return true;
		}
		public function admin_options() {
		}
		public function generate_settings_html( $form_fields = array(), $echo = true ) {
			return '';
		}
		public function get_field_key( $key ) {
			return $this->plugin_id . $this->id . '_' . $key;
		}
		public function get_post_data() {
			return $_POST; // phpcs:ignore
		}
		public function add_error( $error ) {
			$this->errors[] = $error;
		}
		public function get_errors() {
			return $this->errors;
		}
	}
	abstract class WC_Integration extends WC_Settings_API {
		public $enabled            = 'yes';
		public $method_title       = '';
		public $method_description = '';
		public function get_method_title() {
			return $this->method_title;
		}
		public function get_method_description() {
			return $this->method_description;
		}
	}
}

namespace Automattic\WooCommerce\Utilities {
	class FeaturesUtil {
		public static function declare_compatibility( $feature_id, $plugin_file, $positive_compatibility = true ) {
			$GLOBALS['bench']['features'][ $feature_id ] = (bool) $positive_compatibility;
			return true;
		}
		public static function feature_is_enabled( $feature_id ) {
			return false;
		}
	}
	class OrderUtil {
		public static function custom_orders_table_usage_is_enabled() {
			return false;
		}
	}
}

namespace Automattic\WooCommerce\StoreApi\Exceptions {
	class RouteException extends \Exception {
		public $error_code;
		public $additional_data;
		public function __construct( $error_code = '', $message = '', $http_status_code = 400, $additional_data = array() ) {
			$this->error_code      = $error_code;
			$this->additional_data = $additional_data;
			parent::__construct( $message, $http_status_code );
		}
	}
}
