<?php

declare(strict_types=1);

return [
    'version' => '202609030001',
    'name' => 'admin_analytics',
    'up' => static function (\PDO $pdo): void {
        $userColumns = $pdo->query('PRAGMA table_info(users)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('admin_role', $userColumns, true)) {
            $pdo->exec("ALTER TABLE users ADD COLUMN admin_role TEXT NOT NULL DEFAULT '' CHECK (admin_role IN ('', 'admin'))");
        }

        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS admin_login_challenges (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_login_challenges_expiry
    ON admin_login_challenges (expires_at);

CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    screen TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    platform TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_account_occurred
    ON analytics_events (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_account
    ON analytics_events (occurred_at, account_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_occurred
    ON analytics_events (event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_screen_occurred
    ON analytics_events (screen, occurred_at) WHERE screen <> '';
CREATE INDEX IF NOT EXISTS idx_analytics_events_action_occurred
    ON analytics_events (action, occurred_at) WHERE action <> '';
CREATE INDEX IF NOT EXISTS idx_analytics_events_received
    ON analytics_events (received_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    admin_id TEXT,
    target_user_id TEXT,
    action TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_occurred
    ON admin_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin
    ON admin_audit_log (admin_id, occurred_at DESC);
SQL);
    },
];
