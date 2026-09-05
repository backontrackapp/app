<?php

declare(strict_types=1);

use BackOnTrack\Api\Config;
use BackOnTrack\Api\Database;

require __DIR__ . '/src/ApiException.php';
require __DIR__ . '/src/Config.php';
require __DIR__ . '/src/Database.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$options = getopt('', ['email:', 'role:', 'help']);
if (isset($options['help']) || !isset($options['email'], $options['role'])) {
    $output = isset($options['help']) ? STDOUT : STDERR;
    fwrite($output, "Usage: php server/admin-role.php --email=EMAIL --role=admin|none\n");
    exit(isset($options['help']) ? 0 : 1);
}

$email = is_string($options['email']) ? strtolower(trim($options['email'])) : '';
$roleInput = is_string($options['role']) ? strtolower(trim($options['role'])) : '';
$role = $roleInput === 'none' ? '' : $roleInput;
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || !in_array($role, ['', 'admin'], true)) {
    fwrite(STDERR, "Provide a valid email and role=admin|none.\n");
    exit(1);
}

try {
    $config = Config::load(__DIR__);
    $database = new Database($config->databasePath);
    $statement = $database->pdo->prepare('SELECT id, verified, token_key FROM users WHERE email = :email COLLATE NOCASE LIMIT 1');
    $statement->execute(['email' => $email]);
    $user = $statement->fetch();
    if (!is_array($user)) {
        throw new RuntimeException('No account uses that email address.');
    }
    if ($role === 'admin' && !(bool) $user['verified']) {
        throw new RuntimeException('Verify the account before granting administrator access.');
    }
    $tokenKey = $role === ''
        ? substr(rtrim(strtr(base64_encode(random_bytes(38)), '+/', '-_'), '='), 0, 50)
        : (string) $user['token_key'];
    $database->pdo->beginTransaction();
    $database->pdo->prepare(
        'UPDATE users SET admin_role = :role, token_key = :token_key, updated = :updated WHERE id = :id',
    )->execute([
        'role' => $role,
        'token_key' => $tokenKey,
        'updated' => (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v\Z'),
        'id' => $user['id'],
    ]);
    $database->pdo->prepare(
        'INSERT INTO admin_audit_log (
            id, admin_id, target_user_id, action, occurred_at, ip_hash, user_agent
         ) VALUES (
            :id, NULL, :target_user_id, :action, :occurred_at, :ip_hash, :user_agent
         )',
    )->execute([
        'id' => 'r' . bin2hex(random_bytes(7)),
        'target_user_id' => $user['id'],
        'action' => $role === 'admin' ? 'admin_role_granted' : 'admin_role_removed',
        'occurred_at' => (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z'),
        'ip_hash' => hash_hmac('sha256', 'local-cli', $config->secret),
        'user_agent' => 'scripts/admin-role',
    ]);
    $database->pdo->commit();
    fwrite(STDOUT, $role === 'admin'
        ? "Granted administrator access to {$email}.\n"
        : "Removed administrator access from {$email} and revoked its sessions.\n");
} catch (Throwable $exception) {
    if (isset($database) && $database->pdo->inTransaction()) {
        $database->pdo->rollBack();
    }
    fwrite(STDERR, 'Administrator role update failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
