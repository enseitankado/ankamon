<?php
/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

declare(strict_types=1);

namespace Ankamon\Api;

use Ankamon\Core\ApiError;
use Ankamon\Core\Audit;
use Ankamon\Core\Db;
use Ankamon\Core\Request;

/**
 * Wi-Fi Monitör "sabit" vericileri (wifimon_fixed_emitters — bkz. göç 040). Sınıfta telefon ararken okulun/sınıfın olağan
 * ağları ve cihazları bu listeye alınır; arayüz (ui.devices.WifiMonitor) gerisini "yabancı" olarak öne çıkarır.
 * kind: ssid (ağ adı, bütün erişim noktaları) | bssid | bt | probe; device_id NULL = bütün cihazlar.
 * Okuma ve değiştirme "screen" yetkisi ister (Wi-Fi Monitör'ü açabilen herkes; bkz. routes.php).
 */
final class WifimonFixedEmittersApi
{
    private const KINDS = ['ssid', 'bssid', 'bt', 'probe'];
    private const MAX_ITEMS = 500;

    public function index(Request $request): array
    {
        $rows = Db::all(
            "SELECT f.id, f.kind, f.value, f.device_id, f.label, f.created_by,
                    (extract(epoch FROM f.created_at) * 1000)::bigint AS created_ts,
                    coalesce(nullif(b.label, ''), b.hostname, host(b.ip)) AS device_name
             FROM wifimon_fixed_emitters f LEFT JOIN devices b ON b.id = f.device_id
             ORDER BY f.device_id NULLS FIRST, f.kind, f.value"
        );
        foreach ($rows as &$row) {
            $row['id'] = (int) $row['id'];
            $row['device_id'] = $row['device_id'] === null ? null : (int) $row['device_id'];
        }
        return ['fixed' => $rows];
    }

    /** Toplu ekleme: items [{kind, value, device_id?, label?}]; zaten olanlar atlanır. */
    public function create(Request $request, array $user): array
    {
        $items = $request->input('items', []);
        if (!is_array($items) || !$items) {
            throw ApiError::badRequest('Sabit işaretlenecek verici seçilmedi.');
        }
        if (count($items) > self::MAX_ITEMS) {
            throw ApiError::badRequest('Tek seferde en fazla ' . self::MAX_ITEMS . ' verici işaretlenebilir.');
        }
        $clean = array_map([self::class, 'validatedFixedEmitter'], $items);
        $added = Db::transaction(static function () use ($clean, $user): int {
            $count = 0;
            foreach ($clean as [$kind, $value, $deviceId, $label]) {
                $count += Db::exec(
                    'INSERT INTO wifimon_fixed_emitters (kind, value, device_id, label, created_by) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (kind, value, coalesce(device_id, 0)) DO NOTHING',
                    [$kind, $value, $deviceId, $label, (string) ($user['username'] ?? '—')]
                );
            }
            return $count;
        });
        Audit::log($user, $request, 'wifimon.fixed.add', '', ['count' => $added, 'items' => array_slice($clean, 0, 50)]);
        return ['ok' => true, 'added' => $added];
    }

    public function delete(Request $request, array $user): array
    {
        $ids = array_values(array_unique(array_map('intval', (array) $request->input('ids', []))));
        if (!$ids) {
            throw ApiError::badRequest('Sabit listesinden çıkarılacak kayıt seçilmedi.');
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $removed = Db::all("DELETE FROM wifimon_fixed_emitters WHERE id IN ($placeholders) RETURNING kind, value, device_id", $ids);
        Audit::log($user, $request, 'wifimon.fixed.delete', '', ['count' => count($removed), 'removed' => array_slice($removed, 0, 50)]);
        return ['ok' => true, 'deleted' => count($removed)];
    }

    /**
     * Toplu kapsam değişikliği (kullanıcı isteği 2026-11-10): ids [..], device_id null = okul geneli, sayı = o cihazın sınıfı.
     * Hedef kapsamda aynı verici zaten kayıtlıysa taşınan kayıt fazlalıktır, silinir (UNIQUE kind+value+kapsam).
     */
    public function rescope(Request $request, array $user): array
    {
        $ids = array_values(array_unique(array_map('intval', (array) $request->input('ids', []))));
        if (!$ids) {
            throw ApiError::badRequest('Kapsamı değişecek kayıt seçilmedi.');
        }
        if (count($ids) > self::MAX_ITEMS) {
            throw ApiError::badRequest('Tek seferde en fazla ' . self::MAX_ITEMS . ' kayıt değiştirilebilir.');
        }
        $raw = $request->input('device_id');
        $deviceId = $raw === null || $raw === '' ? null : (int) $raw;
        if ($deviceId !== null && !Db::value('SELECT 1 FROM devices WHERE id = ?', [$deviceId])) {
            throw ApiError::badRequest('Cihaz bulunamadı.');
        }
        [$moved, $merged] = Db::transaction(static function () use ($ids, $deviceId): array {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            // Hedefte zaten olanlar (ya da seçilenlerin kendi aralarında aynı vericinin birden çok kaydı): biri kalır.
            $merged = Db::exec(
                "DELETE FROM wifimon_fixed_emitters f WHERE f.id IN ($placeholders)
                   AND coalesce(f.device_id, 0) <> coalesce(?::int, 0)
                   AND EXISTS (SELECT 1 FROM wifimon_fixed_emitters g
                               WHERE g.kind = f.kind AND g.value = f.value AND coalesce(g.device_id, 0) = coalesce(?::int, 0))",
                [...$ids, $deviceId, $deviceId]
            );
            $merged += Db::exec(
                "DELETE FROM wifimon_fixed_emitters f WHERE f.id IN ($placeholders)
                   AND EXISTS (SELECT 1 FROM wifimon_fixed_emitters g
                               WHERE g.id IN ($placeholders) AND g.kind = f.kind AND g.value = f.value AND g.id < f.id)",
                [...$ids, ...$ids]
            );
            $moved = Db::exec(
                "UPDATE wifimon_fixed_emitters SET device_id = ?
                 WHERE id IN ($placeholders) AND coalesce(device_id, 0) <> coalesce(?::int, 0)",
                [$deviceId, ...$ids, $deviceId]
            );
            return [$moved, $merged];
        });
        Audit::log($user, $request, 'wifimon.fixed.rescope', '', ['count' => count($ids), 'device_id' => $deviceId,
            'moved' => $moved, 'merged' => $merged, 'ids' => array_slice($ids, 0, 50)]);
        return ['ok' => true, 'moved' => $moved, 'merged' => $merged];
    }

    /** @return array{0:string,1:string,2:?int,3:string} */
    private static function validatedFixedEmitter(mixed $item): array
    {
        $item = is_array($item) ? $item : [];
        $kind = (string) ($item['kind'] ?? '');
        if (!in_array($kind, self::KINDS, true)) {
            throw ApiError::badRequest('Geçersiz verici türü.');
        }
        $value = trim((string) ($item['value'] ?? ''));
        if ($kind === 'ssid') {
            if ($value === '' || mb_strlen($value) > 64) {
                throw ApiError::badRequest('Ağ adı 1–64 karakter olmalı.');
            }
        } else {
            $value = strtoupper($value);
            if (!preg_match('/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/', $value)) {
                throw ApiError::badRequest('Geçersiz adres: ' . $value);
            }
        }
        $deviceId = isset($item['device_id']) && $item['device_id'] !== null && $item['device_id'] !== '' ? (int) $item['device_id'] : null;
        if ($deviceId !== null && !Db::value('SELECT 1 FROM devices WHERE id = ?', [$deviceId])) {
            throw ApiError::badRequest('Cihaz bulunamadı.');
        }
        $label = mb_substr(trim((string) ($item['label'] ?? '')), 0, 120);
        return [$kind, $value, $deviceId, $label];
    }
}
