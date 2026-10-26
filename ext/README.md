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
│   └── src/…                      AnkamonExt\<Ad>\… sınıfları (src/ altındaki yola göre yüklenir)
└── worker/
    └── tasks.py                   TASKS = [run(conn) tanımlayan modüller]
```

- **Arayüz:** derleme `frontend/`'i kütüphane olarak ekler (bkz. `frontend/ext-libs.js`).
  Oturum açılınca `ankamonext.<ad>.Extension.init({ user, app })` bir kez çağrılır.
  Çekirdeğe `ankamon.ext.Extensions.on(kanca, işleyici)` ile bağlanılır; kancaların listesi o sınıfın
  belgesindedir. İşleyici `true` döndürürse çekirdek kendi varsayılan davranışını atlar.
  Eklentinin durumu değişip kanca yanıtları farklılaşınca `ankamon.ext.Extensions.changed()` çağrılır;
  sürekli görünen öğeler (ör. alt çubuk) kancaları yeniden sorar.
- **API:** `backend/routes.php` rotaları çekirdek rotalarının ardına eklenir; erişim düzeyleri aynıdır
  (bkz. `Core\Router`). Yetki denetimi sunucuda yapılır, arayüzde gizlemek koruma değildir.
- **Worker:** `worker/tasks.py`'deki görevler çekirdek periyodik görevleriyle aynı turda çalışır.
  Eklentinin `worker/` dizini import yoluna eklenir.

Yeni bir eklenti noktası gerekirse çekirdeğe **genel** bir kanca eklenir. Kanca hiçbir eklentiyi
adıyla anmaz.
