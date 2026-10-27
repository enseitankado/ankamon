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
from . import diagnose_schedule, board_identity, board_sessions, board_uptime, boards_from_logs, board_status, session_end, telegraf_targets

# Sıra önemlidir: önce kayıt, sonra durum, oturumlar (board_status'ın güncellediği "online"a bakar),
# kimlik (MAC; SSH erişimi gerekir), Telegraf hedefleri (board_status'ın güncellediği exporter_ok'a
# bakar). Kuyruktaki görevler (komut, işlem, kapat, WoL) burada DEĞİL: ayrı "runner" süreci onları
# pg_notify ile anında alır (burada TICK_SECONDS'ı — 60 sn — bekliyorlardı); bkz. ankamon/runner.
#
# board_status, board_sessions VE telegraf_targets ayrıca kendi başlarına, burada listelenenden daha
# sık çalışır (bkz. __main__.py, STATUS_TICK_SECONDS) — çevrimdışı tespiti, oturum açma/kapama VE bir
# tahtanın sensör kaydına başlaması TICK_SECONDS'ı beklemesin diye. Listede de kalmalarının sebebi:
# her TICK_SECONDS turunda diğer görevlerle aynı sırada en az bir kez daha çalışsınlar (board_identity
# 'nin o turda ssh_ok'u güncel bulması garanti olsun; diğerlerinin de her ihtimale karşı aynı turda
# tekrar tetiklenmesi zararsızdır).
# board_uptime: tahtaların açık aralıklarını loglardan artımlı çıkarır (Oturumlar zaman çizelgesindeki
# kapalı saat gölgeleri için; dakikalık doğruluk yeter, hızlı döngüde değil).
# anomaly: anomali kuralları (Tahtalar ▸ Anomaliler) — board_uptime ve session_end'in ardından (onların
# güncellediği aralıklar/oturumlar üzerinden hesaplar; bkz. ankamon/anomaly).
# diagnose_schedule: haftalık otomatik sorun tespiti — kaynaklar müsaitken görev kuyruğa yazar (bkz. o dosya).
# session_end: tahtası yeniden erişilebilir olan "tahta çevrimdışı oldu" kapanışlarını tahtanın açılış günlüğüne
# bakıp netleştirir (düzenli kapatma / ETAP otomatik kapanma / elektrik kesintisi …; bkz. o dosya).
TASKS = [boards_from_logs, board_status, board_sessions, board_identity, telegraf_targets, board_uptime, session_end,
         anomaly, diagnose_schedule]


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
