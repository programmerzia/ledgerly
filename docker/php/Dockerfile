# PHP 8.5 FPM image for the Ledgerly API (plan 0.2). Dev/CI image; production hardening is plan 8.x.
# opcache and sodium ship compiled-in with the base image; argon2 comes via libargon2 (password_hash).
FROM php:8.5-fpm-alpine

RUN apk add --no-cache icu-libs libpq libsodium argon2-libs \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev postgresql-dev libsodium-dev argon2-dev \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql pgsql intl bcmath pcntl \
 && (pecl install redis && docker-php-ext-enable redis) \
 && apk del .build-deps \
 && rm -rf /tmp/pear

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

RUN { \
    echo 'opcache.enable=1'; \
    echo 'opcache.validate_timestamps=1'; \
    echo 'opcache.memory_consumption=128'; \
  } > /usr/local/etc/php/conf.d/opcache-ledgerly.ini

WORKDIR /var/www/backend
