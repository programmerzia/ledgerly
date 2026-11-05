@extends('pdf.layout')
@section('content')
@include('pdf.partials.parties')

<table class="grid">
  <thead>
    <tr><th style="width:22px">#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th>Tax</th><th class="num">Amount</th></tr>
  </thead>
  <tbody>
    @foreach ($lines as $l)
      <tr>
        <td class="muted">{{ $l['no'] }}</td><td>{{ $l['description'] }}</td><td class="num">{{ $l['quantity'] }}</td>
        <td class="num">{{ $l['unit_price'] }}</td><td>{{ $l['tax'] }}</td><td class="num">{{ $l['amount'] }}</td>
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
        <tbody>@foreach ($tax_rows as $r)<tr><td>{{ $r['label'] }}</td><td class="num">{{ $r['taxable'] }}</td><td class="num">{{ $r['tax'] }}</td></tr>@endforeach</tbody>
      </table>
    @endif
    @if ($revision > 0)<div class="muted" style="margin-top:8px">Revision {{ $revision }}. This replaces earlier versions of the order.</div>@endif
  </div>
  <div class="right">
    <table class="totals">@foreach ($totals as [$k, $v, $style])<tr class="{{ $style }}"><td>{{ $k }}</td><td class="num">{{ $v }}</td></tr>@endforeach</table>
  </div>
</div>

@if (! empty($memo))<div class="box"><div class="label">Notes to supplier</div>{{ $memo }}</div>@endif
<div class="sign"><div><div class="who">&nbsp;</div>Authorised by</div><div><div class="who">&nbsp;</div>Date</div></div>
@endsection
