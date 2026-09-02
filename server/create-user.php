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
function createUserUsage(int $status = 0): never
{
    $output = $status === 0 ? STDOUT : STDERR;
    fwrite($output, <<<'USAGE'
Usage:
  php server/create-user.php --email=EMAIL --name=NAME --password-stdin [--timezone=IANA_TIMEZONE]

Creates an email-verified user in the configured database. Read the password from
standard input so it is not exposed in the shell history or process list.

Example:
  read -rs password; printf '%s' "$password" | php server/create-user.php \
    --email=person@example.com --name='Person Name' --timezone=America/Toronto --password-stdin

USAGE);
    exit($status);
}

/**
 * @return never
 */
function createUserFailure(string $message): never
{
    fwrite(STDERR, "User creation failed: {$message}\n");
    exit(1);
}

/**
 * Match the API's text-length behavior when mbstring is available.
 */
function createUserTextLength(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$options = getopt('', ['email:', 'name:', 'timezone::', 'password-stdin', 'help']);
if (array_key_exists('help', $options)) {
    createUserUsage();
}

if (
    !isset($options['email'], $options['name'])
    || !array_key_exists('password-stdin', $options)
    || count($argv) !== count($options) + 1
) {
    createUserUsage(1);
}

$emailValue = $options['email'];
$nameValue = $options['name'];
$timezoneValue = $options['timezone'] ?? 'UTC';
if (!is_string($emailValue) || !is_string($nameValue) || !is_string($timezoneValue)) {
    createUserUsage(1);
}

$email = strtolower(trim($emailValue));
$name = trim($nameValue);
$timezone = trim($timezoneValue);
$password = stream_get_contents(STDIN);
if ($password === false) {
    createUserFailure('Could not read the password from standard input.');
}

if ($email === '' || strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    createUserFailure('A valid email address is required.');
}
if ($name === '' || createUserTextLength($name) > 160) {
    createUserFailure('A name of at most 160 characters is required.');
}
if ($timezone === '' || createUserTextLength($timezone) > 80 || !in_array($timezone, timezone_identifiers_list(), true)) {
    createUserFailure('Use an IANA timezone identifier.');
}
if (strlen($password) < 8 || strlen($password) > 128) {
    createUserFailure('Use a password containing between 8 and 128 characters.');
}

try {
    $config = Config::load(__DIR__);
    $database = new Database($config->databasePath);
    $id = 'r' . bin2hex(random_bytes(7));
    $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v\\Z');
    $statement = $database->pdo->prepare(
        'INSERT INTO users (
            id, avatar, created, email, email_visibility, name,
            password, token_key, updated, verified, timezone
        ) VALUES (
            :id, :avatar, :created, :email, :email_visibility, :name,
            :password, :token_key, :updated, :verified, :timezone
        )',
    );
    $statement->execute([
        'id' => $id,
        'avatar' => '',
        'created' => $now,
        'email' => $email,
        'email_visibility' => 0,
        'name' => $name,
        'password' => password_hash($password, PASSWORD_DEFAULT),
        'token_key' => substr(rtrim(strtr(base64_encode(random_bytes(38)), '+/', '-_'), '='), 0, 50),
        'updated' => $now,
        'verified' => 1,
        'timezone' => $timezone,
    ]);
} catch (PDOException $exception) {
    if (str_contains(strtolower($exception->getMessage()), 'unique constraint failed: users.email')) {
        createUserFailure('An account with that email already exists.');
    }
    createUserFailure('Could not create the user. ' . $exception->getMessage());
} catch (ApiException $exception) {
    createUserFailure($exception->getMessage());
} catch (Throwable $exception) {
    createUserFailure('Could not create the user. ' . $exception->getMessage());
}

fwrite(STDOUT, "Created verified user {$id} for {$email}.\n");
