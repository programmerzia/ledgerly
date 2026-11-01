@php
    use App\Support\Reports\Export\Amounts;
    /** @var \App\Support\Reports\Export\ReportTable $table */
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $table->title }}</title>
    <style>
        body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color: #111; }
        h1 { font-size: 16px; margin: 0 0 2px; }
        .subtitle { color: #555; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; border-bottom: 1px solid #111; padding: 3px 4px; }
        td { padding: 2px 4px; border-bottom: 1px solid #eee; }
        .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        tr.heading td { font-weight: 700; padding-top: 8px; border-bottom: 0; }
        tr.total td { font-weight: 700; border-top: 1px solid #111; }
        tr.grand_total td { font-weight: 700; border-top: 1px solid #111; border-bottom: 3px double #111; }
    </style>
</head>
<body>
    <h1>{{ $table->title }}</h1>
    <div class="subtitle">{{ $table->subtitle }}</div>
    <table>
        <thead>
            <tr>
                @foreach ($table->columns as $column)
                    <th @class(['num' => $column['numeric']])>{{ $column['label'] }}</th>
                @endforeach
            </tr>
        </thead>
        <tbody>
            @foreach ($table->rows as $row)
                <tr class="{{ $row->style }}">
                    @foreach ($row->cells as $i => $cell)
                        @if (is_array($cell))
                            <td class="num">{{ Amounts::text($cell['amount'], $table->decimals) }}</td>
                        @else
                            <td @class(['num' => $table->columns[$i]['numeric'] ?? false])>{{ $cell }}</td>
                        @endif
                    @endforeach
                </tr>
            @endforeach
        </tbody>
    </table>
</body>
</html>
