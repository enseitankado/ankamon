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
 * İşletim sistemine göre işlevler (kullanıcı isteği 2026-11-12 — tanım: platforms/catalog.json, platforms/README.md).
 *
 * Cihazın ailesi (linux | windows | macos | other) sunucudan gelir (DevicesApi os_family — göç 052: elle > SSH bilgisi > ağ
 * taraması); bilinmiyorsa kataloğun default_family'si. Bir menü maddesi (DeviceOps.menuButton anahtarı) kataloğun hangi
 * işlevindeyse o işlevin impl'inde adı olan aileler desteklenir; katalogda olmayan madde unknown_function_families'de.
 *
 * - only(anahtar, cihazlar): maddenin uygulanacağı cihazlar (desteklemeyenler çıkar) — DeviceOps.menu işleyicileri kullanır.
 * - decorate(menu, cihazlar): sağ menü (dolayısıyla araç çubuğu — aynı maddeler) — hiçbir seçili cihaz desteklemiyorsa madde
 *   devre dışı ve ipucu hangi sistem(ler)de tanımsız olduğunu söyler; kısmen destekliyorsa ipucu atlanacakları söyler.
 * İşlevin adı aynı kalır; hangi komutun/kodun çalışacağını worker hedefin ailesine göre seçer (bkz. runner _platform_skip).
 */
qx.Class.define("ankamon.ui.devices.Platforms", {
  type: "static",

  statics: {
    /** Katalog gelmeden önce: bugüne dek olduğu gibi her şey Linux. */
    FALLBACK: {
      families: { linux: { label: "Linux", shell: "bash", script: "run.sh" } },
      family_order: ["linux"], default_family: "linux", unknown_function_families: ["linux"], functions: []
    },

    __catalog: null,
    __byKey: null,
    __loading: null,

    /** Kataloğu bir kez yükler (GET /api/platforms); tekrar çağrı aynı sözü döndürür. */
    load() {
      if (!this.__loading) {
        this.__loading = ankamon.io.Api.get("/platforms").then(cat => {
          this.__catalog = cat;
          this.__byKey = {};
          (cat.functions || []).forEach(fn => (fn.menu || []).forEach(key => (this.__byKey[key] = fn)));
          return cat;
        }).catch(e => {
          this.__loading = null; // sonraki çağrıda yeniden denensin
          throw e;
        });
      }
      return this.__loading;
    },

    catalog() {
      if (!this.__catalog) {
        this.load().catch(() => {});
      }
      return this.__catalog || this.FALLBACK;
    },

    familyOf(device) {
      return (device && device.os_family) || this.catalog().default_family || "linux";
    },

    label(family) {
      const fam = this.catalog().families[family];
      return fam ? fam.label : family || "bilinmiyor";
    },

    /** Menü anahtarının (etiketi, cihaz sayısı eki olmadan) katalogdaki işlevi; yoksa null. */
    functionOf(key) {
      this.catalog();
      return (this.__byKey && this.__byKey[key]) || null;
    },

    supports(key, family) {
      const fn = this.functionOf(key);
      return fn ? !!(fn.impl && fn.impl[family]) : (this.catalog().unknown_function_families || ["linux"]).includes(family);
    },

    /** Maddenin uygulanacağı cihazlar: işlevin ailesinde uygulaması olanlar. */
    only(key, devices) {
      return (devices || []).filter(b => this.supports(key, this.familyOf(b)));
    },

    /** Cihazların aile dağılımı: [[aile, sayı], …] katalog sırasıyla. */
    counts(devices) {
      const order = this.catalog().family_order || [];
      const map = new Map();
      (devices || []).forEach(b => {
        const f = this.familyOf(b);
        map.set(f, (map.get(f) || 0) + 1);
      });
      return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    },

    /** "3 Linux · 2 Windows" */
    summary(devices) {
      return this.counts(devices).map(([f, n]) => `${n} ${this.label(f)}`).join(" · ");
    },

    /** Cihazın OS'ini anlatan kısa metin (grid hücresi / ipucu): "Windows — Microsoft Windows 10 (ağ taraması)". */
    describe(device) {
      const source = { manual: "elle seçildi", ssh: "SSH bilgisi", scan: "ağ taraması tahmini" }[device.os_source] || "varsayılan";
      return `${this.label(this.familyOf(device))}${device.os_name ? " — " + device.os_name : ""} (${source})`;
    },

    /**
     * Menü maddelerini seçili cihazların işletim sistemine göre işaretler (alt menüler dahil). Desteklemeyen
     * maddeler devre dışı + ipucu; kısmen desteklenenlerde ipucu ve sayı eki (N cihaz) desteklenenlere göre.
     */
    decorate(menu, devices) {
      if (!menu || !devices || !devices.length) {
        return menu;
      }
      menu.getChildren().forEach(item => {
        if (!(item instanceof qx.ui.menu.AbstractButton)) {
          return;
        }
        const sub = item.getMenu && item.getMenu();
        if (sub) {
          this.decorate(sub, devices);
        }
        const key = item.getUserData("ankamon.menuKey");
        if (!key || sub) {
          return;
        }
        const yes = this.only(key, devices);
        const no = devices.filter(b => !yes.includes(b));
        if (!no.length) {
          return;
        }
        const missing = this.counts(no).map(([f, n]) => `${this.label(f)}${devices.length > 1 ? ` (${n})` : ""}`).join(", ");
        item.setShowToolTipWhenDisabled(true);
        if (!yes.length) {
          item.setEnabled(false);
          item.setToolTipText(`«${key}» işlevinin ${missing} için uygulaması tanımlı değil (işletim sistemine göre — bkz. ` +
            "Komut ▸ işletim sistemi tanımı). Düzenle ▸ İşletim sistemi ile cihazın sistemi değiştirilebilir.");
          return;
        }
        item.setToolTipText(`Yalnız ${this.summary(yes)} cihazda uygulanır; ${missing} cihazda bu işlev tanımlı değil, atlanır.`);
        // "… (N cihaz)" ekini desteklenen sayıya indir (etiket ilk N'yi tüm seçimden saymıştı).
        const icon = item.getUserData("ankamon.menuIcon");
        const label = String(item.getLabel() || "");
        const m = /\((\d+) cihaz\)\s*$/.exec(label.replace(/<[^>]+>/g, ""));
        if (m && Number(m[1]) === devices.length) {
          const text = yes.length > 1 ? `${key} (${yes.length} cihaz)` : key;
          item.setLabel(`<span style="display:inline-block;width:1.4em;text-align:center">${icon || ""}</span>` + qx.bom.String.escape(text));
        }
      });
      return menu;
    }
  }
});
