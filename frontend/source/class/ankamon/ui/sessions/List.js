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
 * Oturumlar sayfasının "Oturumlar" sekmesi: tüm oturum kayıtlarının grid'i (bkz. page.Sessions —
 * veriyi sayfa çeker, setData ile verir).
 *
 * Tahtalar grid'iyle aynı desen: sütun bazlı Excel tarzı süzgeç + yerleşik tıkla-sırala
 * (qx.ui.table.model.Simple varsayılan olarak sıralanabilir) + sütun genişliği/görünürlüğü
 * localStorage'da kalıcı (bkz. page.Base _createTable storageKey).
 *
 * Satır sağ menüsü: her satırda "Oturum geçmişi" (o kullanıcının zaman çizelgesi — Kullanıcılar
 * sekmesine geçer, bkz. page.Sessions.showUserHistory). Devam eden bir tahta oturumunda ayrıca
 * "Oturumu kapat" / "Oturumu kilitle" (yetki "boards.login" — bkz. ui.BoardOps.sessionAction).
 * Hedef o satırın KULLANICISIDIR (tahtadaki etkin oturum değil): kullanıcı değiştirilmiş tahtada
 * arka plandaki oturum da kapatılabilir.
 */
qx.Class.define("ankamon.ui.sessions.List", {
  extend: qx.ui.tabview.Page,

  /** @param page {ankamon.page.Sessions} tablo yardımcıları, yetki ve sekme geçişi için */
  construct(page) {
    super("Oturumlar");
    this.__page = page;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    // "Yenile" sayfa çubuğunda değil burada (kullanıcı isteği); sayfanın tamamını (iki sekmeyi) tazeler.
    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8));
    const refresh = new qx.ui.form.Button("Yenile");
    refresh.addListener("execute", () => page.refresh());
    bar.add(refresh);
    // Kullanıcı ekle/düzenle'de "sessions.manage" özelliği açıkça verilmiş olmalı — varsayılan
    // kapalı (yeni kullanıcı formunun öntanımlı özellik listesinde yok, bkz. page.Users.__edit).
    if (page._can("sessions.manage")) {
      this.__deleteButton = new qx.ui.form.Button("Süzgeçtekileri sil");
      this.__deleteButton.addListener("execute", () => this.__deleteFiltered());
      bar.add(this.__deleteButton);
    }
    this.add(bar);

    this.__columns = [
      { id: "kind", label: "Tür", width: 110 },
      { id: "username", label: "Kullanıcı adı", width: 160 },
      { id: "board", label: "Tahta", width: 180 },
      { id: "started", label: "Oturum açma", width: 150 },
      { id: "ended", label: "Oturum kapama", width: 150 },
      { id: "duration", label: "Süre", width: 100 },
      { id: "reason", label: "Durum" }
    ];

    this.__table = page._createTable(this.__columns, { storageKey: "sessions.columns" });
    // Süzgeç kutuları her sütunun kendi başlık hücresinin içinde (bkz. Base.js _addColumnFilters).
    this.__filterFields = page._addColumnFilters(this.__table, this.__columns, this.__apply.bind(this));
    this.add(this.__table, { flex: 1 });
    this.__table.addListener("cellContextmenu", e => {
      const row = e.getRow() === null ? null : this.__shownRows[e.getRow()];
      this.__table.setContextMenu(row ? this.__rowMenu(row.session) : null);
    });
    this.__count = new qx.ui.basic.Label("").set({ textColor: "app-muted" });
    this.add(this.__count);
  },

  members: {
    __page: null,
    __table: null,
    __columns: null,
    __filterFields: null,
    __rows: null,
    __count: null,
    __deleteButton: null,
    __shownIds: null,
    __shownRows: null,

    /** @param sessions {Array} /board-sessions yanıtındaki satırlar */
    setData(sessions) {
      const F = ankamon.util.Format;
      const now = Date.now() / 1000;
      this.__rows = sessions.map(s => {
        const durationSeconds = (s.ended_at || now) - s.started_at;
        // İki tablonun kimlikleri çakışabileceğinden satır kimliği türle öneklenir (bkz. __deleteFiltered).
        return {
          session: s,
          cells: [
            (s.kind === "webshell" ? "w:" : "b:") + s.id,
            s.kind === "webshell" ? "Web terminal" : "Tahta oturumu",
            s.username,
            s.board || s.host,
            F.dateTime(s.started_at * 1000),
            s.ended_at ? F.dateTime(s.ended_at * 1000) : "—",
            F.duration(durationSeconds) + (s.ended_at ? "" : " (devam ediyor)"),
            // Kilitli = tahtadaki oturum açık ama ekran kilidinde (Tahtalar grid'indeki "(kilitli)" ile aynı kaynak).
            s.locked ? "Açık (kilitli)" : (s.end_detail || F.sessionEndReason(s.end_reason))
          ]
        };
      });
      this.__apply();
    },

    __apply() {
      if (!this.__rows) {
        return;
      }
      const colFilters = this.__columns
        .map((column, index) => ({ index: index + 1, text: (this.__filterFields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      const shown = this.__rows.filter(({ cells }) =>
        colFilters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));
      this.__table.getTableModel().setData(shown.map(r => r.cells));
      this.__shownRows = shown;
      this.__count.setValue(`${shown.length} / ${this.__rows.length} oturum`);
      // Sil düğmesi her zaman o anda GÖRÜNEN (süzülmüş) satırların kimlikleriyle çalışır —
      // "ekranda ne görüyorsan onu silersin" (bkz. __deleteFiltered).
      this.__shownIds = shown.map(r => r.cells[0]);
      if (this.__deleteButton) {
        this.__deleteButton.setEnabled(this.__shownIds.length > 0);
        this.__deleteButton.setLabel(this.__shownIds.length ? `Süzgeçtekileri sil (${this.__shownIds.length})` : "Süzgeçtekileri sil");
      }
    },

    /**
     * Her satırda "Oturum geçmişi"; yalnız sürmekte olan tahta (greeter) oturumlarında ve
     * "boards.login" yetkisiyle ayrıca oturumu kapat/kilitle.
     */
    __rowMenu(s) {
      const ops = ankamon.ui.BoardOps;
      const icon = ankamon.ui.Shell.ICON;
      const menu = new qx.ui.menu.Menu();
      menu.add(ops.menuButton(icon.sessions,`Oturum geçmişi (${s.username})`,
        () => this.__page.showUserHistory(s.username, s.kind)));
      if (s.kind === "board" && !s.ended_at && s.board_id && this.__page._can("boards.login")) {
        const board = { id: s.board_id, label: s.board };
        menu.add(new qx.ui.menu.Separator());
        menu.add(ops.menuButton(icon.logout, `Oturumu kapat (${s.username})`,
          () => ops.sessionAction("logout", [board], null, s.username)));
        menu.add(ops.menuButton(icon.lock, `Oturumu kilitle (${s.username})`,
          () => ops.sessionAction("lock", [board], null, s.username)));
      }
      return menu;
    },

    /**
     * O anda süzgeçte görünen TÜM kayıtları siler (checkbox'lı satır seçimi değil — "sessions.manage"
     * yetkisi bu sekmede bilerek filtre-tabanlı toplu silme sağlar). Hiç süzgeç uygulanmamışsa TÜM
     * kayıtlar silinir; onay metni bunu açıkça belirtir.
     */
    async __deleteFiltered() {
      const ids = this.__shownIds || [];
      if (!ids.length) {
        return;
      }
      const filtered = Object.values(this.__filterFields).some(f => (f.getValue() || "").trim());
      const question = filtered
        ? `Süzgece uyan <b>${ids.length}</b> oturum kaydı kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`
        : `Hiç süzgeç uygulanmadı — <b>TÜM ${ids.length}</b> oturum kaydı kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`;
      const sure = await ankamon.ui.Dialog.confirm(question, "Sil");
      if (!sure) {
        return;
      }
      try {
        const pick = prefix => ids.filter(id => id.startsWith(prefix)).map(id => Number(id.slice(2)));
        const res = await ankamon.io.Api.del("/board-sessions", { ids: pick("b:"), webshell_ids: pick("w:") });
        ankamon.ui.Dialog.alert(`${res.deleted} oturum kaydı silindi.`, "Kayıtlar silindi");
        this.__page.refresh();
      } catch (e) {
        ankamon.ui.Dialog.error(e);
      }
    }
  }
});
