<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use DOMDocument;

/**
 * XML from a bank file, read with external entities and network access off. Statements never need a DTD, so a
 * DOCTYPE or ENTITY declaration is refused outright (XXE, entity expansion bombs); entities are never substituted.
 */
final class SafeXml
{
    public static function load(string $xml): DOMDocument
    {
        if (preg_match('/<!(DOCTYPE|ENTITY)/i', $xml) === 1) {
            throw StatementFormatException::at(null, 'statement_malformed', 'DTDs and entity declarations are not allowed in a statement file.');
        }
        $previous = libxml_use_internal_errors(true);
        try {
            $doc = new DOMDocument;
            $doc->resolveExternals = false;
            $doc->substituteEntities = false;
            $ok = $doc->loadXML($xml, LIBXML_NONET | LIBXML_NOBLANKS | LIBXML_NOCDATA);
            $error = libxml_get_errors()[0] ?? null;
            libxml_clear_errors();
        } finally {
            libxml_use_internal_errors($previous);
        }
        if (! $ok) {
            throw StatementFormatException::at($error === null ? null : $error->line, 'statement_malformed', $error === null ? 'The file is not valid XML.' : trim($error->message));
        }

        return $doc;
    }
}
