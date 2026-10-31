<?php
$context = stream_context_create(['http' => ['timeout' => 3]]);
$marker = @file_get_contents('http://127.0.0.1/mcp-fixture.json', false, $context);
$data = $marker === false ? null : json_decode($marker, true);
if (($data['project'] ?? null) !== getenv('FIXTURE_PROJECT')) exit(1);
$api = @file_get_contents('http://127.0.0.1/api.php?action=query&meta=tokens&type=login&format=json', false, $context);
$result = $api === false ? null : json_decode($api, true);
exit(isset($result['query']['tokens']['logintoken']) ? 0 : 1);
