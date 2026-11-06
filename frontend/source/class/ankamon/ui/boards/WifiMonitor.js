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
 * Sağ menü / araç çubuğu "Wi-Fi Monitör": seçili bütün tahtalar TEK pencerede — üstte tahta başına tek satırlık durum şeridi,
 * altında bütün tahtaların vericileri TEK tabloda ("Bilgisayar" sütunuyla; kullanıcı isteği 2026-11-06). Amaç sınıfa getirilmiş
 * telefonları bulmak: tahtaların duyduğu Wi-Fi ağları, Bluetooth cihazları ve (kart bağlı değilse) Wi-Fi yoklamaları "sabit"
 * listesine (sınıfın/okulun olağan vericileri, sunucuda — /api/wifimon/fixed) göre ayrılır; sabit olmayanlar telefon kanıtına göre
 * öne çıkarılır (bkz. ui.boards.WifimonClassify, ui.boards.WifimonRender). Pencere zaten açıksa yeni tahtalar ona eklenir.
 *
 * Her tahta için ayrı WebSocket (worker screen/wifi.py): varsayılan tek tarama, "Yenile" yeniden tarar, "Sürekli izle" açıkken
 * liste tazelenir. Kapalı Wi-Fi/Bluetooth tarama süresince o tahtada geçici açılır (kayıtlı ağa bağlanmaz), sonra eski durumuna
 * döner — geri yükleme tahta başınadır, bölümün notunda görünür.
 */
qx.Class.define("ankamon.ui.boards.WifiMonitor", {
  type: "static",

  statics: {
    /** Sürekli izlemede yoklama satırı son duyuluşundan bu kadar sonra listeden düşer. */
    PROBE_KEEP_MS: 5 * 60 * 1000,

    HELP: "Bu pencere seçili tahtaların çevresindeki kablosuz vericileri gösterir. Sınıfın/okulun olağan ağlarını ve cihazlarını " +
      "<b>güvenilir</b> (sabit) işaretleyin — satırdaki <i>Bu sınıfta güvenilir AP</i> / <i>Okul genelinde güvenilir AP</i> " +
      "düğmeleriyle ya da toptan (sınıflar boşken) <i>Görünenleri sabit yap</i> ile; sonra gerisi <b>yabancı</b> olarak öne " +
      "çıkar. <b>Neler görülebilir:</b> telefonun paylaşım noktası (hotspot) açıksa Wi-Fi ağı olarak; Bluetooth'u açıksa Bluetooth " +
      "cihazı olarak (iPhone'lar ve çoğu Android sürekli BLE yayını yapar); Wi-Fi'si açık ama bağlı değilse, ara ara gönderdiği " +
      "<b>yoklamalarla</b> (probe request — yalnız tahtanın Wi-Fi kartı bir ağa bağlı DEĞİLSE dinlenir; dinleme sırasında kart birkaç " +
      "saniye NetworkManager'dan bırakılır). <b>Sınırlar:</b> ekranı kapalı telefon yoklamayı seyrek yapar, bir taramada " +
      "duyulmayabilir — <i>Sürekli izle</i> açık bırakın; telefonlar rastgele adres kullandığından yoklama cihaz sayısı " +
      "kestirimdir; uçak kipindeki ya da Wi-Fi'si ve Bluetooth'u kapalı telefon görülemez; Wi-Fi'ye bağlı telefonun kendi trafiği " +
      "(başka ağın kanalında) dinlenmez; sinyal gücü yalnız kaba bir yakınlık ipucudur (duvar, gövde, anten yönü değiştirir), " +
      "komşu sınıftaki telefon da duyulabilir. Okul ağına bağlı cihazlar için ağ envanterine bakın.",

    __win: null,

    /**
     * Message Bus konusu (veri: tahta kimliği): bir tahtanın Wi-Fi kartının durumu değişti (pencere açılınca geçici açıldı,
     * kapanınca eski durumuna döndü). Sunucu yeni durumu boards.facts'e yazmıştır; Tahtalar listesi kendini tazeler.
     */
    RADIO_CHANGED: "ankamon.wifimon.radio",

    /**
     * @param boards {Array} tahtalar (çevrim içi olanlar)
     */
    open(boards) {
      boards = (Array.isArray(boards) ? boards : [boards]).filter(Boolean);
      if (!boards.length) {
        return;
      }
      if (this.__win && this.__win.ctx) {
        boards.forEach(board => this.__win.ctx.addBoard(board));
        this.__win.open();
        this.__win.focus();
        return;
      }
      const win = ankamon.ui.Dialog.window("Wi-Fi Monitör", 1040, { maximizable: true });
      win.setHeight(640);
      this.__win = win;
      win.ctx = this.__createWifimonContext(win);
      boards.forEach(board => win.ctx.addBoard(board));
      win.addListener("close", () => {
        win.ctx.closeAll();
        win.ctx = null;
        if (this.__win === win) {
          this.__win = null;
        }
      });
      win.open();
      win.ctx.loadFixed();
    },

    __createWifimonContext(win) {
      const Classify = ankamon.ui.boards.WifimonClassify;
      const Render = ankamon.ui.boards.WifimonRender;
      const esc = qx.bom.String.escape;
      const canEdit = true; // pencereyi açabilen ("screen") sabit listesini de düzenler (bkz. backend routes)

      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      const refresh = new qx.ui.form.Button("Yenile");
      const watchBox = new qx.ui.form.CheckBox("Sürekli izle").set({
        toolTipText: "Açıkken liste sürekli tazelenir; tahtada geçici açılan radyo izleme bitene kadar açık kalır."
      });
      const probeBox = new qx.ui.form.CheckBox("Yoklamaları dinle").set({
        value: true,
        toolTipText: "Wi-Fi'si açık ama bağlı olmayan cihazların ağ arama yoklamalarını dinler (yalnız Wi-Fi kartı bir ağa bağlı değilse)."
      });
      const fixedBox = new qx.ui.form.CheckBox("Sabitleri göster");
      const baseline = new qx.ui.form.Button("Görünenleri sabit yap…").set({
        toolTipText: "Şu an görünen bütün kalıcı adresli vericileri kendi sınıflarına sabit işaretler (sınıflar boşken yapın)."
      });
      const manage = new qx.ui.form.Button("Sabit listesi…");
      const help = new qx.ui.form.Button("?").set({ toolTipText: "Neler görülebilir, sınırlar" });
      [refresh, watchBox, probeBox, fixedBox].forEach(w => bar.add(w));
      bar.add(new qx.ui.core.Spacer(), { flex: 1 });
      [baseline, manage, help].forEach(w => bar.add(w));
      win.add(bar);
      const summary = new qx.ui.embed.Html("").set({ height: 30, overflowY: "auto" });
      let only = null; // şeritte tıklanan tahta: tablo yalnız onu gösterir
      win.add(summary);
      const html = new qx.ui.embed.Html("").set({ overflowY: "auto" });
      win.add(html, { flex: 1 });

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const feeds = new Map();
      let fixed = [];
      let fixedIndex = new Map();
      let closed = false;
      let renderQueued = false;

      const red = text => `<span style="color:#d93025">${esc(text)}</span>`;
      const render = () => {
        if (renderQueued || closed) {
          return;
        }
        renderQueued = true;
        qx.event.Timer.once(() => {
          renderQueued = false;
          if (closed) {
            return;
          }
          const now = Date.now();
          const list = Array.from(feeds.values());
          const common = Classify.commonSsids(list);
          const entries = list.map(feed => ({ feed, view: Classify.board(feed, fixedIndex, common, now) }));
          const opts = { showFixed: fixedBox.getValue(), canEdit, now };
          if (only !== null && !feeds.has(only)) {
            only = null;
          }
          html.setHtml(Render.grid(only === null ? entries : entries.filter(e => e.feed.board.id === only), opts));
          summary.setHtml(`<div style="font-size:13px;line-height:22px">${Render.boards(entries, only)}</div>`);
          // Şerit tahta sayısı kadar uzar (satır başı ~1–2 satır), çok tahtada kaydırılır.
          summary.setHeight(Math.min(200, 6 + list.length * (list.some(f => (f.notes || []).some(Boolean)) ? 46 : 28)));
          win.setCaption(`Wi-Fi Monitör — ${list.length === 1 ? list[0].name : list.length + " tahta"}`);
        }, null, 120);
      };

      const btNote = (bt, ended) => {
        if (bt === "temp") {
          return ended ? "Bluetooth geçici açıldı, tarama sonrası eski durumuna döndürüldü." : "Bluetooth geçici açık.";
        }
        return bt && bt.startsWith("fail") ? red("Bluetooth açılamadı; cihazlar listelenemedi.") : bt === "absent" ? "Bluetooth adaptörü yok." : "";
      };
      const wifiNote = (info, watching) => {
        if (info.wifi_fail) {
          return red(info.wifi_fail === "autoconnect"
            ? "Otomatik bağlanma kapatılamadığından Wi-Fi açılmadı."
            : "Wi-Fi geçici açılamadı; ağlar listelenemedi.");
        }
        if (info.wifi_temp !== "1") {
          return "";
        }
        return watching ? "Wi-Fi izleme için geçici açık; izleme bitince kapatılacak." : "Wi-Fi geçici açık, tarama sonrası kapatılacak.";
      };
      const cardLine = d => {
        if (!d.device) {
          return red("Bu bilgisayarda Wi-Fi kartı görünmüyor.");
        }
        return `Kart ${esc(d.device)} · ` + (d.connection ? `bağlı: <b>${esc(d.connection)}</b>` : "bağlı değil");
      };
      const discard = sock => {
        if (sock) {
          sock.onmessage = sock.onclose = null;
          sock.close();
        }
      };
      const anyBusy = () => Array.from(feeds.values()).some(f => f.ws);
      const syncControls = () => refresh.setEnabled(!watchBox.getValue() && !anyBusy());

      const onMessage = (feed, d, watching) => {
        if (d.phase === "scanning") {
          feed.status = "Taranıyor…";
          feed.notes = [feed.data ? cardLine(feed.data) : "", wifiNote(d.info, watching), btNote(d.info.bt, false)];
        } else if (d.phase === "data") {
          feed.data = d;
          // Kartın o anki durumu (ör. tarama için geçici açıldı) Tahtalar listesinin Wi-Fi sütununa anında geçer: sunucu bu
          // iletiyi göndermeden önce boards.facts'e yazdı (bkz. worker screen/wifi.py _store_radio).
          const radioKey = `${d.radio}|${d.state}`;
          if (radioKey !== feed.radioKey) {
            feed.radioKey = radioKey;
            qx.event.message.Bus.dispatchByName(this.RADIO_CHANGED, feed.board.id);
          }
          const sniff = probeBox.getValue() && d.device;
          feed.status = sniff ? "Paketler dinleniyor…" : `Son tarama ${new Date(d.at * 1000).toLocaleTimeString("tr-TR")}`;
          feed.notes = [cardLine(d), wifiNote(d.info || {}, watching), btNote((d.info || {}).bt, false)];
          if (!sniff) {
            feed.initialKeys = feed.initialKeys || new Set(d.rows.map(Classify.rowKey));
          }
        } else if (d.phase === "probes") {
          const now = Date.now();
          if (!watching) {
            feed.probes = new Map();
          }
          d.rows.forEach(row => feed.probes.set(Classify.rowKey(row), { row, at: now }));
          feed.probes.forEach((p, key) => now - p.at > this.PROBE_KEEP_MS && feed.probes.delete(key));
          feed.probeInfo = d;
          feed.status = `Son tarama ${new Date(d.at * 1000).toLocaleTimeString("tr-TR")}`;
          if (d.note) {
            feed.notes.push(Render.PROBE_NOTE[d.note] || "Yoklama dinlenemedi.");
          }
          if (!feed.initialKeys) {
            feed.initialKeys = new Set(((feed.data && feed.data.rows) || []).map(Classify.rowKey));
            feed.probes.forEach((p, key) => feed.initialKeys.add(key));
          }
        } else if (d.phase === "done") {
          qx.event.message.Bus.dispatchByName(this.RADIO_CHANGED, feed.board.id); // geri yüklenen durum (bkz. "data")
          const parts = feed.data ? [cardLine(feed.data)] : [];
          if (d.result === "fail" || d.result === "lock") {
            parts.push(red("Tahtadaki kartın eski durumuna dönmesi doğrulanamadı; lütfen denetleyin."));
          } else if (d.wifi_fail) {
            parts.push(wifiNote(d, false));
          } else if (d.wifi_temp === "1") {
            parts.push(d.result === "shared" ? "Wi-Fi geçici açıldı; bu tahtadaki başka bir tarama bitince kapatılacak."
              : "Wi-Fi geçici açıldı, tarama sonrası kapatıldı.");
          }
          if (d.policy === "off" && d.radio === "disabled" && d.result !== "shared") {
            parts.push("Bu tahtada Wi-Fi kapalı tutuluyor (Wi-Fi'yi kapat); kart kapalı bırakıldı.");
          }
          parts.push(btNote(d.bt, d.result !== "shared"));
          if (feed.probeInfo && feed.probeInfo.note) {
            parts.push(Render.PROBE_NOTE[feed.probeInfo.note] || "");
          }
          feed.notes = parts;
        }
        render();
      };

      const connect = feed => {
        const watching = watchBox.getValue();
        const query = [watching ? "watch=1" : "", probeBox.getValue() ? "probe=1" : ""].filter(Boolean).join("&");
        const sock = feed.ws = new WebSocket(`${proto}//${location.host}/screen/ws/wifi/${feed.board.id}${query ? "?" + query : ""}`);
        feed.busy = true;
        feed.status = "Bağlanılıyor…";
        syncControls();
        render();
        sock.onmessage = e => onMessage(feed, JSON.parse(e.data), watching);
        sock.onclose = e => {
          if (closed || sock !== feed.ws) {
            return;
          }
          feed.ws = null;
          feed.busy = false;
          syncControls();
          if (e.code !== 1000) {
            const why = { 4001: "Tahta bulunamadı.", 4002: "Tahtaya ulaşılamıyor.", 4003: "SSH girişi reddedildi.", 4009: "Tahtada nmcli yok.", 4010: "Tahtada /run dizinine yazılamıyor." };
            const retry = watchBox.getValue() && ![4001, 4003, 4009, 4010].includes(e.code);
            feed.status = red((why[e.code] || "Bağlantı kesildi.") + (retry ? " Yeniden deneniyor…" : ""));
            if (retry) {
              qx.event.Timer.once(() => !closed && !feed.ws && feeds.has(feed.board.id) && watchBox.getValue() && connect(feed), null, 5000);
            }
          } else if (!/Son tarama/.test(feed.status || "")) {
            feed.status = "Bitti";
          }
          render();
        };
      };

      const restartAll = () => feeds.forEach(feed => {
        discard(feed.ws);
        connect(feed);
      });
      const stopAll = () => feeds.forEach(feed => {
        if (feed.ws && feed.ws.readyState === WebSocket.OPEN) {
          feed.ws.send("stop");
          feed.status = "İzleme durduruluyor…";
        } else if (feed.ws) {
          discard(feed.ws);
          feed.ws = null;
          feed.busy = false;
        }
      });

      const loadFixed = async () => {
        try {
          fixed = (await ankamon.io.Api.get("/wifimon/fixed")).fixed || [];
        } catch (err) {
          fixed = [];
          summary.setHtml(red("Sabit listesi okunamadı: " + (err.message || err)));
        }
        fixedIndex = Classify.index(fixed);
        render();
      };
      const addFixed = async items => {
        if (!items.length) {
          return;
        }
        try {
          await ankamon.io.Api.post("/wifimon/fixed", { items });
        } catch (err) {
          ankamon.ui.Dialog.error(err);
        }
        await loadFixed();
      };
      const removeFixed = async ids => {
        try {
          await ankamon.io.Api.del("/wifimon/fixed", { ids });
        } catch (err) {
          ankamon.ui.Dialog.error(err);
        }
        await loadFixed();
      };

      // Görünenleri sabit yap: her tahtanın şu an duyduğu kalıcı adresli vericiler kendi sınıfına (tahtasına) sabitlenir.
      baseline.addListener("execute", async () => {
        const items = [];
        feeds.forEach(feed => {
          const rows = ((feed.data && feed.data.rows) || []).concat(Array.from(feed.probes.values()).map(p => p.row));
          rows.forEach(row => {
            if (!row.addr || row.active || (row.kind !== "wifi" && row.random) || Classify.fixedEntry(row, feed.board.id, fixedIndex)) {
              return;
            }
            items.push({ kind: row.kind === "wifi" ? "bssid" : row.kind, value: row.addr, board_id: feed.board.id, label: row.name || "" });
          });
        });
        if (!items.length) {
          ankamon.ui.Dialog.alert("Sabit işaretlenecek yeni verici yok (rastgele adresli Bluetooth/yoklama cihazları sabitlenemez).", "Wi-Fi Monitör");
          return;
        }
        const ok = await ankamon.ui.Dialog.confirm(`Şu an görünen <b>${items.length}</b> verici, görüldüğü tahtanın sınıfına sabit işaretlenecek.` +
          "<br><br>Bunu sınıflar <b>boşken</b> (öğrenci ve telefon yokken) yapın: o anda sınıfta açık bir telefon varsa o da sabit sayılır.",
        "Sabit yap");
        if (ok) {
          await addFixed(items.slice(0, 500));
        }
      });
      manage.addListener("execute", () => ankamon.ui.boards.WifimonFixedDialog.open(() => fixed, removeFixed));
      help.addListener("execute", () => ankamon.ui.Dialog.alert(this.HELP, "Wi-Fi Monitör — neler görülebilir"));
      fixedBox.addListener("changeValue", render);
      refresh.addListener("execute", () => feeds.forEach(feed => !feed.ws && connect(feed)));
      watchBox.addListener("changeValue", e => {
        // Eski oturum kapanırken yenisi başlarsa tahtadaki sayım radyoyu boşuna kapatmaz (bkz. wifi_remote_scan.py).
        if (e.getData()) {
          restartAll();
        } else {
          stopAll();
        }
        syncControls();
        render();
      });
      probeBox.addListener("changeValue", () => watchBox.getValue() && restartAll());

      html.addListenerOnce("appear", () => {
        html.getContentElement().getDomElement().addEventListener("click", e => {
          const el = e.target.closest && e.target.closest("[data-act]");
          if (!el) {
            return;
          }
          if (el.dataset.act === "fix") {
            const boardId = el.dataset.board ? Number(el.dataset.board) : null;
            addFixed([{ kind: el.dataset.kind, value: el.dataset.value, board_id: boardId, label: el.dataset.label || "" }]);
          } else if (el.dataset.act === "unfix") {
            removeFixed([Number(el.dataset.id)]);
          }
        });
      });
      summary.addListenerOnce("appear", () => {
        summary.getContentElement().getDomElement().addEventListener("click", e => {
          const el = e.target.closest && e.target.closest("[data-act=only]");
          if (el) {
            const id = Number(el.dataset.board);
            only = only === id ? null : id;
            render();
          }
        });
      });
      // Sürekli izlemede "… önce" yazıları ve düşen yoklamalar için ara sıra yeniden çiz.
      const ticker = new qx.event.Timer(15000);
      ticker.addListener("interval", () => watchBox.getValue() && render());
      ticker.start();

      return {
        loadFixed,
        addBoard: board => {
          if (feeds.has(board.id)) {
            return;
          }
          const feed = { board, name: board.label || board.hostname || board.ip || "#" + board.id, ws: null, busy: false, status: "",
            notes: [], data: null, probes: new Map(), probeInfo: null, initialKeys: null };
          feeds.set(board.id, feed);
          connect(feed);
        },
        closeAll: () => {
          closed = true;
          // Pencere kapanınca tahtalar kartı kendisi geri yükler (birkaç sn), sunucu son durumu boards.facts'e yazar; kapanış
          // iletisi bu pencereye artık gelmeyeceğinden Tahtalar listesi birkaç kez tazelenir (değişen durum anında görünsün).
          const ids = Array.from(feeds.keys());
          [4000, 9000, 20000].forEach(ms => qx.event.Timer.once(() =>
            ids.forEach(id => qx.event.message.Bus.dispatchByName(ankamon.ui.boards.WifiMonitor.RADIO_CHANGED, id)), null, ms));
          ticker.stop();
          ticker.dispose();
          feeds.forEach(feed => discard(feed.ws));
          feeds.clear();
        }
      };
    }
  }
});
