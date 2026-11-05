# Queue worker for the `exports` and `mail` queues (plan 3c.4, 3c.5). Same PHP as the API image, plus what makes a PDF:
# node, the `puppeteer` module (Browsershot loads it by name) and a Chromium binary. Dev/CI image; production hardening is plan 8.x.
#
# Chromium comes from the distribution, so puppeteer must not download its own build (PUPPETEER_SKIP_DOWNLOAD) and is pointed at
# the system binary (REPORTS_CHROMIUM_PATH, read by config/reports.php). Fonts: a PDF only prints glyphs a font on this
# machine has, so Latin text needs the font packages below; add more (for example font-noto-cjk) for other scripts.
FROM php:8.5-cli-alpine

RUN apk add --no-cache icu-libs libpq libsodium argon2-libs \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev postgresql-dev libsodium-dev argon2-dev \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql pgsql intl bcmath pcntl \
 && (pecl install redis && docker-php-ext-enable redis) \
 && apk del .build-deps \
 && rm -rf /tmp/pear

RUN apk add --no-cache nodejs npm chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto font-noto-emoji

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    REPORTS_CHROMIUM_PATH=/usr/bin/chromium \
    REPORTS_NODE_MODULE_PATH=/usr/local/lib/node_modules

RUN npm install -g puppeteer@24 && npm cache clean --force

WORKDIR /var/www/backend
