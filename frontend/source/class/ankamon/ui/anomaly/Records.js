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
 * Sağlık ▸ Geçmiş (kullanıcı isteği 2026-11-10: eski "Geçmiş" ve "Özet" sekmeleri tek sekmede). Sürekli izlemenin
 * seçili dönemdeki kayıtları iki bölmede:
 *   - üstte tahta × bulgu ÖZETİ (ui.anomaly.Summary — sayı, toplam/en uzun süre, son başlangıç, şu an sürüyor mu),
 *   - altta tek tek KAYITLAR (ui.anomaly.History — başlangıç, bitiş, süre, ayrıntı).
 * Özette bir satır seçilince alt tablo o tahtanın o bulgusuna süzülür; seçim kalkınca bütün kayıtlar. Bölmelerin
 * düzeni Durum sekmesiyle aynı (kalın ayırıcı, eşit iç boşluk — bkz. ui.health.Status SPLITTER/PANE_GAP).
 * Sekme kimliği "Geçmiş" (eski sol menü yaprağı ve hatırlanan sekme); eski "summary" buraya yönlenir (page.Anomalies OLD_TABS).
 */
qx.Class.define("ankamon.ui.anomaly.Records", {
  extend: qx.ui.tabview.Page,

  /**
   * @param page {ankamon.page.Anomalies}
   * @param periodRow {qx.ui.core.Widget} "Rapor dönemi" seçicisi (sayfanın ortak seçicisi)
   */
  construct(page, periodRow) {
    super("Geçmiş");
    this.setUserData("key", "Geçmiş");
    this.setLayout(new qx.ui.layout.VBox(8));
    this.setPadding(8);
    this.add(periodRow);

    const Status = ankamon.ui.health.Status;
    const split = new qx.ui.splitpane.Pane("vertical");
    split.getChildControl("splitter").set({ height: Status.SPLITTER, minHeight: Status.SPLITTER, maxHeight: Status.SPLITTER });
    this.add(split, { flex: 1 });

    this.__summary = new ankamon.ui.anomaly.Summary(page, (board, kind) => this.__history.filterBoardKind(board, kind));
    this.__summary.setPaddingBottom(Status.PANE_GAP);
    split.add(this.__summary, 1);
    this.__history = new ankamon.ui.anomaly.History(page);
    this.__history.setPaddingTop(Status.PANE_GAP);
    split.add(this.__history, 1);
  },

  members: {
    __summary: null,
    __history: null,

    /** @param anomalies {Array} dönemin kayıtları @param from {Number} dönem başı (epoch sn) */
    setData(anomalies, from) {
      this.__history.setData(anomalies);
      this.__summary.setData(anomalies, from);
    },

    /** Durum'dan çift tık: özet de kayıtlar da o tahtaya süzülür. */
    showBoard(board) {
      this.__summary.filterBoard(board);
      this.__history.filterBoardKind(board, null);
    }
  }
});
