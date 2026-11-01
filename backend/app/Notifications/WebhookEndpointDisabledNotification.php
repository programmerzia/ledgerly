<?php

declare(strict_types=1);

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Tells organisation owners that a webhook endpoint was switched off by the system (13 §15). Carries no secret and no path or query of the URL. */
final class WebhookEndpointDisabledNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly string $host, public readonly string $reason, public readonly string $organisation)
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
        $why = $this->reason === 'gone'
            ? 'The receiver answered 410 Gone, which means it no longer wants these events.'
            : 'Every delivery attempt failed for 24 hours.';

        return (new MailMessage)
            ->subject("Webhook endpoint {$this->host} was disabled")
            ->line("Ledgerly stopped sending webhooks for {$this->organisation} to {$this->host}.")
            ->line($why)
            ->line('Events that were waiting were not sent. Fix the receiver, then enable the endpoint again and redeliver what you missed.')
            ->action('Open webhook settings', rtrim((string) config('app.frontend_url'), '/').'/settings/webhooks');
    }
}
