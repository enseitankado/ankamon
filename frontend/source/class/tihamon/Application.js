/**
 * Tiha-Mon uygulaması: oturum durumuna göre giriş ekranını ya da ana kabuğu gösterir.
 *
 * @asset(tihamon/*)
 *
 * Not: Tango simgeleri (qx/icon/Tango/16/*) kasıtlı olarak paketlenmiyor — bu derlenmiş build'de
 * background-image tabanlı simgelerin URL'si güvenilmez üretiliyordu (bkz. tihamon.ui.Shell.ICON
 * başındaki not); tüm düğüm/menü simgeleri artık metin tabanlı Unicode karakter.
 */
qx.Class.define("tihamon.Application", {
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

      qx.event.message.Bus.subscribe(tihamon.io.Api.UNAUTHORIZED, () => this.__showLogin());
      this.__start();
    },

    async __start() {
      try {
        const user = await tihamon.io.Api.get("/auth/me");
        // Shell/sayfalar oluşturulmadan önce uygulanır ki ilk çizim doğrudan doğru temayla olsun.
        tihamon.theme.Registry.apply(user.theme);
        this.__show(new tihamon.ui.Shell(user));
        tihamon.ext.Extensions.start({ user, app: this });
      } catch (e) {
        this.__showLogin();
      }
    },

    __showLogin() {
      if (this.__view instanceof tihamon.ui.Login) {
        return;
      }
      const login = new tihamon.ui.Login();
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
