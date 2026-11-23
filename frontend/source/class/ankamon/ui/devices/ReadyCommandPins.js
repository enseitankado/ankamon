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
 * Komut menüsüne sabitlenen hazır komutlar (kullanıcı isteği 2026-11-23): Komut çalıştır penceresinde bir hazır komutun
 * yanındaki "Komut menüsüne sabitle" ile seçilir; sabitlenenler sağ menünün "Komut çalıştır ▸" alt menüsünde doğrudan
 * madde olur — araç çubuğunun Komut düğmesi aynı alt menüden türediği için orada da (ui.devices.ActionBar CONTAINERS).
 * Çekirdek hazır işlemleri (/api/actions) ve eklentilerin hazır komutları (ankamon.ext.Extensions.addReadyCommandSource,
 * ör. TiHA adımları) sabitlenebilir.
 *
 * Kullanıcı başına ui_prefs["devices.commandPins"] = [{key, label, platforms}] (sıra = sabitleme sırası). key:
 * "action:<hazır işlem kimliği>" ya da "ext:<kaynak>:<kimlik>". Etiket ve aileler kayıtta durur: sağ menü eşzamanlı
 * kurulur, katalog beklenmez; tıklanınca güncel tanım alınır (silinmiş/yetkisi kalkmış komut uyarı verir). Varsayılan:
 * hiçbiri sabit değil.
 */
qx.Class.define("ankamon.ui.devices.ReadyCommandPins", {
  type: "static",

  statics: {
    PREF_KEY: "devices.commandPins",

    /** Sağ menüde sabit maddenin simgesi. */
    ICON: "★",

    /** Bir kullanıcının en çok sabitleyebileceği komut (menü uzamasın; ui_prefs değeri 16 KB sınırında kalsın). */
    MAX: 25,

    /** @return {Array} [{key, label, platforms}] */
    list(user) {
      const saved = ((user && user.ui_prefs) || {})[this.PREF_KEY];
      return Array.isArray(saved) ? saved.filter(p => p && typeof p.key === "string") : [];
    },

    isPinned(user, key) {
      return this.list(user).some(p => p.key === key);
    },

    /**
     * Sabitler ya da sabitlemeyi kaldırır. @param entry {Map} {key, label, platforms?} @return {Boolean} artık sabit mi
     */
    toggle(user, entry) {
      const pins = this.list(user);
      const at = pins.findIndex(p => p.key === entry.key);
      if (at >= 0) {
        pins.splice(at, 1);
      } else {
        if (pins.length >= this.MAX) {
          ankamon.ui.Dialog.alert(`Komut menüsüne en çok ${this.MAX} hazır komut sabitlenebilir; önce birinin sabitlemesini kaldırın.`);
          return false;
        }
        pins.push({ key: entry.key, label: String(entry.label || entry.key).slice(0, 160), platforms: entry.platforms || null });
      }
      ankamon.page.Base.savePref(user, this.PREF_KEY, pins.length ? pins : null);
      return at < 0;
    },

    /** Sabitlenmiş kaydın etiketi değişmişse (hazır işlemin adı güncellendi) tazeler — Komut çalıştır penceresi açılınca. */
    refreshLabels(user, entries) {
      const pins = this.list(user);
      let changed = false;
      pins.forEach(p => {
        const e = entries.find(x => x.key === p.key);
        if (e && (e.label !== p.label || JSON.stringify(e.platforms || null) !== JSON.stringify(p.platforms || null))) {
          p.label = e.label;
          p.platforms = e.platforms || null;
          changed = true;
        }
      });
      if (changed) {
        ankamon.page.Base.savePref(user, this.PREF_KEY, pins);
      }
    },

    /** Sabitin kaynağı şu an kullanılabilir mi (eklenti kapalıysa / kaldırıldıysa o eklentinin sabitleri gösterilmez). */
    __available(pin, user) {
      const can = feature => user.is_admin || (user.features || []).includes(feature);
      if (pin.key.startsWith("action:")) {
        return can("actions");
      }
      const m = /^ext:([^:]*):/.exec(pin.key);
      return !!m && ankamon.ext.Extensions.hasReadyCommandSource(m[1]);
    },

    /**
     * Sağ menünün "Komut çalıştır" alt menüsüne sabit maddeleri ekler (ayırıcıdan sonra). DeviceOps.menu çağırır.
     * @param menu {qx.ui.menu.Menu} Komut çalıştır alt menüsü
     * @param devices {Array} uygulanacak cihazlar
     */
    addMenuItems(menu, devices, user) {
      const pins = this.list(user).filter(p => this.__available(p, user));
      if (!pins.length) {
        return;
      }
      if (menu.getChildren().length) {
        menu.add(new qx.ui.menu.Separator());
      }
      const count = devices.length > 1 ? ` (${devices.length} cihaz)` : "";
      pins.forEach(pin => {
        const item = ankamon.ui.DeviceOps.menuButton(this.ICON, pin.label + count, () => this.run(pin, devices, user));
        // Araç çubuğu maddeyi kendi anahtarıyla Komut düğmesine koyar (ITEMS'ta olmayan madde kapsayıcısının grubuna düşer).
        item.setUserData("ankamon.menuKey", pin.label);
        item.setUserData("ankamon.platforms", pin.platforms || ["linux"]);
        item.setUserData("ankamon.commandPin", pin.key);
        item.setToolTipText("Komut menüsüne sabitlenmiş hazır komut (Hazır / Serbest komut çalıştır penceresinden sabitlenir ya da kaldırılır).");
        menu.add(item);
      });
    },

    /** Sabit maddeye tıklandı: güncel tanımı alır ve çalıştırır (parametresi varsa önce parametre penceresi). */
    async run(pin, devices, user) {
      if (!devices.length) {
        return;
      }
      try {
        if (pin.key.startsWith("action:")) {
          const id = pin.key.slice("action:".length);
          const actions = (await ankamon.io.Api.get("/actions")).actions || [];
          const action = actions.find(a => a.id === id);
          if (!action) {
            ankamon.ui.Dialog.alert(`«${qx.bom.String.escape(pin.label)}» hazır komutu artık yok ya da çalıştırma yetkiniz yok.`);
            return;
          }
          ankamon.ui.DeviceOps.runReadyAction(action, devices, user);
          return;
        }
        const entry = (await ankamon.ext.Extensions.readyCommands(user)).find(e => e.key === pin.key);
        if (!entry) {
          ankamon.ui.Dialog.alert(`«${qx.bom.String.escape(pin.label)}» hazır komutu artık yok (eklenti kapalı ya da adım kaldırılmış).`);
          return;
        }
        entry.run(devices, user);
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    }
  }
});
