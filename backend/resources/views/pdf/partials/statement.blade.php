@include('pdf.partials.parties')

<table class="grid">
  <thead><tr><th>Date</th><th>Type</th><th>Number</th><th>Description</th><th class="num">{{ $debit_label }}</th><th class="num">{{ $credit_label }}</th><th class="num">Balance</th></tr></thead>
  <tbody>
    <tr><td colspan="6" class="muted">Opening balance</td><td class="num">{{ $opening }}</td></tr>
    @foreach ($statement_rows as $r)
      <tr><td>{{ $r['date'] }}</td><td style="text-transform:capitalize">{{ $r['type'] }}</td><td>{{ $r['number'] }}</td><td>{{ $r['description'] }}</td><td class="num">{{ $r['debit'] }}</td><td class="num">{{ $r['credit'] }}</td><td class="num">{{ $r['balance'] }}</td></tr>
    @endforeach
  </tbody>
  <tfoot><tr><td colspan="4">Totals for the period</td><td class="num">{{ $total_debit }}</td><td class="num">{{ $total_credit }}</td><td></td></tr></tfoot>
</table>

<div class="below">
  <div class="left"></div>
  <div class="right"><table class="totals"><tr class="due"><td>{{ $closing_label }}</td><td class="num">{{ $closing }}</td></tr></table></div>
</div>
@if (! empty($payment_instructions))<div class="box"><div class="label">How to pay</div>{{ $payment_instructions }}</div>@endif
