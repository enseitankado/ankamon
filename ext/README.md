<!--
SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Eklentiler

Bu dizin Ankamon'a çekirdek koda dokunmadan özellik ekleyen eklentiler içindir. Her eklenti
`ext/<ad>/` altında **ayrı bir git deposudur** (ör. private bir GitHub deposu) ve bu depoya girmez
(`.gitignore`: `/ext/*`). Eklenti yoksa Ankamon aynen derlenir ve çalışır.

Kurulum: eklenti deposunu bu dizine klonlayıp imajı yeniden derleyin.

```sh
git clone <eklenti deposu> ext/<ad>
docker compose up -d --build
```

## Yapı

Her kısım isteğe bağlıdır.

```
ext/<ad>/
├── frontend/                      qooxdoo kütüphanesi
│   ├── Manifest.json              "provides": { "namespace": "ankamonext.<ad>", "class": "source/class" }
│   └── source/class/ankamonext/<ad>/Extension.js
├── backend/
│   ├── routes.php                 config/routes.php biçiminde rota dizisi döndürür
│   ├── boot.php                   (isteğe bağlı) her istekte bir kez yüklenir — genel kanca kaydı için
│   └── src/…                      AnkamonExt\<Ad>\… sınıfları (src/ altındaki yola göre yüklenir)
├── worker/
│   ├── tasks.py                   TASKS = [run(conn) tanımlayan modüller]
│   ├── job_hooks.py               JOB_DONE / JOB_FINISHED = {hazır işlem id: fn}
│   └── tools.json                 tahtalara taşınan dış araçlar
├── actions/<id>/                  hazır işlemler (action.json + run.sh)
├── db/migrations/*.sql            eklentinin tabloları (ext:<ad>:<dosya> olarak bir kez)
├── features.php, feature_deps.php eklentinin yetkileri
└── extension.json                 Ayarlar ▸ Eklentiler (başlık, açıklama, ayarlar)
```

- **Arayüz:** derleme `frontend/`'i kütüphane olarak ekler (bkz. `frontend/ext-libs.js`).
  Oturum açılınca `ankamonext.<ad>.Extension.init({ user, app })` bir kez çağrılır.
  Çekirdeğe `ankamon.ext.Extensions.on(kanca, işleyici)` ile bağlanılır; kancaların listesi o sınıfın
  belgesindedir. İşleyici `true` döndürürse çekirdek kendi varsayılan davranışını atlar.
  Eklentinin durumu değişip kanca yanıtları farklılaşınca `ankamon.ext.Extensions.changed()` çağrılır;
  sürekli görünen öğeler (ör. alt çubuk) kancaları yeniden sorar.
- **API:** `backend/routes.php` rotaları çekirdek rotalarının ardına eklenir; erişim düzeyleri aynıdır
  (bkz. `Core\Router`). Yetki denetimi sunucuda yapılır, arayüzde gizlemek koruma değildir.
- **Backend başlatma:** `backend/boot.php` varsa her istekte rotalardan önce bir kez yüklenir; rota
  tanımlamayan genel kancalara geri çağrı bağlamak içindir (ör. `Core\Audit::setPolicy(...)` ile denetim
  kaydı ilkesi). Çekirdek kancaları istekte başlık ekleme (`ankamon.ext.Extensions.handle("api.headers", …)`,
  bkz. arayüz `io.Api`) gibi hep genel adlıdır; kanca hiçbir eklentiyi adıyla anmaz.
- **Worker:** `worker/tasks.py`'deki görevler çekirdek periyodik görevleriyle aynı turda çalışır.
  Eklentinin `worker/` dizini import yoluna eklenir.
- **Hazır işlemler:** `actions/<id>/action.json` + `run.sh` (çekirdek actions/ ile aynı biçim; id'ler geneldir,
  eklentiye özgü önek kullanın). `worker/job_hooks.py`: `JOB_DONE = {id: fn}` işlem 'ok' bitince,
  `JOB_FINISHED = {id: fn}` betik tahtada bittiğinde (başarısız olsa da; fn'e sonuç da verilir) çağrılır —
  büyük sonuçlar tahtadaki dosyadan okunup eklentinin tablosuna yazılır.
- **Dış araçlar:** `worker/tools.json` — tek dosyalı araç (`repo`, `branch`, `file`, `remote_dir`) ya da
  `"kind": "archive"` ile çok dosyalı araç (`sources: [{repo, ref: "release"|<dal>, include, dest?}]`): sunucu
  günde en çok bir kez sürüm denetler, tahtaya yalnız değişince SFTP ile koyar (`action.json` `"tools"`).
- **Yetkiler:** `features.php` (anahtar → açıklama) ve `feature_deps.php` (alt → üst) çekirdek kataloğuyla
  birleşir; kullanıcılara Kullanıcılar penceresinden verilir. Rotada erişim düzeyi olarak kullanılır.
- **Tahtalar sağ menüsü / araç çubuğu:** `ankamon.ext.Extensions.addBoardMenu({build, bar})` — madde grid
  satırı ve ekran kutucuğu menüsüne eklenir; `bar` verilirse araç çubuğunda düğme olur (`mirror`: maddenin alt
  menüsü düğmenin menüsüdür).

- **Sol menü sayfası:** `ankamon.ext.Extensions.addPage({id, label, icon, feature, parent?, tabs?, create(user)})` —
  `ui.Shell` PAGES biçimi; `create` bir `ankamon.page.Base` döndürür. `parent` yoksa sayfa kökte "Sistem"den önce durur;
  ağaç, üst yol gösterimi ve sekme yaprakları çekirdek sayfalarındaki gibi kendiliğinden gelir.

Yeni bir eklenti noktası gerekirse çekirdeğe **genel** bir kanca eklenir. Kanca hiçbir eklentiyi
adıyla anmaz.
