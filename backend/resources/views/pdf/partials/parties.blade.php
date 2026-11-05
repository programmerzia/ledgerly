<section class="parties">
  <div class="party">
    <div class="label">{{ $party['label'] }}</div>
    <div class="pname">{{ $party['name'] }}</div>
    @if ($party['legal_name'])<div>{{ $party['legal_name'] }}</div>@endif
    @foreach ($party['address'] as $line)<div>{{ $line }}</div>@endforeach
    @if ($party['tax_id'])<div class="muted">Tax ID {{ $party['tax_id'] }}</div>@endif
    @if ($party['email'])<div class="muted">{{ $party['email'] }}</div>@endif
  </div>
  <table class="meta">
    @foreach ($meta as [$k, $v])
      <tr><td>{{ $k }}</td><td>{{ $v }}</td></tr>
    @endforeach
  </table>
</section>
