<?php

declare(strict_types=1);

return [
    'version' => '202608280001',
    'name' => 'program_step_requirement_exercises',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            UPDATE program_steps
            SET completions = (
                SELECT json_group_array(json(
                    CASE
                        WHEN json_type(completion.value, '$.exercise') IS NULL
                            THEN json_set(completion.value, '$.exercise', '')
                        ELSE completion.value
                    END
                ))
                FROM json_each(program_steps.completions) AS completion
            )
            WHERE json_valid(completions)
              AND json_type(completions) = 'array';
            SQL);
    },
];
