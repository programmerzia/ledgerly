@extends('pdf.layout')
@section('content')
<section class="parties">
  <div class="party">
    @if (! empty($memo))<div class="label">Narration</div><div>{{ $memo }}</div>@endif
  </div>
  <table class="meta">@foreach ($meta as [$k, $v])<tr><td>{{ $k }}</td><td>{{ $v }}</td></tr>@endforeach</table>
</section>

<table class="grid">
  <thead><tr><th style="width:22px">#</th><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
  <tbody>
    @foreach ($journal_lines as $l)
      <tr><td class="muted">{{ $l['no'] }}</td><td>{{ $l['account'] }}</td><td>{{ $l['description'] }}</td><td class="num">{{ $l['debit'] }}</td><td class="num">{{ $l['credit'] }}</td></tr>
    @endforeach
  </tbody>
  <tfoot><tr><td colspan="3">Total</td><td class="num">{{ $total_debit }}</td><td class="num">{{ $total_credit }}</td></tr></tfoot>
</table>

<div class="sign">
  @foreach ($signatures as [$k, $v])<div><div class="who">{{ $v }}&nbsp;</div>{{ $k }}</div>@endforeach
</div>
@endsection
