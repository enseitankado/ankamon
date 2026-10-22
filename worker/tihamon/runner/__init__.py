"""Görev yürütücüsü: kuyruğa yazılan görevleri (komut, hazır işlem, kapat, WoL) beklemeden çalıştırır.

API görevi yazarken `pg_notify('tihamon_jobs')` gönderir; yürütücü bunu LISTEN ile anında yakalar (ayrıca
birkaç saniyede bir kuyruğu yoklar). Her görev ayrı bir iş parçacığında çalışır (RUNNER_JOB_THREADS kadar
eşzamanlı görev); görevdeki tahtalar PARALEL işlenir, aynı anda kaç tahta olacağı konteynerin CPU/RAM
boşluğuna göre (whoami.dynamic_concurrency) — her iş parçacığı kendi veritabanı bağlantısını açar, çıktı
tahta başına ayrı tutulur (job_events.board_id). Komut/işlem görevlerinde tahtaya doğrudan SSH ile bağlanılır ve olup biten her
şey — bağlanılıyor, bağlandı, çıktının her satırı, çıkış kodu, süre — oluştukça `job_events`'e yazılır;
arayüzün canlı çıktı penceresi bunu artımlı okur (bkz. backend JobsApi::events, frontend ui/Jobs.js).
"""
