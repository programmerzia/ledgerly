<?php

declare(strict_types=1);

namespace App\Notifications;

use App\Actions\Organisation\InviteMember;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** The invitation email; the link carries the only copy of the raw token. */
final class InvitationNotification extends Notification
{
    use Queueable;

    public function __construct(public readonly string $token, public readonly string $organisation, public readonly string $inviter) {}

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("{$this->inviter} invited you to {$this->organisation} on Ledgerly")
            ->line("{$this->inviter} invited you to join {$this->organisation}.")
            ->action('Accept invitation', rtrim((string) config('app.frontend_url'), '/').'/invitations/'.$this->token)
            ->line('The link expires in '.InviteMember::VALID_DAYS.' days. If you did not expect it, ignore this email.');
    }
}
