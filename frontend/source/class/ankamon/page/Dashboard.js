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
 * Genel bakış: tahta sayıları, son 24 saatin log yoğunluğu, son hatalar ve görevler. Her bilgi
 * kartının ipucu yalnız kendi konusunu, güncel değerlerle anlatır (bkz. __tip).
 */
qx.Class.define("ankamon.page.Dashboard", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Genel bakış");
    // "Yenile" düğmesi yok: sol ağaçta "Genel bakış"a (zaten seçiliyken de) tıklamak yeniler — bkz.
    // Shell PAGES retap. Boş düğme satırı da yer kaplamasın.
    this._actions.exclude();

    // Kartlar sarılır (dar pencerede alt satıra geçer, değerler "…" ile kesilmez). Flow'un VBox içinde
    // sarması için genişliği sayfanınkine kilitlenir — bkz. Base.js'teki _actions için aynı not.
    this.__stats = new qx.ui.container.Composite(new qx.ui.layout.Flow(12, 12));
    this.add(this.__stats);
    this.addListener("resize", e => {
      const width = e.getData().width;
      if (width) {
        this.__stats.setWidth(width);
      }
    });

    this.add(new qx.ui.basic.Label("Son 24 saatte hata düzeyindeki kayıtlar").set({ font: "bold" }));
    this.__errors = this._createTable([
      { id: "time", label: "Zaman", width: 160 },
      { id: "label", label: "Takma ad", width: 150 },
      { id: "host", label: "Bilgisayar adı", width: 150 },
      { id: "severity", label: "Önem", width: 90 },
      { id: "program", label: "Program", width: 140 },
      { id: "message", label: "Mesaj" }
    ], { prefsKey: "dashboard.errors.columns" });
    this.add(this.__errors, { flex: 2 });
    this.__addLogsMenu(this.__errors, id => {
      const row = this.__errorRows && this.__errorRows[id];
      return row && row.board_id ? [{ id: row.board_id, name: row.board_label || row.host }] : [];
    });

    this.add(new qx.ui.basic.Label("Son görevler").set({ font: "bold" }));
    this.__jobs = this._createTable([
      { id: "time", label: "Zaman", width: 160 },
      { id: "title", label: "Görev" },
      { id: "status", label: "Durum", width: 120 },
      { id: "summary", label: "Özet" }
    ], { prefsKey: "dashboard.jobs.columns" });
    this.add(this.__jobs, { flex: 1 });
    this.__addLogsMenu(this.__jobs, id => {
      const job = (this.__jobRows || []).find(j => j.id === id);
      return job ? job.targets || [] : [];
    });
  },

  members: {
    __stats: null,
    __errors: null,
    __jobs: null,
    __errorRows: null,
    __jobRows: null,

    async _refresh() {
      const F = ankamon.util.Format;
      const data = await ankamon.io.Api.get("/dashboard");
      const logs = data.log_histogram.reduce((sum, bucket) => sum + bucket.total, 0);
      const errors = data.log_histogram.reduce((sum, bucket) => sum + bucket.errors, 0);

      const b = data.backups;
      const n = v => Number(v).toLocaleString("tr-TR");
      const bt = data.boards;
      this.__stats.removeAll().forEach(card => card.dispose());
      // [başlık, değer, renk, alt satır, ipucu anahtarı] — ipucu her kartın KENDİ konusunu anlatır
      // (bkz. __tip); her yenilemede güncel değerlerle yeniden kurulur.
      [
        ["Kayıtlı tahta", n(bt.total), null, `${n(bt.total - bt.online)} kapalı`, "boards"],
        ["Çevrimiçi", n(bt.online), "app-ok", bt.total ? `%${Math.round(bt.online * 100 / bt.total)}` : null, "online"],
        ["Sensör verisi gelen", n(bt.exporter_ok), null, `${n(bt.total - bt.exporter_ok)} tahtadan gelmiyor`, "exporter"],
        ["Log gönderen (24 sa)", n(bt.logging), null, `${n(bt.total - bt.logging)} tahtadan gelmiyor`, "logging"],
        ["Log (24 sa)", n(logs), null, F.bytes(data.storage.tables.logs.bytes) + " (tümü)", "logs"],
        ["Hata (24 sa)", n(errors), errors ? "error" : null, logs ? `logların %${(errors * 100 / logs).toFixed(1)}'i` : null, "errors"],
        ["Sensör kaydı", this.__millions(data.metrics_rows), null, F.bytes(data.metrics_bytes), "metrics"],
        // rsyslog disk kuyruğu: büyüyorsa loglar veritabanına yazılamıyor demektir.
        ["Log kuyruğu", F.bytes(data.log_queue.bytes), null, `${data.log_queue.files} dosya`, "queue"],
        ["Veritabanı", F.bytes(data.database_bytes), null, "PostgreSQL + TimescaleDB", "db"],
        b
          ? ["Yedekler", F.bytes(b.bytes), null,
            `${b.files} dosya` + (b.latest.full ? ` · son tam ${F.bytes(b.latest.full.bytes)}` : ""), "backups"]
          : ["Yedekler", "—", null, "özet henüz yok", "backups"]
      ].forEach(([label, value, color, sub, key]) =>
        this.__stats.add(this.__card(label, value, color, sub, this.__tip(key, data, { logs, errors }), this.__target(key))));

      this.__errorRows = data.recent_errors;
      this.__jobRows = data.recent_jobs;
      this.__errors.getTableModel().setData(data.recent_errors.map((row, index) => [
        index, F.dateTime(row.ts), row.board_label || "", row.host, F.severity(row.severity), row.program, row.message
      ]));
      this.__jobs.getTableModel().setData(data.recent_jobs.map(job => [
        job.id, F.dateTime(job.created_at * 1000), job.title, F.jobStatus(job.status), job.summary
      ]));
    },

    /**
     * Satır sağ menüsü: "Hata loglarını göster" — Loglar sayfasını o tahtaya ve "Hata ve üstü"
     * önem düzeyine süzülmüş açar (bkz. ui.Shell.OPEN_LOGS). Görevlerin birden çok hedef tahtası
     * olabildiğinden, birden fazlaysa her tahta için ayrı madde (alt menü) çıkar.
     * @param boardsOf {Function} satırın kimlik değeri → [{id, name}]
     */
    __addLogsMenu(table, boardsOf) {
      if (!this._can("logs")) {
        return;
      }
      const open = boardId => qx.event.message.Bus.dispatchByName(ankamon.ui.Shell.OPEN_LOGS, { boardId, severity: "3" });
      const label = `${ankamon.ui.Shell.ICON.logs} Hata loglarını göster`;
      table.addListener("cellContextmenu", e => {
        const row = e.getRow();
        const boards = row === null || row === undefined ? [] : boardsOf(table.getTableModel().getValue(0, row));
        const old = table.getContextMenu();
        if (old) {
          qx.event.Timer.once(() => old.destroy(), null, 0);
        }
        if (!boards.length) {
          table.setContextMenu(null);
          return;
        }
        table.getSelectionModel().setSelectionInterval(row, row);
        const menu = new qx.ui.menu.Menu();
        if (boards.length === 1) {
          const item = new qx.ui.menu.Button(`${label} — ${boards[0].name}`);
          item.addListener("execute", () => open(boards[0].id));
          menu.add(item);
        } else {
          const sub = new qx.ui.menu.Menu();
          boards.forEach(b => {
            const item = new qx.ui.menu.Button(b.name);
            item.addListener("execute", () => open(b.id));
            sub.add(item);
          });
          menu.add(new qx.ui.menu.Button(`${label} (${boards.length} tahta)`, null, null, sub));
        }
        table.setContextMenu(menu);
      });
    },

    /**
     * Karta tıklayınca açılacak yer (kullanıcının yetkisi varsa; yoksa kart tıklanamaz).
     * @return {Map|null} {text: ipucuna eklenen açıklama, open: Function}
     */
    __target(key) {
      const Shell = ankamon.ui.Shell;
      const send = (name, data) => () => qx.event.message.Bus.dispatchByName(name, data);
      const page = (text, data, feature) => (feature === true ? this._user.is_admin : this._can(feature))
        ? { text, open: send(Shell.OPEN_PAGE, data) } : null;
      const disk = (text, tab) => this._can("logs.manage") ? { text, open: send(Shell.OPEN_PAGE, { diskUsage: tab }) } : null;
      const logs = (text, open) => this._can("logs") ? { text, open } : null;
      switch (key) {
        case "boards": return page("Tahtalar listesi", { page: "boards", status: "" }, "boards");
        case "online": return page("Çevrimiçi tahtalar", { page: "boards", status: "Çevrimiçi" }, "boards");
        case "exporter": return page("Sensörler", { page: "metrics" }, "metrics");
        case "logging":
        case "logs": return logs("Sistem logları", send(Shell.OPEN_LOGS_MODE, "system"));
        case "errors": return logs("Hata düzeyindeki sistem logları", send(Shell.OPEN_LOGS, { boardId: null, severity: "3" }));
        case "metrics": return disk("Disk kullanımı — Sensör verileri", "metrics") || page("Sensörler", { page: "metrics" }, "metrics");
        case "queue": return disk("Disk kullanımı — Log kuyruğu", "queue");
        case "db": return page("Sistem — Veritabanı", { page: "system", tab: "database" }, true);
        case "backups": return disk("Disk kullanımı — Yedekler", "backups");
        default: return null;
      }
    },

    /** Milyon cinsinden kısa gösterim: 351458 → "0,35 M". */
    __millions(n) {
      return (n / 1e6).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M";
    },

    /**
     * Kartın ipucu (zengin metin): yalnız O kartın konusu — ne saydığı, güncel ayrıntısı ve (veri
     * tutan kartlarda) verinin nerede, ne kadar süre saklandığı. Her yenilemede güncel değerlerle
     * yeniden kurulur. Kaynak: /api/dashboard (boards, log_histogram, recent_errors, storage,
     * log_queue, backups).
     * @param key {String} boards|online|exporter|logging|logs|errors|metrics|queue|db|backups
     * @param ctx {Map} {logs, errors} — son 24 saatin toplamları (_refresh'te hesaplanıyor)
     */
    __tip(key, data, ctx) {
      const F = ankamon.util.Format;
      const esc = s => qx.bom.String.escape(String(s ?? "—"));
      const n = v => Number(v).toLocaleString("tr-TR");
      const gun = s => esc((s || "?").replace(/ days?/, " gün").replace(/ mons?/, " ay"));
      const t = data.storage.tables;
      const p = data.storage.policies;
      const bt = data.boards;
      const off = bt.total - bt.online;
      const hist = data.log_histogram;
      const lastHour = hist.length ? hist[hist.length - 1] : { total: 0, errors: 0 };
      const peak = hist.reduce((a, h) => (h.total > (a ? a.total : -1) ? h : a), null);
      const hour = ts => new Date(ts * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      const pre = s => `<pre style="margin:4px 0 0;font-family:monospace;font-size:12px;line-height:1.35">${s}</pre>`;
      const muted = s => `<span style="color:#888">${s}</span>`;
      let title;
      let body;

      switch (key) {
        case "boards":
          title = "Kayıtlı tahta";
          body = `Ankamon'un tanıdığı tahtaların tamamı: <b>${n(bt.total)}</b><br>` +
            `├ çevrimiçi: ${n(bt.online)}<br>└ kapalı: ${n(off)}<br><br>` +
            "Tahta log göndermeye başlayınca (TiHA merkezi log ayarı) en geç ~1 dk içinde kendiliğinden<br>" +
            "kaydedilir; Tahtalar → Ekle ile elle de eklenebilir. Silinen bir tahta log göndermeyi<br>" +
            "sürdürse de yeniden eklenmez — yalnız elle eklenirse.";
          break;
        case "online":
          title = "Çevrimiçi";
          body = `Şu an açık olan tahtalar: <b>${n(bt.online)}</b> / ${n(bt.total)}` +
            (bt.total ? ` (%${Math.round(bt.online * 100 / bt.total)})` : "") + `, kapalı: ${n(off)}<br><br>` +
            "Bir tahta şu durumda çevrimiçi sayılır:<br>" +
            "├ son 2 dakikada log geldiyse, ya da<br>" +
            "└ SSH / sensör portu yoklamasına yanıt veriyorsa (yaklaşık 10 sn'de bir).<br>" +
            "Kapalıya dönmesi için üst üste 2 yoklamanın başarısız olması gerekir (anlık kopmalar sayılmaz).<br>" +
            "Kapalı tahtalar Tahtalar sayfasından \"Uyandır\" (WoL) ile açılabilir.";
          break;
        case "exporter":
          title = "Sensör verisi gelen";
          body = `Sensör portu (node_exporter, varsayılan 9100) yanıt veren tahtalar: <b>${n(bt.exporter_ok)}</b> / ${n(bt.total)}<br>` +
            `Veri gelmeyen: ${n(bt.total - bt.exporter_ok)} tahta — kapalı, sensör toplama kapatılmış ya da port yanıt vermiyor.<br><br>` +
            "Telegraf bu tahtaların CPU, bellek, disk, ağ ve sıcaklık değerlerini dakikada bir okuyup<br>" +
            "veritabanına yazar (bkz. \"Sensör kaydı\" kartı).";
          break;
        case "logging":
          title = "Log gönderen (24 sa)";
          body = `Son 24 saatte en az bir log gönderen tahta: <b>${n(bt.logging)}</b> / ${n(bt.total)}<br>` +
            `24 saattir log gelmeyen: ${n(bt.total - bt.logging)} tahta — kapalı kalmış ya da TiHA'nın merkezi log<br>` +
            "sunucusu ayarı o tahtada etkin değil.<br>" +
            pre("tahta ─(514/tcp,udp)─► rsyslog ─► veritabanı (logs tablosu)");
          break;
        case "logs":
          title = "Log (24 sa)";
          body = `Son 24 saatte gelen log: <b>${n(ctx.logs)}</b><br>` +
            `├ son 1 saatte: ${n(lastHour.total)}<br>` +
            (peak ? `└ en yoğun saat: ${hour(peak.time)} (${n(peak.total)} kayıt)<br>` : "") + "<br>" +
            `Saklandığı yer: <b>data/postgres</b> → logs tablosu, tümü ${F.bytes(t.logs.bytes)}<br>` +
            `${gun(p.logs?.compress_after)} sonra sıkıştırılır, ${gun(p.logs?.drop_after)} sonra kendiliğinden silinir.<br>` +
            muted("Görüntüleme: Loglar sayfası · elle silme: Disk kullanımı");
          break;
        case "errors": {
          title = "Hata (24 sa)";
          const last = data.recent_errors[0];
          body = `Son 24 saatte önem düzeyi <b>hata ya da daha ciddi</b> olan loglar ` +
            `(emerg, alert, crit, err): <b>${n(ctx.errors)}</b>` +
            (ctx.logs ? ` — tüm logların %${(ctx.errors * 100 / ctx.logs).toFixed(1)}'i` : "") + "<br>" +
            `├ son 1 saatte: ${n(lastHour.errors)}<br>` +
            (last
              ? `└ en son: ${esc(F.dateTime(last.ts))} · ${esc(last.board_label || last.host)} · ${esc(last.program)}<br>`
              : "└ hiç hata yok<br>") + "<br>" +
            muted("Son 15 hata aşağıdaki tabloda; tamamı Loglar sayfasında önem süzgeciyle görülebilir.");
          break;
        }
        case "metrics":
          title = "Sensör kaydı";
          body = "Telegraf'ın tahtalardan okuduğu ölçümler (log değildir): " +
            `<b>≈${n(t.metrics.rows)}</b> satır, ${F.bytes(t.metrics.bytes)}<br>` +
            "Saklandığı yer: <b>data/postgres</b> → metrics tablosu. Disk tasarrufu için yaşlandıkça seyreltilir:" +
            pre(`ayrıntılı (dakikalık) ── ${gun(p.metrics?.drop_after)} tutulur, ${gun(p.metrics?.compress_after)} sonra sıkıştırılır\n` +
              `   └► 5 dk ortalama ─── ${gun(p.metrics_5m?.drop_after)}\n` +
              `        └► saatlik ──── ${gun(p.metrics_1h?.drop_after)}`) +
            muted("Grafik ve tahta ayrıntıları: Grafana / Sensörler");
          break;
        case "queue":
          title = "Log kuyruğu";
          body = `<b>data/rsyslog</b>: ${F.bytes(data.log_queue.bytes)} · ${n(data.log_queue.files)} dosya<br><br>` +
            "Veritabanının o an yazamadığı loglar (ör. yeniden başlatma sırasında) kaybolmasın diye<br>" +
            "burada bekler; veritabanı açılınca sırayla yazılır ve kuyruk boşalır. Buradaki loglar<br>" +
            "henüz sorgulanamaz.<br>" +
            (data.log_queue.bytes > 50 * 1024 * 1024
              ? "<b style='color:#d9534f'>Kuyruk büyük: loglar veritabanına ulaşmıyor olabilir.</b>"
              : muted("Normalde boş ya da birkaç yüz KB'tır; sürekli büyüyorsa log yazımı aksıyor demektir."));
          break;
        case "db": {
          title = "Veritabanı";
          const row = (name, desc, approx, lastRow) =>
            `${lastRow ? "└" : "├"}── ${name.padEnd(15)} ${F.bytes(t[name].bytes).padStart(9)} · ` +
            `${approx ? "≈" : ""}${n(t[name].rows)} satır  ${muted(desc)}\n`;
          body = `<b>data/postgres</b> — "ankamon" veritabanının diskteki boyutu: <b>${F.bytes(data.database_bytes)}</b>` +
            pre(row("logs", "sistem logları", true) +
              row("metrics", "sensör ölçümleri", true) +
              row("command_log", "çalıştırılan komutlar") +
              row("job_events", "komut çıktı satırları (30 gün)") +
              row("board_sessions", "oturum açma/kapama") +
              row("activity_log", "arka plan işlemleri çubuğu") +
              row("audit_log", "arayüzde kim ne yaptı", false, true)) +
            muted("Silinen kayıtların yeri hemen diske iade edilmez, veritabanı içinde yeniden kullanılır;<br>" +
              "bu yüzden silme sonrası bu değer hemen küçülmeyebilir.");
          break;
        }
        case "backups": {
          title = "Yedekler";
          const b = data.backups;
          if (!b) {
            body = "<b>data/backups</b> — yedek özeti henüz oluşmadı (yedek servisi dakikada bir günceller).";
            break;
          }
          const kind = (k, what, lastRow) => {
            const g = b.kinds[k] || { files: 0, bytes: 0 };
            return `${lastRow ? "└" : "├"}── ${(k + "-*.dump").padEnd(15)} ${String(g.files).padStart(3)} dosya · ` +
              `${F.bytes(g.bytes).padStart(9)}  ${muted(what)}\n`;
          };
          body = `<b>data/backups</b>: toplam <b>${F.bytes(b.bytes)}</b> · ${n(b.files)} dosya` +
            pre(kind("full", `tam yedek (loglar + sensör dahil) · günde 1 (${esc(b.full_at)}), son ${b.keep_full} tutulur`) +
              kind("config", `ayarlar/kullanıcılar/tahtalar · ${b.config_every_hours} saatte 1, son ${b.keep_config} tutulur`) +
              kind("grafana", "Grafana pano ayarları · config ile birlikte", true)) +
            (b.latest.full
              ? `Son tam yedek: ${esc(b.latest.full.name)} — ${F.bytes(b.latest.full.bytes)}, ` +
                `${esc(F.dateTime(b.latest.full.mtime * 1000))}<br>`
              : "") +
            muted("Silinen loglar, silmeden önce alınmış tam yedeklerde bir süre daha durur.");
          break;
        }
        default:
          return null;
      }
      return `<div style="line-height:1.45"><b style="font-size:13px">${esc(title)}</b>` +
        `  ${muted(esc(new Date().toLocaleTimeString("tr-TR")))}<br>${body}</div>`;
    },

    /**
     * Bilgi kartı: başlık İLK satırda, ardından değer ve alt satır. Alt satırı olmayan kartta da
     * boş bir satır tutulur — kartların yükseklikleri eşit kalsın.
     */
    __card(label, value, color, sub, richTip, target) {
      const border = new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "app-border" });
      const card = new qx.ui.container.Composite(new qx.ui.layout.VBox(4)).set({
        padding: 14,
        minWidth: 150,
        backgroundColor: "surface",
        decorator: border
      });
      if (target) {
        // Tıklanabilir kart: el imleci + üzerine gelince vurgulu kenar; ipucu nereye gidileceğini söyler.
        const hover = new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "primary" });
        card.set({ cursor: "pointer" });
        card.addListener("pointerover", () => card.setDecorator(hover));
        card.addListener("pointerout", () => card.setDecorator(border));
        card.addListener("tap", target.open);
        richTip = (richTip || "") + `<div style="margin-top:6px;opacity:.75">Tıklayınca açılır: ${qx.bom.String.escape(target.text)}</div>`;
      }
      if (richTip) {
        // Çok satırlı ipucu: okunacak kadar açık kalsın (varsayılan gizlenme süresi kısa).
        const toolTip = new qx.ui.tooltip.ToolTip(richTip).set({ rich: true, showTimeout: 400, hideTimeout: 60000 });
        card.setToolTip(toolTip);
        qx.util.DisposeUtil.disposeTriggeredBy(toolTip, card); // kartlar her yenilemede atılıyor
      }
      card.add(new qx.ui.basic.Label(label).set({ textColor: "app-muted", font: "bold" }));
      card.add(new qx.ui.basic.Label(String(value)).set({ font: "app-stat", textColor: color || "primary" }));
      card.add(new qx.ui.basic.Label(sub || " ").set({ textColor: "app-muted" }));
      return card;
    }
  }
});
