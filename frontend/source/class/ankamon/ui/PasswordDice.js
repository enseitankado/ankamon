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
 * Parola kutularının yanına "🎲 Rastgele" düğmesi ve "Göster" kutusu (kullanıcı isteği 2026-11-13; Parola ayarla
 * penceresi, Yönetici hesapları sekmesi).
 *
 * Rastgele parola 8 karakterdir: harf ve rakam karışık, en az bir rakam, bir küçük ve bir büyük harf. Birbirine
 * benzeyen karakterler (0/O, 1/l/I) kullanılmaz — parola çoğu zaman ekrandan okunup öğrenciye söylenir. Tarayıcının
 * şifreleme rastgeleliğiyle (crypto.getRandomValues) üretilir.
 *
 * Düğmeye basılınca parola verilen bütün kutulara (parola + tekrar) yazılır ve kutular açık metne geçer, "Göster"
 * işaretlenir: kullanıcı parolayı görüp not alır. "Göster" kaldırılınca kutular yeniden gizlenir; elle yazarken de
 * aynı kutu kullanılır.
 */
qx.Class.define("ankamon.ui.PasswordDice", {
  type: "static",

  statics: {
    /** Karışmayan karakterler (0 O 1 l I yok). */
    DIGITS: "23456789",
    LOWER: "abcdefghijkmnopqrstuvwxyz",
    UPPER: "ABCDEFGHJKLMNPQRSTUVWXYZ",

    /** @return {String} rastgele parola (varsayılan 8 karakter; rakam + küçük + büyük harf her birinden en az bir) */
    make(length = 8) {
      const pick = set => set[this.__random(set.length)];
      const all = this.DIGITS + this.LOWER + this.UPPER;
      const chars = [pick(this.DIGITS), pick(this.LOWER), pick(this.UPPER)];
      while (chars.length < length) {
        chars.push(pick(all));
      }
      // Fisher–Yates: zorunlu karakterler hep başta kalmasın.
      for (let i = chars.length - 1; i > 0; i--) {
        const j = this.__random(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      return chars.join("");
    },

    /** Eşit dağılımlı 0..n-1 (modulo sapması olmadan). */
    __random(n) {
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      do {
        window.crypto.getRandomValues(buf);
      } while (buf[0] >= limit);
      return buf[0] % n;
    },

    /**
     * Kutuları açık metin / gizli yapar.
     * @param fields {qx.ui.form.PasswordField[]}
     */
    reveal(fields, on) {
      fields.forEach(f => {
        const el = f.getContentElement();
        el.setAttribute("type", on ? "text" : "password");
        const dom = el.getDomElement();
        if (dom) {
          dom.type = on ? "text" : "password";
        }
      });
    },

    /**
     * "🎲 Rastgele" düğmesi + "Göster" kutusu.
     * @param fields {qx.ui.form.PasswordField[]} parolanın yazılacağı kutular (ilki asıl kutu)
     * @return {qx.ui.container.Composite}
     */
    controls(fields) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.HBox(8).set({ alignY: "middle" }));
      const dice = new qx.ui.form.Button("🎲 Rastgele").set({
        toolTipText: "8 karakterlik rastgele parola üretir (harf ve rakam, karışan 0/O, 1/l/I yok), iki kutuya da yazar ve gösterir"
      });
      const show = new qx.ui.form.CheckBox("Göster").set({ toolTipText: "Parolayı açık metin olarak göster" });
      show.addListener("changeValue", e => this.reveal(fields, e.getData()));
      dice.addListener("execute", () => {
        const value = this.make();
        fields.forEach(f => f.setValue(value));   // changeValue: eşleşme notu ve düğmeler tazelenir
        show.setValue(true);
        fields[0].focus();
      });
      box.add(dice);
      box.add(show);
      return box;
    }
  }
});
