/*
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
 * Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
 * https://github.com/enseitankado/ankamon
 *
 * Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
 * GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
 * daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
 * değiştirebilirsiniz.
 *
 * Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
 * YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
 * verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
 *
 * Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
 * dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
 * adresine bakınız.
 *
 * Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
 * parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
 * lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
 * korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
 * kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).
 */

/**
 * Canlı görev çıktısı penceresi (Komut çalıştır, Kapat, Uyandır… hepsi buradan izlenir).
 *
 * Görev başlar başlamaz açılır ve /api/jobs/{id}/events'i kısa aralıkla artımlı okur: her tahta için
 * "bağlanılıyor → bağlandı → çıktı satırları → çıkış kodu" akışı oluştukça görünür (bkz.
 * worker/ankamon/runner). Birden fazla tahta varsa solda tahta listesi (durum simgesiyle) + "Tümü"
 * vardır; seçilen tahtanın ayrıntısı sağdadır. Tek tahtada liste gizlenir.
 *
 * Komut/hazır işlemde tahtalar PARALEL, kaynak yetmezse grup grup çalışır (bkz. runner/__main__.py):
 * liste duruma göre gruplanır ve renklenir — önce çalışanlar (mavi ▶), sonra sırada bekleyenler
 * (gri ⏳), en sonda bitenler (yeşil ✓ / kırmızı ✕ / turuncu ⚠); üst satırda sayıları. "Tümü"
 * görünümünde her satır [tahta] önekli; bir tahta bitmeden araya başkası girebildiğinden boş satırlı
 * ayraç yalnız önceki tahta bitmişse konur (sıralı görevlerde eskisi gibi tahta tahta okunur).
 */
qx.Class.define("ankamon.ui.Jobs", {
  type: "static",

  statics: {
    POLL_MS: 700,

    STATUS_ICON: { queued: "⏳", running: "▶", ok: "✓", failed: "✕", unreachable: "⚠" },
    // Listede durum rengi ve grup sırası (çalışan → sırada → biten).
    STATUS_COLOR: { queued: "#888", running: "#1a73e8", ok: "#2e7d32", failed: "#c5221f", unreachable: "#e37400" },
    STATUS_RANK: { running: 0, queued: 1 },

    // İndirme kuyruğunda iki otomatik indirme arası en az bu kadar beklenir: tarayıcılar art arda hızlı
    // gelen indirmeleri "çoklu indirme" saldırısı sayıp engelleyebiliyor (kullanıcı bildirdi).
    DOWNLOAD_GAP_MS: 3000,

    /**
     * @param jobOrPromise {Integer|Promise<Integer>} görev kimliği ya da onu döndüren istek (pencere
     *   istek sürerken açılır — "kuyruğa alınıyor" görünür)
     * @param caption {String?} pencere başlığı
     * @param opts {Map?} {progress: true} — toplam ilerleme çubuğu (worker'ın "progress" olayları, bkz.
     *   worker/ankamon/executor/backup.py); {downloads: url(jobId, name)} — "file" olaylarındaki dosyalar
     *   indirme listesine eklenir ve DOWNLOAD_GAP_MS aralıklarla sırayla otomatik indirilir;
     *   {intro: "metin"} — çıktı kutusunun EN BAŞINDA (her görünümde, tahta seçiminden bağımsız) duran
     *   sabit açıklama, ör. Uyandır'da "tahta açılmazsa neden" bilgisi (bkz. BoardOps.WOL_INTRO).
     */
    async show(jobOrPromise, caption, opts = {}) {
      const root = qx.core.Init.getApplication().getRoot();
      const bounds = root.getBounds() || { width: 1100, height: 700 };
      const win = new qx.ui.window.Window(caption || "Komut çıktısı").set({
        contentPadding: 10,
        layout: new qx.ui.layout.VBox(8),
        width: Math.min(1000, bounds.width - 40),
        height: Math.min(620, bounds.height - 40)
      });
      win.addListenerOnce("appear", () => win.center());

      const status = new qx.ui.basic.Label("Görev kuyruğa alınıyor…").set({ rich: true });
      win.add(status);
      let bar = null;
      let barLabel = null;
      if (opts.progress) {
        const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
        bar = new qx.ui.indicator.ProgressBar(0, 100).set({ height: 16 });
        barLabel = new qx.ui.basic.Label("Toplam: %0").set({ minWidth: 90 });
        row.add(bar, { flex: 1 });
        row.add(barLabel);
        win.add(row);
      }
      let downloads = null;
      if (opts.downloads) {
        downloads = new qx.ui.basic.Label("").set({ rich: true, selectable: true, visibility: "excluded" });
        win.add(downloads);
      }

      const split = new qx.ui.splitpane.Pane("horizontal");
      const list = new qx.ui.form.List().set({ width: 240 });
      // opts.intro görev kuyruğa alınırken de (çıktı gelmeden) görünsün.
      const log = new qx.ui.form.TextArea(opts.intro || "").set({ readOnly: true, font: "app-mono", wrap: true });
      split.add(list, 0);
      split.add(log, 1);
      win.add(split, { flex: 1 });
      root.add(win);
      win.open();

      let stop = false;
      win.addListener("close", () => {
        stop = true;
        win.destroy();
      });

      let jobId;
      try {
        jobId = await jobOrPromise;
      } catch (e) {
        status.setValue("Görev başlatılamadı: " + qx.bom.String.escape(e.message || String(e)));
        return;
      }

      const icon = ankamon.ui.Jobs.STATUS_ICON;
      const F = ankamon.util.Format;
      const lines = new Map();   // board_id (null = genel) → [satır]
      const items = new Map();   // board_id → ListItem
      const all = new qx.ui.form.ListItem("Tümü");
      all.setUserData("board", "all");
      list.add(all);
      let selected = "all";
      let after = 0;
      let names = new Map();
      let lastAllBoard; // "Tümü" görünümünde en son eklenen tahta — aralara boş satır koymak için
      const finished = new Set();  // bitiş satırı ("ok"/"fail" olayı) gelmiş tahtalar — ayraç kararı için
      const percent = new Map();   // board_id → son "progress" yüzdesi
      const files = [];            // [{board, name, size, note, url, auto, started}]
      const queue = [];            // otomatik indirilecekler (sırayla, aralıklı)
      let pumping = false;
      const renderDownloads = () => {
        const esc = qx.bom.String.escape;
        downloads.setVisibility(files.length ? "visible" : "excluded");
        downloads.setValue("<b>İndirilecek yedekler</b> (otomatik başlamazsa adına tıklayın):<br>" + files.map(f =>
          `${f.started ? "⬇" : f.auto ? "⏳" : "▫"} <a href="${esc(f.url)}" download="${esc(f.name)}">${esc(f.name)}</a> ` +
          `(${F.bytes(f.size)}) — ${esc(f.board)}` + (f.note ? ` <i>· ${esc(f.note)}</i>` : "")).join("<br>"));
      };
      const pump = () => {
        if (pumping || stop) {
          return;
        }
        const f = queue.shift();
        if (!f) {
          return;
        }
        pumping = true;
        const a = document.createElement("a");
        a.href = f.url;
        a.download = f.name;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        f.started = true;
        renderDownloads();
        qx.event.Timer.once(() => {
          pumping = false;
          pump();
        }, this, ankamon.ui.Jobs.DOWNLOAD_GAP_MS);
      };

      const time = t => {
        const d = new Date(t);
        return d.toLocaleTimeString("tr-TR", { hour12: false });
      };
      const fmt = (ev, prefix) => {
        const mark = ev.kind === "err" ? "! " : ev.kind === "info" ? "» " : ev.kind === "ok" ? "✓ " : ev.kind === "fail" ? "✕ " : "  ";
        return `${time(ev.t)} ${prefix}${mark}${ev.text}`;
      };
      const render = () => {
        let text;
        if (selected === "all") {
          text = (lines.get("all") || []).join("\n");
        } else {
          text = (lines.get(selected) || []).join("\n");
        }
        if (opts.intro) {
          text = opts.intro + "\n" + "─".repeat(60) + "\n" + text;
        }
        log.setValue(text);
        if (opts.intro) {
          return; // açıklama en üstte okunabilsin: sona kaydırılmaz (bu görevlerin çıktısı zaten kısa)
        }
        // Sona kaydır (yeni satırlar görünsün).
        const el = log.getContentElement().getDomElement();
        if (el) {
          el.scrollTop = el.scrollHeight;
        } else {
          qx.event.Timer.once(() => {
            const e2 = log.getContentElement().getDomElement();
            if (e2) {
              e2.scrollTop = e2.scrollHeight;
            }
          }, this, 50);
        }
      };
      list.addListener("changeSelection", e => {
        const item = e.getData()[0];
        selected = item ? item.getUserData("board") : "all";
        render();
      });

      const tick = async () => {
        if (stop) {
          return;
        }
        let res;
        try {
          res = await ankamon.io.Api.get(`/jobs/${jobId}/events`, { after });
        } catch (e) {
          status.setValue("Çıktı alınamadı: " + qx.bom.String.escape(e.message || String(e)));
          qx.event.Timer.once(tick, this, 3000);
          return;
        }
        if (stop) {
          return;
        }
        names = new Map(res.targets.map(t => [t.board_id, t.board]));
        // Tahta listesi + durum simgeleri.
        res.targets.forEach(t => {
          let item = items.get(t.board_id);
          if (!item) {
            item = new qx.ui.form.ListItem("");
            item.setUserData("board", t.board_id);
            items.set(t.board_id, item);
            list.add(item);
          }
          const code = t.exit_code === null || t.exit_code === undefined ? "" : ` (${t.exit_code})`;
          const pct = t.status === "running" && percent.has(t.board_id) ? ` — %${percent.get(t.board_id)}` : "";
          const color = ankamon.ui.Jobs.STATUS_COLOR[t.status] || "inherit";
          item.setRich(true);
          item.setLabel(`<span style="color:${color}${t.status === "running" ? ";font-weight:600" : ""}">` +
            `${icon[t.status] || "•"} ${qx.bom.String.escape(t.board)}${code}${pct}</span>`);
        });
        // Grup sırası: çalışanlar üstte, sonra sıradakiler, en altta bitenler (her grupta ad sırası).
        const rank = st => ankamon.ui.Jobs.STATUS_RANK[st] ?? 2;
        const order = res.targets.slice().sort((a, b) => rank(a.status) - rank(b.status) || a.board.localeCompare(b.board, "tr"));
        order.forEach((t, i) => {
          const item = items.get(t.board_id);
          if (list.indexOf(item) !== i + 1) {
            list.addAt(item, i + 1); // 0: "Tümü"
          }
        });
        // Tek tahtada liste gereksiz: doğrudan o tahtanın ayrıntısı gösterilir.
        const single = res.targets.length <= 1;
        list.setVisibility(single ? "excluded" : "visible");
        if (single && res.targets.length === 1 && selected === "all") {
          selected = res.targets[0].board_id;
        }

        let changed = false;
        res.events.forEach(ev => {
          after = Math.max(after, ev.id);
          const key = ev.board_id === null ? null : ev.board_id;
          const name = key === null ? "Görev" : (names.get(key) || "#" + key);
          // Makine olayları (yedekleme): metin olarak gösterilmez, çubuğu/indirme listesini besler.
          if (ev.kind === "progress" || ev.kind === "file") {
            let data = null;
            try {
              data = JSON.parse(ev.text);
            } catch (e) {
              return;
            }
            if (ev.kind === "progress") {
              percent.set(key, data.pct || 0);
            } else if (downloads) {
              // auto:false (ör. ev yedeğinin .tar.gz'si — Windows kopyası .zip otomatik iner) yalnız listelenir.
              const f = {
                board: name, name: data.name, size: data.size, note: data.note || "",
                url: opts.downloads(jobId, data.name), auto: data.auto !== false, started: false
              };
              files.push(f);
              if (f.auto) {
                queue.push(f);
              }
              renderDownloads();
              pump();
            }
            return;
          }
          if (!lines.has("all")) {
            lines.set("all", []);
          }
          if (key !== null && lastAllBoard !== undefined && key !== lastAllBoard && finished.has(lastAllBoard)) {
            lines.get("all").push(""); // önceki tahta bitti, sıradakine geçildi: ayraç boş satır
          }
          if (key !== null && (ev.kind === "ok" || ev.kind === "fail")) {
            finished.add(key); // tahtanın son satırı (bkz. runner stream.run: "Bitti"/"Bağlanılamadı")
          }
          if (key !== null) {
            lastAllBoard = key;
          }
          lines.get("all").push(fmt(ev, `[${name}] `));
          if (key !== null) {
            if (!lines.has(key)) {
              lines.set(key, []);
            }
            lines.get(key).push(fmt(ev, ""));
          }
          changed = true;
        });
        if (changed) {
          render();
        }

        const done = res.targets.filter(t => !["queued", "running"].includes(t.status)).length;
        const running = res.job.status === "queued" || res.job.status === "running";
        if (bar && res.targets.length) {
          // Toplam: biten tahta %100, çalışan tahta kendi yüzdesiyle, bekleyen %0 — eşit ağırlıklı.
          const sum = res.targets.reduce((acc, t) =>
            acc + (["queued", "running"].includes(t.status) ? (percent.get(t.board_id) || 0) : 100), 0);
          const total = running ? Math.floor(sum / res.targets.length) : 100;
          bar.setValue(total);
          barLabel.setValue(`Toplam: %${total}`);
        }
        const title = qx.bom.String.escape(res.job.title || "");
        const count = st => res.targets.filter(t => t.status === st).length;
        const C = ankamon.ui.Jobs.STATUS_COLOR;
        const failed = count("failed") + count("unreachable");
        const counts = res.targets.length > 1
          ? ` — <span style="color:${C.running}">▶ ${count("running")} çalışıyor</span> · ` +
            `<span style="color:${C.queued}">⏳ ${count("queued")} sırada</span> · ` +
            `<span style="color:${C.ok}">✓ ${count("ok")} başarılı</span>` +
            (failed ? ` · <span style="color:${C.failed}">✕ ${failed} başarısız</span>` : "")
          : "";
        status.setValue(running
          ? `<b>${title}</b> — ${F.jobStatus(res.job.status)}: ${done}/${res.targets.length} tahta bitti${counts}`
          : `<b>${title}</b> — ${F.jobStatus(res.job.status)}. ${qx.bom.String.escape(res.job.summary || "")}${counts}`);
        // Görev bittikten sonra da son olaylar gelsin diye bir tur daha okunur.
        if (running || res.events.length) {
          qx.event.Timer.once(tick, this, ankamon.ui.Jobs.POLL_MS);
        }
      };
      tick();
    }
  }
});
