<?php

declare(strict_types=1);

return [
    'version' => '202608310004',
    'name' => 'recent_session_presentations',
    'up' => static function (\PDO $pdo): void {
        foreach (['interval_sessions', 'flashcard_review_sessions'] as $table) {
            $columns = $pdo->query("PRAGMA table_info($table)")
                ->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array('presentation_snapshot', $columns, true)) {
                $pdo->exec(
                    "ALTER TABLE $table ADD COLUMN presentation_snapshot JSON NOT NULL DEFAULT '{}'",
                );
            }
        }
    },
];
