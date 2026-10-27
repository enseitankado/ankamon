# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""İki panelli dosya gezgini ("Bilgisayarlar arasında kopyala"): tahtalardaki dosyaları listeler (sahip/grup/izin/
boyut ile), siler, adını değiştirir, klasör oluşturur ve bir tahtadan diğerine ilerlemeli kopyalar.

Bağımsız küçük bir HTTP servisi (supervisord: files, 127.0.0.1:8895); nginx /files-api/ ile oturum +
"filemanager" yetkisiyle vekiller (tahtanın tüm dosya sistemine root erişim — dosya yöneticisiyle aynı
yetki). Tahtalara SSH ile bağlanır (bkz. remote.py); arayüzü frontend ui/files/*.
"""
