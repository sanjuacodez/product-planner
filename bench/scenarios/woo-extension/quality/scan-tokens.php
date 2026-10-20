<?php
/**
 * Extracts security-relevant facts from a plugin folder with PHP's tokenizer.
 * Used by security-scan.js; prints one JSON document on stdout.
 *
 * Usage: php scan-tokens.php <plugin-dir>
 *
 * This is a heuristic, not a parser for every PHP construct: see the scenario README for limits.
 */

error_reporting( E_ALL & ~E_DEPRECATED );

$root = isset( $argv[1] ) ? rtrim( $argv[1], '/' ) : '';
if ( '' === $root || ! is_dir( $root ) ) {
	fwrite( STDERR, "scan-tokens.php: plugin directory not found: $root\n" );
	exit( 2 );
}

const SKIP_DIRS = array( 'vendor', 'node_modules', 'tests', 'test', '.git', '.github', 'bin' );

const ESCAPERS = array(
	'esc_html', 'esc_attr', 'esc_url', 'esc_js', 'esc_textarea', 'esc_xml', 'esc_html__', 'esc_attr__', 'esc_html_x', 'esc_attr_x',
	'wp_kses', 'wp_kses_post', 'wp_kses_data', 'wp_kses_one_attr', 'absint', 'intval', 'floatval', 'boolval', 'count',
	'number_format', 'number_format_i18n', 'wp_json_encode', 'json_encode', 'wc_help_tip', 'wc_price', 'wc_kses_notice',
	'sanitize_html_class', 'tag_escape', 'get_submit_button', 'wp_nonce_field', 'selected', 'checked', 'disabled', 'esc_url_raw',
	'wc_esc_json', 'zeroise', 'get_avatar', 'wp_readonly',
);
const SANITIZERS = array(
	'sanitize_text_field', 'sanitize_textarea_field', 'sanitize_key', 'sanitize_title', 'sanitize_title_with_dashes', 'sanitize_email',
	'sanitize_file_name', 'sanitize_html_class', 'sanitize_user', 'sanitize_url', 'sanitize_option', 'sanitize_meta', 'sanitize_hex_color',
	'sanitize_hex_color_no_hash', 'sanitize_mime_type', 'sanitize_sql_orderby', 'sanitize_term_field', 'absint', 'intval', 'floatval',
	'boolval', 'is_numeric', 'wc_clean', 'wc_sanitize_textarea', 'wc_format_decimal', 'wc_sanitize_order_id', 'wc_string_to_bool',
	'wp_kses', 'wp_kses_post', 'wp_kses_data', 'esc_url_raw', 'filter_var', 'filter_input', 'in_array', 'array_key_exists',
	'wp_verify_nonce', 'check_admin_referer', 'check_ajax_referer', 'map_deep', 'array_map', 'rest_sanitize_boolean', 'wp_validate_boolean',
	'ctype_digit', 'ctype_alnum', 'preg_match', 'is_email', 'wc_bool_to_string', 'wc_format_localized_price', 'wc_get_post_data_by_key',
	'wp_unslash_deep_sanitize',
);
const VALIDATORS = array( 'isset', 'empty', 'array_key_exists' );
const GETTEXT_DOMAIN_ARG = array(
	'__' => 1, '_e' => 1, 'esc_html__' => 1, 'esc_html_e' => 1, 'esc_attr__' => 1, 'esc_attr_e' => 1, 'translate' => 1,
	'_x' => 2, '_ex' => 2, 'esc_html_x' => 2, 'esc_attr_x' => 2, '_n' => 3, '_nx' => 4, '_n_noop' => 2, '_nx_noop' => 3,
);
const USER_FACING_KEYS = array( 'title', 'desc', 'description', 'label', 'placeholder', 'desc_tip', 'tooltip', 'button_text', 'menu_title', 'page_title' );
const NOTICE_FUNCS = array( 'wc_add_notice' => 0, 'wc_print_notice' => 0, 'add_settings_error' => 2, 'wp_die' => 0, 'esc_html' => 0, 'esc_attr' => 0, 'sprintf' => 0, 'printf' => 0 );

$files = array();
$it    = new RecursiveIteratorIterator(
	new RecursiveCallbackFilterIterator(
		new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS ),
		function ( $f ) {
			return ! ( $f->isDir() && ( in_array( $f->getFilename(), SKIP_DIRS, true ) || '.' === $f->getFilename()[0] ) );
		}
	)
);
foreach ( $it as $f ) {
	if ( $f->isFile() && 'php' === strtolower( $f->getExtension() ) ) {
		$files[] = $f->getPathname();
	}
}
sort( $files );

/** Significant (non-whitespace, non-comment) tokens with line numbers. */
function sig_tokens( $code ) {
	$out  = array();
	$line = 1;
	foreach ( token_get_all( $code ) as $t ) {
		if ( is_array( $t ) ) {
			$line = $t[2];
			if ( in_array( $t[0], array( T_WHITESPACE, T_COMMENT, T_DOC_COMMENT ), true ) ) {
				continue;
			}
			$out[] = array( 'id' => $t[0], 'text' => $t[1], 'line' => $t[2] );
		} else {
			$out[] = array( 'id' => $t, 'text' => $t, 'line' => $line );
		}
	}
	return $out;
}

function tok_is( $t, $ids ) {
	return in_array( $t['id'], (array) $ids, true );
}

/** Name of a function call token, or null. Handles \fqn and Class::method. */
function call_name( $toks, $i ) {
	$t = $toks[ $i ];
	if ( ! tok_is( $t, array( T_STRING, T_NAME_FULLY_QUALIFIED, T_NAME_QUALIFIED, T_ISSET, T_EMPTY, T_EXIT, T_EVAL, T_PRINT ) ) ) {
		return null;
	}
	if ( ! isset( $toks[ $i + 1 ] ) || '(' !== $toks[ $i + 1 ]['id'] ) {
		return null;
	}
	$prev = $toks[ $i - 1 ] ?? null;
	if ( $prev && tok_is( $prev, array( T_FUNCTION, T_NEW, T_FN ) ) ) {
		return null;
	}
	$name = ltrim( $t['text'], '\\' );
	if ( $prev && tok_is( $prev, array( T_DOUBLE_COLON ) ) ) {
		$cls = $toks[ $i - 2 ] ?? null;
		return ( $cls ? ltrim( $cls['text'], '\\' ) : '?' ) . '::' . $name;
	}
	if ( $prev && tok_is( $prev, array( T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR ) ) ) {
		$obj = $toks[ $i - 2 ] ?? null;
		return ( $obj ? $obj['text'] : '?' ) . '->' . $name;
	}
	$lower = strtolower( $name );
	return in_array( $lower, array( 'isset', 'empty', 'exit', 'die', 'eval', 'print' ), true ) ? $lower : $name;
}

/** Index of the matching closer for an opener at $i. */
function match_close( $toks, $i ) {
	$open  = $toks[ $i ]['id'];
	$pairs = array( '(' => ')', '[' => ']', '{' => '}' );
	$depth = 0;
	$n     = count( $toks );
	for ( $j = $i; $j < $n; $j++ ) {
		$id = $toks[ $j ]['id'];
		if ( $id === $open || ( '{' === $open && tok_is( $toks[ $j ], array( T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES ) ) ) ) {
			++$depth;
		} elseif ( $id === $pairs[ $open ] ) {
			--$depth;
			if ( 0 === $depth ) {
				return $j;
			}
		}
	}
	return $n - 1;
}

/** Splits token range [from, to) at depth-0 commas. */
function split_args( $toks, $from, $to ) {
	$args  = array();
	$cur   = array();
	$depth = 0;
	for ( $j = $from; $j < $to; $j++ ) {
		$id = $toks[ $j ]['id'];
		if ( in_array( $id, array( '(', '[', '{' ), true ) || tok_is( $toks[ $j ], array( T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES ) ) ) {
			++$depth;
		} elseif ( in_array( $id, array( ')', ']', '}' ), true ) ) {
			--$depth;
		}
		if ( ',' === $id && 0 === $depth ) {
			$args[] = $cur;
			$cur    = array();
			continue;
		}
		$cur[] = $toks[ $j ];
	}
	if ( $cur ) {
		$args[] = $cur;
	}
	return $args;
}

function literal_of( $arg ) {
	if ( 1 === count( $arg ) && tok_is( $arg[0], T_CONSTANT_ENCAPSED_STRING ) ) {
		return stripcslashes( substr( $arg[0]['text'], 1, -1 ) );
	}
	return null;
}

function text_of( $arg ) {
	return implode( ' ', array_map( function ( $t ) { return $t['text']; }, $arg ) );
}

/** Is an expression (token list) safe to output? */
function expr_safe( $toks ) {
	// Drop wrapping parentheses.
	while ( $toks && '(' === $toks[0]['id'] && match_close( $toks, 0 ) === count( $toks ) - 1 ) {
		$toks = array_slice( $toks, 1, -1 );
	}
	if ( ! $toks ) {
		return true;
	}
	// Split into operands at depth 0 on . , ?? ? :
	$ops   = array();
	$cur   = array();
	$depth = 0;
	$n     = count( $toks );
	for ( $j = 0; $j < $n; $j++ ) {
		$t  = $toks[ $j ];
		$id = $t['id'];
		if ( in_array( $id, array( '(', '[', '{' ), true ) ) {
			++$depth;
		} elseif ( in_array( $id, array( ')', ']', '}' ), true ) ) {
			--$depth;
		}
		if ( 0 === $depth && ( in_array( $id, array( '.', ',', ':' ), true ) || tok_is( $t, T_COALESCE ) ) ) {
			$ops[] = array( $cur, false );
			$cur   = array();
			continue;
		}
		if ( 0 === $depth && '?' === $id ) {
			$ops[] = array( $cur, true ); // Ternary condition: not output.
			$cur   = array();
			continue;
		}
		$cur[] = $t;
	}
	$ops[] = array( $cur, false );
	foreach ( $ops as $op ) {
		list( $o, $is_condition ) = $op;
		if ( $is_condition || ! $o ) {
			continue;
		}
		if ( ! operand_safe( $o ) ) {
			return false;
		}
	}
	return true;
}

function operand_safe( $o ) {
	$first = $o[0];
	if ( '(' === $first['id'] ) {
		return expr_safe( $o );
	}
	if ( tok_is( $first, array( T_CONSTANT_ENCAPSED_STRING, T_LNUMBER, T_DNUMBER, T_LINE, T_FILE, T_DIR, T_CLASS_C, T_FUNC_C, T_METHOD_C, T_NS_C ) ) ) {
		return 1 === count( $o );
	}
	if ( tok_is( $first, array( T_INT_CAST, T_DOUBLE_CAST, T_BOOL_CAST ) ) ) {
		return true;
	}
	if ( tok_is( $first, array( T_STRING, T_NAME_FULLY_QUALIFIED ) ) ) {
		$name = strtolower( ltrim( $first['text'], '\\' ) );
		if ( ! isset( $o[1] ) ) {
			return true; // A constant such as PHP_EOL or true.
		}
		if ( '(' === $o[1]['id'] ) {
			return in_array( $name, ESCAPERS, true ) && match_close( $o, 1 ) === count( $o ) - 1;
		}
		if ( tok_is( $o[1], T_DOUBLE_COLON ) && isset( $o[2] ) && tok_is( $o[2], T_STRING ) && ! isset( $o[3] ) ) {
			return true; // Class constant.
		}
	}
	return false;
}

$facts = array( 'root' => $root, 'files' => array() );
foreach ( $files as $path ) {
	$code = (string) file_get_contents( $path );
	$toks = sig_tokens( $code );
	$rel  = ltrim( substr( $path, strlen( $root ) ), '/' );
	$f    = array(
		'path'        => $rel,
		'namespace'   => null,
		'has_code'    => false,
		'has_guard'   => (bool) preg_match( '/defined\s*\(\s*[\'"](ABSPATH|WPINC|WP_UNINSTALL_PLUGIN)[\'"]\s*\)/', $code ),
		'functions'   => array(),
		'classes'     => array(),
		'constants'   => array(),
		'calls'       => array(),
		'superglobals' => array(),
		'echo_issues' => array(),
		'bare_strings' => array(),
		'parse_error' => null,
	);
	try {
		token_get_all( $code, TOKEN_PARSE );
	} catch ( \Throwable $e ) {
		$f['parse_error'] = $e->getMessage() . ' (line ' . $e->getLine() . ')';
	}

	$n          = count( $toks );
	$brace      = 0;
	$class_ends = array(); // Brace depths at which class bodies close.
	$fn_ends    = array();
	$paren      = array(); // Stack of enclosing call names for '('.
	$statement_has_cast = false;
	for ( $i = 0; $i < $n; $i++ ) {
		$t  = $toks[ $i ];
		$id = $t['id'];
		if ( ! tok_is( $t, array( T_OPEN_TAG, T_CLOSE_TAG, T_INLINE_HTML ) ) ) {
			$f['has_code'] = true;
		}
		if ( ';' === $id || '{' === $id || '}' === $id ) {
			$statement_has_cast = false;
		}
		if ( tok_is( $t, array( T_INT_CAST, T_DOUBLE_CAST, T_BOOL_CAST ) ) ) {
			$statement_has_cast = true;
		}
		// Braces and scopes.
		if ( '{' === $id || tok_is( $t, array( T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES ) ) ) {
			++$brace;
		} elseif ( '}' === $id ) {
			--$brace;
			if ( $class_ends && end( $class_ends ) === $brace ) {
				array_pop( $class_ends );
			}
			if ( $fn_ends && end( $fn_ends ) === $brace ) {
				array_pop( $fn_ends );
			}
		}
		if ( '(' === $id ) {
			$name    = $i > 0 ? call_name( $toks, $i - 1 ) : null;
			$paren[] = $name;
		} elseif ( ')' === $id ) {
			array_pop( $paren );
		}

		if ( tok_is( $t, T_NAMESPACE ) && isset( $toks[ $i + 1 ] ) && tok_is( $toks[ $i + 1 ], array( T_STRING, T_NAME_QUALIFIED ) ) ) {
			$f['namespace'] = $toks[ $i + 1 ]['text'];
		}
		// Declarations.
		if ( tok_is( $t, array( T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM ) ) && isset( $toks[ $i + 1 ] ) && tok_is( $toks[ $i + 1 ], T_STRING ) && ! ( $i > 0 && tok_is( $toks[ $i - 1 ], array( T_DOUBLE_COLON, T_NEW ) ) ) ) {
			$extends = null;
			for ( $j = $i + 2; $j < $n && '{' !== $toks[ $j ]['id']; $j++ ) {
				if ( tok_is( $toks[ $j ], T_EXTENDS ) && isset( $toks[ $j + 1 ] ) ) {
					$extends = ltrim( $toks[ $j + 1 ]['text'], '\\' );
				}
			}
			if ( ! $class_ends && ! $fn_ends ) {
				$f['classes'][] = array( 'name' => $toks[ $i + 1 ]['text'], 'line' => $t['line'], 'extends' => $extends );
			}
			$class_ends[] = $brace;
		}
		if ( tok_is( $t, T_FUNCTION ) ) {
			$j = $i + 1;
			if ( isset( $toks[ $j ] ) && '&' === $toks[ $j ]['id'] ) {
				++$j;
			}
			if ( isset( $toks[ $j ] ) && tok_is( $toks[ $j ], T_STRING ) ) {
				if ( ! $class_ends ) {
					$f['functions'][] = array( 'name' => $toks[ $j ]['text'], 'line' => $t['line'] );
				}
				// Find the body brace to track nesting.
				for ( $k = $j; $k < $n; $k++ ) {
					if ( ';' === $toks[ $k ]['id'] ) {
						break;
					}
					if ( '{' === $toks[ $k ]['id'] ) {
						$fn_ends[] = $brace;
						break;
					}
				}
			}
		}
		if ( tok_is( $t, T_CONST ) && ! $class_ends && isset( $toks[ $i + 1 ] ) && tok_is( $toks[ $i + 1 ], T_STRING ) ) {
			$f['constants'][] = array( 'name' => $toks[ $i + 1 ]['text'], 'line' => $t['line'], 'via' => 'const' );
		}

		// Calls.
		$name = call_name( $toks, $i );
		if ( null !== $name ) {
			$close  = match_close( $toks, $i + 1 );
			$args   = split_args( $toks, $i + 2, $close );
			$call   = array(
				'name'     => $name,
				'line'     => $t['line'],
				'literals' => array_map( 'literal_of', $args ),
				'args'     => array_map( 'text_of', $args ),
			);
			$f['calls'][] = $call;
			$lname        = strtolower( $name );
			if ( 'define' === $lname && null !== $call['literals'][0] ) {
				$f['constants'][] = array( 'name' => $call['literals'][0], 'line' => $t['line'], 'via' => 'define' );
			}
			if ( in_array( $lname, array( 'printf', 'vprintf' ), true ) ) {
				foreach ( $args as $a ) {
					if ( ! expr_safe( $a ) ) {
						$f['echo_issues'][] = array( 'line' => $t['line'], 'text' => substr( $name . '( ' . text_of( $a ) . ' )', 0, 160 ) );
					}
				}
			}
			if ( in_array( $lname, array( '_e', '_ex' ), true ) ) {
				$f['echo_issues'][] = array( 'line' => $t['line'], 'text' => $name . '() prints unescaped text; use esc_html_e()' );
			}
			if ( in_array( $lname, array( 'print_r', 'var_dump', 'var_export', 'debug_zval_dump' ), true ) && ! ( 'print_r' === $lname && 2 === count( $args ) ) && ! ( 'var_export' === $lname && 2 === count( $args ) ) ) {
				$f['echo_issues'][] = array( 'line' => $t['line'], 'text' => $name . '() debug output' );
			}
			if ( isset( NOTICE_FUNCS[ $lname ] ) && isset( $args[ NOTICE_FUNCS[ $lname ] ] ) ) {
				$a   = $args[ NOTICE_FUNCS[ $lname ] ];
				$lit = literal_of( $a );
				if ( null !== $lit && preg_match( '/[A-Za-z]{2,}\s+[A-Za-z]{2,}/', wp_like_strip( $lit ) ) ) {
					$f['bare_strings'][] = array( 'line' => $t['line'], 'text' => $name . "( '" . substr( $lit, 0, 60 ) . "' )" );
				}
			}
		}

		// Array values for user-facing keys.
		if ( tok_is( $t, T_CONSTANT_ENCAPSED_STRING ) && isset( $toks[ $i + 2 ] ) && tok_is( $toks[ $i + 1 ], T_DOUBLE_ARROW ) && tok_is( $toks[ $i + 2 ], T_CONSTANT_ENCAPSED_STRING ) ) {
			$key  = substr( $t['text'], 1, -1 );
			$next = $toks[ $i + 3 ] ?? null;
			if ( in_array( $key, USER_FACING_KEYS, true ) && ( ! $next || in_array( $next['id'], array( ',', ')', ']' ), true ) ) ) {
				$val = stripcslashes( substr( $toks[ $i + 2 ]['text'], 1, -1 ) );
				if ( preg_match( '/[A-Za-z]{2,}/', wp_like_strip( $val ) ) ) {
					$f['bare_strings'][] = array( 'line' => $t['line'], 'text' => "'$key' => '" . substr( $val, 0, 60 ) . "'" );
				}
			}
		}

		// Superglobals.
		if ( tok_is( $t, T_VARIABLE ) && in_array( $t['text'], array( '$_POST', '$_GET', '$_REQUEST', '$_COOKIE', '$_FILES', '$_SERVER' ), true ) ) {
			$j   = $i + 1;
			$key = null;
			if ( isset( $toks[ $j ] ) && '[' === $toks[ $j ]['id'] ) {
				$key = isset( $toks[ $j + 1 ] ) && tok_is( $toks[ $j + 1 ], T_CONSTANT_ENCAPSED_STRING ) ? substr( $toks[ $j + 1 ]['text'], 1, -1 ) : '?';
				while ( isset( $toks[ $j ] ) && '[' === $toks[ $j ]['id'] ) {
					$j = match_close( $toks, $j ) + 1;
				}
			}
			$next      = $toks[ $j ] ?? null;
			$prev      = $toks[ $i - 1 ] ?? null;
			$cmp       = array( T_IS_EQUAL, T_IS_IDENTICAL, T_IS_NOT_EQUAL, T_IS_NOT_IDENTICAL );
			$enclosing = array_values( array_filter( array_reverse( $paren ) ) );
			$lower     = array_map( 'strtolower', $enclosing );
			$f['superglobals'][] = array(
				'var'        => $t['text'],
				'key'        => $key,
				'line'       => $t['line'],
				'only_check' => isset( $lower[0] ) && in_array( $lower[0], VALIDATORS, true ),
				'sanitized'  => (bool) array_intersect( $lower, SANITIZERS ) || ( $prev && tok_is( $prev, array( T_INT_CAST, T_DOUBLE_CAST, T_BOOL_CAST ) ) ) || $statement_has_cast,
				'compared'   => ( $prev && tok_is( $prev, $cmp ) ) || ( $next && tok_is( $next, $cmp ) ),
				'enclosing'  => $enclosing,
			);
		}

		// echo / print / <?=.
		if ( tok_is( $t, array( T_ECHO, T_PRINT, T_OPEN_TAG_WITH_ECHO ) ) ) {
			$j     = $i + 1;
			$depth = 0;
			$expr  = array();
			for ( ; $j < $n; $j++ ) {
				$id2 = $toks[ $j ]['id'];
				if ( in_array( $id2, array( '(', '[', '{' ), true ) ) {
					++$depth;
				} elseif ( in_array( $id2, array( ')', ']', '}' ), true ) ) {
					--$depth;
				}
				if ( 0 === $depth && ( ';' === $id2 || tok_is( $toks[ $j ], T_CLOSE_TAG ) ) ) {
					break;
				}
				if ( $depth < 0 ) {
					break;
				}
				$expr[] = $toks[ $j ];
			}
			if ( ! expr_safe( $expr ) ) {
				$f['echo_issues'][] = array( 'line' => $t['line'], 'text' => substr( trim( $t['text'] ) . ' ' . text_of( $expr ), 0, 160 ) );
			}
		}
	}
	$facts['files'][] = $f;
}

/** Strips tags and placeholders so "%1$s" or "<strong>" don't count as words. */
function wp_like_strip( $s ) {
	return preg_replace( '/%(\d+\$)?[sdf]|<[^>]*>/', ' ', $s );
}

echo json_encode( $facts, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE ), "\n";
