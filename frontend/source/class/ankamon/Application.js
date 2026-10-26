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
