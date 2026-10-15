/**
 * Disk kullanımı penceresinin (bkz. ui.DiskUsage) tek bir sekmesi: bir veri türünün kapsamlarını
 * (tahta, görev, "tümü"…) kayıt sayısı ve YAKLAŞIK boyutuyla listeler; Ctrl/Shift ile tekli ya da
 * çoklu seçilen kapsamları sağ menüden veya "Seçilenleri sil" düğmesinden KALICI olarak siler.
 * Türün kendine özgü kısmı (sütunlar, yükleme, silme isteği) `spec` ile verilir:
 *
 *   label    {String}   sekme başlığı
 *   noun     {String}   onay metninde kayıt türü, ör. "sistem log kaydı"
 *   columns  {Array}    _createTable sütunları (kimlik sütunu hariç)
 *   load     {Function} async () => {rows, info} — rows: [{name, n, bytes, estimated, deletable,
 *                       all?, group?, groupAll?, cells}] (cells: columns ile aynı sırada), info: durum satırı metni
 *   remove   {Function} async row => silinen kayıt sayısı
 *   onDeleted{Function?} silme bittikten sonra (ör. arkadaki log grid'ini tazelemek için)
 */
qx.Class.define("tihamon.ui.DiskUsageTab", {
  extend: qx.ui.tabview.Page,

  /**
   * @param page {tihamon.page.Base} tablo yardımcıları (_createTable/_addColumnFilters) için
   * @param spec {Map} yukarıya bakın
   */
  construct(page, spec) {
    super(spec.label);
    this.__spec = spec;
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);

    const bar = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
    const refresh = new qx.ui.form.Button("Tazele");
    refresh.addListener("execute", () => this.load());
    bar.add(refresh);
    this.__deleteBtn = new qx.ui.form.Button(`${tihamon.ui.Shell.ICON.delete} Seçilenleri kalıcı sil`).set({ enabled: false });
    this.__deleteBtn.addListener("execute", () => this.__deleteMany(this.__selected()));
    bar.add(this.__deleteBtn);
    this.__status = new qx.ui.basic.Label("").set({ textColor: "app-muted", rich: true });
    bar.add(this.__status, { flex: 1 });
    this.add(bar);

    const columns = spec.columns;
    this.__table = page._createTable(columns);
    // Explorer tarzı seçim: düz tıklama YALNIZ o satırı seçer (öncekileri bırakır); Ctrl ile satır
    // eklenir/çıkarılır, Shift ile aralık seçilir. (_TOGGLE kipi her düz tıklamayı seçime ekleyip
    // çıkarıyordu — kullanıcı istemedi.)
    this.__table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
    const fields = page._addColumnFilters(this.__table, columns, () => {
      this.__colFilters = columns
        .map((column, index) => ({ index: index + 1, text: (fields[column.id].getValue() || "").toLowerCase().trim() }))
        .filter(f => f.text);
      this.__apply();
    });
    this.__table.getSelectionModel().addListener("changeSelection", () => this.__updateButton());
    this.__table.addListener("cellContextmenu", this.__onContextMenu, this);
    this.add(this.__table, { flex: 1 });

    // İlk kez görünür olunca yüklenir: açılmayan sekmeler için sunucuya sorgu gitmez.
    this.addListenerOnce("appear", () => this.load());
  },

  members: {
    __spec: null,
    __table: null,
    __status: null,
    __deleteBtn: null,
    __colFilters: null,
    // [{name, n, bytes, estimated, deletable, all, cells}]; tablo satırının cells[0]'ı bu dizideki
    // indekstir — sıralama/süzme satır konumunu değiştirdiğinden satır KİMLİĞE göre bulunur.
    __rows: null,
    __loading: false,

    async load() {
      if (this.__loading) {
        return;
      }
      this.__loading = true;
      this.__status.setValue("Yükleniyor…");
      try {
        const { rows, info } = await this.__spec.load();
        this.__rows = rows;
        this.__apply();
        this.__status.setValue(info || "");
      } catch (e) {
        this.__status.setValue("");
        tihamon.ui.Dialog.error(e);
      } finally {
        this.__loading = false;
      }
    },

    __apply() {
      const filters = this.__colFilters || [];
      const shown = (this.__rows || [])
        .map((r, i) => [i].concat(r.cells))
        .filter(cells => filters.every(f => String(cells[f.index] ?? "").toLowerCase().includes(f.text)));
      this.__table.getSelectionModel().resetSelection();
      this.__table.getTableModel().setData(shown);
      this.__updateButton();
    },

    __selected() {
      const tm = this.__table.getTableModel();
      const out = [];
      this.__table.getSelectionModel().iterateSelection(r => {
        const row = this.__rows && this.__rows[tm.getValue(0, r)];
        if (row) {
          out.push(row);
        }
      });
      return out;
    },

    __updateButton() {
      const n = this.__selected().filter(r => r.deletable && r.n > 0).length;
      this.__deleteBtn.setEnabled(n > 0);
      this.__deleteBtn.setLabel(`${tihamon.ui.Shell.ICON.delete} Seçilenleri kalıcı sil` + (n > 0 ? ` (${n})` : ""));
    },

    __onContextMenu(e) {
      const tableRow = e.getRow();
      if (tableRow === null) {
        return;
      }
      const selModel = this.__table.getSelectionModel();
      // Çoklu seçimin içindeki bir satıra sağ tıklanırsa seçim KORUNUR; seçim dışındaki bir satıra
      // sağ tıklanırsa (dosya yöneticilerindeki gibi) seçim o satıra sıfırlanır.
      if (!selModel.isSelectedIndex(tableRow)) {
        selModel.setSelectionInterval(tableRow, tableRow);
      }
      const selected = this.__selected();
      if (!selected.length) {
        return;
      }
      const menu = new qx.ui.menu.Menu();
      const del = new qx.ui.menu.Button(`${tihamon.ui.Shell.ICON.delete} Kalıcı olarak sil…` +
        (selected.length > 1 ? ` (${selected.length})` : ""));
      del.setEnabled(selected.some(r => r.deletable && r.n > 0));
      del.addListener("execute", () => this.__deleteMany(selected));
      menu.add(del);
      this.__table.setContextMenu(menu);
    },

    /**
     * Seçili kapsamları onaydan sonra TEK TEK siler; her birinin durumu (bekliyor/siliniyor/tamam/
     * hata) ilerleme penceresinde canlı güncellenir. Sonunda silinen toplam kayıt, tahmini boşalan
     * alan ("~" tahminlerin toplamı) ve /data'nın GERÇEK toplam/boş alanı raporlanır. Seçimde "tümü"
     * satırı varsa diğerleri zaten onun kapsamında olduğundan yalnız o silinir; bir grup satırı
     * (groupAll: <grup>) seçiliyse o gruba ait (group: <grup>) satırlar ayrıca silinmez.
     */
    async __deleteMany(selected) {
      const candidates = selected.filter(r => r.deletable && r.n > 0);
      const all = candidates.find(r => r.all);
      const groups = new Set(candidates.filter(r => r.groupAll).map(r => r.groupAll));
      const toDelete = all ? [all] : candidates.filter(r => r.groupAll || !groups.has(r.group));
      if (!toDelete.length) {
        return;
      }
      const F = tihamon.util.Format;
      const esc = qx.bom.String.escape;
      const totalN = toDelete.reduce((sum, r) => sum + r.n, 0);
      const scope = toDelete.length > 1
        ? `<b>${toDelete.length} kapsamdaki</b> (${esc(toDelete.map(r => r.name).join(", "))})`
        : `<b>${esc(toDelete[0].name)}</b> kapsamındaki`;
      const ok = await tihamon.ui.Dialog.confirm(
        `${scope} toplam <b>${totalN}</b> ${this.__spec.noun} ` +
        "<b>kalıcı olarak diskten silinecek. Bu işlem GERİ ALINAMAZ.</b><br><br>Emin misiniz?",
        "Kalıcı olarak sil", { maximizable: true }
      );
      if (!ok) {
        return;
      }

      const progress = tihamon.ui.Dialog.window("Siliniyor…", 520);
      const list = new qx.ui.container.Composite(new qx.ui.layout.VBox(4));
      const scroll = new qx.ui.container.Scroll(list).set({ maxHeight: 320 });
      const steps = toDelete.map(row => {
        const line = new qx.ui.basic.Label(`⏳ ${esc(row.name)} — bekliyor`).set({ rich: true });
        list.add(line);
        return { row, line };
      });
      progress.add(scroll, { flex: 1 });
      const summary = new qx.ui.basic.Label("").set({ rich: true, wrap: true });
      progress.add(summary);
      const closeBtn = new qx.ui.form.Button("Kapat").set({ enabled: false });
      closeBtn.addListener("execute", () => progress.close());
      tihamon.ui.Dialog.buttons(progress, [closeBtn]);
      progress.open();

      let deletedTotal = 0;
      let freed = 0;
      let hadError = false;
      let disk = null;
      for (const { row, line } of steps) {
        line.setValue(`⏳ ${esc(row.name)} — siliniyor…`);
        scroll.scrollChildIntoView(line);
        try {
          const deleted = await this.__spec.remove(row);
          deletedTotal += deleted;
          freed += row.bytes || 0;
          line.setValue(`✓ ${esc(row.name)} — ${deleted} kayıt silindi`);
        } catch (e) {
          hadError = true;
          line.setValue(`✗ ${esc(row.name)} — hata: ` + esc(e && e.message ? e.message : String(e)));
        }
      }

      await this.load();
      disk = this.__spec.lastDisk && this.__spec.lastDisk();
      summary.setValue(
        `<b>${deletedTotal}</b> kayıt silindi, yaklaşık <b>~${F.bytes(freed)}</b> boşaltıldı.` +
        (disk && disk.total != null && disk.free != null
          ? `<br>Disk: toplam ${F.bytes(disk.total)}, boş ${F.bytes(disk.free)}. ` +
            "<span style='opacity:.7'>(Silinen alan veritabanı tarafından yeniden kullanılır; dosya boyutu hemen küçülmeyebilir.)</span>"
          : "") +
        (hadError ? "<br><span style='color:#c0392b'>Bazı kapsamlarda hata oluştu (yukarıya bakın).</span>" : "")
      );
      closeBtn.setEnabled(true);
      if (this.__spec.onDeleted) {
        this.__spec.onDeleted();
      }
    }
  }
});
