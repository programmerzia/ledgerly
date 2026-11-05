<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * A short notice to one of our own users (an approval is waiting). Plain strings only: the views print them escaped, so nothing
 * a document's name or number contains is ever treated as markup.
 */
final class NoticeMail extends Mailable implements ShouldQueue
{
    use Queueable;
    use SerializesModels;

    public function __construct(
        private readonly string $headline,
        private readonly string $message,
        private readonly string $url,
        private readonly string $company,
    ) {
        $this->onQueue('mail');
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->headline);
    }

    public function content(): Content
    {
        return new Content(view: 'mail.notice', text: 'mail.notice-text', with: ['headline' => $this->headline, 'notice' => $this->message, 'url' => $this->url, 'company' => $this->company]);
    }
}
