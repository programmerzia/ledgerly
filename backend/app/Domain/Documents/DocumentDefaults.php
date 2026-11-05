<?php

declare(strict_types=1);

namespace App\Domain\Documents;

/** What a company's document look and email templates are until it changes them. */
final class DocumentDefaults
{
    public const string ACCENT = '#1F4E79';

    /** Email templates exist for the documents that can be sent (plan 3c.5). */
    public const array EMAIL_TYPES = ['invoice', 'credit_note', 'statement', 'payment_advice'];

    /** @return array<string, array{subject: string, body: string}> */
    public static function emailTemplates(): array
    {
        return [
            'invoice' => [
                'subject' => 'Invoice {{document_number}} from {{company_name}}',
                'body' => "Dear {{contact_name}},\n\nPlease find attached invoice {{document_number}} dated {{issue_date}} for {{total}}, due on {{due_date}}.\n\n{{payment_instructions}}\n\nKind regards,\n{{sender_name}}\n{{company_name}}",
            ],
            'credit_note' => [
                'subject' => 'Credit note {{document_number}} from {{company_name}}',
                'body' => "Dear {{contact_name}},\n\nPlease find attached credit note {{document_number}} dated {{issue_date}} for {{total}}.\n\nKind regards,\n{{sender_name}}\n{{company_name}}",
            ],
            'statement' => [
                'subject' => 'Statement of account from {{company_name}}',
                'body' => "Dear {{contact_name}},\n\nPlease find attached your statement for {{period_from}} to {{period_to}}. The balance at {{period_to}} is {{closing_balance}}.\n\n{{payment_instructions}}\n\nKind regards,\n{{sender_name}}\n{{company_name}}",
            ],
            'payment_advice' => [
                'subject' => 'Payment advice {{document_number}} from {{company_name}}',
                'body' => "Dear {{contact_name}},\n\nWe have made a payment of {{total}} on {{issue_date}}. The attached advice lists the documents it settles.\n\nKind regards,\n{{sender_name}}\n{{company_name}}",
            ],
        ];
    }
}
