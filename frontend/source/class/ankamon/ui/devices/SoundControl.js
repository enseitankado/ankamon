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
 * Cihaz ses kontrolü (kullanıcı isteği 2026-11-24): sağ menü Yönet ▸ Ses kontrolü ▸ Sesi devre dışı bırak / Sesi etkinleştir /
 * Sesi ayarla… / Sesi sınırla… / Ses sınırını kaldır. Ekranlar kutucuğundaki ve ekran penceresindeki ses simgesine basınca da
 * aynı alt menü açılır (tek kaynak: menu()). İşi hazır işlem "sound-control" yapar (actions/sound-control/run.sh; sınır cihazda
 * systemd bekçisiyle korunur — kullanıcı sesi sınırın üstüne çıkaramaz). Durum oturum yoklamasından gelir: sound_muted,
 * sound_volume (göç 059), sound_limit (göç 060) — bkz. worker executor/soundstate.py. Yetki: devices.sound.
 */
qx.Class.define("ankamon.ui.devices.SoundControl", {
  type: "static",

  statics: {
    /** Hazır işlem kimliği (actions/sound-control). */
    ACTION: "sound-control",

    /** Menü simgeleri (Unicode — bkz. ankamon.ui.Shell.ICON başındaki not). */
    ICON: { sound: "🔊", mute: "🔇", unmute: "🔈", set: "🎚", limit: "⤒", unlimit: "⊘" },

    /**
     * Cihazın bilinen ses durumu: {muted: bool|null, volume: int|null, limit: int|null} ya da null (çevrim dışı, yoklama eski
     * ya da hiçbir değer okunamadı). Sınır oturum açık olmasa da okunur (bekçi cihazdadır).
     */
    state(device) {
      const fresh = !!device && !!device.online && !!device.session_checked_at &&
        Date.now() / 1000 - device.session_checked_at < ankamon.page.Devices.CABLE_FRESH_S;
      if (!fresh) {
        return null;
      }
      const v = x => (x === undefined ? null : x);
      const s = { muted: v(device.sound_muted), volume: v(device.sound_volume), limit: v(device.sound_limit) };
      return s.muted === null && s.volume === null && s.limit === null ? null : s;
    },

    /** Ses sütununun metni: "Kapalı", "%60", "%60 (sınır %70)", oturum yokken "sınır %70"; bilinmiyorsa boş. */
    text(device) {
      const s = this.state(device);
      if (!s) {
        return "";
      }
      const level = s.muted ? "Kapalı" : s.volume === null ? "" : "%" + s.volume;
      const limit = s.limit === null ? "" : "sınır %" + s.limit;
      return level && limit ? `${level} (${limit})` : level || limit;
    },

    /**
     * Yönet ▸ Ses kontrolü alt menüsü. Kutucuk/pencere ses simgesi de bunu açar.
     * @param online {Array} uygulanacak (çevrim içi, işlevi destekleyen) cihazlar
     * @return {qx.ui.menu.Menu|null} yetki yoksa null
     */
    menu(online, user) {
      if (!user || !(user.is_admin || user.features.includes("devices.sound"))) {
        return null;
      }
      const Ops = ankamon.ui.DeviceOps;
      const I = this.ICON;
      const menu = new qx.ui.menu.Menu();
      const n = list => (list.length > 1 ? ` (${list.length} cihaz)` : "");
      // Durumu bilinen cihazlarda yalnız uygun olanlara uygulanır; bilinmeyen cihaz iki maddede de sayılır (bkz. DeviceOps stateAdd).
      const add = (icon, label, list, handler) => {
        const btn = Ops.menuButton(icon, label + n(list), () => handler(list));
        btn.setEnabled(list.length > 0);
        menu.add(btn);
      };
      const st = b => this.state(b) || {};
      add(I.mute, "Sesi devre dışı bırak", online.filter(b => st(b).muted !== true), list => this.run(list, "mute"));
      add(I.unmute, "Sesi etkinleştir", online.filter(b => st(b).muted !== false), list => this.run(list, "unmute"));
      add(I.set, "Sesi ayarla…", online, list => this.open(list, "set"));
      menu.add(new qx.ui.menu.Separator());
      add(I.limit, "Sesi sınırla…", online, list => this.open(list, "limit"));
      add(I.unlimit, "Ses sınırını kaldır", online.filter(b => !this.state(b) || this.state(b).limit !== null),
        list => this.run(list, "unlimit"));
      return menu;
    },

    /**
     * Ses simgesine basılınca (screen/index.html "tm-soundmenu" — Ekranlar kutucuğu ya da ekran penceresi) menu()'yü
     * iframe içi (x, y) konumunda açar. Önceki açılan menü atılır.
     * @param devices {Array} uygulanacak cihazlar (çevrim dışı ve işlevi desteklemeyenler ayıklanır)
     * @param el {Element} iframe öğesi (konum ona göre)
     */
    openMenuAt(devices, user, el, x, y) {
      const P = ankamon.ui.devices.Platforms;
      const menu = this.menu(P.only("Ses kontrolü", devices.filter(b => b.online)), user);
      if (this.__menu) {
        const old = this.__menu;
        qx.event.Timer.once(() => old.destroy(), null, 0);
        this.__menu = null;
      }
      if (!menu || !el) {
        return;
      }
      this.__menu = menu;
      const rect = el.getBoundingClientRect();
      menu.openAtPoint({ left: Math.round(rect.left + x), top: Math.round(rect.top + y) });
    },

    __menu: null,

    /** Görev başlatır ve canlı çıktı penceresini açar (bkz. DeviceOps.__job). */
    run(devices, islem, level = null) {
      if (!devices.length) {
        return;
      }
      const values = { ISLEM: islem };
      if (level !== null) {
        values.DUZEY = String(level);
      }
      const captions = { mute: "Sesi devre dışı bırak", unmute: "Sesi etkinleştir", set: `Sesi ayarla — %${level}`,
        limit: `Sesi sınırla — en çok %${level}`, unlimit: "Ses sınırını kaldır" };
      ankamon.ui.Jobs.show(ankamon.io.Api.post("/jobs", { type: "action", action: this.ACTION, device_ids: devices.map(b => b.id), values })
        .then(res => res.id), captions[islem] || "Ses kontrolü");
    },

    /**
     * "Sesi ayarla…" (mode "set") ve "Sesi sınırla…" (mode "limit") penceresi: kaydırıcı + hazır düzeyler, seçili cihazlara uygular.
     */
    open(devices, mode) {
      if (!devices.length) {
        return;
      }
      const esc = qx.bom.String.escape;
      const limitMode = mode === "limit";
      const name = b => b.label || b.hostname || b.ip || "#" + b.id;
      const where = devices.length > 1 ? `${devices.length} cihaz` : name(devices[0]);
      const states = devices.map(b => this.state(b) || {});
      const known = key => states.map(s => s[key]).filter(x => x !== null && x !== undefined);
      // Başlangıç: sınırda mevcut sınır (yoksa 70), ayarda bilinen düzey (yoksa 50) — çoklu seçimde ilk bilinen.
      const start = limitMode ? (known("limit")[0] ?? 70) : Math.min(known("volume")[0] ?? 50, 100);
      const win = ankamon.ui.Dialog.window(`${limitMode ? "Sesi sınırla" : "Sesi ayarla"} — ${where}`, 440);
      win.add(new qx.ui.basic.Label(limitMode
        ? `<b>${esc(where)}</b> için en yüksek ses düzeyi. Cihazdaki kullanıcı sesi bunun üstüne çıkaramaz (yükseltirse hemen geri `
          + "çekilir); bilgisayar yeniden başlasa da sürer. Daha yüksekteki ses hemen sınıra iner. Kaldırmak: Ses kontrolü ▸ Ses sınırını kaldır."
        : `<b>${esc(where)}</b> ses düzeyi (oturum açık kullanıcının ses ayarı; oturum yoksa ses kartının ana kanalı). `
          + "Sessizdeyse sessiz kalır — açmak için: Sesi etkinleştir.").set({ rich: true, wrap: true }));
      const row = new qx.ui.container.Composite(new qx.ui.layout.HBox(10).set({ alignY: "middle" }));
      const slider = new qx.ui.form.Slider().set({ minimum: 0, maximum: 100, singleStep: 1, pageStep: 10, value: start });
      const value = new qx.ui.basic.Label("%" + start).set({ minWidth: 44, font: "bold" });
      slider.addListener("changeValue", e => value.setValue("%" + e.getData()));
      row.add(slider, { flex: 1 });
      row.add(value);
      win.add(row);
      const presets = new qx.ui.container.Composite(new qx.ui.layout.HBox(6));
      (limitMode ? [30, 50, 70, 85] : [0, 25, 50, 75, 100]).forEach(p => {
        const b = new qx.ui.form.Button("%" + p).set({ padding: [2, 8] });
        b.addListener("execute", () => slider.setValue(p));
        presets.add(b);
      });
      win.add(presets);
      const note = new qx.ui.basic.Label("").set({ rich: true, wrap: true, textColor: "app-muted" });
      const limits = known("limit");
      const updateNote = () => {
        const v = slider.getValue();
        if (!limitMode && limits.some(l => l < v)) {
          note.setValue(`Sınırı %${Math.min(...limits)} olan cihaz(lar)da düzey sınırda kalır.`);
        } else if (limitMode && v === 0) {
          note.setValue("%0 sınırı sesi tümüyle keser.");
        } else {
          note.setValue("");
        }
        note.setVisibility(note.getValue() ? "visible" : "excluded");
      };
      slider.addListener("changeValue", updateNote);
      updateNote();
      win.add(note);
      const apply = new qx.ui.form.Button(limitMode ? "Sınırla" : "Uygula");
      const cancel = new qx.ui.form.Button("Vazgeç");
      apply.addListener("execute", () => {
        win.close();
        this.run(devices, mode, slider.getValue());
      });
      cancel.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [apply, cancel]);
      win.open();
      slider.focus();
    }
  }
});
