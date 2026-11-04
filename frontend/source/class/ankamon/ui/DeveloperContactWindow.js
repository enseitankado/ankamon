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
 * Üst çubuktaki Ankamon simgesi → geliştiriciye (Özgür Koca, ozgurkoca.com) anonim mesaj. Gönderim sunucudan ntfy.sh'nin
 * ankamon-iletisim konusuna (bkz. backend DeveloperContactApi): kullanıcı ya da kurum bilgisi eklenmez, metin saklanmaz.
 */
qx.Class.define("ankamon.ui.DeveloperContactWindow", {
  type: "static",

  statics: {
    MAX_CHARS: 4096,

    INTRO:
      "Ankamon; ETAP ve FATİH ağının gerçek koşulları düşünülerek, okullardaki akıllı tahtaların ve Pardus " +
      "bilgisayarların yönetimi, bakımı ve izlenmesi için geliştirilmiş kapsamlı bir yazılım. Uzun ve zorlu bir " +
      "geliştirme sürecinden geçti; özelliklerinin çoğu sahada karşılaşılan bir sorundan doğdu.<br><br>" +
      "Onu asıl geliştirecek olan sizin deneyiminiz. Bir eleştiri, bir öneri, karşılaştığınız bir hata, eksik " +
      "bulduğunuz bir özellik ya da yalnızca bir teşekkür… Ne yazarsanız doğrudan geliştiricisi " +
      "<b>Özgür Koca</b>'ya (<a href=\"https://ozgurkoca.com\" target=\"_blank\" rel=\"noopener\">ozgurkoca.com</a>) ulaşır " +
      "ve okunur.<br><br>" +
      "<i>Mesajınız anonim gönderilir: adınız, kullanıcı adınız ya da kurumunuzun bilgisi eklenmez. Yanıt almak " +
      "isterseniz iletişim bilginizi mesaja kendiniz yazabilirsiniz.</i>",

    open() {
      const Self = ankamon.ui.DeveloperContactWindow;
      const win = ankamon.ui.Dialog.window("Geliştiriciye yazın", 600);
      win.add(new qx.ui.basic.Label(Self.INTRO).set({ rich: true, wrap: true, width: 560 }));

      const text = new qx.ui.form.TextArea("").set({
        placeholder: "Eleştiri, öneri, hata bildirimi, teşekkür…", maxLength: Self.MAX_CHARS, height: 200, wrap: true
      });
      win.add(text, { flex: 1 });
      const count = new qx.ui.basic.Label("").set({ textColor: "app-muted", alignX: "right", allowGrowX: true, textAlign: "right" });
      win.add(count);

      const send = new qx.ui.form.Button("Gönder");
      const close = new qx.ui.form.Button("Vazgeç");
      const update = () => {
        const value = text.getValue() || "";
        count.setValue(`${value.length} / ${Self.MAX_CHARS}`);
        send.setEnabled(value.trim().length > 0);
      };
      text.addListener("input", update);
      text.addListener("changeValue", update);
      update();

      send.addListener("execute", async () => {
        send.setEnabled(false);
        send.setLabel("Gönderiliyor…");
        try {
          await ankamon.io.Api.post("/developer-contact", { message: text.getValue() || "" });
          win.close();
          ankamon.ui.Dialog.alert("Mesajınız geliştiriciye iletildi. Zaman ayırdığınız için teşekkürler!", "Teşekkürler");
        } catch (e) {
          ankamon.ui.Dialog.error(e);
          if (!win.isDisposed()) {
            send.setLabel("Gönder");
            update();
          }
        }
      });
      close.addListener("execute", () => win.close());
      ankamon.ui.Dialog.buttons(win, [send, close]);
      win.open();
      text.focus();
    }
  }
});
