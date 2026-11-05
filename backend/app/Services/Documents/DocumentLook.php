<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Domain\Documents\DocumentDefaults;
use App\Models\Organisation\CompanySettings;

/**
 * A company's document look and email templates, read from `company_settings.document_templates` with the defaults
 * filled in. Stored shape: `{accent_color, footer_text, payment_instructions, email: {type: {subject, body}}}`.
 */
final class DocumentLook
{
    /**
     * @return array{accent_color: string, footer_text: string, payment_instructions: string, email: array<string, array{subject: string, body: string}>}
     */
    public function for(string $companyId): array
    {
        $settings = CompanySettings::query()->where('company_id', $companyId)->first();
        $raw = $settings === null ? [] : $settings->getAttribute('document_templates');
        $raw = is_string($raw) ? json_decode($raw, true) : $raw;

        return self::normalise(is_array($raw) ? $raw : []);
    }

    /**
     * @param  array<string, mixed>  $stored
     * @return array{accent_color: string, footer_text: string, payment_instructions: string, email: array<string, array{subject: string, body: string}>}
     */
    public static function normalise(array $stored): array
    {
        $accent = $stored['accent_color'] ?? null;
        $email = DocumentDefaults::emailTemplates();
        $saved = is_array($stored['email'] ?? null) ? $stored['email'] : [];
        foreach ($email as $type => $default) {
            $mine = $saved[$type] ?? null;
            if (is_array($mine)) {
                $email[$type] = [
                    'subject' => is_string($mine['subject'] ?? null) && $mine['subject'] !== '' ? $mine['subject'] : $default['subject'],
                    'body' => is_string($mine['body'] ?? null) && $mine['body'] !== '' ? $mine['body'] : $default['body'],
                ];
            }
        }

        return [
            'accent_color' => is_string($accent) && preg_match('/^#[0-9A-Fa-f]{6}$/', $accent) === 1 ? strtoupper($accent) : DocumentDefaults::ACCENT,
            'footer_text' => is_string($stored['footer_text'] ?? null) ? $stored['footer_text'] : '',
            'payment_instructions' => is_string($stored['payment_instructions'] ?? null) ? $stored['payment_instructions'] : '',
            'email' => $email,
        ];
    }
}
