/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Sağlık grid'lerinde satıra çift tıklama (kullanıcı isteği 2026-11-12: Geçmiş'te Ayrıntı alanı kırpılıyordu): satırın
 * bütün alanları kırpılmadan, kaydırılabilir, KİPLİ (modal) bir pencerede — Geçmiş ve Denetle ▸ Sonuçlar ortak.
 * Değerler düz metin (kaçışlanır); uzun metin satır sarar. Kopyala: alanları "Ad: değer" satırları olarak panoya.
 */
qx.Class.define("ankamon.ui.anomaly.RowDetail", {
  type: "static",

  statics: {
    /**
     * @param caption {String} pencere başlığı
     * @param fields {Array} [[ad, değer], …] — boş değerli alanlar atlanır
     */
    open(caption, fields) {
      const esc = s => qx.bom.String.escape(String(s ?? ""));
      const shown = fields.filter(f => f[1] !== null && f[1] !== undefined && String(f[1]).trim() !== "");
      const html = '<table style="border-collapse:collapse;width:100%;font:inherit">' + shown.map(([k, v]) =>
        `<tr><td style="padding:5px 14px 5px 0;vertical-align:top;white-space:nowrap;opacity:.7">${esc(k)}</td>` +
        `<td style="padding:5px 0;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere">${esc(v)}</td></tr>`).join("") +
        "</table>";
      const win = ankamon.ui.Dialog.window(caption, 680, { maximizable: true });
      // Kipli kalsın (WindowDock pencereleri kipsizleştirir; bu işaretle istisna — bkz. ui.WindowDock).
      win.setUserData("ankamon.keepModal", true);
      win.set({ modal: true, resizable: true, maxHeight: 640 });
      const view = new qx.ui.basic.Label(html).set({ rich: true, wrap: true, selectable: true, allowGrowX: true });
      win.add(new qx.ui.container.Scroll(view).set({ minHeight: 120 }), { flex: 1 });
      const copy = new qx.ui.form.Button("Kopyala");
      copy.addListener("execute", () => ankamon.util.Clipboard.copy(shown.map(([k, v]) => `${k}: ${v}`).join("\n")));
      const close = new qx.ui.form.Button("Kapat");
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [copy, close]);
      win.open();
      close.focus();
      return win;
    }
  }
});
