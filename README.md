# IP2Location.io Headers for Fastly Compute

Enrich requests at the **Fastly edge** with additional [IP2Location.io](https://www.ip2location.io/) IP geolocation, network, and proxy intelligence. The Fastly Compute service looks up the visitor's IP address, adds selected `X-IP2Location-*` headers, and forwards the request to your existing origin application, without requiring changes to your application code just to perform the lookup.

Built for developers who want to use IP intelligence in localization, analytics, request logging, and risk-aware application workflows.

> **Scope:** This service supplements the geolocation information Fastly already makes available. It does **not** block, challenge, or redirect visitors automatically.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Available headers](#available-headers)
- [Caching and API usage](#caching-and-api-usage)
- [Read headers in your application](#read-headers-in-your-application)
- [Debug endpoint](#debug-endpoint)
- [Local development and testing](#local-development-and-testing)
- [Troubleshooting](#troubleshooting)
- [Security and responsible use](#security-and-responsible-use)
- [Resources](#resources)

## Features

- **Edge request enrichment:** attaches additional IP intelligence as HTTP request headers before forwarding to your origin.
- **IPv4 and IPv6 support:** identifies client IP addresses using Fastly's client address information.
- **Geolocation and network metadata:** exposes eligible district, currency, language, ISP, domain, network type, and ASN-related fields.
- **Proxy and threat signals:** provides proxy indicators and, on eligible plans, fraud score, proxy type, provider, threat, and a comma-separated set of proxy flags.
- **Plan-aware output:** emits a field only when IP2Location.io returns a usable value.
- **Fastly SimpleCache:** caches lookup results by IPv4 `/24` or IPv6 `/48` network to reduce repeated API calls.
- **Diagnostic endpoint:** returns lookup status, generated headers, raw lookup data, and Fastly geolocation metadata for testing.
- **Keyless mode:** operates without an API key, with the data and quotas available to keyless API requests.

## How it works

```text
Visitor
   |
   v
Fastly Compute service
   |-- Read visitor IP from Fastly client metadata
   |-- Check SimpleCache for the IP network
   |-- If needed, query IP2Location.io
   |-- Build X-IP2Location-* request headers
   |
   v
Your origin server / web application
   |-- Read enriched request headers
   v
Response to visitor (through Fastly)
```

The service uses Fastly's `origin` backend for application traffic and an `ip2location` backend for API lookups. Incoming `X-IP2Location-*` request headers are removed before the service adds its own values, reducing the chance that callers can spoof these headers through the public Fastly endpoint.

**Important:** These are headers forwarded **to the origin**, not headers automatically added to the HTTP response returned to the browser. Use the debug endpoint to inspect the data without modifying your origin application.

## Prerequisites

- A [Fastly](https://www.fastly.com/) account with access to **Fastly Compute**.
- A local installation of **Node.js** and **npm**.
- Fastly CLI access and credentials suitable for deploying to your Fastly account. This project includes the Fastly CLI as a development dependency, so the examples use `npx fastly`.
- An existing origin hostname that Fastly can reach.
- Optional: an [IP2Location.io API key](https://www.ip2location.io/) for authenticated API access and additional plan-dependent fields.
- Optional: [Bun](https://bun.sh/) to run the repository's tests and live-check script.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/ip2location/fastly-ip2location-headers.git
cd fastly-ip2location-headers
npm install
```

Authenticate with the Fastly CLI if you have not already configured access to your account. See the [Fastly CLI documentation](https://www.fastly.com/documentation/reference/cli/) for authentication details.

### 2. Review the deployment configuration

The included [`fastly.toml`](fastly.toml) has a `[setup]` section for the required `origin` and `ip2location` backends, Config Store, and Secret Store.

Before deployment:

- Confirm that the service is associated with the **intended Fastly account and service**. The checked-in manifest includes a `service_id`; do not accidentally publish changes to another service.
- Provide your real origin hostname when Fastly prompts for the `origin` backend configuration.
- Verify the API backend uses `api.ip2location.io` over HTTPS and that your origin's TLS, SNI, and Host settings are correct for your infrastructure.

### 3. Publish the Compute service

```bash
npx fastly compute publish
```

The manifest's setup section is intended to provision/link required resources during publication. Check the resulting Fastly service configuration and resolve any setup prompts or missing bindings before sending live traffic. The required backend names and store names are listed in [Configuration](#configuration).

### 4. Add your API key (optional)

In your Fastly service, open the **Secret Store** named `ip2location_secret` and set:

```text
IP2LOCATION_API_KEY = YOUR_API_KEY
```

Use Fastly's secret-management interface or supported CLI workflow; **never commit an API key to the repository or put it in the public Config Store**. Without a key, the service uses keyless IP2Location.io lookups.

### 5. Route traffic through the service

Associate the deployed Compute service with the hostname you want to enrich and verify your DNS, TLS, service version, and origin backend settings. Then make a request through the Fastly-facing hostname and confirm your origin receives `X-IP2Location-Lookup` and any applicable enrichment headers.

> **First validation:** `X-IP2Location-Lookup: miss` indicates a successful lookup with caching enabled; subsequent requests for the same cached network at the same Fastly POP may produce `hit`.

## Configuration

### Fastly resources

| Resource | Default name | Purpose |
| --- | --- | --- |
| Application backend | `origin` | Receives forwarded application requests |
| API backend | `ip2location` | Connects to `api.ip2location.io` |
| Config Store | `ip2location_config` | Contains non-secret runtime settings |
| Secret Store | `ip2location_secret` | Stores the optional API key |

The resources must be linked to the deployed Compute service. If your environment uses different backend names, update the matching Config Store values.

### Config Store settings

| Key | Default | Description |
| --- | --- | --- |
| `CACHE_TTL` | `3600` | Cached lookup lifetime in seconds. `0` disables lookup caching. |
| `BACKEND` | `origin` | Name of the application backend. |
| `API_BACKEND` | `ip2location` | Name of the IP2Location.io API backend. |
| `ALLOW_QUERY_IP` | `0` | Allows an `ip` query parameter on the debug endpoint when enabled. |
| `ALLOWED_ORIGINS` | `*` | Value of the debug endpoint's `Access-Control-Allow-Origin` header. |

### Secret Store setting

| Secret | Description |
| --- | --- |
| `IP2LOCATION_API_KEY` | Optional IP2Location.io API key; omission selects keyless mode. |

For local `fastly compute serve`, the manifest includes example local backends and sets `ALLOW_QUERY_IP=1` in a local Config Store. **These local defaults are not production security recommendations.**

## Available headers

Headers are added to the request received by your origin. Names begin with `X-IP2Location-`. The list below reflects the repository's **current default field selection** in [`lib/fields.ts`](lib/fields.ts), not every possible field declared in the source code.

### Lookup diagnostics

| Header | Meaning |
| --- | --- |
| `X-IP2Location-Lookup` | `hit`, `miss`, `off`, `error`, or `invalid` |
| `X-IP2Location-Error` | Short failure detail, when an error is present |

Lookup status meanings:

- `hit`: result loaded from cache.
- `miss`: API result retrieved and cached.
- `off`: API result retrieved while caching was disabled.
- `error`: API call, response, or runtime processing failed.
- `invalid`: client address was missing or not a valid IP address.

### Default enrichment headers

| Header | What it represents | Minimum plan indicated by existing README* |
| --- | --- | --- |
| `X-IP2Location-Is-Proxy` | General proxy indicator | Keyless |
| `X-IP2Location-ISP` | Internet service provider | Starter |
| `X-IP2Location-Domain` | Associated domain | Starter |
| `X-IP2Location-Net-Speed` | Connection/network speed classification | Starter |
| `X-IP2Location-Usage-Type` | Network usage category | Starter |
| `X-IP2Location-Country-Currency` | Currency code | Plus |
| `X-IP2Location-Country-Language` | Language code | Plus |
| `X-IP2Location-Time-Abbr` | Time zone abbreviation | Plus |
| `X-IP2Location-Time-DST` | Daylight-saving-time indicator | Plus |
| `X-IP2Location-Address-Type` | Unicast/anycast classification | Plus |
| `X-IP2Location-Mobile-MCC` | Mobile country code | Plus |
| `X-IP2Location-Mobile-MNC` | Mobile network code | Plus |
| `X-IP2Location-Mobile-Brand` | Mobile carrier brand | Plus |
| `X-IP2Location-District` | District/county | Security |
| `X-IP2Location-AS-Domain` | Autonomous system domain | Security |
| `X-IP2Location-AS-Usage-Type` | Autonomous system usage category | Security |
| `X-IP2Location-AS-CIDR` | Autonomous system CIDR information | Security |
| `X-IP2Location-Ads-Category` | Advertising category | Security |
| `X-IP2Location-Fraud-Score` | IP-related fraud risk score | Security |
| `X-IP2Location-Proxy-Type` | Proxy type classification | Security |
| `X-IP2Location-Proxy-Provider` | Proxy service/provider | Security |
| `X-IP2Location-Threat` | Threat classification | Security |
| `X-IP2Location-Proxy-Flags` | Comma-separated names of true proxy/threat flags | Security |

*Plan levels summarize the current repository README, not a guarantee of account entitlement. Refer to [IP2Location.io](https://www.ip2location.io/) for current plan and field availability.

**Missing values:** A header is omitted when the API does not return the field, its value is `null`, blank, or `-`. Boolean values, when present, are serialized as `true` or `false`. Header values are sanitized and truncated to a maximum of 512 characters.

**Not emitted by default:** The source defines additional fields such as `X-IP2Location-IDD-Code`, `X-IP2Location-Elevation`, `X-IP2Location-Country-Currency-Symbol`, `X-IP2Location-Proxy-Last-Seen`, and individual `X-IP2Location-Is-VPN` / `X-IP2Location-Is-Tor` / `X-IP2Location-Is-AI-Crawler` headers. These are **not** part of `DEFAULT_FIELDS` in the current implementation. To expose them, modify the field selection in [`lib/fields.ts`](lib/fields.ts) and redeploy. The combined `Proxy-Flags` header is enabled by default.

### Example origin request headers

Depending on the client's IP, your subscription, and the API response, an origin request may contain:

```http
X-IP2Location-Lookup: miss
X-IP2Location-ISP: Example ISP
X-IP2Location-Country-Currency: USD
X-IP2Location-Is-Proxy: false
```

These values are illustrative, not a guaranteed response for a particular IP address.

## Caching and API usage

The service uses [Fastly SimpleCache](https://www.fastly.com/documentation/reference/compute/javascript/fastly-cache/) for lookups:

- IPv4 lookups use a `/24` network key.
- IPv6 lookups use a `/48` network key.
- Default cache lifetime is `3600` seconds.
- `CACHE_TTL=0` disables caching and causes lookups to go to the API for each eligible request.
- Cache entries are maintained at the Fastly POP; do not assume a single worldwide shared cache.
- A lookup result is reused for other addresses in the **same cached network**. This reduces API usage but can mean network-specific metadata does not exactly describe each individual IP.

If the API responds with error code `10000` for a request using a configured API key, the implementation retries **once** without the key. This may return a smaller set of fields under keyless access.

For accurate quota information and data availability, consult [IP2Location.io](https://www.ip2location.io/). API usage depends on traffic patterns, cache configuration, geographic distribution across POPs, and expiry.

## Read headers in your application

Your origin application can consume the enriched headers like ordinary inbound HTTP request headers. **Always handle optional fields and check lookup status.**

### PHP

```php
$lookup  = $_SERVER['HTTP_X_IP2LOCATION_LOOKUP'] ?? null;
$isp     = $_SERVER['HTTP_X_IP2LOCATION_ISP'] ?? null;
$flags   = $_SERVER['HTTP_X_IP2LOCATION_PROXY_FLAGS'] ?? '';
$isProxy = ($_SERVER['HTTP_X_IP2LOCATION_IS_PROXY'] ?? '') === 'true';
$isVpn   = in_array('vpn', explode(',', $flags), true);
```

### Node.js (Express)

```javascript
app.get('/', (req, res) => {
  const lookup = req.get('x-ip2location-lookup');
  const isp = req.get('x-ip2location-isp') ?? null;
  const flags = (req.get('x-ip2location-proxy-flags') ?? '')
    .split(',').filter(Boolean);
  const isProxy = req.get('x-ip2location-is-proxy') === 'true';
  const isVpn = flags.includes('vpn');

  res.json({ lookup, isp, isProxy, isVpn });
});
```

### Python (Flask)

```python
from flask import request

lookup = request.headers.get('X-IP2Location-Lookup')
isp = request.headers.get('X-IP2Location-ISP')
flags = request.headers.get('X-IP2Location-Proxy-Flags', '').split(',')
is_proxy = request.headers.get('X-IP2Location-Is-Proxy') == 'true'
is_vpn = 'vpn' in flags
```

> These examples presume your application only trusts the enrichment headers on requests received through the intended Fastly service. Protect the origin from direct public traffic that could supply forged header values.

## Debug endpoint

The service exposes:

```http
GET /__ip2location
```

It returns a JSON object with the lookup status, IP address, cache network, backend name, Fastly geolocation metadata, generated headers, and raw API response data. The debug endpoint is served by the Compute service and is **not** forwarded to your origin.

Example local request:

```bash
curl 'http://127.0.0.1:7676/__ip2location?ip=8.8.8.8'
```

The `?ip=` override is processed only when `ALLOW_QUERY_IP=1`. When it is disabled, the debug endpoint looks up the actual client address instead.

**Production caution:** The debug endpoint can reveal information about visitor IPs and lookup data. Disabling `ALLOW_QUERY_IP` prevents arbitrary IP overrides but does **not** disable the endpoint itself. Restrict access at the Fastly edge or modify the service if it must not be publicly accessible. Likewise, `ALLOWED_ORIGINS` controls a CORS response header; it is not an authentication mechanism.

## Local development and testing

Install dependencies:

```bash
npm install
```

Create a `.env` file for the optional **live-check script**:

```bash
cp .env.example .env
# Edit .env and provide IP2LOCATION_API_KEY if desired.
```

Run checks:

```bash
npm run typecheck
npm test
npm run live
```

The `test` and `live` scripts use **Bun**. The `.env` file is read by the live-check script only; the Fastly Compute application itself reads its Config Store and Secret Store.

Start the local Compute server:

```bash
npm run dev
```

The repository's `fastly.toml` configures example local backends and enables `ALLOW_QUERY_IP=1` locally. The local origin points to `https://example.com` until you configure it otherwise. Test the debug endpoint at `http://127.0.0.1:7676/__ip2location?ip=8.8.8.8`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Origin requests fail after deployment | Verify the `origin` backend address, TLS/Host settings, and that the service has the expected backend linked. |
| API enrichment is unavailable | Verify the `ip2location` backend and HTTPS connectivity to `api.ip2location.io`. |
| `X-IP2Location-Lookup: error` | Use the debug endpoint to inspect the error; check API credentials, quota, and API response shape. |
| `X-IP2Location-Lookup: invalid` | Confirm Fastly is providing a valid client address. |
| Only a few enrichment headers appear | Check account plan, IP-specific field availability, and the `DEFAULT_FIELDS` selection in `lib/fields.ts`. |
| Cache appears ineffective | Check `CACHE_TTL`, cache expiry, and whether requests are routed through different Fastly POPs. |
| `?ip=` does not change debug results | Verify `ALLOW_QUERY_IP=1` in the relevant environment; keep it disabled for public deployments. |
| `npm test` cannot execute Bun | Install Bun and rerun the test script. |

## Security and responsible use

- Keep `IP2LOCATION_API_KEY` in the Fastly **Secret Store**, not in source control, query logs, or a public Config Store.
- Do not expose your origin directly to untrusted traffic if the application uses `X-IP2Location-*` values for security-sensitive decisions.
- The service removes incoming `X-IP2Location-*` headers before generating its own, but trusted-edge routing remains an essential part of the deployment model.
- Restrict access to the debug endpoint in production. `ALLOW_QUERY_IP=0` alone does not disable it.
- Use proxy flags, fraud scores, and other threat signals as **risk indicators**, not conclusive evidence of abuse or malicious intent.
- **IP geolocation is not GPS.** Results are approximate, can vary by network, and should not be used to pinpoint a person's physical location.

## Resources

- [IP2Location.io API and plans](https://www.ip2location.io/)
- [Fastly Compute documentation](https://www.fastly.com/documentation/guides/compute/)
- [Fastly CLI documentation](https://www.fastly.com/documentation/reference/cli/)
- [Fastly `fastly.toml` reference](https://www.fastly.com/documentation/reference/compute/fastly-toml/)
- [Source code](https://github.com/ip2location/fastly-ip2location-headers)
- [Report an issue or request an enhancement](https://github.com/ip2location/fastly-ip2location-headers/issues)

Contributions and issue reports are welcome. When reporting a problem, include the relevant lookup status, local or deployed environment, reproduction steps, and sanitized configuration details. **Do not include API keys or other credentials.**
