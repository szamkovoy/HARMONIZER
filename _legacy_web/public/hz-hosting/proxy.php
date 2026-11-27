<?php
/**
 * Reverse proxy: visitors hit this REG.RU site, PHP fetches Vercel
 * from an address that completes TLS. Pinned addresses are the ones
 * that answered from this network; the dead ones are not listed.
 *
 * Two placements, one file, no per-placement edits (PATH_PREFIX = 'auto'):
 *  - site docroot /www/harmonizer.zamkovoi.yoga  → prefix '' (whole site)
 *  - folder     /www/zamkovoi.yoga/hz/            → prefix '/hz' (auto by folder name)
 *
 * Widget config GETs (PATH_PREFIX + /api/widget/...) are cached locally for
 * WIDGET_CACHE_TTL seconds; while the RU → Vercel leg is down the last good
 * copy keeps serving for up to WIDGET_CACHE_MAX_STALE, so landing pages keep
 * their prices and payment forms through short outages. Checkout POSTs and
 * everything else are never cached.
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
/** Vercel anycast addresses verified to serve this project (2026-11-17). */
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
const PUBLIC_HOST = 'harmonizer.zamkovoi.yoga';

/** Folder prefix: '' = whole site, '/hz' = subfolder placement,
 *  'auto' (default) = strip '/hz' when this file lives in a folder named hz. */
const PATH_PREFIX = 'auto';
const WIDGET_CACHE_TTL = 60;          // seconds a widget config stays fresh
const WIDGET_CACHE_MAX_STALE = 86400; // seconds a stale copy may serve while upstream is down

header('X-Harmonizer-Proxy: reg.ru');
header('X-Accel-Buffering: no');

/**
 * Path forwarded to Vercel: REQUEST_URI minus the folder prefix.
 */
function hz_forward_path(): string
{
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    if ($uri === '' || $uri[0] !== '/') {
        $uri = '/' . $uri;
    }
    $prefix = PATH_PREFIX !== 'auto' ? PATH_PREFIX : (basename(__DIR__) === 'hz' ? '/hz' : '');
    if ($prefix !== '' && strpos($uri, $prefix) === 0) {
        $uri = substr($uri, strlen($prefix));
        if ($uri === '' || $uri[0] !== '/') {
            $uri = '/' . $uri;
        }
    }
    return $uri;
}

/**
 * Cache file for cacheable requests (widget config GETs), null otherwise.
 */
function hz_widget_cache_file(string $path): ?string
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        return null;
    }
    if (strpos($path, '/api/widget/') !== 0) {
        return null;
    }
    // Sub-requests that carry buyer data are POSTs; GETs here are configs only.
    $dir = sys_get_temp_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        $alt = __DIR__ . '/cache';
        if (!is_dir($alt)) {
            @mkdir($alt, 0770, true);
        }
        $dir = is_writable($alt) ? $alt : null;
    }
    if ($dir === null) {
        return null;
    }
    return $dir . '/hz-widget-' . sha1($path) . '.cache';
}

/**
 * Serve a cached widget config. Returns true when the response was sent.
 */
function hz_serve_widget_cache(string $file, string $mark): bool
{
    if (!is_file($file)) {
        return false;
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return false;
    }
    $entry = json_decode($raw, true);
    if (!is_array($entry) || !isset($entry['body'], $entry['content_type'])) {
        return false;
    }
    $body = base64_decode((string) $entry['body'], true);
    if ($body === false || $body === '') {
        return false;
    }
    http_response_code(200);
    header('Content-Type: ' . (string) $entry['content_type']);
    header('Cache-Control: no-store');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: content-type');
    header('Access-Control-Max-Age: 600');
    header('X-Hz-Widget-Cache: ' . $mark);
    echo $body;
    return true;
}

/**
 * Store a widget config response for later (best effort).
 */
function hz_store_widget_cache(string $file, string $contentType, string $body): void
{
    if ($file === '') {
        return;
    }
    @file_put_contents(
        $file,
        json_encode([
            'at' => time(),
            'content_type' => $contentType,
            'body' => base64_encode($body),
        ], JSON_UNESCAPED_SLASHES)
    );
}

$uri = hz_forward_path();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Cacheable widget config: serve fresh (<= TTL) right away; remember a stale
// copy so a dead RU → Vercel leg can be survived quickly instead of burning
// one connect-timeout per pinned IP before the fallback.
$cacheFile = hz_widget_cache_file($uri);
$hasStale = false;
if ($cacheFile !== null && is_file($cacheFile)) {
    $raw = @file_get_contents($cacheFile);
    $entry = $raw === false ? null : json_decode($raw, true);
    $age = is_array($entry) && isset($entry['at']) ? time() - (int) $entry['at'] : PHP_INT_MAX;
    if ($age <= WIDGET_CACHE_TTL) {
        // Fresh copy: serve without touching Vercel at all.
        if (hz_serve_widget_cache($cacheFile, 'fresh')) {
            exit;
        }
    }
    if ($age <= WIDGET_CACHE_MAX_STALE) {
        $hasStale = true;
    }
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
    'x-harmonizer-client-ip' => true,
];

$outgoing = [
    'Host: ' . UPSTREAM_HOST,
    'X-Forwarded-Proto: https',
];
if (!empty($_SERVER['REMOTE_ADDR'])) {
    $outgoing[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
    // Vercel replaces X-Forwarded-For with the proxy address; geo needs the visitor.
    $outgoing[] = 'X-Harmonizer-Client-Ip: ' . $_SERVER['REMOTE_ADDR'];
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

// Cacheable requests buffer the response so it can be stored; everything
// else streams straight to the visitor as before.
$buffer = $cacheFile !== null ? '' : null;

$lastError = 'upstream unreachable';
foreach (UPSTREAM_IPS as $ip) {
    $ch = curl_init('https://' . UPSTREAM_HOST . $uri);
    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $outgoing,
        CURLOPT_RESOLVE => [UPSTREAM_HOST . ':443:' . $ip],
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 300,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADER => false,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    if ($method !== 'GET' && $method !== 'HEAD') {
        // Raw bodies (JSON, image/*) arrive intact. multipart/form-data does not:
        // this curl call drops the boundary, and Vercel returns
        // "no boundary found in multipart body". Email images are sent as a
        // raw image body for that reason. Do not switch them back to FormData.
        $options[CURLOPT_POSTFIELDS] = $body ?? '';
    }
    curl_setopt_array($ch, $options);

    $statusSent = false;
    $upstreamContentType = '';
    // Letter images come from Blob via /email-cdn. Blob sends
    // Content-Security-Policy: default-src 'none'. A browser that applies
    // that header to the image response paints a broken icon. The header
    // photo is already cached, so only a newly uploaded picture breaks.
    // Hold the body and send Content-Length so a short stream is not stored
    // as a complete JPEG.
    $holdImage = strpos($uri, '/email-cdn/') === 0;
    $heldImage = '';
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $headerLine) use (&$statusSent, &$upstreamContentType, $holdImage) {
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
        if ($holdImage && $lower === 'content-security-policy') {
            return strlen($headerLine);
        }
        if ($lower === 'content-type') {
            $upstreamContentType = $value;
        }
        if ($lower === 'location') {
            $value = str_replace(
                ['https://' . UPSTREAM_HOST, 'http://' . UPSTREAM_HOST],
                ['https://' . PUBLIC_HOST, 'http://' . PUBLIC_HOST],
                $value
            );
        }
        header($name . ': ' . $value, false);
        return strlen($headerLine);
    });
    $GLOBALS['hz_hop'] = $hop;

    if ($buffer !== null) {
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use (&$buffer) {
            $buffer .= $chunk;
            return strlen($chunk);
        });
    } elseif ($holdImage) {
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use (&$heldImage) {
            $heldImage .= $chunk;
            return strlen($chunk);
        });
    } else {
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) {
            echo $chunk;
            flush();
            return strlen($chunk);
        });
    }

    $ok = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $lastError = curl_error($ch) ?: $lastError;
    // Note: curl_close() is a no-op since PHP 8.0 and deprecated since 8.5
    // (emitting a deprecation notice straight into the response). Keep the
    // handle alive; PHP reclaims it at request end.
    if ($ok !== false && $errno === 0) {
        if ($buffer !== null) {
            if ($status === 200 && $upstreamContentType !== '' && $cacheFile !== null) {
                hz_store_widget_cache($cacheFile, $upstreamContentType, $buffer);
                header('X-Hz-Widget-Cache: live');
            } elseif ($status >= 500 && $hasStale && $cacheFile !== null) {
                // Vercel is up but the API errored (e.g. a Supabase blip):
                // a slightly stale config serves the landing page better.
                if (hz_serve_widget_cache($cacheFile, 'stale')) {
                    exit;
                }
            }
            echo $buffer;
        }
        if ($holdImage) {
            header('Content-Length: ' . strlen($heldImage));
            echo $heldImage;
        }
        exit;
    }
    if ($statusSent) {
        exit;
    }
    if ($hasStale && $buffer !== null) {
        // First pinned IP is dead and a stale config exists: serve it now
        // (within one connect-timeout) instead of walking all addresses.
        if (hz_serve_widget_cache($cacheFile, 'stale')) {
            exit;
        }
    }
}

// Every Vercel address failed. A cached widget config (stale copy) still
// serves the landing page prices; otherwise report the outage as before.
if ($cacheFile !== null && hz_serve_widget_cache($cacheFile, 'stale')) {
    exit;
}

http_response_code(502);
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'error' => 'proxy_upstream_failed',
    'detail' => 'Vercel did not answer from the hosting server',
], JSON_UNESCAPED_UNICODE);
