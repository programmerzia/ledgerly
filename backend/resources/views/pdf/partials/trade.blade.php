@php($hasDiscount = collect($lines)->contains(fn ($l) => $l['discount'] !== ''))
@include('pdf.partials.parties')

<table class="grid">
  <thead>
    <tr>
      <th style="width:22px">#</th>
      <th>Description</th>
      <th class="num">Qty</th>
      <th class="num">Unit price</th>
      @if ($hasDiscount)<th class="num">Disc.</th>@endif
      <th>Tax</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>
    @foreach ($lines as $l)
      <tr>
        <td class="muted">{{ $l['no'] }}</td>
        <td>{{ $l['description'] }}</td>
        <td class="num">{{ $l['quantity'] }}</td>
        <td class="num">{{ $l['unit_price'] }}</td>
        @if ($hasDiscount)<td class="num">{{ $l['discount'] }}</td>@endif
        <td>{{ $l['tax'] }}</td>
        <td class="num">{{ $l['amount'] }}</td>
      </tr>
    @endforeach
  </tbody>
</table>

<div class="below">
  <div class="left">
    @if (count($tax_rows) > 0)
      <div class="label">Tax breakdown</div>
      <table class="mini">
        <thead><tr><th>Tax</th><th class="num">Taxable amount</th><th class="num">Tax</th></tr></thead>
        <tbody>
          @foreach ($tax_rows as $r)
            <tr><td>{{ $r['label'] }}</td><td class="num">{{ $r['taxable'] }}</td><td class="num">{{ $r['tax'] }}</td></tr>
          @endforeach
        </tbody>
      </table>
    @endif
    @if ($words)<div class="words">{{ $words }}</div>@endif
    @if ($base_total)<div class="muted" style="margin-top:6px">Equivalent in books currency: {{ $base_total }}</div>@endif
  </div>
  <div class="right">
    <table class="totals">
      @foreach ($totals as [$k, $v, $style])
        <tr class="{{ $style }}"><td>{{ $k }}</td><td class="num">{{ $v }}</td></tr>
      @endforeach
    </table>
  </div>
</div>

@if (! empty($memo))
  <div class="box"><div class="label">Notes</div>{{ $memo }}</div>
@endif
@if (! empty($payment_instructions))
  <div class="box"><div class="label">How to pay</div>{{ $payment_instructions }}</div>
@endif
