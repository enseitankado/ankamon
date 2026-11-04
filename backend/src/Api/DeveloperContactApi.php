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
use Ankamon\Core\Request;

/**
 * Üst çubuktaki Ankamon simgesi → "Geliştiriciye yaz" (bkz. frontend ui/DeveloperContactWindow.js): mesaj ntfy.sh'nin
 * ankamon-iletisim konusuna gider, geliştiricinin (Özgür Koca) telefonuna düşer.
 *
 * Anonim: ntfy'ye yalnız kullanıcının yazdığı metin gider; kullanıcı adı, kurum adı, tahta ya da sunucu bilgisi eklenmez.
 * Metin Ankamon'da da saklanmaz (görev, denetim kaydı, bildirim geçmişi yok). ntfy.sh yalnız isteğin geldiği ağ adresini görür.
 */
final class DeveloperContactApi
{
    private const SERVER = 'https://ntfy.sh';
    private const TOPIC = 'ankamon-iletisim';
    public const MAX_CHARS = 4096;
    /** ntfy.sh'nin bildirim gövdesi sınırı 4096 bayt; başlık ve pay için biraz altı. */
    private const PART_BYTES = 3900;
    /** Aynı kullanıcının iki gönderimi arasında en az (saniye): yanlışlıkla çift gönderim ve kötüye kullanım önlemi. */
    private const COOLDOWN = 60;
    // MEB filtresi HTTPS'i kendi sertifikasıyla keser: kök sertifikası da güvenilir (bkz. worker executor/ntfy.py).
    private const MEB_CA = '/opt/ankamon/certs/meb-ca.crt';

    public function send(Request $request, array $user): array
    {
        $message = trim(str_replace("\r\n", "\n", (string) $request->input('message', '')));
        if ($message === '') {
            throw ApiError::badRequest('Mesaj boş olamaz.');
        }
        if (mb_strlen($message) > self::MAX_CHARS) {
            throw ApiError::badRequest('Mesaj en çok ' . self::MAX_CHARS . ' karakter olabilir.');
        }
        // Bekleme süresi yalnız kullanıcı kimliğiyle (geçici dosyanın zamanı) tutulur, metin yazılmaz.
        $stamp = sys_get_temp_dir() . '/ankamon-developer-contact-' . (int) $user['id'];
        $last = @filemtime($stamp);
        if ($last !== false && time() - $last < self::COOLDOWN) {
            throw ApiError::badRequest('Az önce bir mesaj gönderdiniz; yeni mesaj için ' . (self::COOLDOWN - (time() - $last)) . ' sn bekleyin.');
        }

        // ntfy.sh 4 KB'ı (bayt) aşan gövdeyi bildirim yerine "attachment.txt" dosyası olarak teslim ediyor; Türkçe
        // 4096 karakter ~5 KB eder. Uzun mesaj kelime sınırından parçalara bölünür, telefonda düz metin okunur.
        $parts = self::split($message);
        foreach ($parts as $index => $part) {
            $title = count($parts) > 1 ? sprintf('Ankamon iletisi (%d/%d)', $index + 1, count($parts)) : 'Ankamon iletisi';
            self::publish($title, $part);
        }
        @touch($stamp);
        return ['ok' => true, 'parts' => count($parts)];
    }

    private static function publish(string $title, string $text): void
    {
        $curl = curl_init(self::SERVER . '/' . self::TOPIC);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $text,
            CURLOPT_HTTPHEADER => ["Title: $title", 'Tags: envelope', 'Content-Type: text/plain; charset=utf-8'],
            CURLOPT_USERAGENT => 'Ankamon',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 20,
        ]);
        if (is_readable(self::MEB_CA)) {
            // CAINFO tek dosya ister: sistem kökleri ile MEB kökü birleştirilmiş paket verilir.
            curl_setopt($curl, CURLOPT_CAINFO, self::caBundle());
        }
        $body = curl_exec($curl);
        $code = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if ($body === false || $code < 200 || $code >= 300) {
            throw ApiError::badRequest('Mesaj gönderilemedi: ' . ($error !== '' ? $error : "sunucu yanıtı HTTP $code") . '. Biraz sonra yeniden deneyin.');
        }
    }

    /** En çok PART_BYTES baytlık parçalar; mümkünse boşluk/satır sonundan bölünür, UTF-8 karakter asla ikiye ayrılmaz. */
    private static function split(string $text): array
    {
        $parts = [];
        while (strlen($text) > self::PART_BYTES) {
            $cut = mb_strcut($text, 0, self::PART_BYTES, 'UTF-8');
            $space = max(strrpos($cut, ' ') ?: 0, strrpos($cut, "\n") ?: 0);
            if ($space > self::PART_BYTES / 2) {
                $cut = substr($cut, 0, $space);
            }
            $parts[] = rtrim($cut);
            $text = ltrim(substr($text, strlen($cut)));
        }
        if ($text !== '') {
            $parts[] = $text;
        }
        return $parts;
    }

    /** Sistem CA paketi + MEB kökü (bir kez birleştirilir, geçici dizinde). */
    private static function caBundle(): string
    {
        $bundle = sys_get_temp_dir() . '/ankamon-ca-with-meb.pem';
        if (!is_file($bundle) || filemtime($bundle) < filemtime(self::MEB_CA)) {
            $system = '';
            foreach (['/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/cert.pem'] as $path) {
                if (is_readable($path)) {
                    $system = (string) file_get_contents($path);
                    break;
                }
            }
            file_put_contents($bundle . '.tmp', $system . "\n" . file_get_contents(self::MEB_CA));
            rename($bundle . '.tmp', $bundle);
        }
        return $bundle;
    }
}
