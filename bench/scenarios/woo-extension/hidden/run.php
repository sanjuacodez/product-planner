<?php
/**
 * Hidden-test runner for the woo-extension scenario.
 *
 * Reads a JSON spec on STDIN:
 *   {
 *     "target":  "/abs/path/min-order-by-role/min-order-by-role.php",
 *     "context": "load" | "cart" | "checkout" | "admin-render" | "admin-save" | "activate" | "uninstall",
 *     "options": { "option_name": value, ... },
 *     "user":    null | { "id": 7, "roles": ["customer"] },
 *     "cart":    { "subtotal": 49.99, "empty": false },
 *     "post":    { ... }            // admin-save only
 *   }
 * Prints "@@BENCH_RESULT@@" followed by one JSON object (see bench_finish()).
 * Everything the plugin echoes is captured in "output", never mixed into the JSON.
 */

error_reporting( E_ALL );
ini_set( 'display_errors', 'stderr' );

$bench_spec = json_decode( (string) stream_get_contents( STDIN ), true );
if ( ! is_array( $bench_spec ) || empty( $bench_spec['target'] ) ) {
	fwrite( STDERR, "run.php: expected a JSON spec with a target on STDIN\n" );
	exit( 2 );
}
$bench_target  = $bench_spec['target'];
$bench_context = $bench_spec['context'] ?? 'load';

require __DIR__ . '/wp-stubs.php';

$GLOBALS['bench_result'] = array(
	'context'         => $bench_context,
	'loaded'          => false,
	'errors'          => array(), // PHP Errors (fatal: undefined function, type errors ...).
	'exceptions'      => array(), // Exceptions thrown by hook callbacks outside checkout.
	'checkout_errors' => array(), // Error notices / WP_Error messages / exceptions during checkout.
	'died'            => array(),
	'targets'         => array(),
	'tabs'            => array(),
	'output'          => '',
);

/** Records PHP warnings and notices raised inside the plugin folder (never fatal). */
set_error_handler(
	function ( $errno, $errstr, $errfile, $errline ) use ( $bench_target ) {
		$dir = dirname( realpath( $bench_target ) ? realpath( $bench_target ) : $bench_target );
		if ( 0 === strpos( (string) realpath( $errfile ), $dir ) ) {
			$GLOBALS['bench']['warnings'][] = basename( $errfile ) . ':' . $errline . ' ' . $errstr;
		}
		return true;
	}
);

/** Runs a step; records Errors and Exceptions without stopping the run. */
function bench_try( $label, callable $fn, $checkout = false ) {
	try {
		$fn();
	} catch ( Bench_Wp_Die $e ) {
		$GLOBALS['bench_result']['died'][] = $label . ': ' . $e->getMessage();
		if ( $checkout ) {
			$GLOBALS['bench_result']['checkout_errors'][] = array( 'via' => 'wp_die', 'text' => $e->getMessage() );
		}
	} catch ( \Exception $e ) {
		if ( $checkout ) {
			// WC_Checkout::process_checkout() turns exceptions into error notices.
			$GLOBALS['bench_result']['checkout_errors'][] = array( 'via' => 'exception', 'text' => $e->getMessage() );
		} else {
			$GLOBALS['bench_result']['exceptions'][] = $label . ': ' . get_class( $e ) . ': ' . $e->getMessage();
		}
	} catch ( \Throwable $e ) {
		$GLOBALS['bench_result']['errors'][] = $label . ': ' . get_class( $e ) . ': ' . $e->getMessage() . ' at ' . basename( $e->getFile() ) . ':' . $e->getLine();
	}
}

/** Prints the result. Registered as a shutdown function so exit() in the plugin still reports. */
function bench_finish() {
	$out = '';
	while ( ob_get_level() > 0 ) {
		$out = ob_get_clean() . $out;
	}
	$err = error_get_last();
	if ( $err && in_array( $err['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR ), true ) ) {
		$GLOBALS['bench_result']['errors'][] = 'fatal: ' . $err['message'] . ' at ' . basename( $err['file'] ) . ':' . $err['line'];
	}
	$r                  = $GLOBALS['bench_result'];
	$r['output']        = $out;
	$r['notices']       = $GLOBALS['bench']['notice_log'];
	$r['options']       = (object) $GLOBALS['bench']['options'];
	$r['warnings']      = $GLOBALS['bench']['warnings'];
	$r['unknown_calls'] = array_keys( $GLOBALS['bench']['unknown_calls'] );
	$r['redirects']     = $GLOBALS['bench']['redirects'];
	$r['features']      = (object) $GLOBALS['bench']['features'];
	$r['menu_pages']    = array_map(
		function ( $p ) {
			unset( $p['cb'] );
			return $p;
		},
		$GLOBALS['bench']['menu_pages']
	);
	$r['admin_messages'] = $GLOBALS['bench']['admin_messages'];
	$r['baseline_options'] = $GLOBALS['bench_baseline_options'] ?? array();
	$r['did']            = (object) array_filter(
		$GLOBALS['bench']['did'],
		function ( $k ) {
			return 0 !== strpos( $k, 'filter:' );
		},
		ARRAY_FILTER_USE_KEY
	);
	echo "\n@@BENCH_RESULT@@" . json_encode( $r, JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE ) . "\n";
}
register_shutdown_function( 'bench_finish' );
ob_start();

// ------------------------------------------------------------------ state.

/** Adds slashes like WordPress's wp_magic_quotes(). */
function bench_slash( $value ) {
	if ( is_array( $value ) ) {
		return array_map( 'bench_slash', $value );
	}
	return is_string( $value ) ? addslashes( $value ) : $value;
}

$GLOBALS['bench']['options'] = array_merge(
	array(
		'active_plugins'                => array( 'woocommerce/woocommerce.php', plugin_basename( $bench_target ) ),
		'woocommerce_currency'          => 'USD',
		'woocommerce_currency_pos'      => 'left',
		'woocommerce_price_num_decimals' => '2',
		'woocommerce_price_decimal_sep' => '.',
		'woocommerce_price_thousand_sep' => ',',
		'blogname'                      => 'Bench Shop',
		'siteurl'                       => 'https://shop.example',
		'home'                          => 'https://shop.example',
		'WPLANG'                        => '',
	),
	(array) ( $bench_spec['options'] ?? array() )
);
$GLOBALS['bench_baseline_options'] = array_keys( $GLOBALS['bench']['options'] );

if ( ! empty( $bench_spec['user'] ) ) {
	$GLOBALS['bench']['user'] = new WP_User( (int) ( $bench_spec['user']['id'] ?? 7 ), (array) ( $bench_spec['user']['roles'] ?? array() ) );
}

$bench_is_admin_context        = in_array( $bench_context, array( 'admin-render', 'admin-save', 'activate' ), true );
$GLOBALS['bench']['is_admin']  = $bench_is_admin_context;
$GLOBALS['bench']['is_cart']   = 'cart' === $bench_context;
$GLOBALS['bench']['is_checkout'] = 'checkout' === $bench_context;
if ( 'checkout' === $bench_context ) {
	define( 'WOOCOMMERCE_CHECKOUT', true );
}
WC()->session  = new WC_Session_Handler();
WC()->customer = new WC_Customer();
if ( ! $bench_is_admin_context ) {
	$cart      = (array) ( $bench_spec['cart'] ?? array() );
	WC()->cart = new WC_Cart( $cart['subtotal'] ?? 0, ! empty( $cart['empty'] ) );
}
$_GET     = array();
$_POST    = array();
$_REQUEST = array();
$_COOKIE  = array();
$_SERVER  = array_merge( $_SERVER, array( 'REQUEST_METHOD' => 'GET', 'HTTP_HOST' => 'shop.example', 'REQUEST_URI' => '/' ) );
if ( $bench_is_admin_context ) {
	$_GET['page']        = 'wc-settings';
	$_SERVER['REQUEST_URI'] = '/wp-admin/admin.php?page=wc-settings';
	$GLOBALS['pagenow']  = 'admin.php';
	$GLOBALS['plugin_page'] = 'wc-settings';
}
$GLOBALS['current_tab']     = '';
$GLOBALS['current_section'] = '';

// -------------------------------------------------------- uninstall path.

if ( 'uninstall' === $bench_context ) {
	$bench_uninstall_file = dirname( $bench_target ) . '/uninstall.php';
	$GLOBALS['bench']['is_admin'] = true;
	if ( is_file( $bench_uninstall_file ) ) {
		define( 'WP_UNINSTALL_PLUGIN', plugin_basename( $bench_target ) );
		$GLOBALS['bench_result']['uninstall_via'] = 'uninstall.php';
		try {
			include $bench_uninstall_file;
		} catch ( \Throwable $e ) {
			$GLOBALS['bench_result']['errors'][] = 'uninstall.php: ' . get_class( $e ) . ': ' . $e->getMessage();
		}
	} else {
		try {
			include $bench_target;
			$GLOBALS['bench_result']['loaded'] = true;
		} catch ( \Throwable $e ) {
			$GLOBALS['bench_result']['errors'][] = 'include: ' . get_class( $e ) . ': ' . $e->getMessage();
		}
		foreach ( $GLOBALS['bench']['activation'] as $cb ) {
			bench_try( 'activation', function () use ( $cb ) { call_user_func( $cb, false ); } );
		}
		$GLOBALS['bench_result']['uninstall_via'] = $GLOBALS['bench']['uninstall'] ? 'register_uninstall_hook' : 'none';
		foreach ( $GLOBALS['bench']['uninstall'] as $cb ) {
			bench_try( 'uninstall hook', function () use ( $cb ) { call_user_func( $cb ); } );
		}
	}
	exit( 0 );
}

// --------------------------------------------------------- load plugin.

try {
	include $bench_target;
	$GLOBALS['bench_result']['loaded'] = true;
} catch ( \Throwable $e ) {
	$GLOBALS['bench_result']['errors'][] = 'include: ' . get_class( $e ) . ': ' . $e->getMessage() . ' at ' . basename( $e->getFile() ) . ':' . $e->getLine();
}

if ( 'activate' === $bench_context ) {
	foreach ( $GLOBALS['bench']['activation'] as $cb ) {
		bench_try( 'activation', function () use ( $cb ) { call_user_func( $cb, false ); } );
	}
}

foreach ( array( 'plugins_loaded', 'woocommerce_loaded', 'setup_theme', 'after_setup_theme', 'before_woocommerce_init', 'init', 'woocommerce_init', 'wp_loaded' ) as $bench_hook ) {
	bench_try( $bench_hook, function () use ( $bench_hook ) { do_action( $bench_hook ); } );
}

// ---------------------------------------------------------- front end.

/** Fires a list of hooks; the checkout flag routes exceptions to checkout_errors. */
function bench_fire( array $hooks, $checkout = false ) {
	foreach ( $hooks as $hook ) {
		bench_try( $hook, function () use ( $hook ) { do_action( $hook ); }, $checkout );
	}
}

if ( 'cart' === $bench_context ) {
	bench_fire( array( 'parse_request', 'wp', 'template_redirect', 'wp_enqueue_scripts', 'wp_head' ) );
	// WC_Shortcode_Cart::output() runs the cart checks, then the cart template renders.
	bench_fire(
		array(
			'woocommerce_check_cart_items',
			'woocommerce_before_cart',
			'woocommerce_before_cart_table',
			'woocommerce_before_cart_contents',
			'woocommerce_cart_contents',
			'woocommerce_after_cart_contents',
			'woocommerce_after_cart_table',
			'woocommerce_cart_collaterals',
			'woocommerce_before_cart_totals',
			'woocommerce_cart_totals_before_order_total',
			'woocommerce_cart_totals_after_order_total',
			'woocommerce_proceed_to_checkout',
			'woocommerce_after_cart_totals',
			'woocommerce_after_cart',
		)
	);
	bench_try( 'woocommerce_output_all_notices', 'woocommerce_output_all_notices' );
	bench_fire( array( 'wp_footer' ) );
}

if ( 'checkout' === $bench_context ) {
	// Mirrors WC_Checkout::process_checkout() for the classic (shortcode) checkout.
	$_SERVER['REQUEST_METHOD'] = 'POST';
	bench_fire( array( 'woocommerce_before_checkout_process', 'woocommerce_checkout_process' ), true );
	bench_fire( array( 'woocommerce_check_cart_items' ), true );
	$bench_wp_error = new WP_Error();
	bench_try(
		'woocommerce_after_checkout_validation',
		function () use ( $bench_wp_error ) {
			do_action( 'woocommerce_after_checkout_validation', array( 'billing_email' => 'buyer@example.com', 'payment_method' => 'cod' ), $bench_wp_error );
		},
		true
	);
	foreach ( $bench_wp_error->get_error_messages() as $bench_msg ) {
		$GLOBALS['bench_result']['checkout_errors'][] = array( 'via' => 'WP_Error', 'text' => $bench_msg );
	}
	foreach ( $GLOBALS['bench']['notice_log'] as $bench_n ) {
		if ( 'error' === $bench_n['type'] && 'wc_add_notice' === $bench_n['via'] ) {
			$GLOBALS['bench_result']['checkout_errors'][] = array( 'via' => 'wc_add_notice', 'text' => $bench_n['text'] );
		}
	}
}

// ---------------------------------------------------------------- admin.

/** Built-in WooCommerce settings pages and their own sections. */
function bench_builtin_pages() {
	$defs  = array(
		'general'     => array( 'General', array( '' => 'General' ) ),
		'products'    => array( 'Products', array( '' => 'General', 'inventory' => 'Inventory', 'downloadable' => 'Downloadable products' ) ),
		'tax'         => array( 'Tax', array( '' => 'Tax options' ) ),
		'shipping'    => array( 'Shipping', array( '' => 'Shipping zones', 'options' => 'Shipping settings', 'classes' => 'Classes' ) ),
		'checkout'    => array( 'Payments', array( '' => 'Payment methods' ) ),
		'account'     => array( 'Accounts & Privacy', array( '' => 'General' ) ),
		'email'       => array( 'Emails', array( '' => 'Email options' ) ),
		'integration' => array( 'Integration', array( '' => 'Integration' ) ),
		'advanced'    => array( 'Advanced', array( '' => 'Page setup', 'keys' => 'REST API', 'webhooks' => 'Webhooks' ) ),
	);
	$pages = array();
	foreach ( $defs as $id => $def ) {
		$pages[] = new class( $id, $def[0], $def[1] ) extends WC_Settings_Page {
			private $bench_sections;
			public function __construct( $id, $label, $sections ) {
				$this->id             = $id;
				$this->label          = $label;
				$this->bench_sections = $sections;
				parent::__construct();
			}
			protected function get_own_sections() {
				return $this->bench_sections;
			}
		};
	}
	return array( $defs, $pages );
}

/** Works out which settings tabs/sections the plugin contributed. */
function bench_settings_targets() {
	list( $defs, $builtins ) = bench_builtin_pages();
	$pages                   = apply_filters( 'woocommerce_get_settings_pages', $builtins );
	$GLOBALS['bench_settings_pages'] = $pages;
	$by_id                   = array();
	foreach ( (array) $pages as $page ) {
		if ( $page instanceof WC_Settings_Page ) {
			$by_id[ $page->get_id() ] = $page;
		}
	}
	$tabs                           = (array) apply_filters( 'woocommerce_settings_tabs_array', array() );
	$GLOBALS['bench_result']['tabs'] = array_keys( $tabs );
	$targets                        = array();
	foreach ( array_keys( $tabs ) as $tab ) {
		$tab      = (string) $tab;
		$sections = isset( $by_id[ $tab ] ) ? $by_id[ $tab ]->get_sections() : apply_filters( 'woocommerce_get_sections_' . $tab, array() );
		$sections = is_array( $sections ) && $sections ? array_keys( $sections ) : array( '' );
		if ( ! in_array( '', $sections, true ) ) {
			array_unshift( $sections, '' );
		}
		$builtin = isset( $defs[ $tab ] ) ? array_keys( $defs[ $tab ][1] ) : null;
		foreach ( $sections as $section ) {
			$section = (string) $section;
			if ( null === $builtin || ! in_array( $section, array_map( 'strval', $builtin ), true ) ) {
				$targets[] = array( $tab, $section );
			}
		}
	}
	return $targets;
}

function bench_select_target( $tab, $section ) {
	$GLOBALS['current_tab']     = $tab;
	$GLOBALS['current_section'] = $section;
	$_GET['tab']                = $tab;
	$_GET['section']            = $section;
	$_REQUEST['tab']            = $tab;
	$_REQUEST['section']        = $section;
}

if ( $bench_is_admin_context ) {
	if ( 'admin-save' === $bench_context ) {
		$_SERVER['REQUEST_METHOD'] = 'POST';
		$_POST                     = bench_slash( (array) ( $bench_spec['post'] ?? array() ) );
		$_POST['save']             = 'Save changes';
		$_POST['_wpnonce']         = 'bench-valid-nonce';
		$_POST['_wp_http_referer'] = '/wp-admin/admin.php?page=wc-settings';
		$_REQUEST                  = array_merge( $_GET, $_POST );
	}
	bench_fire( array( 'admin_menu', 'admin_init', 'current_screen', 'admin_enqueue_scripts' ) );
	$bench_targets = array();
	bench_try(
		'settings pages',
		function () use ( &$bench_targets ) {
			$bench_targets = bench_settings_targets();
		}
	);
	$GLOBALS['bench_result']['targets'] = array_map(
		function ( $t ) {
			return $t[0] . ( '' === $t[1] ? '' : '/' . $t[1] );
		},
		$bench_targets
	);

	foreach ( $bench_targets as $bench_t ) {
		list( $bench_tab, $bench_section ) = $bench_t;
		bench_select_target( $bench_tab, $bench_section );
		if ( 'admin-render' === $bench_context ) {
			// Mirrors html-admin-settings.php.
			bench_fire( array( 'woocommerce_settings_start', 'woocommerce_sections_' . $bench_tab, 'woocommerce_settings_' . $bench_tab, 'woocommerce_settings_tabs_' . $bench_tab ) );
		} else {
			// Mirrors WC_Admin_Menus::save_settings() + WC_Admin_Settings::save().
			bench_try( 'check_admin_referer', function () { check_admin_referer( 'woocommerce-settings' ); } );
			bench_fire( array( 'woocommerce_settings_save_' . $bench_tab, 'woocommerce_update_options_' . $bench_tab, 'woocommerce_update_options', 'woocommerce_settings_saved' ) );
		}
	}
	if ( 'admin-render' === $bench_context ) {
		bench_fire( array( 'admin_notices', 'admin_footer' ) );
	}
}

exit( 0 );
