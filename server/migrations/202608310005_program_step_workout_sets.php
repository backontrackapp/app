<?php

declare(strict_types=1);

return [
    'version' => '202608310005',
    'name' => 'program_step_workout_sets',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE occurrences
                ADD COLUMN workout_sets JSON NOT NULL DEFAULT '{}';
            SQL);
    },
];
