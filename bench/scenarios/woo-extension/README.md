# Scenario: woo-extension

A WooCommerce extension for sale on the WooCommerce Marketplace: a minimum order amount per customer role, with a settings tab under WooCommerce > Settings, a cart notice and checkout validation (`prompt.md`).

The prompt says the plugin will be sold on the Marketplace and must meet its quality, security and coding expectations. It does not name any tool or technique: no PHPCS, WordPress Coding Standards, PHPStan, QIT, nonces, escaping, prefixes or uninstall. The scenario measures two things separately:

1. **Stated behaviour**: 14 hidden behaviour tests (`hidden-tests.js`).
2. **Platform quality**: 4 quality checks (`quality.json`). These are never shown to the agent and show whether it applied the platform's rules without being told them.

## Hidden behaviour tests (14)

`hidden-tests.js` runs under `node --test`. Each test starts fresh PHP processes (`hidden/run.php`) that load minimal WordPress and WooCommerce stand-ins (`hidden/wp-stubs.php`), include the plugin's main file, fire the hooks WordPress and WooCommerce would fire for one request, and print JSON. The tests check only observable behaviour stated in the prompt:

| # | Behaviour |
|---|---|
| 1 | The main file loads on the front end and in admin without PHP errors |
| 2 | Below the role minimum, the cart shows the exact notice text with `wc_price()` amounts |
| 3 | At or above the minimum, no cart notice (plus a control case below the minimum) |
| 4 | Below the minimum, checkout is rejected with the same text as an error |
| 5 | At or above the minimum, checkout is not blocked (plus a control case) |
| 6 | Each role uses its own minimum |
| 7 | Logged-out visitors use the `guest` amount, and have no minimum when it is not set |
| 8 | Roles without an amount, empty or zero amounts and a missing option mean no minimum (plus a control) |
| 9 | A customer with several roles gets the highest configured minimum |
| 10 | Decimal minimums compare and format exactly |
| 11 | An empty cart never shows the notice (plus a control) |
| 12 | WooCommerce > Settings renders a `min_order_by_role_minimums[<role>]` field for every role and for `guest` |
| 13 | Saving the settings stores per-role amounts in the option, and the cart then uses them |
| 14 | Saving negative or non-numeric amounts leaves those roles with no minimum |

Every "no notice" test also checks a control case below the minimum, so a plugin that does nothing passes only test 1.

**How the runner simulates WordPress.** The cart context fires `wp`, `template_redirect`, `woocommerce_check_cart_items` and the cart template hooks (`woocommerce_before_cart` ... `woocommerce_after_cart`). A notice counts if it was added with `wc_add_notice()`, printed with `wc_print_notice()` or echoed into the page. The checkout context mirrors `WC_Checkout::process_checkout()` for the classic checkout: `woocommerce_checkout_process`, `woocommerce_check_cart_items` and `woocommerce_after_checkout_validation` (with a `WP_Error`). An error counts if it was added with `wc_add_notice(..., 'error')`, added to the `WP_Error`, or thrown as an exception. The settings tests rebuild the WooCommerce > Settings page from `woocommerce_get_settings_pages`, `woocommerce_settings_tabs_array` and `woocommerce_get_sections_*`, find the tabs and sections the plugin added (its own tab, or a section in a built-in tab such as Products), and render or save them the way WooCommerce does. The stubs copy the relevant parts of `WC_Settings_Page` and `WC_Admin_Settings::output_fields()` / `save_fields()`, including array-style field ids and the `woocommerce_admin_settings_sanitize_option_*` filters. Before saving, the runner verifies the `woocommerce-settings` nonce, just as WooCommerce core does. Posted values get slashes added, like `wp_magic_quotes()`.

**Tolerance.** About 330 WordPress and WooCommerce functions and 18 classes (about 145 methods) are stubbed: hooks, options, transients, roles and users, i18n, escaping and sanitising, nonces, `WC()->cart` and its subtotal accessors, notices, `wc_price()`, `FeaturesUtil`, `WC_Integration` and `$wpdb`. If the plugin calls something that is not stubbed, PHP's "Call to undefined function" error and any unknown `WC()`/cart members appear in the failure message (`errors`, `unknown`), so a stub gap can be told apart from a plugin bug. Notice text is compared after stripping tags and decoding entities twice, so `wc_price()` HTML compares as `$50.00` whether or not it was escaped.

Reference check: `BENCH_TARGET=$PWD/bench/scenarios/woo-extension/reference/min-order-by-role/min-order-by-role.php node --test bench/scenarios/woo-extension/hidden-tests.js` gives 14/14. Tolerance was also checked with an alternative implementation (namespaced, a section under the Products tab, `woocommerce_check_cart_items` with `wc_print_notice()`, `WP_Error` checkout validation, read-time sanitising), which also scored 14/14. An off-by-one variant that took the lowest role minimum failed 4 tests.

## Quality checks (4)

`quality.json` lists one setup step and four checks. Each check prints one JSON line `{"name","pass","errors","details"}` and exits 0 only when it passes. The harness substitutes three placeholders: `${SCENARIO}` (this folder), `${WORKSPACE}` (the run's workspace) and `${BENCH_TOOLS}` (a tool cache outside the workspace, for example `~/.cache/pp-bench-tools`).

| Check | Command | Passes when |
|---|---|---|
| setup | `quality/check.js setup` | It copies `quality/composer.json` and `quality/composer.lock` into `$BENCH_TOOLS` and runs `composer install`. It skips the install when the lock is unchanged. |
| `phpcs-wordpress` | PHPCS `--standard=WordPress` (WPCS 3.4.1) | 0 errors. Warnings are reported but allowed. |
| `php-compatibility-7.4` | PHPCS `--standard=PHPCompatibilityWP --runtime-set testVersion 7.4-` | 0 errors |
| `phpstan-level5` | PHPStan 2.3 level 5 with `szepeviktor/phpstan-wordpress` and `php-stubs/woocommerce-stubs` (`quality/phpstan.neon`) | 0 errors |
| `security-scan` | `quality/security-scan.js`: facts from PHP's tokenizer (`quality/scan-tokens.php`) plus a live uninstall run through `hidden/run.php` | 0 errors in all 11 sub-checks |

All checks analyse `${WORKSPACE}/min-order-by-role` and skip `vendor/`, `node_modules/`, `tests/` and `test/`. Agents often put their own tests or dev tools there, and the Marketplace zip would be built without them.

Security-scan sub-checks:

- `syntax`: every PHP file parses.
- `direct-access`: every file with code has a `defined( 'ABSPATH' ) || exit` style guard.
- `input-sanitised`: every read of `$_POST`, `$_GET`, `$_REQUEST`, `$_COOKIE`, `$_FILES` or `$_SERVER` sits inside a sanitiser or cast, or is only checked with `isset`/`empty` or compared. A missing `wp_unslash()` is a warning.
- `nonce-or-settings-api`: settings are saved through the WooCommerce settings API, `register_setting()`, or a handler that verifies a nonce. A file that reads form data must call `wp_verify_nonce`, `check_admin_referer` or `check_ajax_referer`. In a file that only saves through `woocommerce_update_options_*` or `woocommerce_settings_save_*`, this is downgraded to a warning, because WooCommerce has already checked its own nonce by then.
- `capability-checks`: form handlers and `admin_post_*`/`wp_ajax_*` hooks call `current_user_can()`, with the same downgrade. Admin pages may not use `read` or `exist` as their capability.
- `output-escaped`: every `echo`, `print`, `<?=`, `printf` and `vprintf` operand is a literal, a number, a cast or an escaping call (`esc_*`, `wp_kses*`, `absint`, `wc_price` and so on). `_e()`/`_ex()` and debug output are flagged.
- `prefixing`: global functions, classes and `define()` constants, options and transients written by the plugin, and custom hooks start with a plugin prefix. Accepted prefixes are `min_order_by_role`, `minorderbyrole`, `mobr`, or one distinctive vendor prefix (3+ characters, not a generic word) shared by every global symbol. Namespaced code counts as prefixed.
- `i18n`: the Text Domain header and every gettext call use `min-order-by-role`. Gettext calls need literal strings. User-facing literals (`'title' =>`, `'desc' =>`, `'label' =>`, notice text, `sprintf()` sentences) must be translatable. A missing `load_plugin_textdomain()` is a warning.
- `uninstall`: the scan seeds `min_order_by_role_minimums`, runs the plugin's activation and bootstrap hooks to find every option it creates, then runs `uninstall.php` (or the `register_uninstall_hook()` callback) and requires all of those options to be gone.
- `woo-headers-hpos`: the main file needs `Plugin Name`, `Version`, `WC requires at least` and `WC tested up to` headers, plus an HPOS compatibility declaration (`FeaturesUtil::declare_compatibility( 'custom_order_tables', ... )`). Missing `Requires at least`, `Requires PHP`, `Requires Plugins` or `License`, or no Cart and Checkout blocks declaration, are warnings.
- `dangerous-code`: `eval`, `extract`, `create_function`, shell execution, `assert`, and dynamic `$wpdb` queries not built with `prepare()`.

Verified results (2026-10-20, PHP 8.4):

| Version | Behaviour | phpcs | PHPCompat | PHPStan | security-scan |
|---|---|---|---|---|---|
| `reference/` | 14/14 | 0 errors | 0 | 0 | 0 |
| Sloppy (unescaped `echo`, raw `$_POST`, unprefixed functions, no uninstall, no i18n, no Woo headers) | 14/14 | 113 errors | 0 | 0 | 17 errors in 7 sub-checks |
| Alternative (namespaced, Products section, uses `WC_Cart::$subtotal`) | 14/14 | 18 errors | 0 | 1 (undefined property `WC_Cart::$subtotal`) | 6 (uninstall, Woo headers, HPOS) |

PHPStan typically takes 10–15 s per run because it scans the WooCommerce stubs. The other checks take well under a second.

### Pinned tools (`quality/composer.lock`)

squizlabs/php_codesniffer 3.13.6, wp-coding-standards/wpcs 3.4.1, phpcsstandards/phpcsutils 1.2.3, phpcsstandards/phpcsextra 1.5.1, phpcompatibility/phpcompatibility-wp 3.0.0-alpha2, phpcompatibility/php-compatibility 10.0.0-alpha2, phpcompatibility/phpcompatibility-paragonie 2.0.0-alpha2, phpstan/phpstan 2.3.1, szepeviktor/phpstan-wordpress 2.0.4, php-stubs/wordpress-stubs 7.1.2, php-stubs/woocommerce-stubs 10.9.4, dealerdirect/phpcodesniffer-composer-installer 1.2.1.

PHPCompatibility uses the 10.0 alpha line on purpose. The last stable release (9.3.5, from 2019) does not recognise PHP 8 syntax such as `match`, `?->` or `mixed`, so it would pass PHP 8-only code as 7.4-compatible.

## Requirements

PHP 8.1 or newer and Composer on `PATH` (override with `BENCH_PHP` and `BENCH_COMPOSER`), Node 20+, and network access for the first `setup`.

## Known limits

- The stubs are not WordPress. A plugin that works in real WordPress can still fail if it uses an API that is not stubbed (the failure message names it) or depends on real database, template or request behaviour. A plugin that only works against the stubs is unlikely but possible. The runner also defines WooCommerce before the plugin loads, which is more lenient than real load order.
- Settings must live under WooCommerce > Settings (as the prompt says) and post `min_order_by_role_minimums[<role>]`. A save handler that needs its own hidden nonce field in a custom form will not be exercised by test 13 or 14, because the runner cannot know that field's name.
- Only the classic (shortcode) cart and checkout are simulated, as the prompt specifies. Block checkout behaviour (Store API) is not tested.
- The security scan is heuristic. It follows data flow only within one expression: sanitising a superglobal on one line and echoing the variable later is fine, but echoing any variable without escaping is flagged even when it is already safe. Nonce and capability checks are matched per file, not per code path. Escaping accepts `wc_price()` as safe output, unlike WPCS. Prefix detection cannot recognise every legitimate vendor prefix: a prefix shared by all symbols counts unless it is a generic word. It overlaps with PHPCS on purpose. PHPCS measures the standard as reviewers apply it, and the scan explains which platform requirement was missed.
- The uninstall check covers options only, not custom tables, user meta, transients or scheduled events.
- Header and HPOS requirements reflect WooCommerce Marketplace guidance as of 2026. They are listed separately so they can be ignored if the guidance changes.
