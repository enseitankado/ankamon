/**
 * Ayarlar ▸ "Ders saatleri" düzenleyicisi: ders günleri (Pzt…Paz) + ders satırları (ad, başlangıç, bitiş).
 * Teneffüs/öğle arası ayrıca girilmez — dersler arasındaki boşluktur. "+ Ders ekle" bir öncekinin
 * bitişinden 10 dk sonra başlayan 40 dk'lık satır önerir. Kayıt/doğrulama sunucuda (bkz. backend
 * LessonTimesApi — çakışma, SS:DD biçimi); burada yalnız anlık süre gösterimi yapılır.
 * Değer, Oturumlar ▸ Kullanıcılar çizelgesindeki oturum ipucunda kullanılır (bkz. ui.sessions.Users).
 */
qx.Class.define("ankamon.ui.LessonTimesEditor", {
  extend: qx.ui.container.Composite,

  /** @param value {Map} {days: [1..7], lessons: [{name, start, end}]} */
  construct(value) {
    super(new qx.ui.layout.VBox(10));
    value = value || { days: [1, 2, 3, 4, 5], lessons: [] };

    const days = new qx.ui.container.Composite(new qx.ui.layout.HBox(12).set({ alignY: "middle" }));
    days.add(new qx.ui.basic.Label("Ders günleri:").set({ alignY: "middle" }));
    this.__days = ankamon.ui.LessonTimesEditor.DAYS.map((label, i) => {
      const box = new qx.ui.form.CheckBox(label).set({ value: (value.days || []).includes(i + 1) });
      days.add(box);
      return box;
    });
    this.add(days);

    const grid = new qx.ui.layout.Grid(8, 6);
    grid.setColumnAlign(3, "left", "middle");
    this.__grid = new qx.ui.container.Composite(grid);
    this.add(this.__grid);

    const add = new qx.ui.form.Button("+ Ders ekle").set({ allowGrowX: false });
    add.addListener("execute", () => this.__addRow(this.__suggest()));
    this.add(add);

    this.__rows = [];
    (value.lessons || []).forEach(l => this.__addRow(l, true));
    this.__layout();
  },

  statics: {
    DAYS: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"],

    /** "08:30" → 510 (dakika); geçersizse null. */
    minutes(text) {
      const m = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(String(text || ""));
      return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? Number(m[1]) * 60 + Number(m[2]) : null;
    },

    hhmm(min) {
      min = ((min % 1440) + 1440) % 1440;
      return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
    }
  },

  members: {
    __days: null,
    __grid: null,
    __rows: null,

    /** @return {Map} {days, lessons} — sunucuya gönderilecek değer (boş satırlar atlanır). */
    getValue() {
      return {
        days: this.__days.map((b, i) => (b.getValue() ? i + 1 : 0)).filter(Boolean),
        lessons: this.__rows
          .map(r => ({ name: r.name.getValue() || "", start: r.start.getValue() || "", end: r.end.getValue() || "" }))
          .filter(l => l.start.trim() || l.end.trim())
      };
    },

    __suggest() {
      const S = ankamon.ui.LessonTimesEditor;
      const last = this.__rows.length ? S.minutes(this.__rows[this.__rows.length - 1].end.getValue()) : null;
      const start = last === null ? 8 * 60 + 30 : last + 10;
      return { name: "", start: S.hhmm(start), end: S.hhmm(start + 40) };
    },

    __addRow(lesson, silent) {
      const field = (v, width, placeholder) => new qx.ui.form.TextField(v || "").set({ width, placeholder });
      const row = {
        name: field(lesson.name, 150, `${this.__rows.length + 1}. ders`),
        start: field(lesson.start, 70, "SS:DD"),
        end: field(lesson.end, 70, "SS:DD"),
        length: new qx.ui.basic.Label("").set({ textColor: "app-muted", minWidth: 60 }),
        remove: new qx.ui.form.Button("✕").set({ toolTipText: "Bu ders saatini sil", padding: [2, 8] })
      };
      const update = () => {
        const S = ankamon.ui.LessonTimesEditor;
        const a = S.minutes(row.start.getValue());
        const b = S.minutes(row.end.getValue());
        row.length.setValue(a === null || b === null ? "" : b > a ? `${b - a} dk` : "bitiş başlangıçtan önce");
        row.length.setTextColor(a !== null && b !== null && b <= a ? "#d9534f" : "app-muted");
      };
      row.start.addListener("input", update);
      row.end.addListener("input", update);
      update();
      row.remove.addListener("execute", () => {
        this.__rows.splice(this.__rows.indexOf(row), 1);
        this.__layout();
      });
      this.__rows.push(row);
      if (!silent) {
        this.__layout();
        row.start.focus();
      }
    },

    /** Satırları ızgaraya yeniden yerleştirir; boş ad yer tutucuları sıra numarasını izler. */
    __layout() {
      this.__grid.removeAll();
      if (!this.__rows.length) {
        this.__grid.add(new qx.ui.basic.Label("Henüz ders saati yok — \"+ Ders ekle\" ile ekleyin.")
          .set({ textColor: "app-muted" }), { row: 0, column: 0, colSpan: 6 });
        return;
      }
      ["Ad", "Başlangıç", "Bitiş", "Süre"].forEach((h, c) =>
        this.__grid.add(new qx.ui.basic.Label(h).set({ font: "bold" }), { row: 0, column: c === 3 ? 3 : c }));
      this.__rows.forEach((r, i) => {
        r.name.setPlaceholder(`${i + 1}. ders`);
        this.__grid.add(r.name, { row: i + 1, column: 0 });
        this.__grid.add(r.start, { row: i + 1, column: 1 });
        this.__grid.add(r.end, { row: i + 1, column: 2 });
        this.__grid.add(r.length, { row: i + 1, column: 3 });
        this.__grid.add(r.remove, { row: i + 1, column: 4 });
      });
    }
  }
});
