<?php

declare(strict_types=1);

return [
    'version' => '202608270001',
    'name' => 'flashcard_review_set_icons',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(flashcard_review_sets)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('icon', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets ADD COLUMN icon VARCHAR(64) NOT NULL DEFAULT ''",
            );
        }
    },
];
