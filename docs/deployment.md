# Web deployment

The `dev` branch deploys with the Vite `dev` mode. The GitHub `Dev` environment provides `BACKONTRACK_REQUIRE_IPS`, a comma-separated allowlist of IPv4, IPv6, or CIDR entries, directly to the build process. Builds created in Vite `dev` mode append `-dev` to the version shown in the account menu.

After validation, `pnpm build:dev` writes LiteSpeed-compatible `Order`, `Deny`, and `Allow` directives into `dist/.htaccess`. The authenticated `/server/migrate.php` endpoint remains reachable so the deployment workflow can apply migrations. All other web and API requests are limited to the allowlist.

Production uses `pnpm build:prod` and copies the unmodified `public/.htaccess`, so it has no IP allowlist.
