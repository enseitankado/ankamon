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
 * Bağlı Ankamon kullanıcıları penceresi (kullanıcı isteği 2026-11-24): alt çubuktaki 👤 göstergesine tıklanınca açılan,
 * kendiliğinden tazelenen kipli pencere. Eskiden ayrıntı göstergenin üzerine gelince açılan balondaydı; balon kırpılıyor,
 * içinde gezinilemiyordu. Gösterge (ve bu pencere) yalnız bir eklenti "statusBar.usersVisible" kancasını üstlenince
 * görünür.
 *
 * Veri: GET /api/login-sessions/active PARAMETRESİZ (yalnız okur; bu oturumun odak/sayfa bildirimini alt çubuk 15 sn'de
 * bir kendisi yapar — bkz. ui.StatusBar.__pollUsers). Ayrıntı satırları yalnız 'logins' yetkisine (sunucu süzer); yoksa
 * yalnız sayı. Satır = kullanıcı + IP (sunucu gruplar).
 */
qx.Class.define("ankamon.ui.LoginPresenceWindow", {
  extend: qx.core.Object,

  statics: {
    __instance: null,
    POLL_MS: 3000,

    /** Pencereyi açar (açıksa öne getirir). */
    open() {
      const W = ankamon.ui.LoginPresenceWindow;
      if (!W.__instance || W.__instance.isDisposed()) {
        W.__instance = new W();
      }
      W.__instance.show();
      return W.__instance;
    },

    /** Açıksa kapatır (gösterge gizlenince — kanca kapandı). */
    closeIfOpen() {
      const W = ankamon.ui.LoginPresenceWindow;
      if (W.__instance && !W.__instance.isDisposed()) {
        W.__instance.close();
      }
    },

    COLUMNS: [
      ["user", "Kullanıcı", 120], ["name", "Ad soyad", 150], ["state", "Durum", 90], ["view", "Açık sayfa", "2*"],
      ["computer", "Bilgisayar", 150], ["ip", "IP", 110], ["started", "Son giriş", 130], ["seen", "Son etkinlik", 100],
      ["sessions", "Oturum", 60]
    ]
  },

  construct() {
    super();
    const root = qx.core.Init.getApplication().getRoot().getBounds() || { width: 1200, height: 700 };
    const win = this.__win = ankamon.ui.Dialog.window("Bağlı Ankamon kullanıcıları", Math.min(1100, root.width - 40),
      { maximizable: true });
    // Kipli kalır (kullanıcı isteği): WindowDock bütün pencereleri küçültülebilir yapıp kipliliği kaldırır; istisna işareti.
    win.setUserData("ankamon.keepModal", true);
    win.set({ modal: true, height: Math.min(460, root.height - 60), minWidth: 420, minHeight: 220, resizable: true,
      contentPadding: 8, layout: new qx.ui.layout.VBox(6) });

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    this.__summary = new qx.ui.basic.Label("Yükleniyor…").set({ rich: true, font: "bold" });
    bar.add(this.__summary);
    bar.add(new qx.ui.core.Spacer(), { flex: 1 });
    this.__stamp = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    bar.add(this.__stamp);
    const close = new qx.ui.form.Button("Kapat");
    close.addListener("execute", () => win.close());
    bar.add(close);
    win.add(bar);

    const cols = ankamon.ui.LoginPresenceWindow.COLUMNS;
    const model = this.__model = new qx.ui.table.model.Simple();
    ankamon.page.Base.keepSortOnReload(model);
    model.setColumns(["key"].concat(cols.map(c => c[1])), ["key"].concat(cols.map(c => c[0])));
    const table = this.__table = new qx.ui.table.Table(model, {
      tableColumnModel: obj => new qx.ui.table.columnmodel.Resize(obj)
    }).set({ statusBarVisible: false, showCellFocusIndicator: false, minHeight: 120 });
    const cm = table.getTableColumnModel();
    cm.setColumnVisible(0, false);
    const behavior = cm.getBehavior();
    cols.forEach((c, i) => behavior.setWidth(i + 1, c[2]));
    // Durum: Aktif yeşil kalın, arka plan soluk.
    const stateRenderer = new qx.ui.table.cellrenderer.Default();
    stateRenderer._getCellStyle = function (cellInfo) {
      const v = cellInfo.value || "";
      return qx.ui.table.cellrenderer.Default.prototype._getCellStyle.call(this, cellInfo) +
        (v === "Aktif" ? "color:#2e9d4a;font-weight:bold;" : "opacity:.7;");
    };
    cm.setDataCellRenderer(3, stateRenderer);
    table.setToolTipText("Aktif: Ankamon o kişinin tarayıcısında görünür sekmede ve pencere odakta. " +
      "Arka planda: bağlı ama sekme/pencere odakta değil. Liste " + (ankamon.ui.LoginPresenceWindow.POLL_MS / 1000) +
      " sn'de bir tazelenir.");
    win.add(table, { flex: 1 });

    this.__timer = new qx.event.Timer(ankamon.ui.LoginPresenceWindow.POLL_MS);
    this.__timer.addListener("interval", this.__poll, this);
    this.__timer.start();
    this.__poll();
    win.addListener("close", () => this.dispose());
  },

  destruct() {
    this.__timer.stop();
    this.__timer.dispose();
    if (ankamon.ui.LoginPresenceWindow.__instance === this) {
      ankamon.ui.LoginPresenceWindow.__instance = null;
    }
  },

  members: {
    __win: null,
    __model: null,
    __table: null,
    __summary: null,
    __stamp: null,
    __timer: null,
    __busy: false,

    show() {
      this.__win.open();
      this.__win.setActive(true);
    },

    close() {
      this.__win.close();
    },

    async __poll() {
      if (this.__busy || this.isDisposed()) {
        return;
      }
      this.__busy = true;
      let res;
      try {
        res = await ankamon.io.Api.get("/login-sessions/active");
      } catch (e) {
        if (!this.isDisposed()) {
          this.__stamp.setValue("<span style=\"color:#c62828\">Alınamadı: " + qx.bom.String.escape(e.message || String(e)) + "</span>");
        }
        return;
      } finally {
        this.__busy = false;
      }
      if (this.isDisposed()) {
        return;
      }
      const F = ankamon.util.Format;
      this.__summary.setValue(`Bağlı kullanıcı: ${res.users}` + (res.total !== undefined ? ` <span style="font-weight:normal">(${res.total} oturum)</span>` : ""));
      this.__stamp.setValue("Son tazeleme: " + new Date().toLocaleTimeString("tr-TR"));
      if (!res.sessions) {
        this.__model.setData([]);
        this.__table.setToolTipText("Ayrıntı için 'Oturumlar' (logins) yetkisi gerekir; yalnız sayı gösterilir.");
        return;
      }
      const rows = res.sessions.map(s => {
        const flags = [s.mine ? "siz" : ""].filter(Boolean).join(", ");
        return [
          `${s.username}|${s.ip || ""}`,
          s.username + (flags ? ` (${flags})` : ""),
          s.full_name || "",
          s.active ? "Aktif" : "Arka planda",
          s.view || "",
          s.computer || "",
          s.ip || "",
          s.started_ts ? F.dateTime(s.started_ts) : "",
          s.last_seen_ts ? F.ago(Math.round(s.last_seen_ts / 1000)) : "—",
          s.sessions || 1
        ];
      });
      this.__model.setData(rows);
    }
  }
});
