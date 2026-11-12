# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Görev yürütücüsü: kuyruğa yazılan görevleri (komut, hazır işlem, kapat, WoL) beklemeden çalıştırır.

API görevi yazarken `pg_notify('ankamon_jobs')` gönderir; yürütücü bunu LISTEN ile anında yakalar (ayrıca
birkaç saniyede bir kuyruğu yoklar). Her görev ayrı bir iş parçacığında çalışır (RUNNER_JOB_THREADS kadar
eşzamanlı görev); görevdeki cihazlar PARALEL işlenir, aynı anda kaç cihaz olacağı konteynerin CPU/RAM
boşluğuna göre (whoami.dynamic_concurrency) — her iş parçacığı kendi veritabanı bağlantısını açar, çıktı
cihaz başına ayrı tutulur (job_events.device_id). Komut/işlem görevlerinde cihaza doğrudan SSH ile bağlanılır ve olup biten her
şey — bağlanılıyor, bağlandı, çıktının her satırı, çıkış kodu, süre — oluştukça `job_events`'e yazılır;
arayüzün canlı çıktı penceresi bunu artımlı okur (bkz. backend JobsApi::events, frontend ui/Jobs.js).
"""
