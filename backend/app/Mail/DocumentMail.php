<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A document emailed to a customer or supplier. The subject and body are the finished text the sender confirmed: the views
 * print the body escaped, so nothing in it is ever treated as markup. The PDF is attached from memory.
 */
final class DocumentMail extends Mailable
{
    public function __construct(
        private readonly string $companyName,
        private readonly string $messageSubject,
        private readonly string $messageBody,
        private readonly string $attachmentName,
        private readonly string $pdf,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->messageSubject);
    }

    public function content(): Content
    {
        return new Content(view: 'mail.document', text: 'mail.document-text', with: ['company' => $this->companyName, 'body' => $this->messageBody]);
    }

    /** @return list<Attachment> */
    public function attachments(): array
    {
        return [Attachment::fromData(fn () => $this->pdf, $this->attachmentName)->withMime('application/pdf')];
    }
}
