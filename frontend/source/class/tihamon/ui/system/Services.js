/**
 * Sistem → Servisler: konteynerdeki arka plan bileşenleri (supervisord programları, /api/system/services).
 * Seçilenler başlatılır/durdurulur/yeniden başlatılır; arayüzü taşıyan servisler (nginx, php-fpm,
 * postgres) kilitlidir — nedeni satırda yazar. Sekme ekrandayken 5 sn'de bir kendiliğinden tazelenir.
 */
qx.Class.define("tihamon.ui.system.Services", {
  extend: tihamon.ui.system.Tab,

  statics: {
    REFRESH_MS: 5000,
    STATE: {
      RUNNING: ["Çalışıyor", "ok"], STARTING: ["Başlıyor", "warn"], STOPPING: ["Duruyor", "warn"],
      BACKOFF: ["Tekrar deneniyor", "bad"], STOPPED: ["Durduruldu", "idle"], EXITED: ["Bitti", "idle"],
      FATAL: ["Başlatılamadı", "bad"], UNKNOWN: ["Bilinmiyor", "bad"]
    }
  },

  construct(page) {
    super(page, "Servisler");
    const ICON = tihamon.ui.Shell.ICON;
    this.__buttons = [
      ["start", "▶ Başlat"], ["stop", `${ICON.shutdown} Durdur`], ["restart", "↻ Yeniden başlat"]
    ].map(([action, label]) => {
      const btn = new qx.ui.form.Button(label).set({ enabled: false });
      btn.addListener("execute", () => this.__control(action));
      this._bar.addAt(btn, this._bar.getChildren().length - 1);
      return btn;
    });

    this.__table = page._createTable([
      { id: "name", label: "Servis", width: 150 },
      { id: "state", label: "Durum", width: 130 },
      { id: "description", label: "Görevi" },
      { id: "pid", label: "PID", width: 70 },
      { id: "uptime", label: "Çalışma süresi", width: 120 },
      { id: "note", label: "Not", width: 260 }
    ]);
    this.__table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
    this.__table.getSelectionModel().addListener("changeSelection", () => this.__updateButtons());
    this.add(this.__table, { flex: 1 });

    this.__timer = new qx.event.Timer(tihamon.ui.system.Services.REFRESH_MS);
    this.__timer.addListener("interval", () => {
      if (this._isShown()) {
        this.load();
      }
    });
    this.__timer.start();
    this.addListener("disappear", () => this.__timer.stop());
    this.addListener("appear", () => this.__timer.start());
  },

  destruct() {
    this.__timer.stop();
    this.__timer.dispose();
  },

  members: {
    __table: null,
    __buttons: null,
    __timer: null,
    __services: null,
    __supervisor: null,

    async _load() {
      const data = await tihamon.io.Api.get("/system/services");
      const F = tihamon.util.Format;
      const STATE = tihamon.ui.system.Services.STATE;
      const selected = new Set(this.__selected().map(s => s.name));
      this.__services = data.services;
      this.__supervisor = data.supervisor;
      const model = this.__table.getTableModel();
      model.setData(data.services.map((s, i) => [
        i, s.name, (STATE[s.state] || [s.state])[0], s.description, s.pid || "",
        s.uptime !== null ? (s.uptime >= 86400 ? Math.floor(s.uptime / 86400) + " gün " : "") + F.duration(s.uptime % 86400) : "",
        s.spawn_error || (s.exit_status !== null && s.state !== "RUNNING" ? `çıkış kodu ${s.exit_status}` : "") ||
          (s.controllable ? "" : "🔒 " + (s.locked_reason || ""))
      ]));
      // Otomatik tazeleme seçimi bozmasın.
      const sel = this.__table.getSelectionModel();
      data.services.forEach((s, i) => selected.has(s.name) && sel.addSelectionInterval(i, i));
      this.__updateButtons();
    },

    _statusText() {
      const s = this.__services || [];
      const running = s.filter(x => x.state === "RUNNING").length;
      const bad = s.filter(x => ["FATAL", "BACKOFF", "UNKNOWN"].includes(x.state)).map(x => x.name);
      const H = tihamon.ui.system.Html;
      return (bad.length ? H.badge(`Sorunlu: ${bad.join(", ")}`, "bad") + " · " : "") +
        `${running}/${s.length} servis çalışıyor · supervisord ${qx.bom.String.escape(this.__supervisor ? this.__supervisor.version : "")}` +
        " · 5 sn'de bir tazelenir";
    },

    __selected() {
      const out = [];
      const tm = this.__table.getTableModel();
      this.__table.getSelectionModel().iterateSelection(r => {
        const s = this.__services && this.__services[tm.getValue(0, r)];
        if (s) {
          out.push(s);
        }
      });
      return out;
    },

    __updateButtons() {
      const sel = this.__selected().filter(s => s.controllable);
      const [start, stop, restart] = this.__buttons;
      start.setEnabled(sel.some(s => s.state !== "RUNNING"));
      stop.setEnabled(sel.some(s => s.state === "RUNNING"));
      restart.setEnabled(sel.length > 0);
    },

    async __control(action) {
      const targets = this.__selected().filter(s => s.controllable &&
        (action === "start" ? s.state !== "RUNNING" : action === "stop" ? s.state === "RUNNING" : true));
      if (!targets.length) {
        return;
      }
      const names = targets.map(s => s.name).join(", ");
      const verb = { start: "başlatılacak", stop: "durdurulacak", restart: "yeniden başlatılacak" }[action];
      if (action !== "start") {
        const ok = await tihamon.ui.Dialog.confirm(
          `<b>${qx.bom.String.escape(names)}</b> ${verb}. Bu sürede servisin gördüğü iş (log alma, ölçüm toplama, görevler…) kesintiye uğrar.<br><br>Devam edilsin mi?`,
          { stop: "Durdur", restart: "Yeniden başlat" }[action]);
        if (!ok) {
          return;
        }
      }
      this.__buttons.forEach(b => b.setEnabled(false));
      const errors = [];
      for (const s of targets) {
        const doing = { start: "başlatılıyor", stop: "durduruluyor", restart: "yeniden başlatılıyor" }[action];
        this._status.setValue(`${qx.bom.String.escape(s.name)} ${doing}…`);
        try {
          await tihamon.io.Api.post("/system/services", { name: s.name, action });
        } catch (e) {
          errors.push(`${s.name}: ${e.message || e}`);
        }
      }
      await this.load();
      if (errors.length) {
        tihamon.ui.Dialog.alert(errors.map(e => qx.bom.String.escape(e)).join("<br>"), "Bazı servisler yönetilemedi");
      }
    }
  }
});
