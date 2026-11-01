<?php

declare(strict_types=1);

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Tells the uploader that their file was found to contain malware and was deleted (13 §17). The file itself is never linked. */
final class AttachmentInfectedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly string $filename, public readonly string $signature)
    {
        $this->onQueue('mail');
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('An attachment was rejected: malware found')
            ->line("The file \"{$this->filename}\" you uploaded was scanned and flagged as {$this->signature}.")
            ->line('It has been deleted and was never made available to anyone. Check the file on your device before uploading anything again.');
    }
}
