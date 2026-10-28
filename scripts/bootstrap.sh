#!/usr/bin/env bash
# Scaffolds Laravel 12 with the React starter kit into the current repo root, then adds the locked packages (04_TRD §2).
# Run once from the repository root. Review each command; nothing here is destructive except writing into an empty app tree.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f artisan ]; then echo "artisan already exists; refusing to re-scaffold"; exit 1; fi

composer global require laravel/installer >/dev/null
# React starter kit = Inertia 2 + React 19 + TypeScript + Tailwind 4 + shadcn/ui
laravel new app --react --pest --no-interaction
# move scaffold up one level without clobbering docs/
shopt -s dotglob; for f in app/*; do [ -e "$(basename "$f")" ] && [ "$(basename "$f")" != ".git" ] || mv "$f" .; done; rmdir app 2>/dev/null || true

composer require laravel/fortify laravel/sanctum laravel/horizon laravel/pennant laravel/cashier \
  spatie/laravel-permission spatie/laravel-typescript-transformer spatie/browsershot \
  brick/money openspout/openspout
composer require --dev larastan/larastan laravel/pint laravel/dusk

npm install
npm install @tanstack/react-table @tanstack/react-query react-hook-form zod @hookform/resolvers lucide-react recharts @dnd-kit/core @dnd-kit/sortable
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom

php artisan fortify:install
php artisan horizon:install
php artisan vendor:publish --provider="Spatie\Permission\PermissionServiceProvider"
echo "Done. Next: docs/06_Plan.md step 0.2 (Docker Compose)."
