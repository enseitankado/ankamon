"""İki panelli dosya gezgini ("Dosyaları kopyala"): tahtalardaki dosyaları listeler (sahip/grup/izin/
boyut ile), siler, adını değiştirir, klasör oluşturur ve bir tahtadan diğerine ilerlemeli kopyalar.

Bağımsız küçük bir HTTP servisi (supervisord: files, 127.0.0.1:8895); nginx /files-api/ ile oturum +
"filemanager" yetkisiyle vekiller (tahtanın tüm dosya sistemine root erişim — dosya yöneticisiyle aynı
yetki). Tahtalara SSH ile bağlanır (bkz. remote.py); arayüzü frontend ui/files/*.
"""
