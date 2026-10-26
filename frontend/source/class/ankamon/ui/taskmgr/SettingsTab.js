/**
 * Ayarlar (Windows 11 Görev Yöneticisi gibi): varsayılan başlangıç sayfası, gerçek zamanlı güncelleme hızı
 * (Yüksek 0,5 sn / Normal 1 sn / Düşük 4 sn / Duraklatıldı), her zaman üstte, bellek değerleri (değer/yüzde).
 * Kullanıcı başına sunucuda saklanır (users.ui_prefs["taskmgr.settings"]).
 */
qx.Class.define("ankamon.ui.taskmgr.SettingsTab", {
  extend: ankamon.ui.taskmgr.Tab,

  statics: {
    SPEEDS: [["Yüksek (0,5 sn)", 0.5], ["Normal (1 sn)", 1], ["Düşük (4 sn)", 4], ["Duraklatıldı", 0]]
  },

  construct(win) {
    super(win, "Ayarlar", "settings");
    const s = win.getSettings();
    const form = new qx.ui.container.Composite(new qx.ui.layout.Grid(12, 10)).set({ maxWidth: 640 });
    form.getLayout().setColumnFlex(1, 1);
    let row = 0;
    const label = text => form.add(new qx.ui.basic.Label(text).set({ alignY: "middle" }), { row, column: 0 });

    label("Varsayılan başlangıç sayfası");
    const start = new qx.ui.form.SelectBox();
    win.getTabKeys().filter(([k]) => k !== "settings").forEach(([k, l]) => {
      const it = new qx.ui.form.ListItem(l, null, k);
      start.add(it);
      if (k === (s.startTab || "processes")) {
        start.setSelection([it]);
      }
    });
    start.addListener("changeSelection", e => win.setSetting("startTab", e.getData()[0].getModel()));
    form.add(start, { row: row++, column: 1 });

    label("Gerçek zamanlı güncelleme hızı");
    const speed = new qx.ui.form.SelectBox();
    ankamon.ui.taskmgr.SettingsTab.SPEEDS.forEach(([l, v]) => {
      const it = new qx.ui.form.ListItem(l, null, v);
      speed.add(it);
      if (v === (s.interval ?? 1)) {
        speed.setSelection([it]);
      }
    });
    speed.addListener("changeSelection", e => win.setSpeed(e.getData()[0].getModel()));
    this.__speed = speed;
    form.add(speed, { row: row++, column: 1 });

    const onTop = new qx.ui.form.CheckBox("Her zaman üstte").set({ value: !!s.onTop });
    onTop.addListener("changeValue", e => win.setSetting("onTop", e.getData()));
    form.add(onTop, { row: row++, column: 1 });

    const memPct = new qx.ui.form.CheckBox("İşlemler'de belleği yüzde olarak göster").set({ value: !!s.memPct });
    memPct.addListener("changeValue", e => win.setSetting("memPct", e.getData()));
    form.add(memPct, { row: row++, column: 1 });

    this.add(form);
    this.add(new qx.ui.basic.Label(
      "Görev yöneticisi açık kaldıkça tahtaya tek bir canlı SSH bağlantısı tutulur ve tahtada küçük bir ölçüm ajanı çalışır " +
      "(normal hızda tahta işlemcisinin yaklaşık %1–3'ü). Pencere kapanınca ya da sayfa yenilenince bağlantı ve ajan sonlanır. " +
      "Değişiklik yapan her işlem (sonlandırma, öncelik, hizmet, başlangıç, oturum) kim tarafından yapıldığıyla işlem kaydına yazılır."
    ).set({ rich: true, textColor: "app-muted", maxWidth: 640, marginTop: 16 }));
  },

  members: {
    __speed: null,

    /** Araç çubuğundan hız değişince seçimi eşitler. */
    syncSpeed(v) {
      const it = this.__speed.getSelectables().find(x => x.getModel() === v);
      if (it) {
        this.__speed.setSelection([it]);
      }
    },

    // overridden
    update(m) {}
  }
});
