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
 * Ayarlar: herkese açık "Görünüm" (tema) sekmesi + yalnız yöneticiye görünen "Tahta erişimi"
 * (SSH + Samba + ekran istemcisinin otomatik kurulumu), "Ağ arabirimleri" (sunucunun kartları — yalnız liste) ve
 * "Ders saatleri" (ui.LessonTimesEditor, /api/lesson-times)
 * sekmeleri. Sayfa herkese açıktır (bkz. ui.Shell.PAGES); admin
 * olmayan kullanıcı yalnız kendi tema tercihini görür (sekme yok, tek bölüm doğrudan), `/settings`
 * admin uç noktasına hiç istek atılmaz. Admin'de bölümler dikey uzamak yerine kategori başına bir
 * sekmede toplanır; "Kaydet" tüm sekmelerdeki formları (hangisi görünür olursa olsun, hepsi DOM'da
 * kalır, TabView yalnız gizler) tek seferde kaydeder.
 */
qx.Class.define("ankamon.page.Settings", {
  extend: ankamon.page.Base,

  construct(user) {
    super(user, "Ayarlar");
    // Genişlik sınırı yok: sekme başlıkları kalan genişliği kullanır, kaydırma düğmeleri yalnız alan daralınca çıkar.
    // Form bölümlerinin okunaklı genişliği __section'da korunur.
    this.__body = new qx.ui.container.Composite(new qx.ui.layout.VBox(12));
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

      const orgPage = this.__page("Kuruluş");
      const org = new ankamon.ui.Form();
      org.text("name", "Kuruluş adı", (settings.organization || {}).name || "");
      org.text("code", "Kuruluş kodu", (settings.organization || {}).code || "");
      this.__section(orgPage, "Kuruluş",
        "Okul ya da kurumun adı ve kodu (ör. MEB kurum kodu). Bildirim başlıklarında görünür; Sağlık ▸ Bildirimler'deki ntfy konu önerisi bunlardan türetilir.", org);
      tabs.add(orgPage);

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
        "Tahtalar sayfasındaki ekran önizlemesi ve fare/klavye ile müdahale için tahtada x11vnc gerekir. Bu seçenek " +
        "açıkken, ağda olan ama x11vnc'si kurulu olmayan tahtaya hazır işlemlerdeki \"Ekran istemcisini (x11vnc) " +
        "kur\" arka planda kendiliğinden uygulanır; kurulum sürerken önizlemede \"İstemci yükleniyor…\" yazar.", vncAuto);
      access.add(new qx.ui.basic.Label(
        `Tahtalar loglarını bu sunucunun <b>${settings.syslog_port}</b> numaralı portuna (TCP ya da UDP) gönderir. ` +
        `Sensör verisi tahtalardan <b>${settings.scrape_interval}</b> aralıkla okunur.`
      ).set({ rich: true, wrap: true, textColor: "app-muted" }));
      tabs.add(access);

      // Ağ arabirimleri (kullanıcı isteği 2026-11-10): tahta ağı / idari ağ ayrımı YOK — sunucunun bütün kartları listelenir
      // ve Ankamon bütün hizmetlerini hepsi üzerinden yürütür (bkz. worker/ankamon/netroles.py, SettingsApi::interfaces).
      const netPage = this.__page("Ağ arabirimleri");
      this.__section(netPage, "Ağ arabirimleri",
        "Sunucunun işletim sisteminde bulunan ağ kartları; \"Etkin\" kutusuyla bir kart kablo çıkarmadan devre dışı bırakılır ya da " +
        "yeniden devreye alınır (sunucu yeniden başlasa da korunur). Ankamon'un bütün giriş/çıkış hizmetleri etkin kartların " +
        "<b>hepsi</b> üzerinden çalışır; ağlar arasında rol ayrımı (tahta ağı / idari ağ) yoktur: panel ve web terminal, " +
        `log alımı (port ${settings.syslog_port}), sensör okuma, SSH/Samba ile tahta yönetimi, ağ taraması ve görülen akış ` +
        "gözlemi, servis/paylaşım/etkinlik taramaları, loglardan tahta kaydı, Wake-on-LAN (tahtanın bulunduğu ağa), ekran " +
        "yansıtma ve yerel ad duyurusu (Avahi). Bir cihazın tahta olup olmadığına hangi ağda görüldüğü değil MAC adresi karar " +
        "verir (ETAP tahta önekleri; uymayan tahtanın Bilgisayar ayrıntıları'nda varlık türü \"Akıllı tahta\" seçilir). Yeni bir " +
        "kart takılınca ya da adresi değişince bir sonraki ağ taramasında kendiliğinden kullanılmaya başlar; ağ başına taramayı " +
        "durdurmak için Ağ ▸ Varlıklar ▸ <i>Ağlar</i> düğmesi. Kartlar arasında IP yönlendirmesi yapılmaz (ağlar birbirine " +
        "açılmaz).", this.__ifaceTable(settings.interfaces), 900);
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
          await ankamon.io.Api.put("/settings", {
            ssh_access: ssh.values(),
            samba_access: samba.values(),
            screen_vnc_autoinstall: vncAuto.getValue(),
            organization: org.values()
          });
          await ankamon.io.Api.put("/lesson-times", lessons.getValue());
          ankamon.ui.Dialog.alert("Ayarlar kaydedildi.");
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
    /** Sunucunun ağ kartları tablosu (SettingsApi::interfaces): ad, tür, durum, MAC, hız, IPv4 adresleri. */
    __ifaceTable(interfaces) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(0));
      this.__fillIfaceTable(box, interfaces || []);
      return box;
    },

    /**
     * Kart tablosu (SettingsApi::interfaces): Etkin (kablo çıkarmadan aç/kapat — kullanıcı isteği 2026-11-10; POST
     * /settings/interface → root netif-ops servisi), ad, tür, bağlantı, MAC, hız, IPv4. Tarayıcının bağlandığı kart
     * (serving) kapatılmak istenirse panel bağlantısının kopacağı söylenip onay istenir.
     */
    __fillIfaceTable(box, list) {
      box.removeAll().forEach(w => w.dispose());
      if (!list.length) {
        box.add(new qx.ui.basic.Label("Ağ arabirimi bulunamadı."));
        return;
      }
      const KIND = { wired: "Kablolu", wireless: "Kablosuz", virtual: "Sanal" };
      const grid = new qx.ui.container.Composite(new qx.ui.layout.Grid(14, 6));
      ["Etkin", "Arabirim", "Tür", "Bağlantı", "MAC", "Hız", "IPv4 adresi"].forEach((h, col) =>
        grid.add(new qx.ui.basic.Label(h).set({ textColor: "app-muted", font: "bold" }), { row: 0, column: col }));
      list.forEach((i, idx) => {
        const row = idx + 1;
        const check = new qx.ui.form.CheckBox().set({ value: !!i.enabled, alignY: "top",
          toolTipText: i.enabled ? "Kartı pasif yap (kablo çıkarmadan devre dışı bırakır)" : "Kartı etkinleştir" });
        check.addListener("changeValue", async e => {
          if (check.getUserData("reverting")) {
            return;
          }
          const enabled = e.getData();
          const revert = () => {
            check.setUserData("reverting", true);
            check.setValue(!enabled);
            check.setUserData("reverting", false);
          };
          if (!enabled) {
            const others = list.filter(o => o !== i && o.enabled && o.kind !== "virtual").length;
            const warn = i.serving
              ? `<b style="color:#c5221f">Dikkat:</b> şu an bu panele <b>${qx.bom.String.escape(i.name)}</b> kartı üzerinden ` +
                "bağlısınız. Kart pasif olunca tarayıcınızın Ankamon bağlantısı KOPAR; yeniden açmak için başka bir karttan " +
                "bağlanmanız ya da sunucuda kartı elle açmanız gerekir.<br><br>"
              : "";
            const last = !others ? "Bu, sunucunun etkin son fiziksel kartı: kapatılınca hiçbir ağa erişilemez.<br><br>" : "";
            const sure = await ankamon.ui.Dialog.confirm(`${warn}${last}<b>${qx.bom.String.escape(i.name)}</b> kartı pasif ` +
              "yapılsın mı? Bu karttaki ağlarda tarama, log alımı, tahta yönetimi ve panel erişimi durur; ayar sunucu yeniden " +
              "başlasa da korunur.", "Pasif yap");
            if (!sure) {
              revert();
              return;
            }
          }
          check.setEnabled(false);
          try {
            const res = await ankamon.io.Api.post("/settings/interface", { name: i.name, enabled });
            this.__fillIfaceTable(box, res.interfaces || list);
          } catch (err) {
            revert();
            check.setEnabled(true);
            ankamon.ui.Dialog.error(err);
          }
        });
        grid.add(check, { row, column: 0 });
        grid.add(new qx.ui.basic.Label(i.name + (i.serving ? " ●" : "")).set({ font: "bold",
          toolTipText: i.serving ? "Tarayıcınız Ankamon'a bu kart üzerinden bağlı" : null }), { row, column: 1 });
        grid.add(new qx.ui.basic.Label(KIND[i.kind] || ""), { row, column: 2 });
        const link = !i.enabled ? ["Pasif", "#c5221f"] : i.carrier ? ["Bağlı", "#1e8e3e"] : ["Bağlantı yok", "#e37400"];
        grid.add(new qx.ui.basic.Label(link[0]).set({ textColor: link[1] }), { row, column: 3 });
        grid.add(new qx.ui.basic.Label(i.mac || "—").set({ selectable: true, font: "monospace" }), { row, column: 4 });
        grid.add(new qx.ui.basic.Label(i.speed ? (i.speed >= 1000 ? i.speed / 1000 + " Gbit/sn" : i.speed + " Mbit/sn") : "—"), { row, column: 5 });
        grid.add(new qx.ui.basic.Label(i.addresses.length ? i.addresses.map(qx.bom.String.escape).join("<br>")
          : "<span style='opacity:.6'>IPv4 adresi yok</span>").set({ rich: true, selectable: true }), { row, column: 6 });
      });
      box.add(grid);
      if (list.some(i => i.serving)) {
        box.add(new qx.ui.basic.Label("● Tarayıcınızın Ankamon'a bağlandığı kart.").set({ textColor: "app-muted", marginTop: 6 }));
      }
    },

    /** Sekme sayfası: TabView.Page düz bir qx.ui.core.Widget değildir — VBox düzeni elle kurulur. */
    __page(label) {
      const page = new qx.ui.tabview.Page(label);
      page.setLayout(new qx.ui.layout.VBox(12));
      return page;
    },

    __section(target, title, hint, form, maxWidth = 620) {
      const box = new qx.ui.container.Composite(new qx.ui.layout.VBox(10)).set({
        padding: 16,
        maxWidth,
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
