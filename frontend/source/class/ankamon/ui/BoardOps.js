/*
 * SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * UYUMLULUK (terim geçişi 2026-11-12): eski ad. Yeni kod ankamon.ui.DeviceOps kullanır; bu sınıf eklentilerin eski
 * çağrıları (BoardOps.menuButton, editBoard, menu, logsAndInfo…) bozulmasın diye DeviceOps'un statiklerini aynı adla
 * (editBoard → editDevice gibi eski adlarla da) yansıtır. Yeni işlev eklemeyin.
 * @require(ankamon.ui.DeviceOps)
 */
qx.Class.define("ankamon.ui.BoardOps", {
  type: "static",

  defer(statics) {
    const target = ankamon.ui.DeviceOps;
    Object.getOwnPropertyNames(target).forEach(name => {
      const value = target[name];
      if (typeof value === "function" && !/^(constructor|prototype|toString)$/.test(name)) {
        statics[name] = value.bind(target);
        statics[name.replace(/Device/g, "Board").replace(/device/g, "board")] = statics[name];
      }
    });
  }
});
