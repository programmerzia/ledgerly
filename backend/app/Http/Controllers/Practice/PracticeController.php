<?php

declare(strict_types=1);

namespace App\Http\Controllers\Practice;

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Middleware\ResolveTenant;
use App\Http\Resources\PracticeOverviewResource;
use App\Models\Platform\User;
use App\Queries\Practice\PracticeOverview;
use Illuminate\Http\Request;
use Illuminate\Routing\Attributes\Controllers\Authorize;

/** Firm access (13 §7): works before a tenant is chosen, like `/me`; switching is `PUT /session/tenant`. */
final class PracticeController extends Controller
{
    #[Authorize('view', PracticeOverview::class)]
    public function overview(Request $request, PracticeOverview $overview): PracticeOverviewResource
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw DomainRuleViolation::single('unauthenticated', 'Sign in to continue.');
        }
        $current = $request->hasSession() ? $request->session()->get(ResolveTenant::SESSION_KEY) : null;

        return new PracticeOverviewResource(['practices' => $overview($user, is_string($current) ? $current : null)]);
    }
}
