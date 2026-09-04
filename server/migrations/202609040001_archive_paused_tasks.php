<?php

declare(strict_types=1);

return [
    'version' => '202609040001',
    'name' => 'archive_paused_tasks',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            UPDATE tasks
            SET archived = 1, active = 1
            WHERE active = 0;
            SQL);
    },
];
