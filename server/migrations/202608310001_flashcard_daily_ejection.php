<?php

declare(strict_types=1);

return [
    'version' => '202608310001',
    'name' => 'flashcard_daily_ejection',
    'up' => static function (\PDO $pdo): void {
        foreach (['flashcards', 'flashcard_review_card_stats'] as $table) {
            $columns = $pdo->query("PRAGMA table_info({$table})")->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array('last_ejected_at', $columns, true)) {
                $pdo->exec("ALTER TABLE {$table} ADD COLUMN last_ejected_at TEXT NOT NULL DEFAULT ''");
            }
        }
    },
];
