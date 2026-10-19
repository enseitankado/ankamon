"""Periyodik görevler. Yeni görev: run(conn) tanımlayan bir modül ekleyip TASKS'a yazın."""

from . import diagnose_schedule, board_identity, board_sessions, board_uptime, boards_from_logs, board_status, session_end, telegraf_targets

# Sıra önemlidir: önce kayıt, sonra durum, oturumlar (board_status'ın güncellediği "online"a bakar),
# kimlik (MAC; SSH erişimi gerekir), Telegraf hedefleri (board_status'ın güncellediği exporter_ok'a
# bakar). Kuyruktaki görevler (komut, işlem, kapat, WoL) burada DEĞİL: ayrı "runner" süreci onları
# pg_notify ile anında alır (burada TICK_SECONDS'ı — 60 sn — bekliyorlardı); bkz. tihamon/runner.
#
# board_status, board_sessions VE telegraf_targets ayrıca kendi başlarına, burada listelenenden daha
# sık çalışır (bkz. __main__.py, STATUS_TICK_SECONDS) — çevrimdışı tespiti, oturum açma/kapama VE bir
# tahtanın sensör kaydına başlaması TICK_SECONDS'ı beklemesin diye. Listede de kalmalarının sebebi:
# her TICK_SECONDS turunda diğer görevlerle aynı sırada en az bir kez daha çalışsınlar (board_identity
# 'nin o turda ssh_ok'u güncel bulması garanti olsun; diğerlerinin de her ihtimale karşı aynı turda
# tekrar tetiklenmesi zararsızdır).
# board_uptime: tahtaların açık aralıklarını loglardan artımlı çıkarır (Oturumlar zaman çizelgesindeki
# kapalı saat gölgeleri için; dakikalık doğruluk yeter, hızlı döngüde değil).
# diagnose_schedule: haftalık otomatik sorun tespiti — kaynaklar müsaitken görev kuyruğa yazar (bkz. o dosya).
# session_end: tahtası yeniden erişilebilir olan "tahta çevrimdışı oldu" kapanışlarını tahtanın açılış günlüğüne
# bakıp netleştirir (düzenli kapatma / ETAP otomatik kapanma / elektrik kesintisi …; bkz. o dosya).
TASKS = [boards_from_logs, board_status, board_sessions, board_identity, telegraf_targets, board_uptime, session_end,
         diagnose_schedule]
