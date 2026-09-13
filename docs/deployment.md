# Spendly on Vultr

## Live service

- Web app and backend: **https://64.177.45.109**
- Host: Vultr Ubuntu 22.04, Node 22.
- Nginx serves the Expo web export and proxies `/api/` to Next.js on `127.0.0.1:3000`.
- The backend runs as the unprivileged `spendly` system user through `spendly.service`, enabled at boot and restarted on failure.
- Runtime secrets are stored outside web/release directories in `/etc/spendly/backend.json`, owned by root, group spendly, mode 640. They are loaded before Next starts.
- The firewall permits SSH, HTTP, and HTTPS. The Node port is bound only to localhost.
- HTTPS uses a publicly trusted Let's Encrypt IP-address certificate. `spendly-cert-renew.timer` checks twice daily, and the deploy hook reloads Nginx after renewal. The simulated renewal and Nginx reload check passed.
- Nginx overwrites forwarded client IP headers; the backend trusts only that local proxy. Browser sessions use Secure/HttpOnly cookies. The public web app and API are same-origin.

The primary app account is linked to the configured Nessie checking account and dedicated Backboard assistant. Connected analysis returned live Nessie, Tiger Data, and Backboard service modes. Account linkage did not create a bank purchase.

## Verified deployment

Public HTTPS API checks passed: registration, protected profile, rejection of an untrusted origin, financial analysis, refresh rotation, logout revocation, secure browser cookie, and temporary-account deletion. A real product-tag scan returned Columbia Arcadia Jacket, $54.99, FULL_SUCCESS in approximately 3.8 seconds.

Browser checks at the public URL passed registration, input validation, persistent sessions, profile edits, password changes, logout, login, protected-route redirects, and account deletion. Test accounts were deleted. Password-reset email delivery remains a separate, unconfigured feature.

## App configuration

`.env.local` now has `EXPO_PUBLIC_API_URL=https://64.177.45.109`. Expo was restarted with that URL and iOS/Android bundles were exported successfully. Reload Expo Go to fetch the updated JavaScript. Existing installed standalone apps require rebuilding to receive changed public environment values.

The deployed Expo web app provides the complete account interface at the same URL; the separate Next.js preview is not the public frontend.

## Operations and future updates

Deployment files live in `deploy/`: server provisioning, Node startup, systemd units, Nginx config, and the certificate-renewal timer. `scripts/configure-vultr.mjs` transfers an explicit allowlist of environment values through SSH stdin, converts the local financial schedule to server-only JSON, and never places values in command-line arguments. Establish a verified SSH connection before using it; do not save the server password in scripts.

Current backend release: `/opt/spendly/releases/20260913`; `/opt/spendly/current` selects the active release. Current web release: `/var/www/spendly/releases/20260913`; `/var/www/spendly/current` selects the web export. For subsequent releases, use a new timestamped directory, build before switching the symlink, restart the backend, and rerun public API checks. Retain the previous release for rollback.

Useful server commands:

```sh
systemctl status spendly nginx --no-pager
systemctl list-timers spendly-cert-renew.timer
journalctl -u spendly -n 50 --no-pager
/opt/certbot/bin/certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew
```

Certificate setup follows the [Let's Encrypt IP-certificate guide](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/). No Vercel project or service is used.

## Physical-device verification remains outstanding

No phone or simulator was available on the development Mac. Native exports and browser tests do not validate actual camera permissions, SecureStore behavior, background/resume, or native reset deep links. Connect a trusted device for those checks. Spendly's iOS/Android identifiers are `com.spendly.app`, with `spendly` and the legacy deep-link scheme supported.
