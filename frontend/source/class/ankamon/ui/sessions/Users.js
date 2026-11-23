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
 * Oturumlar sayfasının "Zaman çizelgesi" sekmesi (eski adı "Kullanıcılar"): kullanıcıların hangi cihazda, ne zaman, ne kadar
 * süre oturum açtığını (ve hangilerinin düzgün kapanmadığını) zaman çizelgesinde gösterir.
 *
 * Veri, Oturumlar sekmesiyle aynı (/device-sessions — page.Sessions çeker, setData ile verir);
 * süzme ve özetleme tamamen istemcide yapılır.
 *  - Süzgeçler (Cihaz, Kullanıcı, Tür) aralık düğmelerinin satırında; zaman çizelgesini süzer. Eski özet tablosu
 *    (cihaz × kullanıcı × tür) kaldırıldı (kullanıcı isteği 2026-11-23) — süzgeç arayüzü aynı kaldı (__filters).
 *  - "Satırlar" (çizelgede cihazlar / kullanıcılar) ve "Yalnız düzgün kapanmayanlar" aralık düğmelerinin satırında.
 *  - Aralık: hazır düğmeler + çizelgede sürükleme; tekerlek dikey kaydırır, Ctrl+tekerlek yakınlaştırır (bkz. Timeline).
 *    Özet HER ZAMAN görünen aralığa göre hesaplanır (aralığı taşan oturumların yalnız aralık içindeki süresi).
 *  - "Satırlar: Cihazlar" görünümünde cihazın KAPALI olduğu aralıklar satırda gri taralı arka plan
 *    olarak görünür (kurum kapalıyken boşluk ile "kimse oturum açmadı"yı ayırır — bkz. __loadUptime).
 *  - Çubuğa sağ tıklama süzme
 *    ve (açık cihaz oturumunda, "devices.login" yetkisiyle) oturumu kapat/kilitle menüsü açar.
 *  - Satır (çizelgedeki satır adı) sağ menüsü: süzgece alma; Cihazlar'a kayıtlı olmayan
 *    bilgisayarda ("sessions.hosts" yetkisiyle) onaylı "Bu bilgisayarın kayıtlarını sil".
 *
 * "Düzgün kapanmadı": kapanış mesajı gelmeden cihaz çevrimdışı oldu (offline — elektrik kesintisi,
 * güç düğmesiyle kapatma) ya da kapanmadan yeni oturum açıldı (superseded) ya da web terminal
 * hizmeti yeniden başladı (restart) — bkz. worker/ankamon/tasks/device_sessions.py.
 */
qx.Class.define("ankamon.ui.sessions.Users", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} */
  construct(page) {
    super("Zaman çizelgesi");
    // Sekme kimliği (sol ağaç yaprağı, hatırlanan sekme) etiketten bağımsız — bkz. ui.Shell PAGES "sessions".
    this.setUserData("key", "timeline");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(6));
    this.setPadding(8);

    // Çizelge satırları ve "yalnız düzgün kapanmayanlar": alttaki aralık satırında (tablonun üstünde ayrı satır yok).
    this.__groupBy = this.__select([["device", "Cihazlar"], ["user", "Kullanıcılar"]]).set({ width: 120 });
    this.__groupBy.addListener("changeSelection", () => this.__changed());
    this.__badOnly = new qx.ui.form.CheckBox("Yalnız düzgün kapanmayanlar").set({ alignY: "middle" });
    this.__badOnly.addListener("changeValue", () => this.__changed());

    const ranges = new qx.ui.container.Composite(new qx.ui.layout.Flow(6, 6).set({ alignY: "middle" }));
    const day = 24 * 3600 * 1000;
    const rangeButton = (label, handler) => {
      const b = new qx.ui.form.Button(label).set({ padding: [3, 9], font: "small" });
      b.addListener("execute", handler);
      ranges.add(b);
    };
    const last = ms => () => this.__timeline.setWindow(new Date(Date.now() - ms), new Date(Date.now() + ms / 50));
    rangeButton("Son 24 saat", last(day));
    rangeButton("Son 7 gün", last(7 * day));
    rangeButton("Son 30 gün", last(30 * day));
    rangeButton("Bu ay", () => {
      const now = new Date();
      this.__timeline.setWindow(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1));
    });
    rangeButton("Tümü", () => this.__timeline.fit());
    ranges.add(new qx.ui.basic.Label("Satırlar:").set({ alignY: "middle", marginLeft: 12 }));
    ranges.add(this.__groupBy);
    ranges.add(this.__badOnly.set({ marginLeft: 8 }));
    const S = ankamon.ui.sessions.Users.STATES;
    // Kutu boyutu satır içi: Timeline CSS'i sonradan yüklendiğinden etiket genişliği o olmadan
    // ölçülür ve son maddeler kırpılırdı (renkler sınıftan gelir, ölçüyü etkilemez).
    const chip = cls => `<span class="tm-legend ${cls}" style="display:inline-block;width:12px;height:12px;` +
      "box-sizing:border-box;border:1px solid;border-radius:2px;vertical-align:-2px;margin:0 4px 0 10px\"></span>";
    // Renk açıklamaları satırda çok yer kaplıyordu (kullanıcı bildirimi): üzerine gelince ipucunda, alt alta.
    const legend = Object.keys(S).map(k => chip("tm-s-" + k) + S[k]).concat(chip("tm-off") + "Cihaz kapalı")
      .map(line => `<div style="margin:2px 0">${line}</div>`).join("");
    const legendTip = new qx.ui.tooltip.ToolTip(legend).set({ rich: true, showTimeout: 100 });
    ranges.add(new qx.ui.basic.Label("ⓘ Renkler").set({
      alignY: "middle", textColor: "app-muted", marginLeft: 10, toolTip: legendTip, cursor: "help"
    }));

    this.__summary = new qx.ui.basic.Label("").set({ rich: true });

    // Yerleşim: aralık düğmeleri + süzgeçler + özet + zaman çizelgesi (özet tablosu 2026-11-23'te kaldırıldı).
    this.__timeline = new ankamon.ui.sessions.Timeline();
    this.__timeline.addListener("changeRange", e => this.__summarize(e.getData()));
    this.__timeline.addListener("itemContextmenu", e => this.__itemMenu(e.getData()));
    this.__timeline.addListener("itemClick", e => this.__openShot(e.getData().item));
    this.__timeline.addListener("groupContextmenu", e => {
      const data = e.getData();
      this.__openMenu(this.__groupMenu(data.group), data.event);
    });
    const lower = new qx.ui.container.Composite(new qx.ui.layout.VBox(6)).set({ paddingTop: 6 });
    lower.add(ranges);
    // "Gece saatlerini gizle" (kullanıcı isteği): özet satırının sonunda, varsayılan işaretli; seçim
    // kullanıcı başına sunucuda (users.ui_prefs["timeline.nights.show"] — yalnız işaret kaldırılınca yazılır).
    const T = ankamon.ui.sessions.Timeline;
    const prefs = page._user.ui_prefs || {};
    const nights = new qx.ui.form.CheckBox(`Gece saatlerini gizle (${T.nightHoursText()})`).set({
      value: prefs[ankamon.ui.sessions.Users.PREF_SHOW_NIGHTS] !== true, alignY: "middle", marginLeft: 12,
      toolTipText: "Her günün bu saatleri çizelgede gösterilmez; gündüzler yan yana gelir, böylece görünen alan daha verimli kullanılır."
    });
    this.__timeline.setNightsHidden(nights.getValue());
    nights.addListener("changeValue", e => {
      this.__timeline.setNightsHidden(e.getData());
      ankamon.page.Base.savePref(page._user, ankamon.ui.sessions.Users.PREF_SHOW_NIGHTS, e.getData() ? null : true);
    });
    const summaryRow = new qx.ui.container.Composite(new qx.ui.layout.HBox().set({ alignY: "middle" }));
    summaryRow.add(this.__summary, { flex: 0 });
    summaryRow.add(nights);
    lower.add(summaryRow);
    lower.add(this.__timeline, { flex: 1 });

    // Süzgeçler (eski özet tablosunun Cihaz/Kullanıcı/Tür sütun süzgeçleri — aynı arayüz: getValue/setValue, Base.filterMatch
    // sözdizimi; sağ menüdeki "Yalnız bu …" ve "Oturum geçmişi" bunları ayarlar).
    const KIND = ankamon.ui.sessions.Users.KIND;
    const textFilter = (placeholder, hint) => {
      const field = new qx.ui.form.TextField().set({ placeholder, width: 140, liveUpdate: true, toolTipText: hint, alignY: "middle" });
      field.addListener("changeValue", () => this.__filtersChanged());
      return field;
    };
    const kindBox = this.__select([["device", KIND.device], ["webshell", KIND.webshell], ["", "Tüm türler"]]).set({ width: 130 });
    kindBox.addListener("changeSelection", () => this.__filtersChanged());
    this.__filters = {
      device: textFilter("Cihaz süz…", "Cihaz (ya da kayıtlı olmayan bilgisayar) adına göre süzer"),
      user: textFilter("Kullanıcı süz…", "Oturumu açan kullanıcıya göre süzer"),
      kind: {
        getValue: () => {
          const k = this.__value(kindBox);
          return k ? `"${KIND[k]}"` : "";
        },
        setValue: v => this.__selectValue(kindBox, Object.keys(KIND).find(k => `"${KIND[k]}"` === v) || "")
      }
    };
    ranges.add(new qx.ui.basic.Label("Süz:").set({ alignY: "middle", marginLeft: 12 }));
    ranges.add(this.__filters.device);
    ranges.add(this.__filters.user);
    ranges.add(kindBox);
    this.add(lower, { flex: 1 });
  },

  statics: {
    /** Tür süzgecinin metinleri. */
    KIND: { device: "Cihaz oturumu", webshell: "Web terminal" },

    /** ui_prefs anahtarı: true = gece saatleri de gösterilsin (varsayılan: gizli). */
    PREF_SHOW_NIGHTS: "timeline.nights.show",

    /** Çubuk renkleri (CSS: ui.sessions.Timeline.CSS, sınıf "tm-s-<anahtar>") ve açıklamaları. */
    STATES: {
      ok: "Düzgün kapandı",
      open: "Açık",
      locked: "Açık (kilitli)",
      offline: "Kapanmadı: cihaz çevrimdışı oldu",
      superseded: "Kapanmadı: yeni oturum açıldı",
      web: "Web terminal"
    },

    /** Düzgün kapanmayan oturum mu (bkz. sınıf başı not). */
    isBad(s) {
      // power_loss/network: kontrolsüz kapanış; otomatik kapanma, kapatma, yeniden başlatma düzgün sayılır (bkz. tasks/session_end.py).
      return ["offline", "superseded", "restart", "power_loss", "network"].includes(s.end_reason);
    },

    state(s) {
      if (!s.ended_at) {
        return s.locked ? "locked" : "open";
      }
      if (["offline", "restart", "power_loss", "network"].includes(s.end_reason)) {
        return "offline";
      }
      if (s.end_reason === "superseded") {
        return "superseded";
      }
      return s.kind === "webshell" ? "web" : "ok";
    }
  },

  members: {
    __page: null,
    __filters: null,
    __pendingDevice: null,
    __groupBy: null,
    __badOnly: null,
    __summary: null,
    __timeline: null,
    __sessions: null,
    __shown: null,
    __rows: null,
    __range: null,
    __uptime: null,
    __uptimeLoading: false,
    __updatingOptions: false,
    __framed: false,
    __lessons: null,
    __lessonsAt: 0,
    __shots: null,

    /** Ekran görüntüleri (bkz. ankamon.ui.sessions.ScreenshotViewer): oturum kayıtlarından bağımsız, çizelgede işaret olarak. */
    async __loadShots() {
      try {
        const shots = (await ankamon.io.Api.get("/screenshots")).screenshots;
        if (JSON.stringify(shots) !== JSON.stringify(this.__shots)) {
          this.__shots = shots;
          if (!this.isDisposed()) {
            this.__render();
          }
        }
      } catch (e) {
        // görüntü listesi okunamazsa çizelge oturumlarla çalışmaya devam eder
      }
    },

    /** Süzgece uyan görüntülerin çizelge öğeleri; satırlar `groups`a eklenir (oturumu olmayan cihaz/kişi de görünsün). */
    __shotItems(groups, byDevice, badOnly) {
      const f = this.__textFilters();
      if (badOnly || !ankamon.page.Base.filterMatch(ankamon.ui.sessions.Users.KIND.device, f.kind)) {
        return [];
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const M = ankamon.page.Base.filterMatch;
      return (this.__shots || []).filter(s => M(s.device_name, f.device) && (!f.user || M(s.session_username || "", f.user))).map(s => {
        const group = byDevice ? (s.device_id ? "b" + s.device_id : "h" + s.device_name) : "device:" + (s.session_username || "");
        if (!groups.has(group)) {
          groups.set(group, byDevice ? s.device_name : (s.session_username || "(oturum yok)"));
        }
        return {
          id: "s:" + s.id, group, type: "box", start: new Date(s.taken_at * 1000), content: "📷", className: "tm-shot",
          title: `<b>Ekran görüntüsü</b> · ${esc(s.device_name)}<br>Oturum: ${esc(s.session_username || "yok")}<br>` +
            `${F.dateTime(s.taken_at * 1000)} · çeken: ${esc(s.taken_by)}`
        };
      });
    },

    __shotOf(item) {
      return String(item).startsWith("s:") ? (this.__shots || []).find(s => "s:" + s.id === item) : null;
    },

    /** Çizelgede görüntü işaretine tıklama: kalıcı pencerede normal boyutta. */
    __openShot(item) {
      const shot = this.__shotOf(item);
      if (shot) {
        ankamon.ui.sessions.ScreenshotViewer.open(shot, this.__page._can("logs.manage"), () => this.__loadShots());
      }
    },

    /** @param sessions {Array} /device-sessions yanıtındaki satırlar */
    setData(sessions) {
      this.__sessions = sessions;
      this.__loadShots();
      if (this.__pendingDevice) {
        this.__applyDevice();
      } else {
        this.__render();
      }
      this.__loadLessons();
    },

    /** Ders saatleri (Ayarlar ▸ Ders saatleri): en çok dakikada bir yeniden okunur; değişince çizelge yeniden kurulur. */
    async __loadLessons() {
      if (this.__lessonsAt && Date.now() - this.__lessonsAt < 60000) {
        return;
      }
      this.__lessonsAt = Date.now();
      try {
        const value = await ankamon.io.Api.get("/lesson-times");
        if (JSON.stringify(value) !== JSON.stringify(this.__lessons)) {
          this.__lessons = value;
          this.__render();
        }
      } catch (e) {
        // ders saatleri okunamazsa ipucu yalnız ders satırları olmadan gösterilir
      }
    },

    /**
     * Oturumun denk geldiği ders saatleri, ipucunda alt alta (kullanıcı isteği): "1. ders (08:30–09:10):
     * 5 dk sonra açıldı, bitimden 2 dk önce kapandı". Yalnız ders günlerinde; birden çok güne yayılan
     * oturumda satır başına tarih eklenir, çok uzun listeler kısaltılır.
     * @param s {Map} oturum  @param end {Number} bitiş (sn; açık oturumda şimdi)
     * @return {String} HTML ("" — ders tanımlı değilse)
     */
    __lessonLines(s, end) {
      const L = this.__lessons;
      if (!L || !L.lessons || !L.lessons.length) {
        return "";
      }
      const F = ankamon.util.Format;
      const esc = qx.bom.String.escape;
      const min = ankamon.ui.LessonTimesEditor.minutes;
      const dur = sec => F.duration(sec);
      const lines = [];
      const day = new Date(s.started_at * 1000);
      day.setHours(0, 0, 0, 0);
      const multiDay = new Date(end * 1000).toDateString() !== day.toDateString();
      for (let d = 0; d < 14 && day.getTime() / 1000 < end; d++, day.setDate(day.getDate() + 1)) {
        const weekday = day.getDay() || 7; // 1=Pzt … 7=Paz
        if (!(L.days || []).includes(weekday)) {
          continue;
        }
        const base = day.getTime() / 1000;
        L.lessons.forEach(l => {
          const ls = base + min(l.start) * 60;
          const le = base + min(l.end) * 60;
          if (s.started_at >= le || end <= ls) {
            return;
          }
          const open = s.started_at > ls ? `${dur(s.started_at - ls)} sonra açıldı` : "başında açıktı";
          let close;
          if (!s.ended_at && end < le) {
            close = "hâlâ açık";
          } else if (end < le) {
            close = `bitimden ${dur(le - end)} önce kapandı`;
          } else {
            close = "sonuna kadar açık kaldı";
          }
          const date = multiDay ? `${day.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} · ` : "";
          lines.push(`${date}<b>${esc(l.name)}</b> <span style="opacity:.7">(${l.start}–${l.end})</span>: ${open}, ${close}`);
        });
      }
      if (!lines.length) {
        return "<br><i>Ders saati dışında</i>";
      }
      const MAX = 12;
      const extra = lines.length > MAX ? `<br>… ${lines.length - MAX} ders daha` : "";
      return "<br>" + lines.slice(0, MAX).join("<br>") + extra;
    },

    /**
     * "Oturum geçmişi" (Oturumlar sekmesindeki sağ menü): o kullanıcıyı süzer, satırları cihazlara
     * göre gruplar ve aralığı kullanıcının bütün oturumlarını kapsayacak şekilde ayarlar.
     */
    showUser(username, kind) {
      this.__updatingOptions = true;
      try {
        this.__setFilter("kind", ankamon.ui.sessions.Users.KIND[kind === "webshell" ? "webshell" : "device"]);
        this.__setFilter("user", username);
        this.__setFilter("device", "");
        this.__selectValue(this.__groupBy, "device");
        this.__badOnly.setValue(false);
      } finally {
        this.__updatingOptions = false;
      }
      this.__render();
      this.__timeline.fit();
    },

    /**
     * Cihazlar/Ekranlar sağ menüsü "Oturum geçmişi" (bkz. page.Sessions.openWith): yalnız o cihaz — tür süzgeci boş
     * (web terminal dahil), satırlar kullanıcılara göre, aralık cihazın bütün oturumlarını kapsar. Veri henüz
     * gelmediyse (sayfa ilk açılıyor) setData'da uygulanır.
     * @param device {Map} {id, name}
     */
    showDevice(device) {
      this.__pendingDevice = device;
      if (this.__sessions) {
        this.__applyDevice();
      }
    },

    __applyDevice() {
      const device = this.__pendingDevice;
      this.__pendingDevice = null;
      this.__updatingOptions = true;
      try {
        this.__setFilter("kind", "");
        this.__setFilter("user", "");
        this.__setFilter("device", device.name);
        this.__selectValue(this.__groupBy, "user");
        this.__badOnly.setValue(false);
      } finally {
        this.__updatingOptions = false;
      }
      this.__render();
      this.__timeline.fit();
    },

    __select(pairs) {
      const box = new qx.ui.form.SelectBox();
      pairs.forEach(([value, label]) => box.add(new qx.ui.form.ListItem(label, null, value)));
      return box;
    },

    __value(box) {
      const item = box.getSelection()[0];
      return item ? item.getModel() : "";
    },

    __selectValue(box, value) {
      const item = box.getSelectables(true).find(i => i.getModel() === value);
      if (item) {
        box.setSelection([item]);
      }
    },

    __deviceKey(s) {
      return s.device_id ? "b" + s.device_id : "h" + (s.host || "");
    },

    /** Sütun süzgecini tek değere (tam eşleşme: "değer") ayarlar; boş değer süzgeci temizler. */
    __setFilter(id, value) {
      this.__filters[id].setValue(value ? `"${value}"` : "");
    },

    /** Cihaz / Kullanıcı / Tür süzgeç metinleri (çizelgeyi süzenler). */
    __textFilters() {
      const get = id => (this.__filters[id].getValue() || "").trim();
      return { device: get("device"), user: get("user"), kind: get("kind") };
    },

    /** Süzgeçte tek değer seçiliyse o değer (ör. hareketler için kullanıcı adı), yoksa null. */
    __single(id) {
      const values = ankamon.page.Base.parseChoices(this.__filters[id].getValue());
      return values && values.length === 1 ? values[0] : null;
    },

    __sessionMatches(s, f) {
      const M = ankamon.page.Base.filterMatch;
      return M(s.device || s.host || "?", f.device) && M(s.username, f.user) &&
        M(ankamon.ui.sessions.Users.KIND[s.kind] || s.kind, f.kind);
    },

    /** Süzgeç değişti: çizelge yeniden çizilir. */
    __filtersChanged() {
      if (this.__updatingOptions) {
        return;
      }
      if (JSON.stringify(this.__textFilters()) !== this.__lastText) {
        this.__render();
      }
    },

    __lastText: null,

    __changed() {
      if (this.__updatingOptions) {
        return;
      }
      this.__render();
    },

    /** Süzgece uyan oturumları çizelgeye verir. */
    __render() {
      if (!this.__sessions) {
        return;
      }
      const F = ankamon.util.Format;
      const S = ankamon.ui.sessions.Users;
      const esc = qx.bom.String.escape;
      const f = this.__textFilters();
      this.__lastText = JSON.stringify(f);
      const kind = /^"[^"|]*"$/.test(f.kind) ? (Object.keys(S.KIND).find(k => `"${S.KIND[k]}"` === f.kind) || "") : "";
      const byDevice = this.__value(this.__groupBy) === "device";
      const badOnly = this.__badOnly.getValue();
      const now = Date.now() / 1000;

      // Süzgeçsiz (yalnız "düzgün kapanmayanlar") oturumlar ve çizelge için Cihaz/Kullanıcı/Tür süzgeçlileri.
      this.__base = this.__sessions.filter(s => !badOnly || S.isBad(s));
      this.__shown = this.__base.filter(s => this.__sessionMatches(s, f));

      const groups = new Map();
      const items = this.__shown.map(s => {
        const deviceName = s.device || s.host || "?";
        // Aynı ad iki türde (cihaz kullanıcısı / Ankamon kullanıcısı) farklı kişiler olabilir.
        const userKey = s.kind + ":" + s.username;
        const userName = s.kind === "webshell" && !kind ? `${s.username} (web terminal)` : s.username;
        const group = byDevice ? this.__deviceKey(s) : userKey;
        groups.set(group, byDevice ? deviceName : userName);
        const end = s.ended_at || now;
        const state = S.state(s);
        return {
          id: (s.kind === "webshell" ? "w:" : "b:") + s.id,
          group,
          start: new Date(s.started_at * 1000),
          end: new Date(Math.max(end, s.started_at + 1) * 1000),
          content: esc(byDevice ? userName : deviceName),
          className: "tm-s-" + state,
          title: `<b>${esc(s.username)}</b> · ${esc(deviceName)}<br>` +
            `Süre: ${F.duration(end - s.started_at)} (${F.dateTime(s.started_at * 1000)} → ` +
            `${s.ended_at ? F.dateTime(s.ended_at * 1000) : "devam ediyor"})<br>` +
            `${s.kind === "webshell" ? "Web terminal · " : ""}${s.locked ? "Açık (kilitli)" : (s.end_detail || F.sessionEndReason(s.end_reason))}` +
            (s.kind === "webshell" ? "" : this.__lessonLines(s, end))
        };
      });
      items.push(...this.__shotItems(groups, byDevice, badOnly));
      if (byDevice) {
        items.push(...this.__offItems(new Set(groups.keys())));
      }
      this.__timeline.setData([...groups.entries()].map(([id, content]) => ({ id, content: esc(content) })), items);
      // Satır adları sütununun başlığı: cihaz satırlarında kayıtlı cihazlar dışında, log gönderen ama
      // cihaz olarak eklenmemiş makineler (bilgisayar adıyla) de bulunabildiğinden "Bilgisayar".
      this.__timeline.setGroupHeader(byDevice ? "Bilgisayar" : "Kullanıcı");
      if (!this.__framed) {
        this.__framed = true;
        this.__frameToday();
      }
      this.__summarize(this.__timeline.getWindow());
    },

    /**
     * Varsayılan aralık (kullanıcı isteği): 24 saat, bugün ilk oturumu açan en solda. Bugün henüz
     * oturum yoksa son 24 saat. Yalnız ilk veriyle uygulanır — sonraki tazelemeler kullanıcının
     * kaydırdığı/yakınlaştırdığı aralığı bozmaz.
     */
    __frameToday() {
      const day = 24 * 3600 * 1000;
      const midnight = new Date().setHours(0, 0, 0, 0) / 1000;
      const first = Math.min(...this.__shown.map(s => s.started_at).filter(t => t >= midnight));
      if (Number.isFinite(first)) {
        const start = first * 1000 - 10 * 60 * 1000; // çubuğun başı kenara yapışmasın
        this.__timeline.setWindow(new Date(start), new Date(start + day));
      } else {
        this.__timeline.setWindow(new Date(Date.now() - day), new Date(Date.now() + day / 50));
      }
    },

    /**
     * Görünen aralıktaki oturumların özeti (çizelgenin üstündeki satır).
     * @param range {Map|null} {start, end: Date}
     */
    __summarize(range) {
      if (range) {
        this.__range = range;
        this.__loadUptime();
      }
      if (!this.__shown || !this.__range) {
        return;
      }
      const F = ankamon.util.Format;
      const S = ankamon.ui.sessions.Users;
      const byDevice = this.__value(this.__groupBy) === "device";
      const from = this.__range.start.getTime() / 1000;
      const to = this.__range.end.getTime() / 1000;
      const now = Date.now() / 1000;

      const inRange = s => !((s.ended_at || now) < from || s.started_at > to);
      const seconds = s => Math.max(0, Math.min(s.ended_at || now, to) - Math.max(s.started_at, from));
      // Özet: çizelgede görünenler (Cihaz/Kullanıcı/Tür süzgeçli).
      let count = 0, total = 0, bad = 0;
      const groupsSeen = new Set();
      this.__shown.filter(inRange).forEach(s => {
        count++;
        total += seconds(s);
        bad += S.isBad(s) ? 1 : 0;
        groupsSeen.add(byDevice ? this.__deviceKey(s) : s.kind + ":" + s.username);
      });

      const span = `${F.dateTime(from * 1000)} – ${F.dateTime(to * 1000)}`;
      this.__summary.setValue(count
        ? `<b>${count}</b> oturum · toplam <b>${F.duration(total)}</b> · ortalama <b>${F.duration(total / count)}</b> · ` +
          `<b style="color:${bad ? "#d93025" : "inherit"}">${bad}</b> düzgün kapanmadı · ` +
          `<b>${groupsSeen.size}</b> ${byDevice ? "cihaz" : "kullanıcı"} <span style="color:#5f6368">(${span})</span>`
        : `<span style="color:#5f6368">Bu aralıkta süzgece uyan oturum yok (${span}). "Tümü" ile bütün kayıtları görebilirsiniz.</span>`);

    },

    __base: null,

    /**
     * Cihazların açık aralıkları (GET /device-uptime — worker'ın loglardan ARTIMLI doldurduğu tablo,
     * her istekte yeniden hesaplanmaz). Görünen aralığın iki yanına birer aralık boyu pay eklenerek
     * çekilir; önbellek görünen aralığı kapsıyor ve 60 sn'den yeniyse yeniden istenmez. Uç yoksa
     * ya da hata verirse çizelge kapalı gölgesi olmadan çalışmaya devam eder.
     */
    async __loadUptime() {
      if (this.__uptimeLoading || !this.__range || this.__value(this.__groupBy) !== "device") {
        return;
      }
      const from = this.__range.start.getTime() / 1000;
      const to = this.__range.end.getTime() / 1000;
      const c = this.__uptime;
      if (c && c.from <= from && c.to >= to && Date.now() - c.at < 60000) {
        return;
      }
      const span = to - from;
      const q = { from: Math.floor(from - span), to: Math.ceil(to + span) };
      this.__uptimeLoading = true;
      try {
        const res = await ankamon.io.Api.get(`/device-uptime?from=${q.from}&to=${q.to}`);
        this.__uptime = { from: q.from, to: q.to, at: Date.now(), devices: res.devices || [] };
      } catch (e) {
        // Uç henüz yoksa / hata: aynı aralık için 60 sn boyunca yeniden denenmez.
        this.__uptime = { from: q.from, to: q.to, at: Date.now(), devices: null };
      } finally {
        this.__uptimeLoading = false;
      }
      if (!this.isDisposed()) {
        this.__render();
      }
    },

    /**
     * Cihaz satırlarına "kapalı" arka plan çubukları: açık aralıkların, çekilen [from, to] (ve
     * şimdi) içindeki tümleyeni. @param groups {Set} çizelgedeki cihaz satır anahtarları
     */
    __offItems(groups) {
      const c = this.__uptime;
      if (!c || !c.devices) {
        return [];
      }
      const now = Date.now() / 1000;
      const to = Math.min(c.to, now);
      const out = [];
      c.devices.forEach(b => {
        const group = b.device_id ? "b" + b.device_id : "h" + (b.host || "");
        if (!groups.has(group)) {
          return;
        }
        // Cihazın ilk log kaydından (since) öncesi bilinmiyor: "kapalı" diye taranmaz.
        let cursor = Math.max(c.from, b.since || 0);
        const gap = (start, end, i) => {
          if (end - start >= 60) {
            out.push({
              id: `off:${group}:${i}`, group, type: "background", className: "tm-off",
              start: new Date(start * 1000), end: new Date(end * 1000)
            });
          }
        };
        (b.up || []).forEach(([start, end], i) => {
          gap(cursor, Math.min(start, to), i);
          cursor = Math.max(cursor, end === null ? to : end);
        });
        gap(cursor, to, "son");
      });
      return out;
    },

    /** Çizelge satır anahtarını (bkz. __groupMenu) süzgece alır. */
    __pickKey(key) {
      if (!key) {
        return;
      }
      if (this.__value(this.__groupBy) === "device") {
        const s = (this.__sessions || []).find(x => this.__deviceKey(x) === key);
        this.__setFilter("device", s ? s.device || s.host : key.slice(1));
      } else {
        const i = key.indexOf(":");
        this.__updatingOptions = true;
        try {
          this.__setFilter("kind", ankamon.ui.sessions.Users.KIND[key.slice(0, i)] || "");
        } finally {
          this.__updatingOptions = false;
        }
        this.__setFilter("user", key.slice(i + 1));
      }
    },

    /** Çubuğa sağ tıklama menüsü. @param data {Map} {item, event} */
    __itemMenu(data) {
      if (this.__shotOf(data.item)) {
        const open = new qx.ui.menu.Menu();
        open.add(ankamon.ui.DeviceOps.menuButton(ankamon.ui.Shell.ICON.screenshot, "Görüntüyü aç", () => this.__openShot(data.item)));
        this.__openMenu(open, data.event);
        return;
      }
      const s = this.__shown && this.__shown.find(x => (x.kind === "webshell" ? "w:" : "b:") + x.id === data.item);
      if (!s) {
        return;
      }
      const ops = ankamon.ui.DeviceOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${s.username})`, () => this.__pickKey(s.kind + ":" + s.username)));
      menu.add(ops.menuButton(icon.devices, `Yalnız bu cihaz (${s.device || s.host})`, () => this.__setFilter("device", s.device || s.host)));
      if (s.kind === "device") {
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.movements, "Oturum hareketleri", () => this.__page.showMovements({
          session: { id: s.id, label: `${s.username} · ${s.device || s.host} · ${ankamon.util.Format.dateTime(s.started_at * 1000)}` },
          username: s.username, device_id: s.device_id, device_name: s.device || s.host
        })));
        menu.add(ops.menuButton(icon.movements, `Bu kullanıcının tüm hareketleri (${s.username})`,
          () => this.__page.showMovements({ username: s.username })));
      }
      // Açık cihaz oturumu: o cihazın canlı ekranı (Ekran ▸ Ekranı göster ile aynı işlev).
      if (s.kind === "device" && !s.ended_at && s.device_id && this.__page._can("screen")) {
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.screen, `Ekranı göster (${s.device || s.host})`,
          () => ops.screen([{ id: s.device_id, label: s.device || s.host }], this.__page._user)));
      }
      if (s.kind === "device" && !s.ended_at && s.device_id && this.__page._can("devices.login")) {
        const device = { id: s.device_id, label: s.device };
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.logout, `Oturumu kapat (${s.username})`,
          () => ops.sessionAction("logout", [device], null, s.username)));
        menu.add(ops.menuButton(icon.lock, `Oturumu kilitle (${s.username})`,
          () => ops.sessionAction("lock", [device], null, s.username)));
      }
      this.__openMenu(menu, data.event);
    },

    __openMenu(menu, event) {
      if (!menu) {
        return;
      }
      menu.addListenerOnce("disappear", () => qx.event.Timer.once(() => menu.destroy(), null, 0));
      menu.openAtPoint({ left: event.pageX, top: event.pageY });
    },

    /**
     * Satır (zaman çizelgesindeki satır adı) sağ menüsü: süzgece alma ve —
     * Cihazlar'a kayıtlı olmayan bilgisayarda (anahtar "h<ad>"), "sessions.hosts" yetkisiyle — kayıtlarını
     * silme. @param key {String} satır anahtarı (cihaz satırlarında "b<id>"/"h<ad>", kullanıcıda "<tür>:<ad>")
     * @return {qx.ui.menu.Menu|null}
     */
    __groupMenu(key, forceDevice) {
      const byDevice = forceDevice || this.__value(this.__groupBy) === "device";
      const ops = ankamon.ui.DeviceOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      if (byDevice) {
        const s = (this.__shown || []).find(x => this.__deviceKey(x) === key);
        const name = s ? s.device || s.host : key.slice(1);
        menu.add(ops.menuButton(icon.devices, `Yalnız bu bilgisayar (${name})`, () => this.__setFilter("device", name)));
        if (key.startsWith("b")) {
          menu.add(ops.menuButton(icon.movements, "Oturum hareketleri", () => this.__page.showMovements(
            { device_id: Number(key.slice(1)), device_name: name, username: this.__single("user") || undefined })));
        }
        if (key.startsWith("h") && this.__page._can("sessions.hosts")) {
          menu.add(new qx.ui.menu.Separator());
          menu.add(ops.menuButton(icon.delete, `Bu bilgisayarın kayıtlarını sil (${key.slice(1)})…`,
            () => this.__deleteHost(key.slice(1))));
        }
      } else {
        const i = key.indexOf(":");
        // "(oturum yok)" satırı: yalnız oturumsuz çekilen ekran görüntülerini taşır, süzülecek bir kullanıcı yoktur.
        if (key.slice(i + 1)) {
          menu.add(ops.menuButton(icon.sessions, `Yalnız bu kullanıcı (${key.slice(i + 1)})`, () => this.__pickKey(key)));
        } else {
          menu.add(ops.menuButton(icon.movements, "Oturumsuz hareketler", () => this.__page.showMovements({ username: "-" })));
        }
        if (key.startsWith("device:") && key.slice(i + 1)) {
          // Cihaz süzgecinde tek kayıtlı cihaz seçiliyse o cihazdaki, değilse bütün cihazlardaki hareketleri.
          const name = this.__single("device");
          const s = name && (this.__sessions || []).find(x => x.device_id && x.device === name);
          menu.add(ops.menuButton(icon.movements, "Oturum hareketleri", () => this.__page.showMovements({
            username: key.slice(i + 1), device_id: s ? s.device_id : undefined, device_name: s ? name : undefined
          })));
        }
      }
      return menu;
    },

    /**
     * Kayıtlı olmayan bilgisayarın oturum ve açık/kapalı kayıtlarını (isteğe bağlı ham loglarını) onay
     * aldıktan sonra siler (DELETE /api/device-hosts — bkz. SessionsApi::deleteHost).
     */
    async __deleteHost(host) {
      const esc = qx.bom.String.escape;
      const count = (this.__sessions || []).filter(s => !s.device_id && s.host === host).length;
      const win = ankamon.ui.Dialog.window("Bilgisayarın kayıtlarını sil", 480);
      win.add(new qx.ui.basic.Label(
        `<b>${esc(host)}</b> Cihazlar'a kayıtlı değil. Bu bilgisayarın <b>${count} oturum kaydı</b> ve açık/kapalı ` +
        "aralıkları kalıcı olarak silinecek; geri alınamaz.<br><br>Bilgisayar hâlâ log gönderiyorsa yalnız bundan " +
        "sonraki oturumları yeniden görünür.").set({ rich: true, wrap: true }));
      const logs = new qx.ui.form.CheckBox("Ham sistem loglarını da sil (Loglar ▸ Sistem logları)");
      win.add(logs);
      const cancel = new qx.ui.form.Button("Vazgeç");
      const ok = new qx.ui.form.Button("Sil");
      let confirmed = false;
      cancel.addListener("execute", () => win.close());
      ok.addListener("execute", () => {
        confirmed = true;
        win.close();
      });
      ankamon.ui.Dialog.buttons(win, [cancel, ok]);
      await new Promise(resolve => {
        win.addListener("close", resolve);
        win.open();
      });
      if (!confirmed) {
        return;
      }
      try {
        const res = await ankamon.io.Api.del("/device-hosts", { host, logs: logs.getValue() });
        this.__uptime = null;   // açık/kapalı aralıkları yeniden çekilsin
        if (this.__single("device") === host) {
          this.__setFilter("device", "");
        }
        await this.__page.refresh();
        ankamon.ui.Dialog.alert(`<b>${esc(host)}</b>: ${res.sessions} oturum kaydı, ${res.uptime} açık/kapalı aralığı` +
          (logs.getValue() ? `, ${res.logs} log satırı` : "") + " silindi.", "Silindi");
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    }
  }
});
