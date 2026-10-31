<?php

use App\Models\Organisation\Permission;
use App\Models\Organisation\Role;
use Spatie\Permission\DefaultTeamResolver;

/*
 * spatie/laravel-permission for a multi-tenant app (13 §7):
 *  - team = company: roles and role assignments are scoped by `company_id`;
 *  - every table carries `tenant_id` with forced RLS (own migration, not the package stub);
 *  - uuid keys (custom models);
 *  - the permission registry cache is per tenant and lives for the process only: see
 *    App\Services\Tenancy\TenantAwarePermissionRegistrar.
 */
return [
    'models' => [
        'permission' => Permission::class,
        'role' => Role::class,
        'team' => null,
        'default_model' => null,
    ],

    'table_names' => [
        'roles' => 'roles',
        'permissions' => 'permissions',
        'model_has_permissions' => 'model_has_permissions',
        'model_has_roles' => 'model_has_roles',
        'role_has_permissions' => 'role_has_permissions',
    ],

    'column_names' => [
        'role_pivot_key' => null,
        'permission_pivot_key' => null,
        'model_morph_key' => 'model_id',
        'team_foreign_key' => 'company_id',
    ],

    'register_permission_check_method' => true,
    'register_octane_reset_listener' => false,
    'events_enabled' => false,
    'teams' => true,
    'team_resolver' => DefaultTeamResolver::class,
    'use_passport_client_credentials' => false,
    'display_permission_in_exception' => false,
    'display_role_in_exception' => false,
    'enable_wildcard_permission' => false,

    'cache' => [
        'expiration_time' => DateInterval::createFromDateString('24 hours'),
        // The registrar appends the tenant id to this key (never share one key across tenants).
        'key' => 'spatie.permission.cache',
        // 'array' = lives only for the request / job / test process; nothing is shared across processes.
        'store' => 'array',
    ],
];
