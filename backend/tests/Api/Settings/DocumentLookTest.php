<?php

declare(strict_types=1);

use App\Models\Organisation\Company;
use App\Services\Documents\DocumentPdf;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/* Settings → General → document look (plan 3c.4): accent colour, footer, payment instructions and the logo. */

beforeEach(function (): void {
    $this->setUpTrade();
    Storage::fake((string) config('attachments.disk'));
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

function pngBytes(int $w = 64, int $h = 32): string
{
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, imagecolorallocate($img, 31, 78, 121));
    ob_start();
    imagepng($img);

    return (string) ob_get_clean();
}

it('shows the defaults and saves the accent colour, footer and payment instructions with the version lock', function (): void {
    $this->asPerson($this->viewer)->getJson($this->api('settings'))->assertOk()
        ->assertJsonPath('data.document_look.accent_color', '#1F4E79')->assertJsonPath('data.document_look.footer_text', '')->assertJsonPath('data.document_look.has_logo', false)
        ->assertJsonPath('data.email_templates.statement.subject', 'Statement of account from {{company_name}}')
        ->assertJsonStructure(['data' => ['email_placeholders' => ['company_name', 'total']]]);

    $version = $this->asPerson($this->owner)->putJson($this->api('settings'), [
        'accent_color' => '#0a7c5a', 'footer_text' => 'Registered in Springfield', 'payment_instructions' => 'IBAN XX00',
    ], $this->key())->assertOk()->assertJsonPath('data.document_look.accent_color', '#0A7C5A')->assertJsonPath('data.document_look.footer_text', 'Registered in Springfield')
        ->assertJsonPath('data.document_look.payment_instructions', 'IBAN XX00')->json('data.version');

    $this->putJson($this->api('settings'), ['footer_text' => 'x', 'version' => $version - 1], $this->key())->assertStatus(409);
    $this->putJson($this->api('settings'), ['footer_text' => ''], $this->key())->assertOk()->assertJsonPath('data.document_look.footer_text', '')->assertJsonPath('data.document_look.accent_color', '#0A7C5A');
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'company_settings.updated')->count()))->toBe(2);
});

it('refuses a bad colour and a viewer', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('settings'), ['accent_color' => 'red'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['accent_color']);
    $this->putJson($this->api('settings'), ['accent_color' => '#12345'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['accent_color']);
    $this->asPerson($this->viewer)->putJson($this->api('settings'), ['footer_text' => 'x'], $this->key())->assertForbidden();
});

it('stores a PNG logo privately, shows it to people who can read the settings, and removes it', function (): void {
    $png = UploadedFile::fake()->createWithContent('logo.png', pngBytes());
    $this->asPerson($this->owner)->post($this->api('settings/logo'), ['file' => $png], $this->key() + ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.document_look.has_logo', true);
    $path = $this->inTenant(fn () => DB::table('companies')->where('id', $this->f->companyId)->value('logo_path'));
    expect($path)->toStartWith($this->f->tenantId.'/'.$this->f->companyId.'/logo/');
    Storage::disk((string) config('attachments.disk'))->assertExists($path);

    $this->asPerson($this->viewer)->get($this->api('settings/logo'))->assertOk()->assertHeader('Content-Type', 'image/png');

    // Replacing it deletes the old file.
    $this->asPerson($this->owner)->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->createWithContent('b.png', pngBytes(40, 40))], $this->key() + ['Accept' => 'application/json'])->assertOk();
    Storage::disk((string) config('attachments.disk'))->assertMissing($path);

    $this->deleteJson($this->api('settings/logo'), [], $this->key())->assertOk()->assertJsonPath('data.document_look.has_logo', false);
    $this->getJson($this->api('settings/logo'))->assertNotFound();
    expect($this->inTenant(fn () => DB::table('audit_events')->whereIn('action', ['company.logo_updated', 'company.logo_removed'])->count()))->toBe(3);
});

it('validates the logo: type read from the bytes, size, dimensions, and who may upload', function (): void {
    $this->asPerson($this->owner);
    $headers = $this->key() + ['Accept' => 'application/json'];
    // An SVG, or a text file renamed to .png, is not an image we take.
    $this->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->createWithContent('logo.png', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], $headers)->assertStatus(422)->assertJson(['code' => 'logo_type_not_allowed']);
    $this->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->createWithContent('logo.png', 'just text')], $this->key() + ['Accept' => 'application/json'])->assertStatus(422)->assertJson(['code' => 'logo_type_not_allowed']);
    // Too small to be a logo; too big in bytes.
    $this->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->createWithContent('logo.png', pngBytes(4, 4))], $this->key() + ['Accept' => 'application/json'])->assertStatus(422)->assertJson(['code' => 'logo_dimensions']);
    $this->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->create('big.png', 600)], $this->key() + ['Accept' => 'application/json'])->assertStatus(422);
    $this->post($this->api('settings/logo'), [], $this->key() + ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['file']);

    $this->asPerson($this->viewer)->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->createWithContent('logo.png', pngBytes())], $this->key() + ['Accept' => 'application/json'])->assertForbidden();
    expect($this->inTenant(fn () => DB::table('companies')->where('id', $this->f->companyId)->value('logo_path')))->toBeNull();
});

it('embeds the logo in the printed document as an inline image', function (): void {
    $this->asPerson($this->owner)->post($this->api('settings/logo'), ['file' => UploadedFile::fake()->createWithContent('logo.png', pngBytes())], $this->key() + ['Accept' => 'application/json'])->assertOk();
    $doc = $this->sale(5000);
    $html = $this->inTenant(fn () => app(DocumentPdf::class)->html('invoice', Company::query()->findOrFail($this->f->companyId), $doc['id']));
    expect($html)->toContain('<img src="data:image/png;base64,');
});
