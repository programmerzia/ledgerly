<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\BaseModel;
use App\Models\Trade\Contact;
use Illuminate\Http\Request;

/**
 * Which route families print and how a request's bound document becomes a document type. A route addresses the
 * document the way viewing it does (`/invoices/{invoice}`), so the same policy and company binding decide who may
 * read it. Statements hang off the contact: `/contacts/{contact}/statement`.
 */
final class DocumentRoutes
{
    /** @var array<string, string> URL path → bound route parameter */
    public const array FAMILIES = [
        'invoices' => 'invoice', 'bills' => 'bill', 'settlements' => 'settlement', 'purchase-orders' => 'purchaseOrder',
        'journals' => 'journal', 'wht-certificates' => 'whtCertificate', 'contacts' => 'contact',
    ];

    /** The document the route addresses. */
    public static function model(Request $request): BaseModel
    {
        $family = (string) $request->route()?->defaults['family'];
        $model = $request->route(self::FAMILIES[$family]);

        return $model instanceof BaseModel ? $model : throw new \LogicException('The document was not bound.');
    }

    /** What ties a queued PDF to the document it was made for. */
    public static function tag(BaseModel $model): string
    {
        return 'document:'.($model instanceof Contact ? 'statement' : DocumentData::typeOf($model)).':'.$model->getKey();
    }

    /**
     * @param  array<string, mixed>  $input  validated request input
     * @return array{type: string, model: BaseModel, params: array<string, string>}
     */
    public static function resolve(Request $request, array $input): array
    {
        $model = self::model($request);
        if (! $model instanceof Contact) {
            return ['type' => DocumentData::typeOf($model), 'model' => $model, 'params' => []];
        }

        if (! isset($input['from'], $input['to'])) {
            throw DomainRuleViolation::single('statement_period_required', 'Give the start and end date of the statement.');
        }
        $side = (string) ($input['side'] ?? match ($model->kind) {
            'customer' => 'customer', 'supplier' => 'supplier', default => '',
        });
        if ($side === '') {
            throw DomainRuleViolation::single('statement_side_required', 'This contact is both a customer and a supplier. Say which statement you want.');
        }
        if (($side === 'customer' && $model->kind === 'supplier') || ($side === 'supplier' && $model->kind === 'customer')) {
            throw DomainRuleViolation::single('statement_side_invalid', 'This contact is not a '.$side.'.');
        }

        return ['type' => $side.'_statement', 'model' => $model, 'params' => ['from' => (string) $input['from'], 'to' => (string) $input['to']]];
    }
}
