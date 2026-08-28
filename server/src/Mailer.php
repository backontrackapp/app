<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use PHPMailer\PHPMailer\PHPMailer;
use RuntimeException;
use Throwable;

final class Mailer
{
    private const ACCOUNT_ACTION_TEMPLATE = 'account-action.html';

    public function __construct(private readonly Config $config)
    {
    }

    public function sendEmailConfirmation(string $email, string $token): void
    {
        $url = $this->actionUrl('/verify-email', $token);
        $this->send(
            $email,
            'Confirm your email',
            'Confirm your email',
            'Confirm ' . $email . ' to finish creating your BackOnTrack account.',
            'Confirm email',
            $url,
            'This link expires in 24 hours.',
            self::ACCOUNT_ACTION_TEMPLATE,
        );
    }

    public function sendPasswordReset(string $email, string $token): void
    {
        $url = $this->actionUrl('/reset-password', $token);
        $this->send(
            $email,
            'Reset your password',
            'Reset your password',
            'Use this link to choose a new password for your BackOnTrack account.',
            'Reset password',
            $url,
            'This link expires in 1 hour. Ignore this email if you did not request it.',
            self::ACCOUNT_ACTION_TEMPLATE,
        );
    }

    private function actionUrl(string $path, string $token): string
    {
        if ($this->config->appUrl === '') {
            throw new ApiException(503, 'Email delivery is not configured.');
        }

        return $this->config->appUrl . $path . '?token=' . rawurlencode($token);
    }

    private function send(
        string $recipient,
        string $subject,
        string $heading,
        string $message,
        string $action,
        string $url,
        string $footer,
        string $template,
    ): void {
        if ($this->config->mailHost === '' || $this->config->mailFromAddress === '') {
            throw new ApiException(503, 'Email delivery is not configured.');
        }

        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host = $this->config->mailHost;
            $mail->Port = $this->config->mailPort;
            $mail->SMTPAuth = $this->config->mailUsername !== '';
            $mail->Username = $this->config->mailUsername;
            $mail->Password = $this->config->mailPassword;
            $mail->SMTPSecure = $this->config->mailEncryption;
            $mail->SMTPAutoTLS = $this->config->mailEncryption !== '';
            $mail->Timeout = 10;
            $mail->CharSet = PHPMailer::CHARSET_UTF8;
            $mail->setFrom($this->config->mailFromAddress, $this->config->mailFromName);
            $mail->addAddress($recipient);
            $mail->Subject = $subject;
            $mail->isHTML(true);
            $mail->Body = $this->renderHtmlTemplate($template, [
                'heading' => $heading,
                'message' => $message,
                'action' => $action,
                'url' => $url,
                'footer' => $footer,
            ]);
            $mail->AltBody = implode("\n\n", [$heading, $message, $action . ': ' . $url, $footer]);
            $mail->send();
        } catch (Throwable $exception) {
            error_log('[backontrack-api/mail] ' . $exception->getMessage());
            throw new ApiException(
                503,
                'We could not send the email. Please verify your information.',
                [],
                $exception,
            );
        }
    }

    /**
     * @param array<string, string> $variables
     */
    private function renderHtmlTemplate(string $template, array $variables): string
    {
        if (basename($template) !== $template || !str_ends_with($template, '.html')) {
            throw new RuntimeException('The email template name is invalid.');
        }

        $path = dirname(__DIR__) . '/templates/' . $template;
        if (!is_file($path) || !is_readable($path)) {
            throw new RuntimeException('The email template is unavailable.');
        }

        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException('The email template could not be read.');
        }

        $rendered = preg_replace_callback(
            '/{{\s*([a-z][a-z0-9_]*)\s*}}/',
            static function (array $matches) use ($variables): string {
                $name = $matches[1];
                if (!array_key_exists($name, $variables)) {
                    throw new RuntimeException('The email template contains an unknown placeholder.');
                }

                return htmlspecialchars(
                    $variables[$name],
                    ENT_QUOTES | ENT_SUBSTITUTE,
                    'UTF-8',
                );
            },
            $contents,
        );
        if ($rendered === null) {
            throw new RuntimeException('The email template could not be parsed.');
        }

        return $rendered;
    }
}
