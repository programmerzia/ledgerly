<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use finfo;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The company logo, kept on the private attachments disk under `{tenant}/{company}/logo/{random}` (never public; read
 * back only through the authorised settings route or embedded into a PDF). Only PNG and JPEG are accepted: the type is read
 * from the bytes, the size is capped and the image must decode with sane dimensions. SVG is refused on purpose (it can carry
 * script). The file is not ClamAV-scanned: it is decoded as an image and only ever embedded as an `<img>` data URI.
 */
final class LogoStore
{
    public const int MAX_BYTES = 512 * 1024;

    public const int MAX_SIDE = 4000;

    private const array TYPES = ['image/png' => 'png', 'image/jpeg' => 'jpg'];

    /**
     * Validates the bytes and writes them; returns the new storage key.
     *
     * @return array{path: string, mime: string}
     */
    public function put(string $tenantId, string $companyId, string $bytes): array
    {
        if ($bytes === '' || strlen($bytes) > self::MAX_BYTES) {
            throw DomainRuleViolation::single('logo_too_large', 'The logo must be a file of at most 512 KB.');
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        if (! is_string($mime) || ! isset(self::TYPES[$mime])) {
            throw DomainRuleViolation::single('logo_type_not_allowed', 'The logo must be a PNG or JPEG image.');
        }
        $size = @getimagesizefromstring($bytes);
        if ($size === false || $size[0] < 16 || $size[1] < 16 || $size[0] > self::MAX_SIDE || $size[1] > self::MAX_SIDE) {
            throw DomainRuleViolation::single('logo_dimensions', 'The logo must be an image between 16 and 4000 pixels on each side.');
        }
        $path = $tenantId.'/'.$companyId.'/logo/'.Str::random(40).'.'.self::TYPES[$mime];
        $this->disk()->put($path, $bytes);

        return ['path' => $path, 'mime' => $mime];
    }

    public function delete(?string $path): void
    {
        if ($path !== null && $path !== '') {
            $this->disk()->delete($path);
        }
    }

    /** @return array{bytes: string, mime: string}|null */
    public function read(Company $company): ?array
    {
        $path = $company->getAttribute('logo_path');
        if (! is_string($path) || $path === '' || ! $this->disk()->exists($path)) {
            return null;
        }
        $bytes = (string) $this->disk()->get($path);
        $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);

        return is_string($mime) && isset(self::TYPES[$mime]) ? ['bytes' => $bytes, 'mime' => $mime] : null;
    }

    public function dataUri(Company $company): ?string
    {
        $logo = $this->read($company);

        return $logo === null ? null : 'data:'.$logo['mime'].';base64,'.base64_encode($logo['bytes']);
    }

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('attachments.disk'));
    }
}
