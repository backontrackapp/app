# Web deployment

The `dev` branch deploys with the Vite `dev` mode. Its build requires `BACKONTRACK_REQUIRE_IPS`, a comma-separated allowlist of IPv4, IPv6, or CIDR entries. Local development builds read the setting from `.env.dev`; GitHub deployments read it from the `BACKONTRACK_REQUIRE_IPS` variable in the `Dev` environment. Builds created in Vite `dev` mode show a `DEV` tag immediately before the synchronization button in the app bar.

After validation, `pnpm build:dev` writes LiteSpeed-compatible `Order`, `Deny`, and `Allow` directives into `dist/.htaccess`. The authenticated `/server/migrate.php` endpoint remains reachable so the deployment workflow can apply migrations. All other web and API requests are limited to the allowlist.

Production uses `pnpm build:prod` and copies the unmodified `public/.htaccess`, so it has no IP allowlist.
