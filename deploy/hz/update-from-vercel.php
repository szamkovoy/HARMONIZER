<?php
/**
 * One-shot hosting updater (2026-11-17).
 *
 * The REG.RU shared-hosting server cannot fetch *.vercel.app directly (RKN),
 * and the ISPmanager panel's "upload by URL" creates broken symlinks. This
 * helper is uploaded once into /www/zamkovoi.yoga/hz/, opened in a browser,
 * and pulls the current copies from Vercel through the pinned anycast IPs
 * (the same mechanism the proxy uses). Files land with the site user's
 * ownership and are served correctly.
 *
 *   widget.js   <- https://harmonizer-ten.vercel.app/widget.js
 *   proxy.php   <- https://harmonizer-ten.vercel.app/hz-hosting/proxy.php
 *   .htaccess   <- https://harmonizer-ten.vercel.app/hz-hosting/htaccess
 *
 * With ?subdomain=1 it also refreshes /www/harmonizer.zamkovoi.yoga/index.php
 * (backup index.backup-<date>.php is kept next to it).
 *
 * Delete this file from the hosting after use.
 */
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');

const UPSTREAM_HOST = 'harmonizer-ten.vercel.app';
const UPSTREAM_IPS = [
    '64.29.17.131',
    '216.198.79.131',
    '64.29.17.67',
    '216.198.79.67',
    '64.29.17.1',
    '216.198.79.1',
    '64.29.17.195',
    '216.198.79.195',
];

function hz_fetch(string $path): string
{
    foreach (UPSTREAM_IPS as $ip) {
        $ch = curl_init('https://' . UPSTREAM_HOST . $path);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => ['Host: ' . UPSTREAM_HOST],
            CURLOPT_RESOLVE => [UPSTREAM_HOST . ':443:' . $ip],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        ]);
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        if ($errno === 0 && is_string($body) && strlen($body) > 100) {
            return $body;
        }
    }
    return '';
}

$targets = [
    'widget.js' => '/widget.js',
    'proxy.php' => '/hz-hosting/proxy.php',
    '.htaccess' => '/hz-hosting/htaccess',
];

foreach ($targets as $local => $path) {
    $body = hz_fetch($path);
    if ($body === '') {
        echo $local . ': FETCH FAILED' . chr(10);
        continue;
    }
    echo $local . ': ' . (file_put_contents(__DIR__ . '/' . $local, $body) !== false ? 'saved ' . strlen($body) . 'B' : 'WRITE FAILED') . chr(10);
}

if (($_GET['subdomain'] ?? '') === '1') {
    $subdir = realpath(__DIR__ . '/../../harmonizer.zamkovoi.yoga');
    if ($subdir === false || !is_file($subdir . '/index.php')) {
        echo 'subdomain: dir or index.php not found' . chr(10);
        exit;
    }
    $body = hz_fetch('/hz-hosting/proxy.php');
    if ($body === '' || strpos($body, 'UPSTREAM_HOST') === false) {
        echo 'subdomain: FETCH FAILED' . chr(10);
        exit;
    }
    $backup = $subdir . '/index.backup-' . date('Ymd') . '.php';
    if (copy($subdir . '/index.php', $backup)) {
        echo 'backup: ' . filesize($backup) . 'B' . chr(10);
    } else {
        echo 'backup: FAILED' . chr(10);
        exit;
    }
    $tmp = $subdir . '/index.php.new';
    if (file_put_contents($tmp, $body) !== false && rename($tmp, $subdir . '/index.php')) {
        echo 'subdomain index.php: replaced ' . strlen($body) . 'B' . chr(10);
    } else {
        echo 'subdomain index.php: RENAME FAILED' . chr(10);
    }
}
