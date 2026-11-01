<?php

declare(strict_types=1);

namespace App\Services\Files;

use App\Contracts\AttachmentStore;
use App\Models\Files\Attachment;
use App\Support\Files\UploadTarget;
use DateTimeInterface;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use LogicException;

/**
 * Attachment bytes on a private local disk (dev and tests). "Presigned" targets are this app's own signed routes
 * (`attachment-uploads.put`, `attachment-files.show`), so the same flow runs everywhere; an S3/MinIO store would
 * return real presigned URLs instead. Keys: `{tenant}/{company}/{quarantine|clean}/{40 random chars}`, with the
 * random part from a CSPRNG (not derivable from any id).
 */
final class LocalAttachmentStore implements AttachmentStore
{
    private const string QUARANTINE = '/quarantine/';

    private const string CLEAN = '/clean/';

    public function quarantineKey(string $tenantId, string $companyId): string
    {
        return $tenantId.'/'.$companyId.self::QUARANTINE.Str::random(40);
    }

    public function cleanKey(string $quarantineKey): string
    {
        if (substr_count($quarantineKey, self::QUARANTINE) !== 1) {
            throw new LogicException('Not a quarantine key.');
        }

        return str_replace(self::QUARANTINE, self::CLEAN, $quarantineKey);
    }

    public function uploadTarget(Attachment $attachment, DateTimeInterface $expires): UploadTarget
    {
        $url = URL::temporarySignedRoute('attachment-uploads.put', $expires, ['tenant' => $attachment->tenant_id, 'file' => $attachment->id]);

        return new UploadTarget($url, 'PUT', ['Content-Type' => 'application/octet-stream'], $expires);
    }

    public function downloadUrl(Attachment $attachment, DateTimeInterface $expires): string
    {
        return URL::temporarySignedRoute('attachment-files.show', $expires, ['tenant' => $attachment->tenant_id, 'file' => $attachment->id]);
    }

    /**
     * Stores an upload received on the signed PUT route, at most $max bytes. Returns the bytes written, or null (and
     * stores nothing) when the body is larger than $max.
     *
     * @param  resource  $input
     */
    public function receive(string $key, $input, int $max): ?int
    {
        $tmp = tmpfile();
        if ($tmp === false) {
            throw new LogicException('No temporary file.');
        }
        $total = 0;
        while (! feof($input)) {
            $chunk = fread($input, 65536);
            if ($chunk === false || $chunk === '') {
                continue;
            }
            $total += strlen($chunk);
            if ($total > $max) {
                fclose($tmp);

                return null;
            }
            fwrite($tmp, $chunk);
        }
        rewind($tmp);
        $this->disk()->writeStream($key, $tmp);
        fclose($tmp);

        return $total;
    }

    public function size(string $key): ?int
    {
        return $this->disk()->exists($key) ? $this->disk()->size($key) : null;
    }

    public function sha256(string $key): ?string
    {
        $stream = $this->readStream($key);
        if ($stream === null) {
            return null;
        }
        $hash = hash_init('sha256');
        hash_update_stream($hash, $stream);
        fclose($stream);

        return hash_final($hash);
    }

    public function readStream(string $key)
    {
        if (! $this->disk()->exists($key)) {
            return null;
        }
        $stream = $this->disk()->readStream($key);

        return is_resource($stream) ? $stream : null;
    }

    public function copy(string $from, string $to): void
    {
        $this->disk()->copy($from, $to);
    }

    public function delete(string $key): void
    {
        $this->disk()->delete($key);
    }

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('attachments.disk'));
    }
}
