# Ankamon

Okuldaki akıllı tahtalar için merkezi log sunucusu, sensör izleme ve uzaktan yönetim merkezi.
[TiHA](https://github.com/enseitankado/tiha) ile hazırlanmış tahtaların karşı tarafıdır: tahtalar loglarını
buraya gönderir, sensör verileri buradan okunur.

Bütün bileşenler **tek bir Docker konteynerinde** çalışır (içeride supervisord yönetir); kalıcı veri
yalnız `data/` dizinindedir. Dışarıya yalnız iki port açılır: arayüz için **80**, tahta logları için
**514** (TCP ve UDP).

## Kurulum

```bash
curl -fsSL https://raw.githubusercontent.com/enseitankado/ankamon/main/install.sh | sudo bash
```

MEB filtreli okul ağında curl sertifika hatası verirse `curl -fsSLk …` kullanın; betik gerisini kendisi
çözer (filtrenin HTTPS kesmesini tespit ederse MEB kök sertifikasını sistemin güven deposuna ekler).

Betik Docker yoksa kurar, kaynak kodu `/opt/ankamon`'a indirir, `.env`'yi varsayılan ayarlar ve rastgele
parolalarla üretir, imajı bu makinede derler, yığını başlatır ve sonunda arayüz adresini ve `etapadmin`
parolasını yazar. Bağımlılıklar (temel imajlar, Alpine paketleri, npm kütüphaneleri, qooxdoo temaları,
MAC üretici tablosu) derlemede kendi asıl adreslerinden indirilir; depoda yalnız Ankamon'un kendi kodu vardır.

Ayarlar `.env` dosyasındadır (açıklamalar için `.env.example`). Değişiklikten sonra: `docker compose up -d`.

### Güncelleme

```bash
sudo /opt/ankamon/install.sh --update
```

Sırasıyla: depodaki dosyalar sunucuda elle değiştirilmişse durur (hiçbir şeyi silmez) → çalışan sistemden
veritabanı yedeği alır (`data/backups/pre-update-*`, son 3 adet) → yeni kodu çeker → `.env`'ye yalnız yeni
ayarları ekler (mevcut değerlere dokunmaz) → yeni imajı **eski sistem çalışırken** derler (derleme başarısız
olursa çalışan sistem etkilenmez) → yeni sürüme geçer; yeni sürüm sağlıklı açılmazsa önceki sürüme kendiliğinden
döner. Veritabanı şeması açılışta göçlerle (`db/migrations/`) güncellenir. `.env` ve `data/` depo dışındadır.

## Bileşenler

Hepsi tek konteynerde, supervisord ile yönetilir (bkz. `docker/rootfs/supervisord.conf`):

| Süreç | Görev | Kalıcı veri |
|---|---|---|
| nginx | Derlenmiş qooxdoo arayüzü (80), `/api` → PHP-FPM, `/grafana` → Grafana vekili | — |
| php-fpm | REST API: oturum, kullanıcılar, tahtalar, loglar, görev kuyruğu | — |
| worker | Python: tahta kaydı, erişilebilirlik yoklaması, Telegraf hedefleri, Ansible ile görev yürütme | `data/telegraf` |
| postgres | PostgreSQL 17 + TimescaleDB: bütün veriler | `data/postgres` |
| rsyslog | Tahtalardan syslog alır (TCP/UDP 514), Postgres'e yazar | `data/rsyslog` (disk kuyruğu) |
| telegraf | Tahtaların node_exporter ucunu (`:9100`) okur, Postgres'e yazar | — |
| grafana | Sensör grafikleri; oturumu Ankamon'dan devralır | `data/grafana`, Postgres |
| backup | Rutin `pg_dump` yedekleri | `data/backups` |
| dbinit | Açılışta bir kez: şema göçleri ve etapadmin hesabı | — |

Konteynerin PID 1'i `docker/rootfs/entrypoint.sh`'tir: veri dizinlerini hazırlar ve supervisord'yi devralır.

## Dizinler

```
Dockerfile    Tek konteyner imajı (çok aşamalı: önce qooxdoo derlenir, sonra çalışma imajı)
actions/      Uzaktan işlem kataloğu — her işlem ayrı dizin (action.json + run.sh)
backend/      PHP API — src/Core (altyapı), src/Api (uç başına bir sınıf), config/routes.php
db/           Şema göçleri (migrations/NNN_*.sql) ve her açılışta çalışan post.sql
docker/rootfs/  Konteyner içi yapılandırma ve servis sarmalayıcıları (supervisord, entrypoint, services/*)
docker/       rsyslog/telegraf/grafana yapılandırmaları ve yedek betiği
frontend/     qooxdoo arayüzü — source/class/ankamon/page altında sayfa başına bir sınıf
worker/       Python işçisi — ankamon/tasks (periyodik) ve ankamon/executor (Ansible ile görev yürütme)
data/         Çalışma verisi (depoya girmez)
```

## Veri saklama

- Sensör verisi: ham ölçümler `METRICS_RAW_DAYS` (30) gün; 5 dakikalık özetler `METRICS_5M_DAYS` (180) gün;
  saatlik özetler `METRICS_1H_DAYS` (1825) gün. Ham veri 2 günden sonra sıkıştırılır.
- Loglar: `LOG_DAYS` (90) gün; 7 günden sonra sıkıştırılır.
- Süreleri `.env` içinde değiştirip `docker compose up -d` demek yeterlidir.

## Dayanıklılık ve yedek

- Postgres `fsync`, `full_page_writes` ve veri sağlama toplamlarıyla çalışır; onaylanmış veri güç kesintisinde kaybolmaz.
- rsyslog, veritabanı erişilemezken kayıtları `data/rsyslog` altındaki disk kuyruğunda tutar; tahtalar da
  sunucu kapalıyken kendi kuyruklarında biriktirir.
- Bütün servisler `restart: always` ile çalışır; sunucu açılınca yığın kendiliğinden kalkar.
- `backup` servisi `data/backups` altına yazar: yapılandırma yedeği (`config-*.dump`, `grafana-*.dump`)
  `BACKUP_CONFIG_EVERY_HOURS` saatte bir, tam yedek (`full-*.dump`) her gün `BACKUP_FULL_AT` saatinde.
  Yedekleri başka bir diske almak için `.env` içinde `BACKUP_DIR` değiştirilir.

Geri yükleme (tam yedekten):

```bash
C=ankamon
docker compose exec -T $C psql -h 127.0.0.1 -U ankamon -d ankamon -c "SELECT timescaledb_pre_restore()"
docker compose exec -T $C pg_restore -h 127.0.0.1 -U ankamon -d ankamon --clean --if-exists /dev/stdin < data/backups/full-….dump
docker compose exec -T $C psql -h 127.0.0.1 -U ankamon -d ankamon -c "SELECT timescaledb_post_restore()"
docker compose restart
```
(`PGPASSWORD` gerekiyorsa `.env` içindeki `POSTGRES_PASSWORD` ile verin.)

## HTTPS ve ekran yansıtma

Arayüz HTTPS'tedir (`HTTPS_PORT`, varsayılan 443); düz HTTP istekleri HTTPS'e yönlendirilir (yalnız
`/api/health` ve CA indirme HTTP'de kalır). Okulda alan adı olmadığından Ankamon kendi yerel CA'sını üretir
(`data/tls/ca.crt`, 10 yıl); sunucu sertifikası bu CA ile imzalanır ve sunucunun IP adresleri değişince
açılışta kendiliğinden yenilenir. Tarayıcı uyarısını kaldırmak için `http://<sunucu>/ankamon-ca.crt`
dosyasını yönetici bilgisayarına bir kez "Güvenilen kök sertifika yetkilileri" deposuna kurun
(Windows: dosyaya çift tık → Sertifika yükle → Yerel makine; Firefox: Ayarlar → Sertifikalar → İçe aktar).

**Ekranımı yansıt** (yetki: `cast`): Tahtalar sayfasında tahtaları işaretleyip **Yansıt** ya da sağ menüden
"Ekranımı yansıt" seçilir; açılan pencerede ekran, pencere ya da sekme seçilip paylaşılır. Görüntü tarayıcıdan
WebRTC (WHIP) ile konteynerdeki [MediaMTX](https://github.com/bluenviron/mediamtx)'e gider, tahtalar onu RTSP ile
okuyup `mpv` ile tam ekran ve en üstte gösterir (yeniden kodlama yok). Tahta ekranı kapalıysa ya da ekran
koruyucu açıksa uyandırılır, yansıtma bitince eski hâline döner. Tahtaya kurulum gerekmez (ETAP 23'te `mpv`
hazır). Gerekenler:

- Yansıtan bilgisayardan sunucunun **8189** (UDP, yoksa TCP) portuna, tahtalardan **8554/TCP** portuna erişim.
- Bant genişliği: her tahtaya ayrı akış gider (1–3 Mbit/sn); kablolu ağda sorun olmaz, Wi-Fi'de takılabilir.
- Ses isteğe bağlıdır: Chrome/Edge'de sekme sesi, Windows'ta tüm sistem sesi paylaşılabilir.

## Ağ envanteri

Sol menü **Ağ**: sunucunun bağlı olduğu her fiziksel ağ (alt düğüm) ve o ağda görülmüş bütün cihazlar —
o an kapalı olanlar "Çevrim dışı" olarak kalır. Cihaz kimliği MAC adresidir.

- Tarayıcı: supervisord `netscan` (`worker/ankamon/netscan/`). Varlık ARP ile (`arp-scan`, /21 ≈ 10 sn),
  açık port/servis/OS tahmini `nmap -sV -O` ile cihaz cihaz (24 saatte bir; "Servisleri tara" ile hemen).
  En yaygın 1000 port taranır (`NETSCAN_TOP_PORTS`): bilgisayarların uzaktan masaüstü / sınıf yönetimi
  (NetSupport 5405, WinRM, VNC), veritabanı (MSSQL/PostgreSQL) ve alt-HTTP gibi servislerini yakalar.
- Sıklık yüke göre: boşta 30 sn, yük arttıkça 300 sn'ye kadar; CPU ≥ %85, CPU baskısı (PSI) ≥ %40 ya da
  boş bellek < %10 ise ertelenir. Servis taraması yalnız CPU < %50 iken. Araçlar `nice 19` + `ionice idle`.
  Ayarlar: `NETSCAN_MIN_INTERVAL`, `NETSCAN_MAX_INTERVAL`, `NETSCAN_SERVICE_RESCAN_HOURS`, `NETSCAN_TOP_PORTS`.
- Marka sütunu Wireshark `manuf` tablosundan (IEEE MA-L/MA-M/MA-S, ~58 bin kayıt). Depoda tutulmaz: imaj her
  derlendiğinde wireshark.org'dan güncel hâli indirilir (indirilemezse marka sütunu boş kalır). Cihaz türü
  üretici + açık portlar + nmap cihaz sınıfı + Ankamon tahta kaydından tahmin edilir; elle de seçilebilir.
- Takma ad: her tarama sonunda boş takma adlar Tahtalar'daki adla ve `net_known_aliases` tablosundaki
  MAC → ad kayıtlarıyla (ör. eski envanterden aktarılmış) doldurulur; elle girilen ad ezilmez.
- ETAP faz veritabanı (`worker/ankamon/netscan/etap_phase.py`): MAC'ten akıllı tahta modeli ve FATİH fazı.
  `etap_prefixes.tsv` yalnız maskelenmiş önekler tutar (6–10 onaltılık hane, en dar 256 adres; tam MAC ve
  okul bilgisi yok) → anakart modeli; `etap_models.json` model → faz/marka/işlemci ve güven düzeyi (kaynaklı /
  veri / çıkarım — elle düzeltilebilir). Önekler ülke çapı ETAP envanterinden `scripts/build-etap-phases.py`
  ile üretilir (envanter depoda değildir); dışarıda bırakılan %20 üzerinde kapsama %99,6, doğruluk %99,9.
- **Ağ paylaşımları**: NetBIOS/SMB portu (139/445) açık cihazlarda, varlık/servis taramasıyla EŞ ZAMANLI
  AYRI bir kanal (`_shares_loop`) `smbclient` ile paylaşımları bulur — önce anonim (guest), reddedilirse
  kayıtlı Samba kimliğiyle (Ayarlar → Samba erişimi). Gezilemeyen `$` sonlu (IPC$, ADMIN$, C$) paylaşımlar
  atlanır. Cihazın alt ağacında portların yanında klasör/🖨 simgesiyle, `\\ad\paylaşım` yoluyla gösterilir;
  sağ menü "Ağ paylaşımlarını tara" ile hemen taranır. Ayar: `NETSCAN_SHARES_RESCAN_HOURS` (vars. 24).
- Yetkiler: `network` (görüntüleme), `network.manage` (ekle/düzenle/sil, ağ adı, tarama).
- Not: nmap port taraması ağdaki saldırı tespit sistemlerinde uyarı üretebilir; gerekirse ağın sağ tık
  menüsünden taraması kapatılabilir.

## Okul ağı notu

Okul ağındaki MEB filtresi bazı HTTPS bağlantılarını (GitHub, Docker Hub, wireshark.org…) kendi kök
sertifikasıyla keser. `install.sh` bunu tespit ederse kökü sistemin güven deposuna ekler (Docker imaj
çekebilsin, git çalışsın). İmaj içinde Alpine paketleri imzalı depolardan HTTP ile kurulur; temalar ve MAC
tablosu yalnız geçici derleme aşamasında MEB köküne güvenilerek indirilir (son imaja bu güven geçmez).

## Geliştirme

```bash
docker compose up -d --build          # imajı derle ve başlat
docker compose logs -f                 # bütün süreçlerin günlükleri (supervisord)
```

Yayın akışı: değişiklikleri commit'leyip `main`'e gönderin; kurulu sunucularda `sudo /opt/ankamon/install.sh
--update`. Kuruluma özel hiçbir şey (`.env`, `data/`, okul envanteri, erişim parolaları) depoya girmez —
bkz. `.gitignore`; okul verisi arayüzden ya da veritabanından girilir.

Topluluk temaları `frontend/themes-src/themes.txt`'teki sabit commit'lerden indirilir; ankamon yamaları
`<ad>.patch` dosyalarındadır (indirilen `frontend/themes/` düzenlenmez, depoda da tutulmaz). Arayüzü
konteyner dışında derlemek için önce temaları indirin (host'ta node gerekmez):

```bash
docker run --rm -e OWNER="$(id -u):$(id -g)" -v "$PWD/frontend:/f" \
  -v "$PWD/docker/rootfs/certs/meb-ca.crt:/meb.crt:ro" node:22-alpine sh -c '
    cat /meb.crt >> /etc/ssl/certs/ca-certificates.crt; sed -i s,https://,http://, /etc/apk/repositories
    apk add -q curl patch && sh /f/themes-src/fetch-themes.sh /f/themes-src /f/themes && chown -R "$OWNER" /f/themes'
```

Tek konteynerde bir süreci yeniden başlatmak: `docker compose exec ankamon supervisorctl restart <ad>`
(adlar: postgres, rsyslog, telegraf, grafana, php-fpm, nginx, worker, runner, mediamtx, backup).

Yeni şema değişikliği için `db/migrations/` altına sıradaki numarayla dosya ekleyin; uygulanmış dosyalar
değiştirilmez.

## Kaldırma

```bash
cd /opt/ankamon && sudo docker compose down     # servisleri durdur (veriler data/ altında kalır)
sudo rm -rf /opt/ankamon                          # veriler ve yedekler DAHİL her şeyi sil
```

Silmeden önce yedekleri saklamak için `data/backups/` dizinini başka bir yere kopyalayın.
