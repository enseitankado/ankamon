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
 * Sensörler (Bakım sayfasının sekmesi — bkz. page.Maintenance): Grafana panosu gömülü açılır
 * (oturum Ankamon'dan devralınır).
 *
 * Varsayılan: "Çevrim içi tahtalar" panosu (docker/grafana/dashboards/cevrimici-tahtalar.json) — şu an
 * çevrim içi TÜM tahtalar, her grafikte tahta başına bir çizgi; lejant tablosunda son/en yüksek değerler.
 * Düğme satırındaki seçim kutusundan tek bir tahta seçilince o tahtanın ayrıntılı panosu (tahta-genel-bakis,
 * var-board) açılır. Seçim yalnız bu sayfa açıkken hatırlanır.
 */
qx.Class.define("ankamon.page.Metrics", {
  extend: ankamon.page.Base,

  statics: {
    ALL_URL: "/grafana/d/ankamon-cevrimici/cevrim-ici-tahtalar?kiosk",
    BOARD_URL: "/grafana/d/ankamon-genel/tahta-genel-bakis?kiosk&var-board="
  },

  construct(user) {
    // Başlık yok: Bakım sayfasının "Sensörler" sekmesinde durur, sekme adı yeterli (bkz. page.Maintenance).
    super(user, null);
    this.__select = new qx.ui.form.SelectBox().set({ width: 280, toolTipText: "Gösterilecek tahtalar" });
    this.__select.add(new qx.ui.form.ListItem("Tüm çevrim içi tahtalar", null, null));
    this.__select.addListener("changeSelection", () => {
      if (!this.__filling) {
        this.__show();
      }
    });
    this._actions.add(this.__select);
    this.__open = this._addButton("Grafana'yı yeni sekmede aç", () => window.open(this.__url(), "_blank", "noopener"));
    this.__open.setToolTipText("Panoları tam ekran incelemek ve düzenlemek için");
    // Verinin nasıl toplandığı/saklandığı, canlı değerlerle (bkz. ui.MetricsHelp) — eski "?" düğmesi (kullanıcı isteği:
    // Grafana düğmesinin yanında, adıyla).
    this._addButton("Veri Toplama şeması", () => ankamon.ui.MetricsHelp.open())
      .setToolTipText("Sensör verisi nasıl toplanıyor, saklanıyor ve sunuluyor? (canlı bilgiler)");
    // Sensör verisi eksik tahtalar için kurulum yönergesi (bkz. __updateNotice): yeni satır kaplamasın diye düğme
    // satırında katlı tek satırlık sarı şerit; tıklayınca ayrıntı (bağlantılar dahil) şeridin altında açılır.
    this.__noticeChip = new qx.ui.basic.Atom("").set({ rich: true, visibility: "excluded", cursor: "pointer",
      padding: [4, 10], backgroundColor: "#fff4ce", textColor: "#3b2f00", alignY: "middle",
      decorator: new qx.ui.decoration.Decorator().set({ width: 1, color: "#e8c95a", radius: 4 }) });
    this.__notice = new qx.ui.basic.Label("").set({ rich: true, wrap: true, selectable: true,
      padding: [8, 12], backgroundColor: "#fff4ce", textColor: "#3b2f00", maxWidth: 760 });
    this.__notice.addListener("tap", e => this.__noticeTap(e));
    this.__noticePopup = new qx.ui.popup.Popup(new qx.ui.layout.Grow()).set({ autoHide: true, position: "bottom-left" });
    this.__noticePopup.add(this.__notice);
    this.__noticePopup.addListener("changeVisibility", () => this.__updateChip());
    this.__noticeChip.addListener("tap", () => {
      if (this.__noticePopup.isVisible()) {
        this.__noticePopup.hide();
      } else {
        this.__noticePopup.placeToWidget(this.__noticeChip, true);
        this.__noticePopup.show();
      }
    });
    this._actions.add(this.__noticeChip);
    // Sekme/sayfa değişince açık ayrıntı kalmasın (menüden programla geçişte autoHide tetiklenmez).
    this.addListener("disappear", () => this.__noticePopup.hide());
    this.__frame = new qx.ui.embed.Iframe("about:blank");
    this.add(this.__frame, { flex: 1 });
  },

  destruct() {
    this._disposeObjects("__noticePopup");
  },

  members: {
    __frame: null,
    __notice: null,
    __noticeChip: null,
    __noticePopup: null,
    __noticeSummary: "",
    __noticeTargets: null,
    __coverage: null,
    __select: null,
    __filling: false,
    __shown: null,

    /** Seçili tahta kimliği; null = tüm çevrim içi tahtalar. */
    __boardId() {
      const sel = this.__select.getSelection()[0];
      return sel ? sel.getModel() : null;
    },

    __url() {
      const id = this.__boardId();
      return id === null ? ankamon.page.Metrics.ALL_URL : ankamon.page.Metrics.BOARD_URL + id;
    },

    /**
     * Sensör verisi eksik tahtalar için bilgilendirme: tüm tahtalar görünümünde o tahtaların listesi, tek
     * tahtada yalnız o tahta. Eksiklik iki türlüdür ama kurulum TEK hazır komuttur — "Metrik izlemeyi kur"
     * (actions/node-exporter; fan/pil/anakart sensörlerini de etkinleştirir):
     *   • son 7 günde hiç veri gelmeyen tahtalar (has_data);
     *   • fan/anakart sensörü olmayan ve anakart sensörü adımı henüz denenmemiş tahtalar (has_board_sensors,
     *     superio_done — yonga desteklenmiyorsa komut yeniden önerilmez).
     * Komutun yolu tıklanır: Komut çalıştır penceresi bu tahtalar için o hazır komut seçili açılır
     * (bkz. ui.BoardOps.run). Listede kapalı tahta varsa sonuna "WoL ile aç" bağlantısı eklenir.
     */
    __updateNotice() {
      const esc = qx.bom.String.escape;
      const list = this.__coverage || [];
      const id = this.__boardId();
      const shown = list.filter(b => id === null || b.id === id);
      const missing = shown.filter(b => !b.has_data);
      const noBoard = shown.filter(b => b.has_data && !b.has_board_sensors && !b.superio_done);
      const steps = [
        { key: "node-exporter", boards: shown.filter(b => !b.has_data || (!b.has_board_sensors && !b.superio_done)),
          title: "Metrik izlemeyi kur (fan/pil/anakart sensörleri dahil)",
          what: "işlemci, bellek, disk, ağ, sıcaklık; anakartın donanım izleme yongası destekleniyorsa fan devri, " +
            "CMOS pili ve anakart sıcaklığı da" }
      ].filter(st => st.boards.length);
      const canRun = this._can("actions");
      const link = (attr, text) => `<span ${attr} style="color:#0b57d0;text-decoration:underline;cursor:pointer">${text}</span>`;
      const names = arr => arr.slice(0, 12).map(b => esc(b.name) + (b.online ? "" : " (kapalı)")).join(", ") +
        (arr.length > 12 ? ` ve ${arr.length - 12} tahta daha` : "");
      const wol = arr => {
        const off = arr.filter(b => !b.online);
        if (!off.length || !this._can("power")) {
          return "";
        }
        const text = id !== null ? "tahtayı WoL ile aç" : `${off.length} kapalı tahtayı WoL ile aç`;
        return " — " + link(`data-sensor-wol="${off.map(b => b.id).join(",")}"`, text);
      };

      const lines = [];
      if (missing.length) {
        lines.push(id === null
          ? `<b>${missing.length} tahtada hiç sensör verisi yok:</b> ${names(missing)}${wol(missing)}.`
          : "<b>Bu tahtada hiç sensör verisi yok:</b> sensör istemcisi (metrik izleme) kurulu değil ya da çalışmıyor" +
            (missing[0].online ? "" : " (tahta kapalı" + wol(missing) + ")") + ".");
      }
      if (noBoard.length) {
        lines.push(id === null
          ? `<b>${noBoard.length} tahtada fan / anakart sensörü verisi yok:</b> ${names(noBoard)}${wol(noBoard)}.`
          : "<b>Bu tahtada fan / anakart sensörü verisi yok.</b>" + (noBoard[0].online ? "" : " Tahta kapalı" + wol(noBoard) + "."));
      }
      this.__noticeTargets = {};
      if (steps.length) {
        const path = st => {
          const text = `Komut çalıştır ▸ Hazır / Serbest komut çalıştır ▸ Sensörler — ${esc(st.title)}`;
          this.__noticeTargets[st.key] = st.boards.map(b => b.id);
          return canRun ? link(`data-sensor-run="${st.key}"`, text) : `<b>${text}</b>`;
        };
        const count = st => {
          if (id !== null) {
            return "";
          }
          const off = st.boards.filter(b => !b.online).length;
          return ` — ${st.boards.length} tahta` + (off ? ` (${off} kapalı: önce açılmalı)` : "");
        };
        lines.push((steps.length > 1 ? "Kurmak için Tahtalar'da tahtaları işaretleyip sırasıyla şu hazır komutları çalıştırın" :
          "Kurmak için Tahtalar'da tahtaları işaretleyip şu hazır komutu çalıştırın") +
          (canRun ? " (bağlantı pencereyi bu tahtalar için açar):" : ":"));
        steps.forEach((st, i) => lines.push(`${steps.length > 1 ? i + 1 + ". " : "• "}${path(st)} (${st.what})${count(st)}`));
        lines.push("Veri birkaç dakika içinde grafiklere gelmeye başlar.");
      }
      const html = lines.join("<br>");
      this.__notice.setValue(html);
      // Katlı şerit: kaç tahtada eksik olduğu (ayrıntı açılır pencerede).
      const n = new Set(missing.concat(noBoard).map(b => b.id)).size;
      this.__noticeSummary = !html ? ""
        : id !== null ? "⚠ Bu tahtada sensör verisi eksik"
        : `⚠ ${n} tahtada sensör verisi eksik`;
      this.__noticeChip.setVisibility(html ? "visible" : "excluded");
      if (!html) {
        this.__noticePopup.hide();
      }
      this.__updateChip();
    },

    __updateChip() {
      const open = this.__noticePopup.isVisible();
      this.__noticeChip.setLabel(`${qx.bom.String.escape(this.__noticeSummary)} <span style="opacity:.7">${open ? "▴ gizle" : "▾ ayrıntı"}</span>`);
    },

    /** Uyarıdaki bağlantılar (bkz. __updateNotice): hazır komut penceresi ya da WoL ile açma. */
    __noticeTap(e) {
      const el = e.getOriginalTarget();
      const hit = el && el.closest ? el.closest("[data-sensor-run],[data-sensor-wol]") : null;
      if (!hit) {
        return;
      }
      const run = hit.getAttribute("data-sensor-run");
      if (run) {
        const ids = (this.__noticeTargets || {})[run] || [];
        ankamon.ui.BoardOps.run(ids.map(i => ({ id: i })), this._user, run);
        return;
      }
      const ids = hit.getAttribute("data-sensor-wol").split(",").map(Number);
      ankamon.io.Api.post("/jobs", { type: "wol", board_ids: ids })
        .then(() => ankamon.ui.Dialog.alert(
          `${ids.length} tahtaya uyandırma (Wake-on-LAN) paketi gönderildi. WoL kurulumu yapılmışsa birkaç dakika ` +
          "sonra tahtalar açılacaktır.", "Uyandırma (WoL)"))
        .catch(err => ankamon.ui.Dialog.error(err));
    },

    /** Panoyu yalnız adres değiştiyse yükler (sekmeye her dönüşte Grafana baştan çizilmesin). */
    __show() {
      this.__updateNotice();
      const url = this.__url();
      if (url !== this.__shown) {
        this.__shown = url;
        this.__frame.setSource(url);
      }
    },

    /** Belirli bir tahtanın ayrıntılı grafiklerini göster. */
    async showBoard(boardId) {
      await this._refresh();
      const item = this.__select.getChildren().find(i => i.getModel() === boardId);
      if (item) {
        this.__select.setSelection([item]);
      }
    },

    async _refresh() {
      // Tahta listesi her açılışta tazelenir (yeni eklenen / çevrim içi-dışı değişen tahtalar); seçim korunur.
      let boards = [];
      try {
        boards = (await ankamon.io.Api.get("/boards")).boards;
      } catch (e) {
        // "boards" yetkisi yoksa yalnız "Tüm çevrim içi tahtalar" kalır.
      }
      try {
        this.__coverage = (await ankamon.io.Api.get("/metrics/coverage")).boards;
      } catch (e) {
        this.__coverage = null; // bilgilendirme gösterilmez; grafikler yine açılır
      }
      const keep = this.__boardId();
      this.__filling = true;
      try {
        this.__select.getChildren().slice(1).forEach(item => {
          this.__select.remove(item);
          item.dispose();
        });
        const name = b => b.label || b.hostname || b.ip || "#" + b.id;
        boards
          .slice()
          .sort((a, b) => (b.online - a.online) || name(a).localeCompare(name(b), "tr"))
          .forEach(b => this.__select.add(new qx.ui.form.ListItem(name(b) + (b.online ? "" : " (çevrim dışı)"), null, b.id)));
        const again = this.__select.getChildren().find(i => i.getModel() === keep);
        this.__select.setSelection([again || this.__select.getChildren()[0]]);
      } finally {
        this.__filling = false;
      }
      this.__show();
    }
  }
});
