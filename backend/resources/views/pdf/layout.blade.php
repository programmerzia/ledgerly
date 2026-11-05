<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ $title }}{{ ! empty($number) ? ' '.$number : '' }}</title>
<style>
  :root { --accent: {{ $accent }}; --ink: #1c2530; --muted: #66707d; --line: #dfe3e8; --soft: #f5f7f9; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif; font-size: 10px; line-height: 1.45; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: var(--muted); }
  header.top { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid var(--accent); }
  .brand { display: flex; gap: 12px; align-items: flex-start; max-width: 60%; }
  .brand img { max-height: 54px; max-width: 150px; object-fit: contain; }
  .brand .name { font-size: 15px; font-weight: 700; letter-spacing: .1px; }
  .brand .addr { color: var(--muted); font-size: 9.5px; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 24px; font-weight: 300; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); }
  .doc-title .no { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .doc-title .state { display: inline-block; margin-top: 6px; padding: 2px 8px; border: 1px solid #b91c1c; color: #b91c1c; font-weight: 700; font-size: 9px; letter-spacing: 1px; border-radius: 2px; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin: 18px 0 14px; }
  .party { flex: 1; }
  .label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 3px; }
  .party .pname { font-size: 12px; font-weight: 700; }
  table.meta { border-collapse: collapse; min-width: 230px; }
  table.meta td { padding: 2.5px 0; vertical-align: top; }
  table.meta td:first-child { color: var(--muted); padding-right: 16px; }
  table.meta td:last-child { text-align: right; font-weight: 600; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.grid thead th { background: var(--accent); color: #fff; font-weight: 600; font-size: 9px; letter-spacing: .4px; text-transform: uppercase; padding: 6px 7px; text-align: left; }
  table.grid thead th.num { text-align: right; }
  table.grid tbody td { padding: 7px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.grid tbody tr { page-break-inside: avoid; }
  table.grid tfoot td { padding: 6px 7px; font-weight: 700; border-top: 2px solid var(--ink); }
  .below { display: flex; justify-content: space-between; gap: 28px; margin-top: 14px; page-break-inside: avoid; }
  .below .left { flex: 1; }
  .below .right { width: 255px; }
  table.totals { width: 100%; border-collapse: collapse; }
  table.totals td { padding: 4px 7px; }
  table.totals tr.strong td { font-weight: 700; border-top: 1px solid var(--ink); }
  table.totals tr.due td { background: var(--accent); color: #fff; font-weight: 700; font-size: 11.5px; padding: 8px 7px; }
  table.mini { border-collapse: collapse; width: 100%; font-size: 9px; }
  table.mini th { text-align: left; font-weight: 600; color: var(--muted); padding: 3px 6px 3px 0; border-bottom: 1px solid var(--line); }
  table.mini th.num { text-align: right; }
  table.mini td { padding: 3px 6px 3px 0; }
  .words { margin-top: 10px; font-style: italic; color: var(--muted); }
  .box { margin-top: 14px; padding: 9px 11px; background: var(--soft); border-left: 3px solid var(--accent); white-space: pre-line; page-break-inside: avoid; }
  .box .label { margin-bottom: 4px; }
  .sign { display: flex; gap: 22px; margin-top: 34px; page-break-inside: avoid; }
  .sign > div { flex: 1; border-top: 1px solid var(--ink); padding-top: 4px; }
  .sign .who { font-weight: 600; min-height: 13px; }
  .watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 104px; font-weight: 800; letter-spacing: 8px; color: rgba(185, 28, 28, .09); transform: rotate(-28deg); z-index: 0; pointer-events: none; white-space: nowrap; }
  .watermark.long { font-size: 62px; }
  main { position: relative; z-index: 1; }
</style>
</head>
<body>
@if (! empty($watermark))
  <div class="watermark {{ strlen($watermark) > 9 ? 'long' : '' }}">{{ $watermark }}</div>
@endif
<main>
<header class="top">
  <div class="brand">
    @if ($logo)<img src="{{ $logo }}" alt="">@endif
    <div>
      <div class="name">{{ $company['legal_name'] ?: $company['name'] }}</div>
      <div class="addr">
        @foreach ($company['address'] as $line){{ $line }}<br>@endforeach
        @if ($company['tax_id'])Tax ID {{ $company['tax_id'] }}@endif
      </div>
    </div>
  </div>
  <div class="doc-title">
    <h1>{{ $title }}</h1>
    @if (! empty($number))<div class="no">{{ $number }}</div>@endif
    @if (! empty($watermark))<div class="state">{{ $watermark }}</div>@endif
  </div>
</header>

@yield('content')
</main>
</body>
</html>
