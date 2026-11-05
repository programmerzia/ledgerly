@extends('pdf.layout')
@section('content')
@include('pdf.partials.parties')

<p>This certifies that tax was withheld at source from the payment described below.</p>

<table class="grid">
  <thead><tr><th>Tax</th><th class="num">Amount subject to withholding</th><th class="num">Tax withheld</th></tr></thead>
  <tbody><tr><td>{{ $tax_name }}</td><td class="num">{{ $base }}</td><td class="num"><strong>{{ $withheld }}</strong></td></tr></tbody>
</table>
@if ($words)<div class="words">Tax withheld: {{ $words }}</div>@endif

<div class="sign">
  <div><div class="who">{{ $company['legal_name'] ?: $company['name'] }}&nbsp;</div>Withholding agent{{ $company['tax_id'] ? ' · Tax ID '.$company['tax_id'] : '' }}</div>
  <div><div class="who">&nbsp;</div>Authorised signature and date</div>
</div>
@endsection
