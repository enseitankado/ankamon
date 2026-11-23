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
 * Disk editörünün (ui.disk.DiskEditor) mantık katmanı — arayüzsüz: cihazdan okunan disk (actions/disk-editor) + kuyruktaki
 * işlemler → GParted'deki gibi "işlemler uygulanınca disk nasıl görünecek" ön izlemesi, boşluk hesabı, hizalama ve her
 * bölümde hangi işlemin yapılabileceği. Kurallar cihazdaki uygulayıcıyla (actions/disk-editor-apply) aynıdır; orada da
 * ayrıca denetlenir.
 */
qx.Class.define("ankamon.ui.disk.DiskModel", {
  type: "static",

  statics: {
    /**
     * Dosya sistemleri: renk (GParted renkleri), araç, çevrimiçi/çevrimdışı yapılabilenler.
     * grow/shrink: false | "offline" (bağlı değilken) | "online" (bağlıyken de); label: "online" | "offline" | false.
     */
    FS: {
      ext4: { color: "#314E6C", tool: "mkfs.ext4", grow: "online", shrink: "offline", label: "online", check: true, uuid: true },
      ext3: { color: "#5A8AB5", tool: "mkfs.ext3", grow: "online", shrink: "offline", label: "online", check: true, uuid: true },
      ext2: { color: "#9DB8D2", tool: "mkfs.ext2", grow: "online", shrink: "offline", label: "online", check: true, uuid: true },
      fat32: { color: "#18D918", tool: "mkfs.vfat", grow: false, shrink: false, label: "offline", check: true, uuid: true, max: 11 },
      fat16: { color: "#16D9A0", tool: "mkfs.vfat", grow: false, shrink: false, label: "offline", check: true, uuid: true, max: 11 },
      ntfs: { color: "#42E5AC", tool: "mkfs.ntfs", grow: "offline", shrink: "offline", label: "offline", check: true, uuid: true },
      exfat: { color: "#2E8B57", tool: "mkfs.exfat", grow: false, shrink: false, label: "offline", check: true, uuid: false },
      btrfs: { color: "#FF9955", tool: "mkfs.btrfs", grow: "online", shrink: "online", label: "online", check: true, uuid: "btrfstune" },
      xfs: { color: "#EEEE00", tool: "mkfs.xfs", grow: "online", shrink: false, label: "offline", check: true, uuid: true },
      f2fs: { color: "#DF9898", tool: "mkfs.f2fs", grow: false, shrink: false, label: false, check: false, uuid: false },
      "linux-swap": { color: "#C1665A", tool: "mkswap", grow: "online", shrink: "offline", label: "online", check: false, uuid: "offline" }
    },
    /** Biçimlendirme listesinin sırası. */
    FS_ORDER: ["ext4", "ext3", "ext2", "fat32", "fat16", "ntfs", "exfat", "btrfs", "xfs", "f2fs", "linux-swap", "none"],
    COLOR_FREE: "#A9A9A9",
    COLOR_UNKNOWN: "#000000",
    COLOR_EXTENDED: "#7DFCFE",
    FLAGS: {
      gpt: ["boot", "esp", "bios_grub", "legacy_boot", "msftdata", "msftres", "hidden", "diag", "lvm", "raid", "swap"],
      msdos: ["boot", "lba", "hidden", "esp", "diag", "lvm", "raid"]
    },
    SYSTEM_MOUNTS: ["/", "/boot", "/boot/efi", "/usr", "/var", "/home"],

    fsName(fs) {
      return fs === "none" || !fs ? "biçimlendirilmemiş" : fs;
    },

    color(part) {
      if (part.kind === "free") {
        return this.COLOR_FREE;
      }
      if (part.kind === "extended") {
        return this.COLOR_EXTENDED;
      }
      return (this.FS[part.fs] || {}).color || this.COLOR_UNKNOWN;
    },

    /** 1 MiB'ta kaç sektör (hizalama birimi). */
    align(disk) {
      return Math.max(1, Math.round(1048576 / disk.sector));
    },

    /** Kullanılabilir sektör aralığı (GPT'de sondaki yedek başlık hariç). */
    usable(disk) {
      const a = this.align(disk);
      return { first: a, last: disk.table === "gpt" ? disk.sectors - 34 : disk.sectors - 1 };
    },

    /** Biçimlendirilebilir dosya sistemleri (cihazda aracı olanlar). */
    formats(tools) {
      return this.FS_ORDER.filter(fs => fs === "none" || (this.FS[fs] && tools[this.FS[fs].tool]));
    },

    /**
     * Ön izleme: okunan disk + işlemler → yeni disk nesnesi (bölümler + yeniden hesaplanmış boşluklar).
     * @param base {Map} cihazdan okunan disk
     * @param ops {Array} kuyruk
     */
    simulate(base, ops) {
      const disk = JSON.parse(JSON.stringify(base));
      let parts = disk.parts.filter(p => p.kind !== "free");
      const at = start => parts.find(p => p.start === start);
      ops.forEach(op => {
        const p = op.start !== undefined ? at(op.start) : null;
        switch (op.op) {
          case "mklabel":
            disk.table = op.table;
            parts = [];
            break;
          case "create":
            parts.push({ kind: op.kind || "primary", number: null, path: null, start: op.newStart, end: op.end,
              fs: op.kind === "extended" ? null : op.fs, label: op.label || "", name: op.name || "", flags: [], uuid: "",
              mounts: [], swap: false, busy: false, used: null, pending: true });
            break;
          case "delete":
            parts = parts.filter(x => x !== p);
            break;
          case "format":
            Object.assign(p, { fs: op.fs, label: op.label || "", used: null, uuid: "", pending: true });
            break;
          case "resize":
            Object.assign(p, { start: op.new_start, end: op.new_end, pending: true });
            break;
          case "label":
            p.label = op.label;
            break;
          case "name":
            p.name = op.name;
            break;
          case "flag":
            p.flags = op.on ? [...new Set(p.flags.concat(op.flag))] : p.flags.filter(f => f !== op.flag);
            break;
          case "uuid":
            p.uuid = "(yeni)";
            break;
          case "mount":
            if (p.fs === "linux-swap") {
              p.swap = true;
            } else {
              p.mounts = ["/media/ankamon/" + (p.label || (p.path || "").replace("/dev/", "") || "yeni")];
            }
            p.busy = true;
            break;
          case "umount":
            Object.assign(p, { mounts: [], swap: false, busy: false });
            break;
          default:
            break;
        }
      });
      disk.parts = this.withFree(disk, parts);
      disk.busy = parts.some(p => p.busy);
      return disk;
    },

    /** Bölümler (boşluksuz) → sıralı liste + 1 MiB'tan büyük boşluklar (genişletilmiş içindekiler logical: true). */
    withFree(disk, parts) {
      if (!disk.table || disk.table === "none" || disk.table === "unknown") {
        return parts.length ? parts : [{ kind: "free", start: this.usable(disk).first, end: disk.sectors - 1, notable: true }];
      }
      const a = this.align(disk);
      const out = [];
      const gaps = (from, to, list, logical) => {
        // Genişletilmiş içinde her mantıksal bölümün önünde 1 MiB EBR alanı durur: ancak ≥ 2 MiB'lık boşluk kullanılabilir.
        const min = logical ? 2 * a : a;
        let cursor = from;
        list.sort((x, y) => x.start - y.start).forEach(p => {
          if (p.start - cursor >= min) {
            out.push({ kind: "free", start: cursor, end: p.start - 1, logical });
          }
          out.push(p);
          if (p.kind === "extended") {
            const inner = parts.filter(q => q.kind === "logical" && q.start >= p.start && q.end <= p.end);
            gaps(p.start, p.end + 1, inner, true);
          }
          cursor = Math.max(cursor, p.end + 1);
        });
        if (to - cursor >= min) {
          out.push({ kind: "free", start: cursor, end: to - 1, logical });
        }
      };
      const u = this.usable(disk);
      gaps(u.first, u.last + 1, parts.filter(p => p.kind !== "logical"), false);
      return out;
    },

    /** Bölümün hemen önündeki / arkasındaki boşluk (yoksa null) — yeniden boyutlandırma/taşıma sınırları. */
    neighbours(disk, part) {
      const list = disk.parts;
      const i = list.indexOf(part);
      const before = i > 0 && list[i - 1].kind === "free" && !!list[i - 1].logical === (part.kind === "logical") ? list[i - 1] : null;
      const after = i < list.length - 1 && list[i + 1].kind === "free" && !!list[i + 1].logical === (part.kind === "logical") ? list[i + 1] : null;
      return { before, after };
    },

    sizeBytes(disk, part) {
      return (part.end - part.start + 1) * disk.sector;
    },

    /** Bölüm sağlanabilir mi: tablo, birincil sayısı, genişletilmiş. → {ok, kinds:[…], why} */
    creatable(disk, free) {
      if (!disk.table || ["none", "unknown", "loop"].includes(disk.table)) {
        return { ok: false, why: "Diskte bölüm tablosu yok — önce Aygıt ▸ Bölüm tablosu oluştur." };
      }
      if (disk.table === "gpt") {
        return disk.parts.filter(p => p.kind !== "free").length >= 128 ? { ok: false, why: "GPT en çok 128 bölüm." } : { ok: true, kinds: ["primary"] };
      }
      if (free.logical) {
        return { ok: true, kinds: ["logical"] };
      }
      const top = disk.parts.filter(p => p.kind === "primary" || p.kind === "extended");
      if (top.length >= 4) {
        return { ok: false, why: "MBR'de en çok 4 birincil/genişletilmiş bölüm olur (genişletilmiş bölümün içinde mantıksal bölüm açılabilir)." };
      }
      return { ok: true, kinds: top.some(p => p.kind === "extended") ? ["primary"] : ["primary", "extended"] };
    },

    /** Seçili bölümde bir işlemin yapılıp yapılamayacağı → null (yapılabilir) ya da neden. */
    why(disk, part, action, tools) {
      const fs = this.FS[part.fs] || null;
      const busy = part.busy;
      const sys = (part.mounts || []).some(m => this.SYSTEM_MOUNTS.includes(m));
      if (part.kind === "free") {
        return action === "create" ? (this.creatable(disk, part).ok ? null : this.creatable(disk, part).why) : "Boş alan seçili.";
      }
      switch (action) {
        case "create":
          return "Boş (ayrılmamış) bir alan seçin.";
        case "delete":
          if (busy) {
            return "Bölüm kullanımda (bağlı ya da etkin takas) — önce ayırın.";
          }
          if (part.kind === "extended" && disk.parts.some(p => p.kind === "logical")) {
            return "Genişletilmiş bölümün içindeki mantıksal bölümleri önce silin.";
          }
          return null;
        case "resize":
          if (part.kind === "extended") {
            return "Genişletilmiş bölüm bu sürümde yeniden boyutlandırılamaz.";
          }
          if (!part.fs || part.fs === "none") {
            return this.__resizeNone(disk, part);
          }
          if (!fs) {
            return `${part.fs} dosya sistemi yeniden boyutlandırılamaz.`;
          }
          if (!fs.grow && !fs.shrink && busy) {
            return `${part.fs} yeniden boyutlandırılamaz; bağlı değilken yalnız taşınabilir.`;
          }
          if (busy && fs.grow !== "online" && fs.shrink !== "online") {
            return "Bölüm kullanımda — bu dosya sistemi bağlıyken yeniden boyutlandırılamaz; önce ayırın.";
          }
          return this.__resizeNone(disk, part);
        case "format":
          if (part.kind === "extended") {
            return "Genişletilmiş bölüm biçimlendirilmez.";
          }
          return busy ? "Bölüm kullanımda — önce ayırın." : null;
        case "label":
          if (!fs || !fs.label) {
            return `${this.fsName(part.fs)} için etiket değiştirilemez.`;
          }
          return busy && fs.label !== "online" ? "Bu dosya sisteminin etiketi bağlıyken değiştirilemez — önce ayırın." : null;
        case "name":
          return disk.table === "gpt" ? null : "Bölüm adı yalnız GPT tablosunda vardır.";
        case "flags":
          return null;
        case "check":
          if (!fs || !fs.check) {
            return `${this.fsName(part.fs)} denetlenemez.`;
          }
          return busy ? "Denetleme bağlı değilken yapılır — önce ayırın." : null;
        case "mount":
          if (part.kind === "extended" || !part.fs || part.fs === "none") {
            return "Bağlanacak dosya sistemi yok.";
          }
          return busy ? "Zaten bağlı." : null;
        case "umount":
          if (!busy) {
            return "Bölüm bağlı değil.";
          }
          return sys ? "Sistem bölümü (/, /boot …) çalışırken ayrılamaz." : null;
        case "uuid":
          if (!fs || !fs.uuid) {
            return `${this.fsName(part.fs)} için yeni UUID üretilemez.`;
          }
          if (fs.uuid === "btrfstune" && !tools.btrfstune) {
            return "Cihazda btrfstune yok.";
          }
          return busy ? "Yeni UUID bağlı değilken üretilir — önce ayırın." : null;
        default:
          return null;
      }
    },

    /**
     * Yeniden boyutlandırma/taşıma sınırları (sektör): {minStart, maxEnd, minSize, maxSize, canMove}
     * Bağlı bölüm taşınamaz; büyüme/küçülme dosya sisteminin yeteneğine göre.
     */
    resizeLimits(disk, part) {
      const a = this.align(disk);
      const { before, after } = this.neighbours(disk, part);
      const fs = this.FS[part.fs] || null;
      const raw = !part.fs || part.fs === "none";
      const size = part.end - part.start + 1;
      const canMove = !part.busy;
      let minStart = canMove && before ? before.start : part.start;
      if (part.kind === "logical" && before) {
        minStart = before.start + a;   // EBR'ye yer: mantıksal bölüm boşluğun 1 MiB sonrasından başlar
      }
      minStart = Math.ceil(minStart / a) * a;
      if (minStart > part.start) {
        minStart = part.start;
      }
      const maxEnd = after ? after.end : part.end;
      const canGrow = raw || (fs && (fs.grow === "online" || (fs.grow === "offline" && !part.busy)));
      const canShrink = raw || (fs && (fs.shrink === "online" || (fs.shrink === "offline" && !part.busy)));
      let minSize = canShrink ? Math.max(a, Math.ceil(((part.used || 0) * 1.1) / disk.sector / a) * a) : size;
      // Takası küçültmek için etkin olmamalı.
      if (part.fs === "linux-swap" && part.swap) {
        minSize = size;
      }
      minSize = Math.min(minSize, size);
      const maxSize = canGrow ? (maxEnd - minStart + 1) : size;
      return { minStart, maxEnd, minSize, maxSize, canMove, canGrow, canShrink, size };
    },

    /** Ne taşınabilir, ne büyüyebilir, ne küçülebilirse neden; yoksa null. */
    __resizeNone(disk, part) {
      const L = this.resizeLimits(disk, part);
      if (L.minStart === part.start && L.minSize === L.size && L.maxSize === L.size) {
        return part.busy ? "Arkasında boş alan yok ve bağlıyken küçültülemez/taşınamaz — değiştirilecek bir şey yok."
          : "Önünde/arkasında boş alan yok ve bu dosya sistemi küçültülemez — değiştirilecek bir şey yok.";
      }
      return null;
    },

    /** İşlem kuyruğu → cihaza gidecek gövde (yalnız cihazın ihtiyaç duyduğu alanlar). */
    payload(base, ops) {
      return { disk: base.path, serial: base.serial, size: base.size,
        ops: ops.map(op => {
          const o = Object.assign({}, op);
          if (o.op === "create") {
            o.start = o.newStart;
          }
          delete o.newStart;
          return o;
        }) };
    }
  }
});
