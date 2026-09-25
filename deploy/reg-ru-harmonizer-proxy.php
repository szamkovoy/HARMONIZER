<?php
/**
 * Reverse proxy: visitors hit this REG.RU site, PHP fetches Vercel
 * from an address that completes TLS. Pinned addresses are the ones
 * that answered from this network; the dead ones are not listed.
 */
declare(strict_types=1);

@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
@ini_set('implicit_flush', '1');
@ini_set('max_execution_time', '300');
@set_time_limit(300);
while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);

const UPSTREAM_HOST = 'harmonizer-ten.vercel.app';
const UPSTREAM_IPS = [
    '64.29.17.1',
    '216.198.79.1',
    '64.29.17.195',
    '216.198.79.195',
];
const PUBLIC_HOST = 'harmonizer.zamkovoi.yoga';

header('X-Harmonizer-Proxy: reg.ru');
header('X-Accel-Buffering: no');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = $_SERVER['REQUEST_URI'] ?? '/';
if ($uri === '' || $uri[0] !== '/') {
    $uri = '/' . $uri;
}

$hop = [
    'connection' => true,
    'keep-alive' => true,
    'proxy-authenticate' => true,
    'proxy-authorization' => true,
    'te' => true,
    'trailers' => true,
    'transfer-encoding' => true,
    'upgrade' => true,
    'host' => true,
    'content-length' => true,
];

$outgoing = [
    'Host: ' . UPSTREAM_HOST,
    'X-Forwarded-Proto: https',
];
if (!empty($_SERVER['REMOTE_ADDR'])) {
    $outgoing[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
}

$headers = [];
if (function_exists('getallheaders')) {
    $headers = getallheaders() ?: [];
}
foreach ($headers as $name => $value) {
    if (isset($hop[strtolower((string) $name)])) {
        continue;
    }
    $outgoing[] = $name . ': ' . $value;
}

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if ($auth !== '' && stripos(implode("\n", $outgoing), 'authorization:') === false) {
    $outgoing[] = 'Authorization: ' . $auth;
}

$body = null;
if (!in_array($method, ['GET', 'HEAD'], true)) {
    $body = file_get_contents('php://input');
    if ($body === false) {
        $body = '';
    }
}

$lastError = 'upstream unreachable';
foreach (UPSTREAM_IPS as $ip) {
    $ch = curl_init('https://' . UPSTREAM_HOST . $uri);
    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $outgoing,
        CURLOPT_RESOLVE => [UPSTREAM_HOST . ':443:' . $ip],
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 300,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADER => false,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    if ($method !== 'GET' && $method !== 'HEAD') {
        $options[CURLOPT_POSTFIELDS] = $body ?? '';
    }
    curl_setopt_array($ch, $options);

    $statusSent = false;
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $headerLine) use (&$statusSent) {
        $line = trim($headerLine);
        if ($line === '') {
            return strlen($headerLine);
        }
        if (stripos($line, 'HTTP/') === 0) {
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if ($code > 0) {
                http_response_code($code);
                $statusSent = true;
            }
            return strlen($headerLine);
        }
        $colon = strpos($line, ':');
        if ($colon === false) {
            return strlen($headerLine);
        }
        $name = trim(substr($line, 0, $colon));
        $value = trim(substr($line, $colon + 1));
        $lower = strtolower($name);
        if (isset($GLOBALS['hz_hop'][$lower]) || $lower === 'content-length') {
            return strlen($headerLine);
        }
        if ($lower === 'location') {
            $value = str_replace(
                ['https://' . UPSTREAM_HOST, 'http://' . UPSTREAM_HOST],
                'https://' . PUBLIC_HOST,
                $value
            );
        }
        header($name . ': ' . $value, false);
        return strlen($headerLine);
    });
    $GLOBALS['hz_hop'] = $hop;

    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) {
        echo $chunk;
        flush();
        return strlen($chunk);
    });

    $ok = curl_exec($ch);
    $errno = curl_errno($ch);
    $lastError = curl_error($ch) ?: $lastError;
    curl_close($ch);
    if ($ok !== false && $errno === 0) {
        exit;
    }
    if ($statusSent) {
        exit;
    }
}

http_response_code(502);
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'error' => 'proxy_upstream_failed',
    'detail' => 'Vercel did not answer from the hosting server',
], JSON_UNESCAPED_UNICODE);
