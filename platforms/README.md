<!--
SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# İşletim sistemine göre işlevler (platform tanımı)

Ankamon'un cihaz işlevleri — Akıllı Tahtalar sağ menüsü, araç çubuğu ve **Komut çalıştır** (hazır işlemler +
serbest komut) — bugüne dek hedef cihazın Linux (Pardus ETAP / Debian) olduğunu varsayıyordu. Bu dizin o
varsayımı kaldıran TANIMDIR (kullanıcı isteği 2026-11-12):

> İşlevin adı aynı kalır; işlevi yerine getirecek komut / algoritma / kod tabanı hedef cihazın işletim
> sistemi ailesine göre **kendiliğinden** seçilir. Bir ailede uygulaması olmayan işlev o ailedeki cihazlarda
> çalıştırılmaz (menüde devre dışı ya da yalnız destekleyen cihazlara uygulanır, worker "Atlandı" yazar).

## 1. İşletim sistemi aileleri

| Aile | Kapsam | Uzaktan erişim | Betik kabuğu | Hazır işlem betiği |
|---|---|---|---|---|
| `linux` | Debian tabanlılar: Pardus ETAP, Debian, Ubuntu… | SSH | bash | `run.sh` |
| `windows` | Windows 10/11 | OpenSSH Sunucusu | PowerShell | `run.ps1` |
| `macos` | macOS | SSH (Uzaktan Giriş) | bash | `run.macos.sh` |
| `other` | ağ cihazı, gömülü, tanınmayan | — | — | — |

Cihazın ailesi şu sırayla belirlenir (SQL `device_os_family(id)`, göç 052 — PHP ve worker aynı fonksiyonu kullanır):

1. **Elle seçim** — Düzenle ▸ İşletim sistemi (`boards.os_family`),
2. **SSH ile toplanan bilgi** — `facts.os_name` (ör. "Pardus ETAP GNU/Linux 23"),
3. **Ağ taraması tahmini** — Varlıklar'daki `os_guess` (nmap; ör. "Microsoft Windows 10 1709 - 21H2"),
4. hiçbiri yoksa `default_family` (`linux` — Akıllı Tahtalar bugüne dek ETAP'tı).

## 2. İşlev kataloğu — `catalog.json`

Her işlev: `id`, `title`, `menu` (sağ menü / araç çubuğu madde adları — `BoardOps.menuButton` anahtarı, cihaz sayısı eki
olmadan), `jobs` (worker görev türleri) ve `impl` (aile → uygulamanın kısa tanımı). `impl`'de adı olmayan aile o işlevi
**desteklemez**. Katalogda hiç geçmeyen menü maddesi / görev türü `unknown_function_families` ailelerinde (Linux) çalışır —
eklentilerin eski maddeleri böylece güvenle Linux'ta kalır; eklenti, maddesinin `ankamon.menuKey`'ini katalogdaki bir işleve
bağlamak için kataloğa yeni işlev ekler.

Yeni bir aile için bir işlevi uygulamak:

- **Hazır işlem** (actions/<kimlik>/): o ailenin betiğini ekle (`run.ps1`, `run.macos.sh`). Worker hedefin ailesine göre
  betiği seçer; betiği olmayan ailedeki hedef "Atlandı" olur. `GET /api/actions` her işlemin `platforms` listesini verir.
- **Serbest komut**: Komut çalıştır penceresinde seçili cihazlarda bulunan HER aile için ayrı komut kutusu açılır
  (Linux/macOS: bash, Windows: PowerShell); her cihaza kendi ailesinin komutu gider.
- **Özel görev türü** (screen_lock, whoami…): worker'daki uygulamayı aileye göre dallandır ve `impl`'e aileyi ekle.

## 3. Uygulama noktaları

- `db/migrations/052_device_os_family.sql` — `boards.os_family`, `device_os_family()`, `device_os_source()`.
- `backend` — `BoardsApi` her cihaza `os_family`, `os_source`, `os_name` ekler; `GET /api/platforms` kataloğu verir;
  `ActionsApi` işlem başına `platforms`.
- `worker/ankamon/platforms.py` — katalog okuma, hedeflerin ailesi, destek denetimi; `runner` desteklenmeyen hedefi
  `skipped` yazar, komut/işlemde aileye göre betik + kabuk seçer (`runner/stream.py` `shell`).
- `frontend ankamon.ui.boards.Platforms` — sağ menü ve araç çubuğu maddelerini seçili cihazların ailesine göre süzer:
  hiçbir cihaz desteklemiyorsa madde devre dışı (ipucu hangi ailede tanımsız olduğunu söyler), kısmen destekliyorsa yalnız
  destekleyen cihazlara uygulanır.
