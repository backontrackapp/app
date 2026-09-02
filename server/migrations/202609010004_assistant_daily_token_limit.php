<?php

declare(strict_types=1);

return [
    'version' => '202609010004',
    'name' => 'assistant_daily_token_limit',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(users)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('assistant_daily_token_limit', $columns, true)) {
            $pdo->exec('ALTER TABLE users ADD COLUMN assistant_daily_token_limit INTEGER DEFAULT NULL');
        }
    },
];
