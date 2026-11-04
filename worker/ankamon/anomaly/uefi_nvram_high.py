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

"""Anomali: UEFI değişken deposu (NVRAM) doluluğu filo ortalamasının belirgin üzerinde.

Kaynak: boards.facts->firmware_boot (store_used / store_total — efivarfs'in df'i, firmware QueryVariableInfo;
bkz. executor/hwfacts.py _firmware_boot). Bilgi kartı, ilk tanıma ve haftalık otomatik sorun taraması toplar.

Neden: NVRAM dolarsa firmware yeni değişken (açılış girdisi, BootNext, Secure Boot anahtarı) yazamaz;
işletim sistemi güncellemesinde önyükleyici kaydı başarısız olur, bazı AMI firmware'leri açılışta takılır.
Aynı modeldeki tahtalar benzer doluluktadır; belirgin sapma, birikmiş/eskimiş kopyalar (firmware toplamıyor)
ya da tahtaya yazılmış fazladan veri demektir.

Kural: tahtanın doluluk oranı, verisi olan tüm tahtaların ortalamasından en az MARGIN_PT puan yüksekse
(ortalama için en az MIN_BOARDS tahta gerekir) ya da boş alan FREE_MIN_PCT'nin altındaysa anomali sürer.
Durum ölçümüdür (sürekli değil): her turda son toplanan değere bakılır; oran düşünce kayıt o toplanma anında biter.
"""

import datetime

KIND = "uefi_nvram_high"
MARGIN_PT = 10.0      # ortalamanın bu kadar puan üzeri anomali (ör. ortalama %40 → %50 ve üstü)
FREE_MIN_PCT = 10.0   # ortalamadan bağımsız: boş alan %10'un altıysa her zaman anomali
MIN_BOARDS = 3
WINDOW = datetime.timedelta(hours=1)

_BOARDS = """
SELECT id, lower(COALESCE(NULLIF(hostname, ''), host(ip))) AS host,
       COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name,
       (facts->'firmware_boot'->>'store_used')::bigint AS used,
       (facts->'firmware_boot'->>'store_total')::bigint AS total,
       (facts->>'hw_collected_at')::bigint AS collected_at
FROM boards
WHERE (facts->'firmware_boot'->>'store_total')::bigint > 0
"""

_OPEN = "SELECT host, started_at, detail FROM anomalies WHERE kind = %s AND ended_at IS NULL"


def _tr(value: float) -> str:
    return f"{value:.1f}".replace(".", ",").replace(",0", "")


def fleet_average(conn) -> tuple[float | None, int]:
    """Verisi olan tahtaların ortalama NVRAM doluluk oranı (%) ve tahta sayısı."""
    rows = [r for r in conn.execute(_BOARDS).fetchall() if r["host"]]
    if not rows:
        return None, 0
    return sum(100.0 * r["used"] / r["total"] for r in rows) / len(rows), len(rows)


def judge(used: int, total: int, avg: float | None, count: int) -> tuple[bool | None, str, dict]:
    """(anomali mi, özet, ayrıntı). Ortalama hesaplanamıyorsa yalnız boş alan eşiğine bakılır."""
    pct = 100.0 * used / total
    free_pct = 100.0 - pct
    detail = {"used_pct": round(pct, 1), "avg_pct": round(avg, 1) if avg is not None else None,
              "used": used, "total": total, "boards": count}
    text = f"Doluluk %{_tr(pct)} ({used // 1024} KB / {total // 1024} KB)"
    if free_pct < FREE_MIN_PCT:
        return True, text + f" — boş alan %{_tr(free_pct)}, firmware yeni değişken yazamayabilir", detail
    if avg is None or count < MIN_BOARDS:
        return None, text + f" — filo ortalaması için en az {MIN_BOARDS} tahtanın verisi gerekir", detail
    over = pct - avg
    if over >= MARGIN_PT:
        return True, text + f" — filo ortalaması %{_tr(avg)} ({count} tahta), {_tr(over)} puan üzerinde", detail
    return False, text + f" — filo ortalaması %{_tr(avg)} ({count} tahta)", detail


def detect(conn, since):
    rows = [r for r in conn.execute(_BOARDS).fetchall() if r["host"]]
    avg = sum(100.0 * r["used"] / r["total"] for r in rows) / len(rows) if rows else None
    open_ = {r["host"]: r for r in conn.execute(_OPEN, (KIND,)).fetchall()}
    now = datetime.datetime.now(datetime.timezone.utc)
    found = []
    for r in rows:
        anomaly, text, detail = judge(r["used"], r["total"], avg, len(rows))
        at = (datetime.datetime.fromtimestamp(r["collected_at"], datetime.timezone.utc)
              if r["collected_at"] else now)
        known = open_.pop(r["host"], None)
        detail["text"] = text
        if anomaly:
            found.append({"host": r["host"], "board_id": r["id"], "board_name": r["name"],
                          "started_at": known["started_at"] if known else at, "ended_at": None, "detail": detail})
        elif known:
            # Oran ortalamaya indi (ya da filo ortalaması yükseldi): son toplanma anında biter.
            found.append({"host": r["host"], "board_id": r["id"], "board_name": r["name"],
                          "started_at": known["started_at"], "ended_at": max(at, known["started_at"]),
                          "detail": {**(known["detail"] or {}), "end_text": text}})
    # Kapsam yok: geçmiş kayıtlar silinmez, yalnız güncellenir (verisi kalkan tahtanın kaydı açık kalır).
    return found, []


# Anlık tarama (Anomaliler ▸ Tarama): efivarfs'in toplam/dolu baytı. Legacy (CSM) açılışta efivarfs yoktur.
PROBE = r"""
if [ -d /sys/firmware/efi/efivars ]; then
  df -B1 -P /sys/firmware/efi/efivars 2>/dev/null | awk 'NR==2{printf "total=%.0f\nused=%.0f\n", $2, $3}'
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
    avg, count = fleet_average(ctx["conn"])
    anomaly, text, detail = judge(used, total, avg, count)
    return {"anomaly": anomaly, "summary": text, "detail": detail}
