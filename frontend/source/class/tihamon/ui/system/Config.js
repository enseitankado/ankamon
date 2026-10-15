/**
 * Sistem → Yapılandırma (/api/system/config): .env'den gelen ayarlar (gruplu, açıklamalı; parolalar
 * yalnız "tanımlı/tanımsız") ve veritabanında gerçekten etkin saklama/sıkıştırma politikaları.
 * Salt-okunurdur: ayarlar .env'de değiştirilip konteyner yeniden başlatılınca uygulanır.
 */
qx.Class.define("tihamon.ui.system.Config", {
  extend: tihamon.ui.system.Tab,

  construct(page) {
    super(page, "Yapılandırma");
    this.__table = page._createTable([
      { id: "group", label: "Grup", width: 140 },
      { id: "key", label: "Ayar", width: 210 },
      { id: "value", label: "Değer", width: 150 },
      { id: "description", label: "Açıklama" }
    ]);
    this.add(this.__table, { flex: 1 });
    const { label, scroll } = tihamon.ui.system.Html.box();
    this.__info = label;
    scroll.setHeight(170);
    this.add(scroll);
  },

  members: {
    __table: null,
    __info: null,

    async _load() {
      const d = await tihamon.io.Api.get("/system/config");
      const H = tihamon.ui.system.Html;
      this.__table.getTableModel().setData(d.env.map((e, i) => [
        i, e.group, e.key, e.value === null ? "(varsayılan)" : e.value, e.description
      ]));
      const conf = tihamon.ui.system.Schedules.configText;
      this.__info.setValue(H.keyValue([
        {
          title: "Veritabanında etkin politikalar",
          rows: d.policies.map(p => [`${p.table} — ${p.kind}`, conf(p.config)])
        },
        {
          title: "Değiştirmek için", rows: [[
            "Yöntem",
            "Proje dizinindeki .env dosyasında değeri düzenleyin, ardından: docker compose up -d " +
            "(saklama süreleri açılışta veritabanı politikalarına yeniden uygulanır). Tahta SSH/Samba bilgileri Ayarlar sayfasından değişir."
          ]]
        }
      ]));
    },

    _statusText() {
      return "Salt-okunur · parolalar gösterilmez";
    }
  }
});
