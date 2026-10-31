<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Http\Resources\CompanyResource;
use App\Http\Resources\InvitationResource;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The current representation of a subject, for an idempotent retry whose change committed but
 * whose response was never stored (13 §11). Each API resource registers its table here.
 */
final class SubjectRepresenter
{
    /** @var array<string, array{class-string<Model>, class-string<JsonResource>}> */
    private const array RESOURCES = [
        'companies' => [Company::class, CompanyResource::class],
        'invitations' => [Invitation::class, InvitationResource::class],
    ];

    public function represent(?string $subjectType, ?string $subjectId): JsonResponse
    {
        if ($subjectType === null || $subjectId === null) {
            return new JsonResponse(['data' => null]);
        }
        [$model, $resource] = self::RESOURCES[$subjectType] ?? [null, null];
        $found = $model === null ? null : $model::query()->find($subjectId);
        if ($found === null || $resource === null) {
            return new JsonResponse(['data' => ['type' => $subjectType, 'id' => $subjectId]]);
        }

        return (new $resource($found))->response()->setStatusCode(200);
    }
}
