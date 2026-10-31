#!/bin/sh
set -eu
cd /var/www/html

# This installs an isolated SQLite wiki in this container, with public fixture
# credentials. It never reads a developer's .env or needs a browser installer.
if [ ! -f LocalSettings.php ]; then
  mkdir -p /var/www/data
  php maintenance/run.php install \
    --dbtype sqlite --dbpath /var/www/data --dbname fixture \
    --server http://localhost --scriptpath= --lang en \
    --pass Fixture-admin-only-123 'MCP Integration Fixture' FixtureAdmin
  # Bind-mounted files can be mode 0600 in managed workspaces. Apache must
  # read its own copy rather than traverse the host mount as www-data.
  cp /fixture/LocalSettings.fixture.php LocalSettings.fixture.php
  chmod 644 LocalSettings.fixture.php
  printf '\nrequire __DIR__ . "/LocalSettings.fixture.php";\n' >> LocalSettings.php
  php maintenance/run.php createBotPassword --appid connector \
    --grants basic,editpage,createeditmovepage \
    FixtureAdmin 0123456789abcdef0123456789abcdef >/dev/null
  chown -R www-data:www-data /var/www/data
  php -r 'file_put_contents("mcp-fixture.json", json_encode(["fixture" => "mediawiki-mcp", "project" => getenv("FIXTURE_PROJECT")]));'
fi
exec docker-php-entrypoint apache2-foreground
