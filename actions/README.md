<!--
SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Uzaktan işlem kataloğu

Her alt dizin, tahtalarda SSH (root) ile çalıştırılabilen bir hazır işlemdir:

- `action.json` — arayüzde görünen tanım: `title`, `description`, `category`, gereken `feature`
  (`actions` ya da `power`), `confirm` (onay istensin mi), `timeout` (saniye) ve `params`.
- `run.sh` — tahtada `bash -s` ile çalışır. `params` içindeki her `key`, betiğe aynı adla ortam
  değişkeni olarak gelir. Çıkış kodu 0 başarı sayılır; çıktı görev sonucunda gösterilir.

Yeni işlem eklemek için yeni bir dizin açmak yeterlidir; API ve worker kataloğu bu dizinden okur
(imaj yeniden derlenmelidir: `docker compose up -d --build api worker`).

`hidden: true`: işlem "Komut çalıştır" listesinde görünmez (kendi sayfasından başlatılır, ör. ahenk-check →
Bakım ▸ Ahenk); görev olarak yine çalıştırılabilir.

Parametre türleri: `text`, `number`, `select` (`options: [{value, label}]`), `password` (gizli: maskeli
alan; API yanıtlarına ve denetim kaydına `***` yazılır, değer görev bitince jobs.params'tan silinir).
İsteğe bağlı `pattern` (düzenli ifade) + `pattern_error`: değer tahtaya gitmeden sunucuda denetlenir.

`tools` (ör. `["eta-112"]`): işlemden önce tahtaya taşınacak dış araçlar — sunucuda `/data/tools/<ad>/`
altında tutulur, günün ilk kullanımında GitHub'da yeni sürüm denetlenir, tahtaya yalnız değişmişse SFTP
ile kopyalanır (bkz. `worker/ankamon/executor/tools.py`; eta-112 tahtada `/opt/eta-112/`).
