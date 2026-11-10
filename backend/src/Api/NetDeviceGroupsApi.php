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
 * Varlık grupları (Ağ ▸ Varlıklar ▸ <grup>; şema db/migrations/047_net_device_groups.sql): Tüm Varlıklar grid'inde
 * işaretli varlıklardan kurulan adlı alt listeler. Grup yalnız net_devices satırlarına bağlantıdır — kendi taraması
 * yoktur, satırları her zaman Tüm Varlıklar'ın verisinden (GET /network/devices) süzülür; varlık silinince bütün
 * gruplarından düşer (FK CASCADE). Yazma 'network.manage', okuma 'network' yetkisiyle.
 */
final class NetDeviceGroupsApi
{
    private const NAME_LIMIT = 80;

    /** Bütün gruplar ve üye kimlikleri: {groups:[{id, name, members:[device id…]}]} — ada göre. */
    public function deviceGroups(): array
    {
        $rows = Db::all(
            "SELECT g.id, g.name, COALESCE(array_agg(m.device_id ORDER BY m.device_id)
                    FILTER (WHERE m.device_id IS NOT NULL), '{}') AS members
             FROM net_device_groups g LEFT JOIN net_device_group_members m ON m.group_id = g.id
             GROUP BY g.id ORDER BY lower(g.name)"
        );
        return ['groups' => array_map(fn(array $r) => [
            'id' => (int) $r['id'],
            'name' => $r['name'],
            'members' => array_map('intval', array_filter(explode(',', trim((string) $r['members'], '{}')), 'strlen')),
        ], $rows)];
    }

    /** Gövde: {name, ids:[…]} — ids Tüm Varlıklar'da işaretli varlıklar. */
    public function createDeviceGroup(Request $request, array $user): array
    {
        $name = self::groupName($request->input('name'));
        $ids = self::deviceIds($request->input('ids'), false);
        $id = Db::transaction(function () use ($name, $ids, $user) {
            self::assertFreeName($name, 0);
            $id = (int) Db::value('INSERT INTO net_device_groups (name, created_by) VALUES (?, ?) RETURNING id',
                [$name, (string) ($user['username'] ?? '')]);
            self::addMembers($id, $ids);
            return $id;
        });
        Audit::log($user, $request, 'network.group.create', "$id $name (" . count($ids) . ' varlık)');
        return ['ok' => true, 'id' => $id];
    }

    /** Gövde: {name?, add?:[…], remove?:[…]} — yeniden adlandırma ve üye ekleme/çıkarma. */
    public function updateDeviceGroup(Request $request, array $user): array
    {
        $id = $request->arg('id');
        Db::value('SELECT 1 FROM net_device_groups WHERE id = ?', [$id]) ?? throw ApiError::notFound();
        $name = $request->has('name') ? self::groupName($request->input('name')) : null;
        $add = $request->has('add') ? self::deviceIds($request->input('add'), true) : [];
        $remove = $request->has('remove') ? self::deviceIds($request->input('remove'), true) : [];
        Db::transaction(function () use ($id, $name, $add, $remove) {
            if ($name !== null) {
                self::assertFreeName($name, $id);
                Db::exec('UPDATE net_device_groups SET name = ? WHERE id = ?', [$name, $id]);
            }
            self::addMembers($id, $add);
            if ($remove) {
                Db::exec('DELETE FROM net_device_group_members WHERE group_id = ? AND device_id = ANY(?::int[])',
                    [$id, '{' . implode(',', $remove) . '}']);
            }
        });
        Audit::log($user, $request, 'network.group.update', "$id" . ($name !== null ? " ad=$name" : '') .
            ($add ? ' +' . implode(',', $add) : '') . ($remove ? ' -' . implode(',', $remove) : ''));
        return ['ok' => true];
    }

    /** Grubu siler; varlıklar Tüm Varlıklar'da kalır. */
    public function deleteDeviceGroup(Request $request, array $user): array
    {
        $id = $request->arg('id');
        $name = Db::value('DELETE FROM net_device_groups WHERE id = ? RETURNING name', [$id]) ?? throw ApiError::notFound();
        Audit::log($user, $request, 'network.group.delete', "$id $name");
        return ['ok' => true];
    }

    private static function groupName(mixed $value): string
    {
        $name = trim(preg_replace('/\s+/u', ' ', (string) $value) ?? '');
        if ($name === '') {
            throw ApiError::badRequest('Grup adı boş olamaz.');
        }
        if (mb_strlen($name) > self::NAME_LIMIT) {
            throw ApiError::badRequest('Grup adı en çok ' . self::NAME_LIMIT . ' karakter olabilir.');
        }
        return $name;
    }

    private static function assertFreeName(string $name, int $exceptId): void
    {
        if (Db::value('SELECT 1 FROM net_device_groups WHERE lower(name) = lower(?) AND id <> ?', [$name, $exceptId]) !== null) {
            throw ApiError::badRequest("\"$name\" adlı bir grup zaten var.");
        }
    }

    /** @return list<int> */
    private static function deviceIds(mixed $value, bool $allowEmpty): array
    {
        if (!is_array($value) || count($value) > 5000 || (!$value && !$allowEmpty)) {
            throw ApiError::badRequest('Varlık seçilmedi.');
        }
        $ids = [];
        foreach ($value as $id) {
            if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
                throw ApiError::badRequest('Geçersiz varlık kimliği.');
            }
            $ids[] = (int) $id;
        }
        return array_values(array_unique($ids));
    }

    /** Yalnız Tüm Varlıklar'da var olan varlıklar eklenir (silinmiş kimlik sessizce atlanır). */
    private static function addMembers(int $groupId, array $ids): void
    {
        if ($ids) {
            Db::exec('INSERT INTO net_device_group_members (group_id, device_id)
                      SELECT ?, d.id FROM net_devices d WHERE d.id = ANY(?::int[]) ON CONFLICT DO NOTHING',
                [$groupId, '{' . implode(',', $ids) . '}']);
        }
    }
}
