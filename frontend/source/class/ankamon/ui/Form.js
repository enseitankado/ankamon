/** Etiket + alan satırlarından oluşan basit form ızgarası. */
qx.Class.define("ankamon.ui.Form", {
  extend: qx.ui.container.Composite,

  construct() {
    const layout = new qx.ui.layout.Grid(10, 8);
    layout.setColumnFlex(1, 1);
    layout.setColumnAlign(0, "left", "middle");
    super(layout);
    this.__row = 0;
    this.__fields = {};
  },

  members: {
    __row: null,
    __fields: null,

    /** Alan ekler ve geri döner. */
    addField(key, label, widget) {
      this.add(new qx.ui.basic.Label(label), { row: this.__row, column: 0 });
      this.add(widget, { row: this.__row, column: 1 });
      this.__fields[key] = widget;
      this.__row++;
      return widget;
    },

    text(key, label, value, placeholder) {
      return this.addField(key, label, new qx.ui.form.TextField(value || "").set({ placeholder: placeholder || null }));
    },

    password(key, label, placeholder) {
      return this.addField(key, label, new qx.ui.form.PasswordField().set({ placeholder: placeholder || null }));
    },

    check(key, label, value) {
      return this.addField(key, label, new qx.ui.form.CheckBox().set({ value: !!value }));
    },

    /** @param options {Array} [{value, label}] */
    select(key, label, options, value) {
      const box = new qx.ui.form.SelectBox();
      options.forEach(option => {
        const item = new qx.ui.form.ListItem(option.label, null, option.value);
        box.add(item);
        if (option.value === value) {
          box.setSelection([item]);
        }
      });
      return this.addField(key, label, box);
    },

    /** Bütün alanların değerleri: anahtar → değer. */
    values() {
      const values = {};
      Object.entries(this.__fields).forEach(([key, widget]) => {
        if (widget instanceof qx.ui.form.SelectBox) {
          const item = widget.getSelection()[0];
          values[key] = item ? item.getModel() : "";
        } else {
          const value = widget.getValue();
          values[key] = typeof value === "string" ? value.trim() : value;
        }
      });
      return values;
    }
  }
});
