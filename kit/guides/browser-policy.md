# Browser and web access policy

No browser is installed by Product Planner init. Browser choices are discussed with research and QA requirements during planning and recorded in decisions.md. No automatic browser installer/configurator is implemented in the current CLI.

| Purpose | Default | Optional enhancement |
|---|---|---|
| Open product-dashboard.html | Existing operating-system default browser via open/start/xdg-open | Open the file manually if automatic launch is unavailable |
| Research competitors and documentation | Available host-native search/browser, or agreed built-in research search/fetch CLI | Existing browser automation/MCP capability when interactive pages require it |
| Verify interactive product UI | Existing project test tooling or available host browser automation | Playwright with Chromium when chosen during planning |
| Cross-browser checks | Driven by product audience and requirements | Firefox, WebKit, or existing branded browser channels where needed |

The dashboard itself is a local self-contained HTML file. It does not need Chromium, Playwright or an HTTP service. Opening it does not change the user's default browser. The CLI search/fetch fallback retrieves HTML/text; it is not an interactive JavaScript browser and cannot promise to handle sign-in, CAPTCHAs or dynamic sites.

## Optional Playwright plan

Prefer the project's existing Playwright configuration and compatible cached binaries. Playwright requires browser binaries matched to its version; an installed browser is not necessarily a compatible managed binary. Where a new setup is appropriate, choose Chromium as the initial automation target; install additional engines only for the agreed coverage. Chromium is the automation browser, not a new system-default browser. Headless execution suits routine QA; use a visible browser when the user wants to follow a test or interactive inspection requires it.

Illustrative setup for an npm product project that has agreed to add Playwright Test (run in that product repository, not automatically during Product Planner init):

```sh
npm install --save-dev @playwright/test
npx playwright install chromium
```

Reuse the existing package manager and pinned toolchain when present. Record the selected version in the product lockfile. Some Linux environments need additional system dependencies; inspect the host requirements and use its required approval flow. Do not run the broad install command that downloads all engines unless the product needs them.

Test the agreed journeys, form validation, keyboard behavior, responsive layouts and failure states, and save reproducible steps/screenshots. Use test accounts/fixtures and avoid modifying production data during discovery. Do not claim browser QA passed if tooling or prerequisites are absent; record what was and was not verified and choose an appropriate remaining QA task. Routine test runs need no new planning gate after the setup and scope are agreed.

[Playwright browser documentation](https://playwright.dev/docs/browsers), reviewed 2026-10-19, describes managed binaries, Chromium/Firefox/WebKit and branded browser channels. Native host browsing remains host-dependent; detect availability instead of assuming a particular editor always includes it.
