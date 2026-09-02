<?php

declare(strict_types=1);

return [
    'version' => '202609010003',
    'name' => 'assistant_daily_token_usage',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(users)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('assistant_token_usage_day', $columns, true)) {
            $pdo->exec("ALTER TABLE users ADD COLUMN assistant_token_usage_day TEXT NOT NULL DEFAULT ''");
        }
        if (!in_array('assistant_token_usage', $columns, true)) {
            $pdo->exec('ALTER TABLE users ADD COLUMN assistant_token_usage INTEGER NOT NULL DEFAULT 0');
        }
    },
];
