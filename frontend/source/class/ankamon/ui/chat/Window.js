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
 * Sağ menü "Sohbet": tahtadaki kişiyle canlı yazışma penceresi. Tahta başına bir pencere; aynı tahtaya yeniden açılınca var
 * olan öne gelir. Akış WebSocket'tedir (/screen/ws/chat/<id>, bkz. worker screen/chat.py); tahtada pencere açılır, kapanınca
 * tahtadaki pencere de kapanır. Geçmiş sunucuda: Oturumlar ▸ Sohbet geçmişi.
 */
qx.Class.define("ankamon.ui.chat.Window", {
  extend: qx.ui.window.Window,

  statics: {
    __open: new Map(),

    /** @param board {Map} en az {id, label|hostname|ip} */
    open(board) {
      const existing = this.__open.get(board.id);
      if (existing) {
        existing.open();
        existing.focus();
        return existing;
      }
      const win = new ankamon.ui.chat.Window(board);
      this.__open.set(board.id, win);
      win.addListener("close", () => this.__open.delete(board.id));
      qx.core.Init.getApplication().getRoot().add(win);
      win.open();
      return win;
    }
  },

  construct(board) {
    super("Sohbet — " + (board.label || board.hostname || board.ip || "#" + board.id));
    this.__board = board;
    this.__seen = new Set();
    this.set({ width: 480, height: 480, contentPadding: 10, layout: new qx.ui.layout.VBox(8) });

    this.__status = new qx.ui.basic.Label("Bağlanılıyor…").set({ textColor: "app-muted", rich: true, wrap: true, allowGrowX: true });
    this.add(this.__status);

    this.__log = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ padding: 8 });
    this.__scroll = new qx.ui.container.Scroll(this.__log).set({
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "app-border", radius: 4 })
    });
    this.add(this.__scroll, { flex: 1 });

    const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(6).set({ alignY: "middle" }));
    this.__field = new qx.ui.form.TextField().set({ placeholder: "İletinizi yazın…", maxLength: 2000, enabled: false });
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
      this.__connect();
    });
    this.addListener("close", () => {
      this.__closed = true;
      if (this.__ws) {
        this.__ws.close();
      }
      qx.event.Timer.once(() => this.destroy(), null, 0);
    });
  },

  members: {
    __board: null,
    __status: null,
    __log: null,
    __scroll: null,
    __field: null,
    __sendButton: null,
    __ws: null,
    __seen: null,
    __closed: false,

    __connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = this.__ws = new WebSocket(`${proto}//${location.host}/screen/ws/chat/${this.__board.id}`);
      ws.addEventListener("open", () => this.__setReady(true));
      ws.addEventListener("message", e => this.__onMessage(JSON.parse(e.data)));
      ws.addEventListener("close", e => {
        this.__setReady(false);
        if (this.__closed || this.isDisposed()) {
          return;
        }
        this.__setStatus(e.code === 4001 ? "Tahta bulunamadı." : "Sunucuyla bağlantı koptu; yeniden deneniyor…", "app-error");
        if (e.code !== 4001) {
          qx.event.Timer.once(() => !this.__closed && !this.isDisposed() && this.__connect(), this, 3000);
        }
      });
    },

    __setReady(on) {
      this.__field.setEnabled(on);
      this.__sendButton.setEnabled(on);
      if (on) {
        this.__field.focus();
      }
    },

    __setStatus(text, color) {
      this.__status.set({ value: qx.bom.String.escape(text), textColor: color || "app-muted" });
    },

    __onMessage(msg) {
      if (msg.t === "status") {
        this.__setStatus(msg.detail || "", msg.state === "offline" ? "app-error" : "app-muted");
      } else if (msg.t === "msg" && !this.__seen.has(msg.id)) {
        this.__seen.add(msg.id);
        this.__append(msg);
      }
    },

    __append(msg) {
      const esc = qx.bom.String.escape;
      const color = msg.direction === "out" ? "#1a73e8" : "#188038";
      const time = new Date(msg.at * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      this.__log.add(new qx.ui.basic.Label(
        `<b style="color:${color}">${esc(msg.author)}</b> <span style="opacity:.6;font-size:11px">${time}</span><br>` +
        esc(msg.text).replace(/\n/g, "<br>")
      ).set({ rich: true, wrap: true, selectable: true, allowGrowX: true }));
      // Yerleşim bir sonraki turda hesaplanır: en alta o zaman kaydırılır.
      qx.event.Timer.once(() => !this.isDisposed() && this.__scroll.scrollToY(1000000), this, 30);
    },

    __send() {
      const text = (this.__field.getValue() || "").trim();
      if (!text || !this.__ws || this.__ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.__ws.send(JSON.stringify({ text }));
      this.__field.setValue("");
      this.__field.focus();
    }
  }
});
