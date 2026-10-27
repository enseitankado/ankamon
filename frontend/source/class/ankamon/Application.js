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
 * Ankamon uygulaması: oturum durumuna göre giriş ekranını ya da ana kabuğu gösterir.
 *
 * @asset(ankamon/*)
 *
 * Not: Tango simgeleri (qx/icon/Tango/16/*) kasıtlı olarak paketlenmiyor — bu derlenmiş build'de
 * background-image tabanlı simgelerin URL'si güvenilmez üretiliyordu (bkz. ankamon.ui.Shell.ICON
 * başındaki not); tüm düğüm/menü simgeleri artık metin tabanlı Unicode karakter.
 */
qx.Class.define("ankamon.Application", {
  extend: qx.application.Standalone,

  members: {
    __view: null,

    main() {
      super.main();

      if (qx.core.Environment.get("qx.debug")) {
        qx.log.appender.Native;
      }
      qx.locale.Manager.getInstance().setLocale("tr");

      // Kalıcı (modal) bir pencere açıkken qx, kök bileşenin tamamını (üst menü + sol ağaç + o anki
      // sayfa) görünmez bir "blocker" ile örtüp tıklama/klavyeyi engeller (bkz. qx.ui.core.MBlocker,
      // qx.ui.window.Manager.syncWidget → blockContent) — ama varsayılan rengi yoktur (saydam),
      // kullanıcı devre dışı kaldığını GÖRMEDEN farkına varamıyordu. Rengi burada bir kez
      // ayarlamak, tema/pencereden bağımsız tüm modallar için aynı saydam açık gri görünümü verir.
      this.getRoot().set({ blockerColor: "#808080", blockerOpacity: 0.35 });
      // Grid'lerde sağ tıklama işaret (✓) değiştirmez, yalnız satırı seçip sağ menüyü açar.
      ankamon.ui.table.RightClickPatch.install();

      const boot = document.getElementById("boot");
      if (boot) {
        boot.remove();
      }

      qx.event.message.Bus.subscribe(ankamon.io.Api.UNAUTHORIZED, () => this.__showLogin());
      this.__start();
    },

    async __start() {
      try {
        const user = await ankamon.io.Api.get("/auth/me");
        // Shell/sayfalar oluşturulmadan önce uygulanır ki ilk çizim doğrudan doğru temayla olsun.
        ankamon.theme.Registry.apply(user.theme);
        // Eklentiler Shell'den ÖNCE başlar: sekme/kanca kayıtları (ör. Bakım sekmesi) sol ağaç kurulurken hazır olsun.
        await ankamon.ext.Extensions.start({ user, app: this });
        this.__show(new ankamon.ui.Shell(user));
      } catch (e) {
        this.__showLogin();
      }
    },

    __showLogin() {
      if (this.__view instanceof ankamon.ui.Login) {
        return;
      }
      const login = new ankamon.ui.Login();
      login.addListener("login", () => this.__start());
      this.__show(login);
    },

    __show(view) {
      if (this.__view) {
        this.getRoot().remove(this.__view);
        this.__view.dispose();
      }
      this.__view = view;
      // Kök'ün varsayılan düzeni Basic'tir; "left/top/right/bottom: 0" ile tam kaplama (stretch-anchor)
      // sağlanır. Önceki "{ edge: 0 }" Basic'te geçersizdi — Shell ilk render genişliğinde donuk
      // kalıyor, pencere daralsa/büyüse de hiç küçülüp büyümüyordu (sorumlu bileşen responsive
      // düzenlemesi ne olursa olsun tetiklenmiyordu, çünkü üst kapsayıcı zaten hiç küçülmüyordu).
      this.getRoot().add(view, { left: 0, top: 0, right: 0, bottom: 0 });
    }
  }
});
