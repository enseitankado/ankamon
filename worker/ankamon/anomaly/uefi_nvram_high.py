# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Anomali: UEFI değişken deposunun (NVRAM) boş alanı %10'un altında.

Kaynak: boards.facts->firmware_boot (store_used / store_total — efivarfs'in df'i, firmware QueryVariableInfo;
bkz. executor/hwfacts.py _firmware_boot). Bilgi kartı, ilk tanıma ve haftalık otomatik sorun taraması toplar.

Neden: NVRAM dolarsa firmware yeni değişken (açılış girdisi, BootNext, Secure Boot anahtarı) yazamaz;
işletim sistemi güncellemesinde önyükleyici kaydı başarısız olur, bazı AMI firmware'leri açılışta takılır.

Kural: yalnız boş alan FREE_MIN_PCT'nin altındaysa anomali sürer. Filo ortalamasıyla karşılaştırılmaz:
AMI deposu log yapılıdır — her yazma değişkenin yeni kopyasını ekler, eskisi firmware açılışta toplayana
(reclaim) dek yer kaplar. Canlı içerik her tahtada ~9-19 KB iken doluluk bu testere dişi yüzünden %9-96
arasında gezer ve açılış sayısıyla ilişkisizdir (2026-11-11 filo ölçümü); ortalamanın üstünde olmak sorun
değildir. Ayrıntıya canlı içerik (uefi_vars boyutları toplamı) de yazılır: doluluğun kalanı eskimiş kopyadır.
Durum ölçümüdür (sürekli değil): her turda son toplanan değere bakılır; boş alan açılınca kayıt o toplanma
anında biter.

Saha bulguları (2026-11-11, "B Blok - Arge 2", VESTEL 14MB57 / AMI 4.6.5):
- Firmware her açılışta yazar: MonotonicCounter, ConIn/ConInDev, CSM açıksa legacy BBS Boot#### girdilerinin
  etkin bayrağı (+ görünmeyen BS değişkenleri) — açılış başına ~2,8 KB.
- 14MB37C1 (AMD) dolunca açılışta kendiliğinden toplar (etap-8abea4, etap-8a716a, etap-8ac554). 14MB57 (Intel)
  %100 dolu depoda (ham 265 B) açılışta TOPLAMADI.
- Çözüm: BIOS Setup'a girip ayar değiştirmeden "Save & Exit" → toplandı (%100 → %13), değişkenler ve açılış
  sırası korundu. Linux'tan tetikleme dolu depoda işlemez (x86 çekirdeği son 5 KB'a yazmaz, df boş 0).
- Önlem: CSM kapatmak legacy Boot#### yazılarını keser.
"""

import datetime

KIND = "uefi_nvram_high"
FREE_MIN_PCT = 10.0   # boş alan %10'un altıysa anomali (128 KB depoda ~13 KB)
WINDOW = datetime.timedelta(hours=1)

_BOARDS = """
SELECT id, lower(COALESCE(NULLIF(hostname, ''), host(ip))) AS host,
       COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name,
       (facts->'firmware_boot'->>'store_used')::bigint AS used,
       (facts->'firmware_boot'->>'store_total')::bigint AS total,
       (SELECT sum((v->>'size')::bigint) FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(facts->'uefi_vars') = 'array' THEN facts->'uefi_vars' ELSE '[]' END) v) AS live,
       (facts->>'hw_collected_at')::bigint AS collected_at
FROM boards
WHERE (facts->'firmware_boot'->>'store_total')::bigint > 0
"""

_OPEN = "SELECT host, started_at, detail FROM anomalies WHERE kind = %s AND ended_at IS NULL"


def _tr(value: float) -> str:
    return f"{value:.1f}".replace(".", ",").replace(",0", "")


def judge(used: int, total: int, live: int | None = None) -> tuple[bool, str, dict]:
    """(anomali mi, özet, ayrıntı). live: canlı değişkenlerin bayt toplamı (bilinmiyorsa None)."""
    pct = 100.0 * used / total
    free_pct = 100.0 - pct
    detail = {"used_pct": round(pct, 1), "used": used, "total": total, "live": live}
    text = f"Doluluk %{_tr(pct)} ({used // 1024} KB / {total // 1024} KB)"
    if live:
        text += f", canlı içerik {max(1, round(live / 1024))} KB"
    if free_pct < FREE_MIN_PCT:
        tail = f" — boş alan %{_tr(free_pct)}, firmware yeni değişken yazamayabilir"
        if live and live < used / 2:
            tail += (" (doluluğun çoğu eskimiş kopya. Çözüm: tahtanın başında BIOS kurulumuna girip ayar"
                     " değiştirmeden \"Save & Exit\" — firmware toplar, ayarlar korunur)")
        return True, text + tail, detail
    return False, text + f" — boş alan %{_tr(free_pct)}", detail


def detect(conn, since):
    rows = [r for r in conn.execute(_BOARDS).fetchall() if r["host"]]
    open_ = {r["host"]: r for r in conn.execute(_OPEN, (KIND,)).fetchall()}
    now = datetime.datetime.now(datetime.timezone.utc)
    found = []
    for r in rows:
        anomaly, text, detail = judge(r["used"], r["total"], r["live"])
        at = (datetime.datetime.fromtimestamp(r["collected_at"], datetime.timezone.utc)
              if r["collected_at"] else now)
        known = open_.pop(r["host"], None)
        detail["text"] = text
        if anomaly:
            found.append({"host": r["host"], "board_id": r["id"], "board_name": r["name"],
                          "started_at": known["started_at"] if known else at, "ended_at": None, "detail": detail})
        elif known:
            # Boş alan açıldı (firmware topladı) ya da eşik altına hiç inmemişti: son toplanma anında biter.
            found.append({"host": r["host"], "board_id": r["id"], "board_name": r["name"],
                          "started_at": known["started_at"], "ended_at": max(at, known["started_at"]),
                          "detail": {**(known["detail"] or {}), "end_text": text}})
    # Kapsam yok: geçmiş kayıtlar silinmez, yalnız güncellenir (verisi kalkan tahtanın kaydı açık kalır).
    return found, []


# Anlık tarama (Anomaliler ▸ Tarama): efivarfs'in toplam/dolu baytı + canlı değişkenlerin veri toplamı
# (efivarfs dosya boyu = 4 bayt öznitelik + veri). Legacy (CSM) açılışta efivarfs yoktur.
PROBE = r"""
if [ -d /sys/firmware/efi/efivars ]; then
  df -B1 -P /sys/firmware/efi/efivars 2>/dev/null | awk 'NR==2{printf "total=%.0f\nused=%.0f\n", $2, $3}'
  find /sys/firmware/efi/efivars -type f -printf '%s\n' 2>/dev/null | awk '$1>4{s+=$1-4} END{printf "live=%.0f\n", s}'
else
  echo "legacy=1"
fi
"""


def evaluate(values: dict, ctx: dict) -> dict:
    if values.get("legacy") == "1":
        return {"anomaly": None, "summary": "Legacy (CSM) açılış: UEFI değişken deposu okunamaz", "detail": {}}
    try:
        used, total = int(values["used"]), int(values["total"])
    except (KeyError, ValueError):
        return {"anomaly": None, "summary": "Değişken deposu okunamadı", "detail": {}}
    if total <= 0:
        return {"anomaly": None, "summary": "Değişken deposu boyutu bildirilmiyor", "detail": {}}
    try:
        live = int(values.get("live") or 0) or None
    except ValueError:
        live = None
    anomaly, text, detail = judge(used, total, live)
    return {"anomaly": anomaly, "summary": text, "detail": detail}
