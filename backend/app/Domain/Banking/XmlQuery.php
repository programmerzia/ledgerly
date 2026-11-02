<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;

/** Typed XPath over a statement document: the first node, its text, or all matching elements. */
final class XmlQuery
{
    private readonly DOMXPath $xpath;

    public function __construct(DOMDocument $doc)
    {
        $this->xpath = new DOMXPath($doc);
    }

    /** `*[local-name()="Name"]` steps from names: `p('Stmt', 'Bal')` is `*[local-name()="Stmt"]/*[local-name()="Bal"]`. */
    public static function p(string ...$names): string
    {
        return implode('/', array_map(fn (string $n): string => '*[local-name()="'.$n.'"]', $names));
    }

    public function node(string $path, ?DOMNode $context = null): ?DOMNode
    {
        $list = $context === null ? $this->xpath->query($path) : $this->xpath->query($path, $context);

        $n = $list === false ? null : $list->item(0);

        return $n instanceof DOMNode ? $n : null;
    }

    public function text(string $path, ?DOMNode $context = null): ?string
    {
        $n = $this->node($path, $context);
        if ($n === null) {
            return null;
        }
        $t = trim((string) $n->textContent);

        return $t === '' ? null : $t;
    }

    /** @return list<DOMElement> */
    public function elements(string $path, ?DOMNode $context = null): array
    {
        $list = $context === null ? $this->xpath->query($path) : $this->xpath->query($path, $context);
        $out = [];
        if ($list !== false) {
            foreach ($list as $n) {
                if ($n instanceof DOMElement) {
                    $out[] = $n;
                }
            }
        }

        return $out;
    }
}
