<?php

declare(strict_types=1);

namespace App\Domain\Documents;

/**
 * Subject and body templates for document emails. The only syntax is `{{ name }}` with a name from an allowlist; there
 * is no code, no filters and no includes. A value is substituted as plain text (the mail view escapes it for HTML), a
 * placeholder not on the list is rejected when the template is saved and renders as nothing if one slips through.
 */
final class MessageTemplate
{
    /** @var array<string, string> name → what it stands for */
    public const array PLACEHOLDERS = [
        'company_name' => 'Your company name',
        'contact_name' => 'The customer or supplier',
        'document_number' => 'Invoice, credit note or payment number',
        'document_type' => 'Invoice, Credit note, Statement or Payment advice',
        'issue_date' => 'Date of the document',
        'due_date' => 'Due date (invoices)',
        'total' => 'Document total with currency',
        'amount_due' => 'Amount still unpaid, with currency',
        'days_overdue' => 'Days past the due date (overdue reminders)',
        'invoice_link' => 'Online link to view and download the invoice (invoices only; making it needs the right to share)',
        'period_from' => 'Statement start date',
        'period_to' => 'Statement end date',
        'closing_balance' => 'Statement closing balance',
        'sender_name' => 'The person sending',
        'payment_instructions' => 'Payment instructions from your document settings',
    ];

    private const string PATTERN = '/\{\{\s*([a-z_]+)\s*\}\}/';

    /** @return list<string> placeholder names used in $text that are not allowed */
    public static function unknown(string $text): array
    {
        preg_match_all('/\{\{\s*([^}]*?)\s*\}\}/', $text, $m);

        return array_values(array_unique(array_filter($m[1], fn (string $n) => ! array_key_exists($n, self::PLACEHOLDERS))));
    }

    /** Whether $text uses the placeholder $name. */
    public static function uses(string $text, string $name): bool
    {
        preg_match_all(self::PATTERN, $text, $m);

        return in_array($name, $m[1], true);
    }

    /** @param array<string, string> $values */
    public static function render(string $text, array $values): string
    {
        return (string) preg_replace_callback(self::PATTERN, fn (array $m): string => array_key_exists($m[1], self::PLACEHOLDERS) ? ($values[$m[1]] ?? '') : '', $text);
    }
}
