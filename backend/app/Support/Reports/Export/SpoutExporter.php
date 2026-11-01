<?php

declare(strict_types=1);

namespace App\Support\Reports\Export;

use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\CSV\Writer as CsvWriter;
use OpenSpout\Writer\WriterInterface;
use OpenSpout\Writer\XLSX\Writer as XlsxWriter;

/**
 * Streams a ReportTable to XLSX or CSV through OpenSpout: rows are written as they are produced.
 * Text cells are escaped against formula injection. CSV amounts are exact decimal text; XLSX amounts are
 * numeric cells (a double, as a spreadsheet requires) with a two-decimal-style number format.
 */
final class SpoutExporter
{
    public function write(ReportTable $table, string $format, string $path): void
    {
        $xlsx = $format === 'xlsx';
        $writer = $xlsx ? new XlsxWriter : new CsvWriter;
        $writer->openToFile($path);
        $this->emit($writer, $table, $xlsx);
        $writer->close();
    }

    private function emit(WriterInterface $writer, ReportTable $table, bool $xlsx): void
    {
        $format = $table->decimals === 0 ? '#,##0;-#,##0' : '#,##0.'.str_repeat('0', $table->decimals).';-#,##0.'.str_repeat('0', $table->decimals);
        $bold = (new Style)->withFontBold(true);
        $number = (new Style)->withFormat($format);
        $boldNumber = $bold->withFormat($format);

        $writer->addRow(new Row([$this->text(Amounts::safe($table->title), $bold)]));
        $writer->addRow(new Row([$this->text(Amounts::safe($table->subtitle))]));
        $writer->addRow(new Row([]));
        $writer->addRow(new Row(array_map(fn (array $c) => $this->text(Amounts::safe($c['label']), $bold), $table->columns)));

        foreach ($table->rows as $row) {
            $isBold = $row->style !== 'normal';
            $cells = [];
            foreach ($row->cells as $cell) {
                if (is_array($cell)) {
                    $cells[] = $xlsx
                        ? Cell::fromValue(Amounts::number($cell['amount'], $table->decimals), $isBold ? $boldNumber : $number)
                        : new StringCell(Amounts::text($cell['amount'], $table->decimals), null);
                } elseif (is_int($cell)) {
                    $cells[] = Cell::fromValue($cell, $isBold ? $bold : null);
                } else {
                    $cells[] = $this->text(Amounts::safe((string) $cell), $isBold ? $bold : null);
                }
            }
            $writer->addRow(new Row($cells));
        }
    }

    private function text(string $value, ?Style $style = null): Cell
    {
        return new StringCell($value, $style);
    }
}
