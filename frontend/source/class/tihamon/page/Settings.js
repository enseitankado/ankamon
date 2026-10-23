/**
 * Ayarlar: herkese açık "Görünüm" (tema) sekmesi + yalnız yöneticiye görünen "Tahta erişimi"
 * (SSH + Samba + ekran istemcisinin otomatik kurulumu) ve "Ders saatleri" (ui.LessonTimesEditor, /api/lesson-times)
 * sekmeleri. Sayfa herkese açıktır (bkz. ui.Shell.PAGES); admin
 * olmayan kullanıcı yalnız kendi tema tercihini görür (sekme yok, tek bölüm doğrudan), `/settings`
 * admin uç noktasına hiç istek atılmaz. Admin'de bölümler dikey uzamak yerine kategori başına bir
 * sekmede toplanır; "Kaydet" tüm sekmelerdeki formları (hangisi görünür olursa olsun, hepsi DOM'da
 * kalır, TabView yalnız gizler) tek seferde kaydeder.
 */
qx.Class.define("tihamon.page.Settings", {
  extend: tihamon.page.Base,

  construct(user) {
    super(user, "Ayarlar");
    this.__body = new qx.ui.container.Composite(new qx.ui.layout.VBox(12)).set({ maxWidth: 620 });
    this.add(this.__body, { flex: 1 });
  },

  members: {
    __body: null,

    async _refresh() {
      this.__body.removeAll().forEach(widget => widget.dispose());
      if (!this._user.is_admin) {
        this.__addThemeSection(this.__body);
        return;
      }

      const settings = await tihamon.io.Api.get("/settings");
      const tabs = new qx.ui.tabview.TabView();

      const view = this.__page("Görünüm");
      this.__addThemeSection(view);
      tabs.add(view);

      const access = this.__page("Tahta erişimi");
      const ssh = new tihamon.ui.Form();
      ssh.text("user", "Kullanıcı adı", settings.ssh_access.user);
      ssh.password("password", "Parola", settings.ssh_access.password_set ? "kayıtlı — değiştirmek için yazın" : "henüz girilmedi");
      this.__section(access, "SSH erişimi",
        "Uzaktan işlemler, toplu komut ve web terminal tahtalara bu hesapla bağlanır. " +
        "TiHA yalnız root ve etapadmin hesaplarına SSH izni verir.", ssh);
      const samba = new tihamon.ui.Form();
      samba.text("user", "Kullanıcı adı", settings.samba_access.user);
      samba.password("password", "Parola", settings.samba_access.password_set ? "kayıtlı — değiştirmek için yazın" : "henüz girilmedi");
      this.__section(access, "Samba erişimi",
        "TiHA'nın \"Dosya sunucusu\" adımıyla açtığı paylaşımın hesabı. SSH'tan bağımsız olarak saklanır.", samba);
      // Ekranlar: tahtada x11vnc yoksa "Ekran istemcisini kur" arka planda kendiliğinden çalışsın mı
      // (bkz. worker/tihamon/screen/__main__.py; kutucukta "İstemci yükleniyor…" görünür).
      const vncAuto = new qx.ui.form.CheckBox("Ekran istemcisini otomatik kur").set({
        value: settings.screen_vnc_autoinstall !== false
      });
      this.__section(access, "Ekran izleme",
        "Ekranlar sekmesinde önizleme ve fare/klavye ile müdahale için tahtada x11vnc gerekir. Bu seçenek " +
        "açıkken, ağda olan ama x11vnc'si kurulu olmayan tahtaya hazır işlemlerdeki \"Ekran istemcisini (x11vnc) " +
        "kur\" arka planda kendiliğinden uygulanır; kurulum sürerken önizlemede \"İstemci yükleniyor…\" yazar.", vncAuto);
      access.add(new qx.ui.basic.Label(
        `Tahtalar loglarını bu sunucunun <b>${settings.syslog_port}</b> numaralı portuna (TCP ya da UDP) gönderir. ` +
        `Sensör verisi tahtalardan <b>${settings.scrape_interval}</b> aralıkla okunur.`
      ).set({ rich: true, wrap: true, textColor: "app-muted" }));
      tabs.add(access);

      const lessonsPage = this.__page("Ders saatleri");
      const lessons = new tihamon.ui.LessonTimesEditor(await tihamon.io.Api.get("/lesson-times"));
      this.__section(lessonsPage, "Okulun ders saatleri",
        "Her dersin başlangıç ve bitiş saati (teneffüs ve öğle arası, dersler arasındaki boşluktur). " +
        "Oturumlar ▸ Kullanıcılar çizelgesinde bir oturumun üzerine gelince hangi derslere denk geldiği " +
        "(ör. \"1. ders: 5 dk sonra açıldı, bitimden 2 dk önce kapandı\") bu saatlere göre yazılır.", lessons);
      tabs.add(lessonsPage);

      // Eklentiler (ext/<ad>): yüklü eklentiler ve ayar şemalarını bildirenlerin formu (bkz.
      // ui.ExtensionsSettings, Core\Extensions). Kendi "Kaydet"i vardır; aşağıdaki global Kaydet'e girmez.
      const extPage = this.__page("Eklentiler");
      extPage.add(new tihamon.ui.ExtensionsSettings(), { flex: 1 });
      tabs.add(extPage);

      this._rememberTab(tabs, "settings"); // sekmeler her yüklemede yeniden kurulur; son seçili geri gelir
      this._hideTabBar(tabs); // sekmeler sol ağaçta "Ayarlar"ın alt seçenekleri (bkz. ui.Shell PAGES tabs)

      this.__body.add(tabs, { flex: 1 });

      const save = new qx.ui.form.Button("Kaydet").set({ allowGrowX: false, marginTop: 12 });
      save.addListener("execute", async () => {
        try {
          await tihamon.io.Api.put("/settings", {
            ssh_access: ssh.values(),
            samba_access: samba.values(),
            screen_vnc_autoinstall: vncAuto.getValue()
          });
          await tihamon.io.Api.put("/lesson-times", lessons.getValue());
          tihamon.ui.Dialog.alert("Ayarlar kaydedildi.");
          this.refresh();
        } catch (e) {
          tihamon.ui.Dialog.error(e);
        }
      });
      this.__body.add(save);
    },

    __addThemeSection(target) {
      const form = new qx.ui.container.Composite(new qx.ui.layout.VBox(8));
      const box = new qx.ui.form.SelectBox();
      const registry = tihamon.theme.Registry;
      Object.keys(registry.THEMES).forEach(key => {
        const item = new qx.ui.form.ListItem(registry.THEMES[key].label, null, key);
        box.add(item);
        if (key === (this._user.theme || registry.DEFAULT)) {
          box.setSelection([item]);
        }
      });
      box.addListener("changeSelection", async e => {
        const item = e.getData()[0];
        if (!item) {
          return;
        }
        const key = item.getModel();
        box.setEnabled(false);
        try {
          await tihamon.io.Api.put("/auth/theme", { theme: key });
        } catch (err) {
          box.setEnabled(true);
          tihamon.ui.Dialog.error(err);
          return;
        }
        // Sayfa yeniden yüklenir (anında, DOM'da canlı uygulamak yerine): qx.ui.table.Table satırları
        // tema değişince kendiliğinden yeniden boyar ama sütun BAŞLIĞI (qx.ui.table.pane.Header
        // widget'ları) canlı tema değişiminde boyanmıyor — eski temanın renginde TAKILI kalıyor
        // (çerçevenin kendi bir eksiği/hatası; ölçüldü: iki ayrı tahta/loglar gibi tüm grid'lerde aynı).
        // Açılışta (Application.js tema sayfa oluşturulmadan ÖNCE uygulanıyor) sorun yok — bu yüzden
        // en güvenilir düzeltme, canlı DOM güncellemesi yerine sayfayı yeniden yüklemek. Yüklenince
        // Genel bakış'a değil yine Ayarlar'a dönülür (kullanıcı isteği; bkz. Shell.REOPEN_KEY).
        try {
          sessionStorage.setItem(tihamon.ui.Shell.REOPEN_KEY, "settings");
        } catch (storageErr) {
          // sessionStorage yoksa yalnız ilk sayfa açılır — tema yine uygulanır.
        }
        window.location.reload();
      });
      form.add(box);
      this.__section(target, "Görünüm", "Tema seçimi seçer seçmez uygulanır (sayfa yeniden yüklenir) ve hesabınızda saklanır.", form);
    },

    /** Sekme sayfası: TabView.Page düz bir qx.ui.core.Widget değildir — VBox düzeni elle kurulur. */
    __page(label) {
      const page = new qx.ui.tabview.Page(label);
      page.setLayout(new qx.ui.layout.VBox(12));
      return page;
    },

    __section(target, title, hint, form) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(10)).set({
        padding: 16,
        backgroundColor: "surface",
        decorator: new qx.ui.decoration.Decorator().set({ radius: 8, width: 1, color: "app-border" })
      });
      box.add(new qx.ui.basic.Label(title).set({ font: "bold" }));
      box.add(new qx.ui.basic.Label(hint).set({ rich: true, wrap: true, textColor: "app-muted" }));
      box.add(form);
      target.add(box);
    }
  }
});
