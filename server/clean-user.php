#!/usr/bin/env php
<?php

declare(strict_types=1);

use BackOnTrack\Api\ApiException;
use BackOnTrack\Api\Config;
use BackOnTrack\Api\Database;

require __DIR__ . '/src/ApiException.php';
require __DIR__ . '/src/Config.php';
require __DIR__ . '/src/Database.php';

/**
 * @return never
 */
function cleanUserUsage(int $status = 0): never
{
    $output = $status === 0 ? STDOUT : STDERR;
    fwrite($output, <<<'USAGE'
Usage:
  php server/clean-user.php --email=EMAIL

Permanently removes the user's application data while preserving the account's
email, password, display name, timezone, and verified status.

USAGE);
    exit($status);
}

/**
 * @return never
 */
function cleanUserFailure(string $message): never
{
    fwrite(STDERR, "User cleanup failed: {$message}\n");
    exit(1);
}

function cleanUserImageFilename(mixed $filename): ?string
{
    return is_string($filename) && preg_match('/^[a-f0-9]{48}\.jpg$/D', $filename) === 1
        ? $filename
        : null;
}

function cleanUserAudioFilename(mixed $filename): ?string
{
    return is_string($filename) && preg_match('/^[a-f0-9]{48}\.(?:webm|m4a)$/D', $filename) === 1
        ? $filename
        : null;
}

/**
 * @param list<string> $filenames
 * @param callable(string): bool $isUnused
 * @return list<string>
 */
function cleanUserFiles(string $directory, array $filenames, callable $isUnused): array
{
    $failed = [];
    foreach (array_unique($filenames) as $filename) {
        if (!$isUnused($filename)) {
            continue;
        }
        $path = $directory . DIRECTORY_SEPARATOR . $filename;
        if (is_file($path) && !@unlink($path)) {
            $failed[] = $path;
        }
    }
    return $failed;
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$options = getopt('', ['email:', 'help']);
if (array_key_exists('help', $options)) {
    cleanUserUsage();
}
if (!isset($options['email']) || count($argv) !== count($options) + 1 || !is_string($options['email'])) {
    cleanUserUsage(1);
}

$email = strtolower(trim($options['email']));
if ($email === '' || strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    cleanUserFailure('A valid email address is required.');
}

try {
    $config = Config::load(__DIR__);
    $database = new Database($config->databasePath);
    $pdo = $database->pdo;
    $findUser = $pdo->prepare('SELECT id, avatar FROM users WHERE email = :email COLLATE NOCASE LIMIT 1');
    $findUser->execute(['email' => $email]);
    $user = $findUser->fetch();
    if (!is_array($user)) {
        cleanUserFailure('No account exists for that email address.');
    }

    $account = (string) $user['id'];
    $selectFiles = static function (string $sql) use ($pdo, $account): array {
        $statement = $pdo->prepare($sql);
        $statement->execute(['account' => $account]);
        return $statement->fetchAll(PDO::FETCH_COLUMN);
    };
    $flashcardImages = array_values(array_filter(
        $selectFiles("SELECT image_file FROM flashcards WHERE owner = :account AND image_file <> ''"),
        'cleanUserImageFilename',
    ));
    $flashcardAudio = array_values(array_filter(
        array_merge(
            $selectFiles("SELECT front_audio_file FROM flashcards WHERE owner = :account AND front_audio_file <> ''"),
            $selectFiles("SELECT back_audio_file FROM flashcards WHERE owner = :account AND back_audio_file <> ''"),
        ),
        'cleanUserAudioFilename',
    ));
    $journalImages = array_values(array_filter(
        $selectFiles("SELECT image_file FROM journal_entries WHERE owner = :account AND image_file <> ''"),
        'cleanUserImageFilename',
    ));
    $taskLogImages = array_values(array_filter(
        $selectFiles("SELECT image_file FROM task_log_images WHERE owner = :account AND image_file <> ''"),
        'cleanUserImageFilename',
    ));
    $avatars = array_values(array_filter([$user['avatar']], 'cleanUserImageFilename'));

    $deleted = [];
    $transactionOpen = false;
    try {
        $pdo->exec('BEGIN IMMEDIATE');
        $transactionOpen = true;
        $delete = static function (string $table, string $where, array $parameters = []) use ($pdo, &$deleted, $account): void {
            $statement = $pdo->prepare("DELETE FROM {$table} WHERE {$where}");
            $statement->execute(['account' => $account, ...$parameters]);
            $deleted[$table] = ($deleted[$table] ?? 0) + $statement->rowCount();
        };

        $delete('backontrack_auth_tokens', 'user_id = :account');
        $delete('backontrack_passkey_challenges', 'user_id = :account');
        $delete('backontrack_passkeys', 'user_id = :account');
        $delete('client_errors', 'account_id = :account');

        $delete('flashcard_review_events', 'owner = :account');
        $delete('flashcard_review_sessions', 'owner = :account');
        $delete('flashcard_review_card_stats', 'reviewer = :account OR card IN (SELECT id FROM flashcards WHERE owner = :account)');
        $delete('flashcard_review_set_preferences', 'account = :account OR review_set IN (SELECT id FROM flashcard_review_sets WHERE owner = :account)');
        $delete('flashcard_review_set_shares', 'recipient = :account OR review_set IN (SELECT id FROM flashcard_review_sets WHERE owner = :account)');
        $updateReviewSessions = $pdo->prepare(
            "UPDATE flashcard_review_sessions
             SET review_set = ''
             WHERE review_set IN (SELECT id FROM flashcard_review_sets WHERE owner = :account)",
        );
        $updateReviewSessions->execute(['account' => $account]);

        $delete('entries', 'owner = :account');
        $delete('task_log_images', 'owner = :account');
        $delete('occurrences', 'owner = :account');
        $delete('program_steps', 'owner = :account');
        $delete('tasks', 'owner = :account');
        $delete('interval_sessions', 'owner = :account');
        $delete('interval_templates', 'owner = :account');
        $delete('tracking_entries', 'owner = :account');
        $delete('tracking_trackers', 'owner = :account');
        $delete('journal_entries', 'owner = :account');
        $delete('flashcards', 'owner = :account');
        $delete('flashcard_tags', 'owner = :account');
        $delete('flashcard_review_sets', 'owner = :account');
        $delete('tags', 'owner = :account');

        $delete('sync_operation_receipts', 'account_id = :account');
        $delete('sync_clients', 'account_id = :account');
        $delete('sync_retention_watermarks', 'account_id = :account');
        $delete('sync_change_log', 'account_id = :account');
        $delete('sync_record_versions', 'account_id = :account');

        $reset = $pdo->prepare(
            "UPDATE users
             SET avatar = '',
                 email_visibility = FALSE,
                 settings = '{}',
                 token_key = :token_key,
                 assistant_token_usage_day = '',
                 assistant_token_usage = 0,
                 assistant_daily_token_limit = NULL,
                 updated = :updated
             WHERE id = :account",
        );
        $reset->execute([
            'account' => $account,
            'token_key' => substr(rtrim(strtr(base64_encode(random_bytes(38)), '+/', '-_'), '='), 0, 50),
            'updated' => (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v\\Z'),
        ]);

        $pdo->exec('COMMIT');
        $transactionOpen = false;
    } catch (Throwable $exception) {
        if ($transactionOpen) {
            $pdo->exec('ROLLBACK');
        }
        throw $exception;
    }

    $storageRoot = dirname($config->databasePath);
    $failedFiles = [];
    $countReferences = static function (string $sql, string $filename) use ($pdo): int {
        $statement = $pdo->prepare($sql);
        $statement->execute(['filename' => $filename, 'needle' => '%' . $filename . '%']);
        return (int) $statement->fetchColumn();
    };
    $failedFiles = array_merge(
        $failedFiles,
        cleanUserFiles($storageRoot . '/avatars', $avatars, static function (string $filename) use ($pdo): bool {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM users WHERE avatar = :filename');
            $statement->execute(['filename' => $filename]);
            return (int) $statement->fetchColumn() === 0;
        }),
        cleanUserFiles($storageRoot . '/flashcard-images', $flashcardImages, static function (string $filename) use ($countReferences): bool {
            return $countReferences(
                'SELECT
                    (SELECT COUNT(*) FROM flashcards WHERE image_file = :filename)
                    + (SELECT COUNT(*) FROM flashcard_review_sessions WHERE queue_state LIKE :needle)
                    + (SELECT COUNT(*) FROM interval_sessions WHERE flashcard_snapshot LIKE :needle)',
                $filename,
            ) === 0;
        }),
        cleanUserFiles($storageRoot . '/flashcard-audio', $flashcardAudio, static function (string $filename) use ($countReferences): bool {
            return $countReferences(
                'SELECT
                    (SELECT COUNT(*) FROM flashcards WHERE front_audio_file = :filename OR back_audio_file = :filename)
                    + (SELECT COUNT(*) FROM flashcard_review_sessions WHERE queue_state LIKE :needle)
                    + (SELECT COUNT(*) FROM interval_sessions WHERE flashcard_snapshot LIKE :needle)',
                $filename,
            ) === 0;
        }),
        cleanUserFiles($storageRoot . '/journal-images', $journalImages, static function (string $filename) use ($pdo): bool {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM journal_entries WHERE image_file = :filename');
            $statement->execute(['filename' => $filename]);
            return (int) $statement->fetchColumn() === 0;
        }),
        cleanUserFiles($storageRoot . '/task-log-images', $taskLogImages, static function (string $filename) use ($pdo): bool {
            $statement = $pdo->prepare('SELECT COUNT(*) FROM task_log_images WHERE image_file = :filename');
            $statement->execute(['filename' => $filename]);
            return (int) $statement->fetchColumn() === 0;
        }),
    );

    $removedRows = array_sum($deleted);
    fwrite(STDOUT, "Cleaned {$removedRows} records for {$email}; existing sessions were revoked.\n");
    if ($failedFiles !== []) {
        fwrite(STDERR, 'Some unused upload files could not be removed: ' . implode(', ', $failedFiles) . "\n");
    }
} catch (ApiException $exception) {
    cleanUserFailure($exception->getMessage());
} catch (Throwable $exception) {
    cleanUserFailure('Could not clean the user. ' . $exception->getMessage());
}
