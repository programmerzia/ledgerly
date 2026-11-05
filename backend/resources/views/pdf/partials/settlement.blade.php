@include('pdf.partials.parties')

@if ($is_advice)
  <p>We have made the payment below. It settles the following documents.</p>
@else
  <p>Thank you. We have received the payment below and applied it as follows.</p>
@endif

<table class="grid">
  <thead><tr><th>Document</th><th>Date</th><th>Reference</th><th class="num">Amount applied</th></tr></thead>
  <tbody>
    @forelse ($allocations as $a)
      <tr><td>{{ $a['document'] }}</td><td>{{ $a['date'] }}</td><td>{{ $a['reference'] }}</td><td class="num">{{ $a['amount'] }}</td></tr>
    @empty
      <tr><td colspan="4" class="muted">Not applied to any document: held as credit on account.</td></tr>
    @endforelse
  </tbody>
</table>

<div class="below">
  <div class="left">@if ($words)<div class="words">{{ $words }}</div>@endif</div>
  <div class="right"><table class="totals">@foreach ($totals as [$k, $v, $style])<tr class="{{ $style }}"><td>{{ $k }}</td><td class="num">{{ $v }}</td></tr>@endforeach</table></div>
</div>
@if (! empty($memo))<div class="box"><div class="label">Notes</div>{{ $memo }}</div>@endif
