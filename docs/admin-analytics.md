# Admin analytics

BackOnTrack's administrator dashboard is a separate static Vue application hosted at `admin.backontrack.app`. It calls the authenticated `/admin/*` routes in this repository's PHP API. The dashboard has no database driver or database path configuration; `BACKONTRACK_DB_PATH` in this repository's root `.env` remains authoritative.

## Access and authentication

Administrator access is a role on an existing verified account. After the database migration is current, grant or remove that role with:

```bash
./scripts/admin-role person@example.com admin
./scripts/admin-role person@example.com none
```

Admin authentication requires the account password followed by a six-digit email code. Challenges expire after ten minutes and allow at most five code attempts. Successful verification creates a signed JWT with an `admin` scope and an eight-hour default lifetime. Normal app endpoints reject scoped admin tokens. Removing an admin role rotates the account token key so existing privileged and normal app tokens stop working.

Set `BACKONTRACK_ADMIN_URL` to the dashboard's public HTTPS origin and optionally change `BACKONTRACK_ADMIN_TOKEN_TTL`. Add that origin to `BACKONTRACK_ALLOWED_ORIGINS`. Existing SMTP variables deliver the verification code. Sign-ins, failed attempts, and user-detail views are written to `admin_audit_log`; IP addresses are stored only as keyed hashes.

## Event contract

Authenticated clients batch up to 50 events to `POST /analytics/events`. Each event is idempotent by its random ID and contains only:

- an allowlisted event name;
- an allowlisted canonical screen or key action when applicable;
- random session and pseudonymous sync-client IDs;
- occurrence time and foreground duration for completed sessions;
- platform and app version on the enclosing batch.

No free-form properties are accepted. Task titles and descriptions, journal text, tracker notes, flashcard content, assistant prompts and responses, route parameters, query strings, URLs, and arbitrary metadata cannot be included in this endpoint. Events older than 13 months are rejected and stored events are purged to the same rolling window during ingestion.

Analytics are enabled by default. The Settings switch updates `productAnalyticsEnabled` through the same optimistic offline-first settings flow as other preferences. Turning it off immediately clears the device queue and deletes that account's `analytics_events` rows when the preference reaches the server. Operational app data and security diagnostics retain their existing lifecycles.

## Metrics

Activation means reaching at least one meaningful outcome within seven days of registration: task progress or completion, a completed interval, a resolved flashcard review event, a tracking entry, or a journal entry. Dashboard date ranges use the administrator's selected IANA timezone and are limited to 366 days.

The dashboard reports registration and active-user trends, a registration-to-outcome funnel, DAU/WAU/MAU, foreground sessions and duration, weekly retention cohorts, screen use, key-action funnels, feature adoption, client-error health, sync-client recency, and privacy-limited user support details. User detail responses may include names of tasks, interval templates, Review sets, and trackers, but never descriptions, notes, journal bodies, flashcard faces, or assistant conversations.

## Schema and deployment

Migration `202609030001_admin_analytics` adds the admin role, one-time login challenges, analytics events, and audit log. Run it from this repository before deploying either client:

```bash
php server/migrate.php
```

Deploy the PHP changes and migrate first, then release the main client telemetry and the separate admin frontend. A pre-analytics information banner in the dashboard makes clear that session and screen history begins only after instrumented clients are released.
