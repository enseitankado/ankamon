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

"""Periyodik görevler. Yeni görev: run(conn) tanımlayan bir modül ekleyip TASKS'a yazın."""

from .. import anomaly
from . import diagnose_schedule, device_identity, device_sessions, device_uptime, devices_from_logs, device_status, break_league, net_device_logs, ntfy_notify, power_probe, session_activity, session_end, session_league, telegraf_targets

# Sıra önemlidir: önce kayıt, sonra durum, oturumlar (device_status'ın güncellediği "online"a bakar),
# kimlik (MAC; SSH erişimi gerekir), Telegraf hedefleri (device_status'ın güncellediği exporter_ok'a
# bakar). Kuyruktaki görevler (komut, işlem, kapat, WoL) burada DEĞİL: ayrı "runner" süreci onları
# pg_notify ile anında alır (burada TICK_SECONDS'ı — 60 sn — bekliyorlardı); bkz. ankamon/runner.
#
# device_status, device_sessions VE telegraf_targets ayrıca kendi başlarına, burada listelenenden daha
# sık çalışır (bkz. __main__.py, STATUS_TICK_SECONDS) — çevrimdışı tespiti, oturum açma/kapama VE bir
# cihazın sensör kaydına başlaması TICK_SECONDS'ı beklemesin diye. Listede de kalmalarının sebebi:
# her TICK_SECONDS turunda diğer görevlerle aynı sırada en az bir kez daha çalışsınlar (device_identity
# 'nin o turda ssh_ok'u güncel bulması garanti olsun; diğerlerinin de her ihtimale karşı aynı turda
# tekrar tetiklenmesi zararsızdır).
# device_uptime: cihazların açık aralıklarını loglardan artımlı çıkarır (Oturumlar zaman çizelgesindeki
# kapalı saat gölgeleri için; dakikalık doğruluk yeter, hızlı döngüde değil).
# anomaly: anomali kuralları (Cihazlar ▸ Anomaliler) — device_uptime ve session_end'in ardından (onların
# güncellediği aralıklar/oturumlar üzerinden hesaplar; bkz. ankamon/anomaly).
# power_probe: açılıştan sonra SMART güç sayaçları + önceki açılışın sonu (elektrik kesintisi anomalisinin teyidi; anomaly'den önce).
# diagnose_schedule: haftalık otomatik sorun tespiti — kaynaklar müsaitken görev kuyruğa yazar (bkz. o dosya).
# session_end: cihazı yeniden erişilebilir olan "cihaz çevrimdışı oldu" kapanışlarını cihazın açılış günlüğüne
# bakıp netleştirir (düzenli kapatma / ETAP otomatik kapanma / elektrik kesintisi …; bkz. o dosya).
# session_activity: Oturumlar ▸ Hareketler verisi (oturumlardan sonra); ntfy_notify: Anomaliler ▸ Bildirimler (anomaly'den sonra).
# session_league: Oturumlar ▸ Şampiyonlar Ligi — oturumların gün parçaları (session_end kapanışları netleştirdikten sonra).
# break_league: Oturumlar ▸ Teneffüs Ligi — ders aralarında açık kalan cihazlar (device_uptime ve oturumlardan sonra).
# net_device_logs: Ağ ▸ "Son log" sütunu (cihaz IP'sinden son log; logs tablosu arayüz sorgusunda taranmasın diye).
TASKS = [devices_from_logs, device_status, device_sessions, device_identity, telegraf_targets, device_uptime, session_end,
         power_probe, anomaly, diagnose_schedule, session_activity, ntfy_notify, session_league, break_league, net_device_logs]


def _extension_tasks() -> list:
    """Eklentilerin (public depoda yok, bkz. ext/README.md) periyodik görevleri: her
    /opt/ankamon/ext/<ad>/worker/tasks.py, run(conn) tanımlayan modüllerden bir TASKS listesi verir;
    bunlar çekirdek görevlerinin ardından aynı turda çalışır. Yüklenemeyen eklenti atlanır (worker durmaz)."""
    import glob
    import importlib.util
    import logging
    import sys

    found = []
    for path in sorted(glob.glob("/opt/ankamon/ext/*/worker/tasks.py")):
        name = "ankamonext_" + path.split("/")[-3]
        try:
            # Eklentinin worker dizini import yoluna girer: tasks.py kendi modüllerini mutlak adla alabilir.
            sys.path.insert(0, path.rsplit("/", 1)[0])
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            found.extend(getattr(module, "TASKS", []))
        except Exception:  # noqa: BLE001 — bir eklentinin hatası worker'ı düşürmesin
            logging.getLogger("ankamon").exception("Eklenti görevleri yüklenemedi: %s", path)
    return found


TASKS += _extension_tasks()
