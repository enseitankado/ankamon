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
 * Sağ menü "Sohbet": cihazdaki kişiyle canlı yazışma penceresi. Tek cihazda cihaz başına bir pencere; çoklu seçimde TEK pencere
 * seçili bütün cihazlara aynı anda yazar (kullanıcı isteği 2026-11-23): her cihaza ayrı köprü bağlantısı açılır, gelen yanıtlar
 * cihaz adıyla aynı akışta görünür, aynı gönderimin cihaz kopyaları tek satırda toplanır (eş anahtarı "k"). Aynı cihaz kümesine
 * yeniden açılınca var olan öne gelir. Akış WebSocket'tedir (/screen/ws/chat/<id>, bkz. worker screen/chat.py); cihazda pencere
 * açılır, kapanınca cihazdaki pencere de kapanır. Geçmiş sunucuda ve her cihaz için ayrı: Oturumlar ▸ Sohbet geçmişi.
 *
 * Cihazdaki pencerenin ayarları üst satırda ve canlıdır: "Karşı taraf yanıt yazabilir" (tek cihazda açık, çoklu pencerede kapalı
 * başlar; kapalıyken cihazda yazma kutusu ve Gönder düğmesi görünmez), pencere boyutu (küçük/orta/büyük/tam ekran) ve punto.
 */
qx.Class.define("ankamon.ui.chat.Window", {
  extend: qx.ui.window.Window,

  statics: {
    __open: new Map(),

    /** Message Bus konusu: açık sohbetler değişti (Ekranlar o cihazların akışını yüksek çözünürlüğe alır). */
    CHANGED: "ankamon.chatWindows",

    /** Cihazdaki pencerenin boyut ön ayarları (worker chat_agent.py CHAT_SIZES ile aynı anahtarlar). */
    SIZES: [["small", "Küçük"], ["medium", "Orta"], ["large", "Büyük"], ["full", "Tam ekran"]],
    FONT_DEFAULT: 14,

    /** Sohbet penceresi açık cihazların kimlikleri (bütün pencerelerden, tekrarsız). */
    openIds() {
      const ids = new Set();
      this.__open.forEach(win => win.getDeviceIds().forEach(id => ids.add(id)));
      return [...ids];
    },

    /** @param devices {Map|Map[]} tek cihaz ya da cihaz listesi; her biri en az {id, label|hostname|ip} */
    open(devices) {
      const list = (Array.isArray(devices) ? devices : [devices]).filter((d, i, all) => all.findIndex(o => o.id === d.id) === i);
      if (!list.length) {
        return null;
      }
      const key = list.map(d => d.id).sort((a, b) => a - b).join(",");
      const existing = this.__open.get(key);
      if (existing) {
        existing.open();
        existing.focus();
        return existing;
      }
      const win = new ankamon.ui.chat.Window(list);
      this.__open.set(key, win);
      win.addListener("close", () => {
        this.__open.delete(key);
        qx.event.message.Bus.dispatchByName(this.CHANGED, this.openIds());
      });
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
      qx.event.message.Bus.dispatchByName(this.CHANGED, this.openIds());
      return win;
    },

    /** Cihazın kullanıcıya görünen adı. */
    deviceLabel(device) {
      return device.label || device.hostname || device.ip || "#" + device.id;
    }
  },

  construct(devices) {
    const Self = ankamon.ui.chat.Window;
    const list = Array.isArray(devices) ? devices : [devices];
    const multi = list.length > 1;
    super("Sohbet — " + (multi ? `${list.length} cihaz` : Self.deviceLabel(list[0])));
    this.__devices = list;
    this.__multi = multi;
    this.__seen = new Set();
    this.__links = new Map();
    this.__grouped = new Map();
    this.__opts = { reply: !multi, size: "medium", font: Self.FONT_DEFAULT };
    this.set({ width: multi ? 560 : 520, height: multi ? 560 : 500, contentPadding: 10, layout: new qx.ui.layout.VBox(8) });

    this.add(this.__buildOptions());

    this.__status = new qx.ui.basic.Label("Bağlanılıyor…").set({ textColor: "app-muted", rich: true, wrap: true, allowGrowX: true });
    this.add(this.__status);
    if (multi) {
      // Cihaz başına durum: renkli nokta + ad; ayrıntı ipucunda.
      this.__chips = new qx.ui.container.Composite(new qx.ui.layout.Flow(10, 2));
      this.add(this.__chips);
    }

    this.__log = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ padding: 8 });
    this.__scroll = new qx.ui.container.Scroll(this.__log).set({
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
    });
    this.add(this.__scroll, { flex: 1 });
    if (multi) {
      this.__note(`İletiler ${list.length} cihaza birlikte gider; yanıtlar cihaz adıyla görünür. Önceki yazışmalar: Oturumlar ▸ Sohbet geçmişi.`);
    }

    const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    this.__field = new qx.ui.form.TextField().set({
      placeholder: multi ? `${list.length} cihaza iletinizi yazın…` : "İletinizi yazın…", maxLength: 2000, enabled: false
    });
    this.__field.addListener("keypress", e => {
      if (e.getKeyIdentifier() === "Enter") {
        this.__send();
      }
    });
    this.__sendButton = new qx.ui.form.Button("Gönder").set({ enabled: false });
    this.__sendButton.addListener("execute", () => this.__send());
    row.add(this.__field, { flex: 1 });
    row.add(this.__sendButton);
    this.add(row);

    this.addListenerOnce("appear", () => {
      this.center();
      list.forEach(device => this.__connect(device));
      this.__renderStatus();
    });
    this.addListener("close", () => {
      this.__closed = true;
      this.__links.forEach(link => link.ws && link.ws.close());
      qx.event.Timer.once(() => this.destroy(), null, 0);
    });
  },

  members: {
    __devices: null,
    __multi: false,
    __status: null,
    __chips: null,
    __log: null,
    __scroll: null,
    __field: null,
    __sendButton: null,
    __links: null,
    __seen: null,
    __grouped: null,
    __closed: false,
    __opts: null,
    __replyBox: null,
    __sizeBox: null,
    __fontSpinner: null,
    __syncing: false,
    __optsTimer: null,

    /** Penceredeki cihazların kimlikleri. */
    getDeviceIds() {
      return this.__devices.map(d => d.id);
    },

    /** Üst satır: cihazdaki pencerenin canlı ayarları. */
    __buildOptions() {
      const Self = ankamon.ui.chat.Window;
      const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      this.__replyBox = new qx.ui.form.CheckBox("Karşı taraf yanıt yazabilir").set({ value: this.__opts.reply });
      this.__replyBox.setToolTipText("Kapalıyken cihazdaki sohbet penceresinde yazma kutusu ve Gönder düğmesi görünmez (yalnız okunur).");
      this.__replyBox.addListener("changeValue", e => this.__setOpt("reply", e.getData()));
      bar.add(this.__replyBox);
      bar.add(new qx.ui.core.Spacer(), { flex: 1 });

      bar.add(new qx.ui.basic.Label("Pencere:").set({ alignY: "middle" }));
      this.__sizeBox = new qx.ui.form.SelectBox().set({ width: 100 });
      Self.SIZES.forEach(([value, label]) => {
        const item = new qx.ui.form.ListItem(label, null, value);
        this.__sizeBox.add(item);
        if (value === this.__opts.size) {
          this.__sizeBox.setSelection([item]);
        }
      });
      this.__sizeBox.setToolTipText("Cihazdaki sohbet penceresinin boyutu (ekranın oranıyla; Tam ekran ekranı kaplar).");
      this.__sizeBox.addListener("changeSelection", e => {
        const item = e.getData()[0];
        if (item) {
          this.__setOpt("size", item.getModel());
        }
      });
      bar.add(this.__sizeBox);

      bar.add(new qx.ui.basic.Label("Punto:").set({ alignY: "middle", marginLeft: 4 }));
      const smaller = new qx.ui.form.Button("A−").set({ toolTipText: "Cihazdaki yazıyı küçült" });
      this.__fontSpinner = new qx.ui.form.Spinner(6, this.__opts.font, 72).set({ width: 58 });
      this.__fontSpinner.setToolTipText("Cihazdaki sohbet penceresinin yazı puntosu");
      const bigger = new qx.ui.form.Button("A+").set({ toolTipText: "Cihazdaki yazıyı büyüt" });
      smaller.addListener("execute", () => this.__fontSpinner.setValue(Math.max(6, this.__fontSpinner.getValue() - 2)));
      bigger.addListener("execute", () => this.__fontSpinner.setValue(Math.min(72, this.__fontSpinner.getValue() + 2)));
      this.__fontSpinner.addListener("changeValue", e => this.__setOpt("font", e.getData()));
      bar.add(smaller);
      bar.add(this.__fontSpinner);
      bar.add(bigger);
      return bar;
    },

    /** Ayar değişti: bütün açık bağlantılara (punto adımları kısa beklemeyle tek iletiye toplanır). */
    __setOpt(name, value) {
      if (this.__syncing || this.__opts[name] === value) {
        return;
      }
      this.__opts[name] = value;
      if (this.__optsTimer) {
        this.__optsTimer.stop();
      }
      this.__optsTimer = qx.event.Timer.once(() => {
        this.__optsTimer = null;
        const text = JSON.stringify(Object.assign({ t: "opts" }, this.__opts));
        this.__links.forEach(link => link.ws && link.ws.readyState === WebSocket.OPEN && link.ws.send(text));
      }, this, name === "font" ? 250 : 0);
    },

    /** Tek cihaz penceresi: ayarı başka bir pencere değiştirdiyse denetimler ona uyar. */
    __syncOpts(msg) {
      if (this.__multi || this.__optsTimer) {
        return;
      }
      this.__syncing = true;
      try {
        this.__opts = { reply: msg.reply !== false, size: msg.size || "medium", font: msg.font || this.__opts.font };
        this.__replyBox.setValue(this.__opts.reply);
        const item = this.__sizeBox.getChildren().find(i => i.getModel() === this.__opts.size);
        if (item) {
          this.__sizeBox.setSelection([item]);
        }
        this.__fontSpinner.setValue(this.__opts.font);
      } finally {
        this.__syncing = false;
      }
    },

    __connect(device) {
      const link = this.__links.get(device.id) || { device, ws: null, state: "offline", detail: "Bağlanılıyor…" };
      this.__links.set(device.id, link);
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const query = new URLSearchParams({
        reply: this.__opts.reply ? "1" : "0", size: this.__opts.size, font: String(this.__opts.font), history: this.__multi ? "0" : "1"
      });
      const ws = link.ws = new WebSocket(`${proto}//${location.host}/screen/ws/chat/${device.id}?${query}`);
      ws.addEventListener("open", () => this.__updateReady());
      ws.addEventListener("message", e => this.__onMessage(link, JSON.parse(e.data)));
      ws.addEventListener("close", e => {
        if (link.ws === ws) {
          link.ws = null;
        }
        this.__updateReady();
        if (this.__closed || this.isDisposed()) {
          return;
        }
        link.state = "offline";
        link.detail = e.code === 4001 ? "Cihaz bulunamadı." : e.code === 4029 ? "Aynı anda sohbet sınırı aşıldı." :
          "Sunucuyla bağlantı koptu; yeniden deneniyor…";
        this.__renderStatus();
        if (e.code !== 4001) {
          qx.event.Timer.once(() => !this.__closed && !this.isDisposed() && this.__connect(device), this, 3000);
        }
      });
    },

    __updateReady() {
      const on = [...this.__links.values()].some(l => l.ws && l.ws.readyState === WebSocket.OPEN);
      const was = this.__field.getEnabled();
      this.__field.setEnabled(on);
      this.__sendButton.setEnabled(on);
      if (on && !was) {
        this.__field.focus();
      }
    },

    __renderStatus() {
      const links = [...this.__links.values()];
      if (!this.__multi) {
        const link = links[0];
        if (link) {
          this.__status.set({ value: qx.bom.String.escape(link.detail || ""), textColor: link.state === "offline" ? "app-error" : "app-muted" });
        }
        return;
      }
      const open = links.filter(l => l.state === "online").length;
      this.__status.set({ value: `<b>${open}/${links.length}</b> cihazda sohbet penceresi açık`, textColor: "app-muted" });
      const esc = qx.bom.String.escape;
      const color = { online: "#188038", closed: "#b06000", offline: "#d93025" };
      this.__chips.removeAll().forEach(w => w.dispose());
      links.forEach(l => this.__chips.add(new qx.ui.basic.Label(
        `<span style="color:${color[l.state] || color.offline}">●</span> ${esc(ankamon.ui.chat.Window.deviceLabel(l.device))}`
      ).set({ rich: true, toolTipText: l.detail || "" })));
    },

    __onMessage(link, msg) {
      if (msg.t === "status") {
        link.state = msg.state;
        link.detail = msg.detail || "";
        this.__renderStatus();
      } else if (msg.t === "opts") {
        this.__syncOpts(msg);
      } else if (msg.t === "msg" && !this.__seen.has(msg.id)) {
        this.__seen.add(msg.id);
        this.__append(link.device, msg);
      }
    },

    __note(text) {
      this.__log.add(new qx.ui.basic.Label(qx.bom.String.escape(text)).set({
        rich: true, wrap: true, allowGrowX: true, textColor: "app-muted", font: "small"
      }));
    },

    __append(device, msg) {
      const esc = qx.bom.String.escape;
      const Self = ankamon.ui.chat.Window;
      const color = msg.direction === "out" ? "#1a73e8" : "#188038";
      const time = new Date(msg.at * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      const body = esc(msg.text).replace(/\n/g, "<br>");
      const head = (who, extra) =>
        `<b style="color:${color}">${esc(who)}</b>${extra} <span style="opacity:.6;font-size:11px">${time}</span><br>` + body;
      if (this.__multi && msg.direction === "out" && msg.k) {
        // Aynı gönderimin öteki cihazlara düşen kopyaları: tek satır, hedefler listede.
        const group = this.__grouped.get(msg.k);
        if (group) {
          group.targets.push(Self.deviceLabel(device));
          group.label.setValue(head(msg.author, this.__targets(group.targets)));
          return;
        }
        const targets = [Self.deviceLabel(device)];
        const label = this.__addLine(head(msg.author, this.__targets(targets)));
        this.__grouped.set(msg.k, { targets, label });
        return;
      }
      const who = this.__multi ? (msg.direction === "out" ? msg.author : `${Self.deviceLabel(device)} — ${msg.author}`) : msg.author;
      const extra = this.__multi && msg.direction === "out" ? this.__targets([Self.deviceLabel(device)]) : "";
      this.__addLine(head(who, extra));
    },

    __targets(names) {
      const esc = qx.bom.String.escape;
      const shown = names.length > 4 ? names.slice(0, 4).join(", ") + ` +${names.length - 4}` : names.join(", ");
      return ` <span style="opacity:.75">→ ${esc(shown)}</span>`;
    },

    __addLine(html) {
      const label = new qx.ui.basic.Label(html).set({ rich: true, wrap: true, selectable: true, allowGrowX: true });
      this.__log.add(label);
      // Yerleşim bir sonraki turda hesaplanır: en alta o zaman kaydırılır.
      qx.event.Timer.once(() => !this.isDisposed() && this.__scroll.scrollToY(1000000), this, 30);
      return label;
    },

    __send() {
      const text = (this.__field.getValue() || "").trim();
      const open = [...this.__links.values()].filter(l => l.ws && l.ws.readyState === WebSocket.OPEN);
      if (!text || !open.length) {
        return;
      }
      // Eş anahtarı: her cihazın kaydı ayrı yazılır, bu pencere kopyaları tek satırda toplar.
      const k = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const payload = JSON.stringify({ text, k });
      open.forEach(l => l.ws.send(payload));
      this.__field.setValue("");
      this.__field.focus();
    }
  }
});
