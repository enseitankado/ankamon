"""Görev yürütücüsü: kuyruğa yazılan görevleri (komut, hazır işlem, kapat, WoL) beklemeden çalıştırır.

API görevi yazarken `pg_notify('tihamon_jobs')` gönderir; yürütücü bunu LISTEN ile anında yakalar (ayrıca
birkaç saniyede bir kuyruğu yoklar). Her görev ayrı bir iş parçacığında çalışır (RUNNER_JOB_THREADS kadar
eşzamanlı görev); görevdeki tahtalar İSE SIRAYLA işlenir — hepsi aynı veritabanı bağlantısını paylaştığından
(bkz. stream.Events) ve çıktının tahta tahta okunaklı akması istendiğinden (bkz. frontend ui/Jobs.js'teki
tahtalar arası boş satır). Komut/işlem görevlerinde tahtaya doğrudan SSH ile bağlanılır ve olup biten her
şey — bağlanılıyor, bağlandı, çıktının her satırı, çıkış kodu, süre — oluştukça `job_events`'e yazılır;
arayüzün canlı çıktı penceresi bunu artımlı okur (bkz. backend JobsApi::events, frontend ui/Jobs.js).
"""
