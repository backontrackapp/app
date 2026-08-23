<?php

declare(strict_types=1);

return [
    'version' => '202608220001',
    'name' => 'task_quick_log',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN quick_log_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE tasks
                ADD COLUMN quick_log_sort_order NUMERIC NOT NULL DEFAULT 0;
            UPDATE tasks SET quick_log_sort_order = sort_order;
            SQL);
    },
];
