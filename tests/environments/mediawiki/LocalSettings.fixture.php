<?php
// Disposable integration environment only. These settings are not for deployment.
$wgServer = 'http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
$wgMainCacheType = CACHE_DB;
$wgSessionCacheType = CACHE_DB;
$wgEnableBotPasswords = true;
$wgGroupPermissions['*']['read'] = false;
$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['*']['createaccount'] = false;
$wgJobRunRate = 0;
