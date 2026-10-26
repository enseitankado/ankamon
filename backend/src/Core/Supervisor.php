<?php
declare(strict_types=1);

namespace Ankamon\Core;

/**
 * supervisord XML-RPC istemcisi (unix soketi /run/supervisor.sock — bkz. supervisord.conf
 * [unix_http_server]: yalnız "nobody" grubuna açık, ağ portu yok). Sistem sayfası servis durumunu
 * buradan okur ve servisleri başlatır/durdurur. Yalnız yönetici uçlarından çağrılır.
 *
 * PHP'nin xmlrpc eklentisi yok (PHP 8'de kaldırıldı); istek elle kodlanır, yanıt SimpleXML ile çözülür.
 */
final class Supervisor
{
    private const SOCKET = 'unix:///run/supervisor.sock';
    private const TIMEOUT = 30;

    /** @return list<array<string,mixed>> supervisor.getAllProcessInfo */
    public static function processes(): array
    {
        return self::call('supervisor.getAllProcessInfo');
    }

    public static function start(string $name): bool
    {
        return (bool) self::call('supervisor.startProcess', [$name, true]);
    }

    public static function stop(string $name): bool
    {
        return (bool) self::call('supervisor.stopProcess', [$name, true]);
    }

    /** @return array<string,mixed> {statecode, statename} */
    public static function state(): array
    {
        return self::call('supervisor.getState');
    }

    public static function version(): string
    {
        return (string) self::call('supervisor.getSupervisorVersion');
    }

    private static function call(string $method, array $params = []): mixed
    {
        $body = '<?xml version="1.0"?><methodCall><methodName>' . htmlspecialchars($method) . '</methodName><params>'
            . implode('', array_map(fn($p) => '<param>' . self::encode($p) . '</param>', $params))
            . '</params></methodCall>';
        $sock = @stream_socket_client(self::SOCKET, $errno, $errstr, 5);
        if ($sock === false) {
            throw new ApiError(503, "Servis yöneticisine (supervisord) bağlanılamadı: $errstr");
        }
        stream_set_timeout($sock, self::TIMEOUT);
        fwrite($sock, "POST /RPC2 HTTP/1.0\r\nHost: localhost\r\nContent-Type: text/xml\r\n"
            . 'Content-Length: ' . strlen($body) . "\r\n\r\n" . $body);
        $raw = stream_get_contents($sock);
        fclose($sock);
        $xmlText = (string) substr((string) $raw, (int) strpos((string) $raw, "\r\n\r\n") + 4);
        $xml = @simplexml_load_string($xmlText);
        if ($xml === false) {
            throw new ApiError(502, 'Servis yöneticisinden okunamayan yanıt.');
        }
        if (isset($xml->fault)) {
            $fault = self::decode($xml->fault->value);
            throw new ApiError(409, 'Servis yöneticisi: ' . ($fault['faultString'] ?? 'hata'));
        }
        return self::decode($xml->params->param->value);
    }

    private static function encode(mixed $v): string
    {
        return '<value>' . match (true) {
            is_bool($v) => '<boolean>' . ($v ? 1 : 0) . '</boolean>',
            is_int($v) => "<int>$v</int>",
            default => '<string>' . htmlspecialchars((string) $v, ENT_XML1) . '</string>',
        } . '</value>';
    }

    private static function decode(\SimpleXMLElement $value): mixed
    {
        $children = $value->children();
        if (count($children) === 0) {
            return (string) $value; // tür etiketi yoksa string
        }
        $node = $children[0];
        return match ($node->getName()) {
            'int', 'i4' => (int) $node,
            'boolean' => (string) $node === '1',
            'double' => (float) $node,
            'array' => array_map(fn($v) => self::decode($v), iterator_to_array($node->data->value, false)),
            'struct' => self::struct($node),
            default => (string) $node,
        };
    }

    private static function struct(\SimpleXMLElement $node): array
    {
        $out = [];
        foreach ($node->member as $m) {
            $out[(string) $m->name] = self::decode($m->value);
        }
        return $out;
    }
}
