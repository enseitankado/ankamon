<?php
declare(strict_types=1);

namespace Ankamon\Core;

use PDO;

/** Postgres erişimi için ince bir PDO sarmalayıcısı. */
final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf(
                'pgsql:host=%s;port=%s;dbname=%s',
                getenv('PG_HOST') ?: 'postgres',
                getenv('PG_PORT') ?: '5432',
                getenv('PG_DB') ?: 'ankamon'
            );
            self::$pdo = new PDO($dsn, getenv('PG_USER') ?: 'ankamon', getenv('PG_PASSWORD') ?: '', [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        }
        return self::$pdo;
    }

    /** @return list<array<string,mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function value(string $sql, array $params = []): mixed
    {
        $value = self::run($sql, $params)->fetchColumn();
        return $value === false ? null : $value;
    }

    public static function exec(string $sql, array $params = []): int
    {
        return self::run($sql, $params)->rowCount();
    }

    /**
     * $fn'i tek bir transaction içinde çalıştırır; istisnada geri alır.
     * @template T
     * @param callable():T $fn
     * @return T
     */
    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    private static function run(string $sql, array $params): \PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        foreach ($params as $key => $value) {
            // PDO false'u boş dizgeye çevirir; Postgres boolean bunu kabul etmez.
            $type = match (true) {
                is_bool($value) => PDO::PARAM_BOOL,
                is_int($value) => PDO::PARAM_INT,
                $value === null => PDO::PARAM_NULL,
                default => PDO::PARAM_STR,
            };
            $stmt->bindValue(is_int($key) ? $key + 1 : $key, $value, $type);
        }
        $stmt->execute();
        return $stmt;
    }

    /** PHP dizisini Postgres text[] sabitine çevirir. */
    public static function textArray(array $items): string
    {
        $quoted = array_map(
            static fn($item) => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $item) . '"',
            array_values($items)
        );
        return '{' . implode(',', $quoted) . '}';
    }
}
