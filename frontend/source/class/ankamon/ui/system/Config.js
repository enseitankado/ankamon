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
 * Sistem → Yapılandırma (/api/system/config): .env'den gelen ayarlar (gruplu, açıklamalı; parolalar
 * yalnız "tanımlı/tanımsız") ve veritabanında gerçekten etkin saklama/sıkıştırma politikaları.
 * Salt-okunurdur: ayarlar .env'de değiştirilip konteyner yeniden başlatılınca uygulanır.
 */
qx.Class.define("ankamon.ui.system.Config", {
  extend: ankamon.ui.system.Tab,

  construct(page) {
    super(page, "Yapılandırma");
    this.__table = page._createTable([
      { id: "group", label: "Grup", width: 140 },
      { id: "key", label: "Ayar", width: 210 },
      { id: "value", label: "Değer", width: 150 },
      { id: "description", label: "Açıklama" }
    ], { prefsKey: "system.config.columns" });
    this.add(this.__table, { flex: 1 });
    const { label, scroll } = ankamon.ui.system.Html.box();
    this.__info = label;
    scroll.setHeight(170);
    this.add(scroll);
  },

  members: {
    __table: null,
    __info: null,

    async _load() {
      const d = await ankamon.io.Api.get("/system/config");
      const H = ankamon.ui.system.Html;
      this.__table.getTableModel().setData(d.env.map((e, i) => [
        i, e.group, e.key, e.value === null ? "(varsayılan)" : e.value, e.description
      ]));
      const conf = ankamon.ui.system.Schedules.configText;
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
