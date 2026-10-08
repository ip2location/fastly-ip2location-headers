# fastly-ip2location-headers

A Fastly Compute service that adds **IP2Location.io** data to the origin request as headers.



## Headers

Only fields Fastly does not already resolve.

| Header | Plan |
| --- | --- |
| `X-IP2Location-Is-Proxy` | Keyless |
| `X-IP2Location-ISP`, `-Domain`, `-Net-Speed`, `-Usage-Type`, `-IDD-Code`, `-Elevation` | Starter |
| `X-IP2Location-Country-Currency`, `-Country-Currency-Symbol`, `-Country-Language`, `-Country-Demonym`, `-Country-Capital`, `-Country-TLD` | Plus |
| `X-IP2Location-Time-Abbr`, `-Time-DST` | Plus |
| `X-IP2Location-Address-Type` | Plus |
| `X-IP2Location-Mobile-MCC`, `-MNC`, `-Brand` | Plus |
| `X-IP2Location-District` | Security |
| `X-IP2Location-AS-Domain`, `-AS-Usage-Type`, `-AS-CIDR` | Security |
| `X-IP2Location-Ads-Category` | Security |
| `X-IP2Location-Fraud-Score` | Security |
| `X-IP2Location-Proxy-Type`, `-Proxy-Provider`, `-Threat`, `-Proxy-Last-Seen`, `-Proxy-Flags` | Security |
| `X-IP2Location-Is-VPN`, `-Is-Tor`, `-Is-Data-Center`, `-Is-AI-Crawler` | Security |

Sign up for a free API key from [https://www.ip2location.io](https://www.ip2location.io/?utm_source=fastly-ip2location).



Headers for diagnose:

| Header | Values |
| --- | --- |
| `X-IP2Location-Lookup` | `hit` `miss` `error` `invalid` `off` |
| `X-IP2Location-Error` | Only on failure |



## Configuration

All settings live in the Config Store named `ip2location_config`, except the key.

| Key | Default | Meaning |
| --- | --- | --- |
| `CACHE_TTL` | `3600` | Seconds a lookup stays cached. `0` = one API call per request |
| `BACKEND` | `origin` | Backend serving your site |
| `API_BACKEND` | `ip2location` | Backend for api.ip2location.io |
| `ALLOW_QUERY_IP` | `0` | Allow `?ip=` on the debug endpoint |
| `ALLOWED_ORIGINS` | `*` | CORS origin for the debug endpoint |

In the Secret Store named `ip2location_secret`:

| Key | Meaning |
| --- | --- |
| `IP2LOCATION_API_KEY` | API key. Absent uses the keyless API |



## Caching

Lookups are cached in Fastly's **SimpleCache**, which lives at the POP rather than in one isolate, so entries are shared by every request that lands there. Entries are keyed by network (`/24` for IPv4, `/48` for IPv6), the same approach as the other versions, so one API call covers a whole subnet for the TTL.


## Deploy

```bash
npm install
npx fastly compute publish
```

Then create the backends, the stores, and the bindings:

```bash
npx fastly backend create --name origin       --address your-origin.example.com --version latest --autoclone

npx fastly config-store create --name ip2location_config
npx fastly secret-store create --name ip2location_secret
```

Add the Config Store and Secret Store as resource links on the service, set `IP2LOCATION_API_KEY` in the secret store, and attach the service to the domain you want enriched.



## Local Development

```bash
cp .env.example .env      # Then insert your API key
bun test
bun x tsc --noEmit
bun run live
npx fastly compute serve
```

`.env` is read only by the live check script. The service itself reads the Config and Secret Stores.

With `ALLOW_QUERY_IP` set locally, `curl 'http://127.0.0.1:7676/__ip2location?ip=8.8.8.8'` shows the lookup result.


## Access the Headers in Web Applications

#### PHP

```php
$isp     = $_SERVER['HTTP_X_IP2LOCATION_ISP'] ?? null;
$flags   = $_SERVER['HTTP_X_IP2LOCATION_PROXY_FLAGS'] ?? '';
$isProxy = $_SERVER['HTTP_X_IP2LOCATION_IS_PROXY'] === 'true';
$isVpn   = str_contains($flags, 'vpn');
```

#### Node.js

```js
const isp     = req.get('x-ip2location-isp');
const flags   = req.get('x-ip2location-proxy-flags') ?? '';
const isProxy = req.get('x-ip2location-is-proxy') === 'true';
const isVpn   = flags.split(',').includes('vpn');
```

#### Python

```python
isp      = request.headers.get('X-IP2Location-ISP')
flags    = request.headers.get('X-IP2Location-Proxy-Flags', '')
is_proxy = request.headers.get('X-IP2Location-Is-Proxy') == 'true'
is_vpn   = 'vpn' in flags.split(',')
```



## Debug Endpoint

`GET /__ip2location` returns the lookup result, the headers that would be sent, the raw payload, and `fastlyGeo` for comparison with what Fastly itself resolved. `?ip=` only works when `ALLOW_QUERY_IP=1`.
