<?php
declare(strict_types=1);

namespace Tihamon\Core;

/** Gelen HTTP isteği: yol, sorgu ve JSON gövde. */
final class Request
{
    public readonly string $method;
    public readonly string $path;
    /** @var array<string,string> yol parametreleri (Router doldurur) */
    public array $args = [];
    private ?array $body = null;

    public function __construct()
    {
        $this->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $this->path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/') ?: '/';
    }

    public function query(string $key, ?string $default = null): ?string
    {
        $value = $_GET[$key] ?? null;
        return is_string($value) && $value !== '' ? $value : $default;
    }

    public function queryInt(string $key, int $default, int $min, int $max): int
    {
        $value = filter_var($_GET[$key] ?? null, FILTER_VALIDATE_INT);
        return $value === false ? $default : max($min, min($max, $value));
    }

    /** @return array<string,mixed> */
    public function body(): array
    {
        if ($this->body === null) {
            $decoded = json_decode(file_get_contents('php://input') ?: '', true);
            $this->body = is_array($decoded) ? $decoded : [];
        }
        return $this->body;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->body()[$key] ?? $default;
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->body());
    }

    public function arg(string $key): int
    {
        return (int) ($this->args[$key] ?? 0);
    }

    public function header(string $name): string
    {
        return (string) ($_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? '');
    }

    public function ip(): string
    {
        // nginx, istemcinin adresini fastcgi REMOTE_ADDR olarak iletir.
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }
}
