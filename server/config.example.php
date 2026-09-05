<?php

declare(strict_types=1);

return [
    'BACKONTRACK_DB_PATH' => '/absolute/private/path/to/data.db',
    'BACKONTRACK_API_SECRET' => 'CHANGE_ME',
    'BACKONTRACK_MIGRATION_KEY' => 'CHANGE_ME',
    'BACKONTRACK_ALLOWED_ORIGINS' => 'https://backontrack.example.com,https://admin.backontrack.example.com,capacitor://localhost,http://localhost',
    'BACKONTRACK_TOKEN_TTL' => 604800,
    'BACKONTRACK_MAX_BODY_BYTES' => 2500000,
    'BACKONTRACK_APP_URL' => 'https://backontrack.example.com',
    'BACKONTRACK_ADMIN_URL' => 'https://admin.backontrack.example.com',
    'BACKONTRACK_ADMIN_TOKEN_TTL' => 28800,
    'BACKONTRACK_MAIL_HOST' => 'smtp.example.com',
    'BACKONTRACK_MAIL_PORT' => 587,
    'BACKONTRACK_MAIL_USERNAME' => 'smtp-user',
    'BACKONTRACK_MAIL_PASSWORD' => 'CHANGE_ME',
    'BACKONTRACK_MAIL_ENCRYPTION' => 'tls',
    'BACKONTRACK_MAIL_FROM_ADDRESS' => 'backontrack@example.com',
    'BACKONTRACK_MAIL_FROM_NAME' => 'BackOnTrack',
    'BACKONTRACK_OPENAI_API_KEY' => '',
    'BACKONTRACK_OPENAI_BASE_URL' => 'https://api.openai.com/v1',
    'BACKONTRACK_OPENAI_MODEL' => 'gpt-5.6-terra',
    'BACKONTRACK_OPENAI_DAILY_TOKEN_LIMIT' => 30000,
    'BACKONTRACK_PASSKEY_RP_ID' => 'backontrack.example.com',
    'BACKONTRACK_PASSKEY_ANDROID_PACKAGE' => 'app.backontrack.android',
    'BACKONTRACK_PASSKEY_ANDROID_KEY_HASHES' => 'BASE64URL_SHA256_OF_ANDROID_SIGNING_CERTIFICATE',
];
