<?php

declare(strict_types=1);

return [
    'version' => '202609010002',
    'name' => 'remove_interval_flexible_repeats',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            UPDATE interval_templates
            SET definition = json_remove(definition, '$.globalRepetition')
            WHERE json_valid(definition)
              AND json_type(definition, '$.globalRepetition') IS NOT NULL;

            UPDATE interval_sessions
            SET definition_snapshot = json_remove(definition_snapshot, '$.globalRepetition')
            WHERE json_valid(definition_snapshot)
              AND json_type(definition_snapshot, '$.globalRepetition') IS NOT NULL;
            SQL);
    },
];
