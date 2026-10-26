/**
 * Ayarlar: herkese açık "Görünüm" (tema) sekmesi + yalnız yöneticiye görünen "Tahta erişimi"
 * (SSH + Samba + ekran istemcisinin otomatik kurulumu), "Ağ arabirimleri" (tahta/idari ağ rolleri) ve
 * "Ders saatleri" (ui.LessonTimesEditor, /api/lesson-times)
 * sekmeleri. Sayfa herkese açıktır (bkz. ui.Shell.PAGES); admin
 * olmayan kullanıcı yalnız kendi tema tercihini görür (sekme yok, tek bölüm doğrudan), `/settings`
 * admin uç noktasına hiç istek atılmaz. Admin'de bölümler dikey uzamak yerine kategori başına bir
 * sekmede toplanır; "Kaydet" tüm sekmelerdeki formları (hangisi görünür olursa olsun, hepsi DOM'da
 * kalır, TabView yalnız gizler) tek seferde kaydeder.
 */
qx.Class.define("ankamon.page.Settings", {
  extend: ankamon.page.Base,

  statics: {
    /**
     * Ağ rolleri değiştiyse kayıt onayına eklenir: ayar yeniden başlatmasız geçerlidir ama her iş onu kendi
     * sonraki çalışmasında okur (bkz. worker/ankamon/netroles.py ve netscan döngüleri).
     */
    NET_ROLES_NOTICE:
      "<br><br><b>Ağ arabirimi seçimi</b> yeniden başlatma gerekmeden geçerli; işler yeni seçimi kendi " +
      "sonraki çalışmalarında kullanır:" +
      "<ul style='margin:6px 0 8px;padding-left:18px'>" +
      "<li>Servis, paylaşım, etkinlik ve ad taramaları: hemen (o an taranan cihaz eski seçimle biter)</li>" +
      "<li>Görülen akış gözlemi: en geç ~35 sn</li>" +
      "<li>Loglardan tahta kaydı ve IP güncellemesi: en geç 1 dk</li>" +
      "<li>Ağ taraması: bir sonraki taramada (yüke göre 30 sn – 5 dk); hemen başlatmak için " +
      "Ağ ▸ <i>Şimdi tara</i></li>" +
      "</ul>" +
      "Artık tahta ağı sayılmayan ağlarda önceden bulunan cihazlar Ağ listesinde kalır, yalnız taranmaz."
  },

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

      const settings = await ankamon.io.Api.get("/settings");
      const tabs = new qx.ui.tabview.TabView();

      const view = this.__page("Görünüm");
      this.__addThemeSection(view);
      tabs.add(view);

      const access = this.__page("Tahta erişimi");
      const ssh = new ankamon.ui.Form();
      ssh.text("user", "Kullanıcı adı", settings.ssh_access.user);
      ssh.password("password", "Parola", settings.ssh_access.password_set ? "kayıtlı — değiştirmek için yazın" : "henüz girilmedi");
      this.__section(access, "SSH erişimi",
        "Uzaktan işlemler, toplu komut ve web terminal tahtalara bu hesapla bağlanır. " +
        "TiHA yalnız root ve etapadmin hesaplarına SSH izni verir.", ssh);
      const samba = new ankamon.ui.Form();
      samba.text("user", "Kullanıcı adı", settings.samba_access.user);
      samba.password("password", "Parola", settings.samba_access.password_set ? "kayıtlı — değiştirmek için yazın" : "henüz girilmedi");
      this.__section(access, "Samba erişimi",
        "TiHA'nın \"Dosya sunucusu\" adımıyla açtığı paylaşımın hesabı. SSH'tan bağımsız olarak saklanır.", samba);
      // Ekranlar: tahtada x11vnc yoksa "Ekran istemcisini kur" arka planda kendiliğinden çalışsın mı
      // (bkz. worker/ankamon/screen/__main__.py; kutucukta "İstemci yükleniyor…" görünür).
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

      // Ağ rolleri (bkz. worker/ankamon/netroles.py): sunucu tahta ağına ve idari ağa ayrı kartlarla
      // bağlıysa tahta işleri yalnız tahta ağında yapılır; idari ağa taşmaz.
      const netPage = this.__page("Ağ arabirimleri");
      const roles = settings.network_roles || {};
      const boardIface = this.__ifaceBox(settings.interfaces, roles.board_iface, "Otomatik (bağlı her ağ)");
      const adminIface = this.__ifaceBox(settings.interfaces, roles.admin_iface, "Seçilmedi");
      const netForm = new qx.ui.container.Composite(new qx.ui.layout.Grid(10, 8));
      netForm.getLayout().setColumnFlex(1, 1);
      netForm.add(new qx.ui.basic.Label("Tahta ağı"), { row: 0, column: 0 });
      netForm.add(boardIface, { row: 0, column: 1 });
      netForm.add(new qx.ui.basic.Label("İdari ağ"), { row: 1, column: 0 });
      netForm.add(adminIface, { row: 1, column: 1 });
      this.__section(netPage, "Ağ arabirimleri",
        "Sunucu tahta ağına ve idari ağa ayrı kartlarla bağlıysa hangisinin hangisi olduğunu seçin. " +
        "<b>Yalnız tahta ağında</b> yapılanlar: ağ taraması ve görülen akış gözlemi, servis/paylaşım/etkinlik " +
        "taramaları, loglardan otomatik tahta kaydı ve tahta IP'sinin güncellenmesi; tahtaların Samba parolası da " +
        "yalnız kayıtlı tahtalarda denenir. <b>İki ağda da</b> çalışanlar: panel, web terminal, log alımı " +
        `(port ${settings.syslog_port}), Wake-on-LAN (tahtanın ağına, o arabirimin maskesiyle), ekran yansıtma ` +
        "ve yerel ad duyurusu (Avahi). Yalnız idari ağ seçilirse, yalnız o karta bağlı ağlar dışındaki her ağ " +
        "tahta ağı sayılır. İki kart aynı ağdaysa o ağ ikisi birden sayılır.", netForm);
      tabs.add(netPage);

      const lessonsPage = this.__page("Ders saatleri");
      const lessons = new ankamon.ui.LessonTimesEditor(await ankamon.io.Api.get("/lesson-times"));
      this.__section(lessonsPage, "Okulun ders saatleri",
        "Her dersin başlangıç ve bitiş saati (teneffüs ve öğle arası, dersler arasındaki boşluktur). " +
        "Oturumlar ▸ Kullanıcılar çizelgesinde bir oturumun üzerine gelince hangi derslere denk geldiği " +
        "(ör. \"1. ders: 5 dk sonra açıldı, bitimden 2 dk önce kapandı\") bu saatlere göre yazılır.", lessons);
      tabs.add(lessonsPage);

      // Eklentiler (ext/<ad>): yüklü eklentiler ve ayar şemalarını bildirenlerin formu (bkz.
      // ui.ExtensionsSettings, Core\Extensions). Kendi "Kaydet"i vardır; aşağıdaki global Kaydet'e girmez.
      const extPage = this.__page("Eklentiler");
      extPage.add(new ankamon.ui.ExtensionsSettings(), { flex: 1 });
      tabs.add(extPage);

      this._rememberTab(tabs, "settings"); // sekmeler her yüklemede yeniden kurulur; son seçili geri gelir

      this.__body.add(tabs, { flex: 1 });

      const save = new qx.ui.form.Button("Kaydet").set({ allowGrowX: false, marginTop: 12 });
      save.addListener("execute", async () => {
        try {
          const newRoles = {
            board_iface: boardIface.getSelection()[0].getModel(),
            admin_iface: adminIface.getSelection()[0].getModel()
          };
          await ankamon.io.Api.put("/settings", {
            ssh_access: ssh.values(),
            samba_access: samba.values(),
            screen_vnc_autoinstall: vncAuto.getValue(),
            network_roles: newRoles
          });
          await ankamon.io.Api.put("/lesson-times", lessons.getValue());
          const rolesChanged = newRoles.board_iface !== (roles.board_iface || "") ||
            newRoles.admin_iface !== (roles.admin_iface || "");
          ankamon.ui.Dialog.alert("Ayarlar kaydedildi." + (rolesChanged ? ankamon.page.Settings.NET_ROLES_NOTICE : ""));
          this.refresh();
        } catch (e) {
          ankamon.ui.Dialog.error(e);
        }
      });
      this.__body.add(save);
    },

    __addThemeSection(target) {
      const form = new qx.ui.container.Composite(new qx.ui.layout.VBox(8));
      const box = new qx.ui.form.SelectBox();
      const registry = ankamon.theme.Registry;
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
          await ankamon.io.Api.put("/auth/theme", { theme: key });
        } catch (err) {
          box.setEnabled(true);
          ankamon.ui.Dialog.error(err);
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
          sessionStorage.setItem(ankamon.ui.Shell.REOPEN_KEY, "settings");
        } catch (storageErr) {
          // sessionStorage yoksa yalnız ilk sayfa açılır — tema yine uygulanır.
        }
        window.location.reload();
      });
      form.add(box);
      this.__section(target, "Görünüm", "Tema seçimi seçer seçmez uygulanır (sayfa yeniden yüklenir) ve hesabınızda saklanır.", form);
    },

    /**
     * Arabirim seçimi: ilk seçenek boş değer (otomatik/seçilmedi), sonra sunucunun kartları ("eth1 —
     * 10.0.0.5/16"). Kayıtlı arabirim artık yoksa (kart söküldü) yine listede tutulur ki seçim kaybolmasın.
     */
    __ifaceBox(interfaces, current, emptyLabel) {
      const box = new qx.ui.form.SelectBox();
      const items = [{ name: "", label: emptyLabel }].concat((interfaces || []).map(i => ({
        name: i.name,
        label: `${i.name} — ${i.addresses.length ? i.addresses.join(", ") : "IPv4 adresi yok"}${i.up ? "" : " (kapalı)"}`
      })));
      if (current && !items.some(i => i.name === current)) {
        items.push({ name: current, label: `${current} — şu an bulunamadı` });
      }
      items.forEach(i => {
        const item = new qx.ui.form.ListItem(i.label, null, i.name);
        box.add(item);
        if (i.name === (current || "")) {
          box.setSelection([item]);
        }
      });
      return box;
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
