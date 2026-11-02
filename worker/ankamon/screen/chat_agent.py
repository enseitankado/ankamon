# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Tahtada çalışan sohbet penceresi (python3-gi, Gtk 3; kurulum yok, SSH oturumuyla yaşar).

Satır başına JSON: stdin'den {"t":"msg","author","text"} / {"t":"end"}; stdout'a {"t":"ready"} / {"t":"msg","text"} /
{"t":"closed"}. Yeni ileti gelince pencere öne çıkar. Etkin VT değişirse (oturum açıldı, kullanıcı değişti) 75 koduyla çıkar:
köprü doğru ekranda yeniden başlatır. stdin kapanırsa (köprü bitti) kısa bir bildirimden sonra pencere kapanır.
"""

import json
import os
import sys
import warnings

import gi

warnings.simplefilter("ignore")
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

EXIT_VT_CHANGED = 75


def active_vt():
    try:
        with open("/sys/class/tty/tty0/active") as f:
            return f.read().strip()
    except OSError:
        return ""


def send(obj):
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except OSError:
        pass


win = Gtk.Window(title="Yönetici ile sohbet")
win.set_default_size(460, 380)
win.set_keep_above(True)
win.set_icon_name("mail-message-new")
win.set_gravity(Gdk.Gravity.SOUTH_EAST)
scr = Gdk.Screen.get_default()
win.move(max(scr.get_width() - 500, 0), max(scr.get_height() - 460, 0))

box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, margin=8)
scroll = Gtk.ScrolledWindow()
view = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR, left_margin=6, right_margin=6)
buf = view.get_buffer()
buf.create_tag("who", weight=700)
buf.create_tag("me", weight=700, foreground="#1a73e8")
buf.create_tag("note", style=2, foreground="#777777")
scroll.add(view)
box.pack_start(scroll, True, True, 0)
row = Gtk.Box(spacing=6)
entry = Gtk.Entry(placeholder_text="İletinizi yazın…")
entry.set_max_length(2000)
button = Gtk.Button(label="Gönder")
row.pack_start(entry, True, True, 0)
row.pack_start(button, False, False, 0)
box.pack_start(row, False, False, 0)
win.add(box)


def append(who, text, tag="who"):
    end = buf.get_end_iter()
    if who:
        buf.insert_with_tags_by_name(end, who + ": ", tag)
        buf.insert(buf.get_end_iter(), text + "\n")
    else:
        buf.insert_with_tags_by_name(end, text + "\n", "note")
    GLib.idle_add(lambda: view.scroll_mark_onscreen(buf.create_mark(None, buf.get_end_iter(), False)) and False)


def submit(*_):
    text = (entry.get_text() or "").strip()
    if text:
        entry.set_text("")
        append("Siz", text, "me")
        send({"t": "msg", "text": text})
    entry.grab_focus()


def on_close(*_):
    win.hide()              # sohbet sürer: yeni iletide pencere yeniden açılır
    send({"t": "closed"})
    return True


def finish():
    Gtk.main_quit()
    return False


ended = False


def end(note):
    global ended
    if ended:
        return
    ended = True
    append(None, note)
    entry.set_sensitive(False)
    button.set_sensitive(False)
    GLib.timeout_add_seconds(8, finish)


def on_stdin(_fd, _cond):
    line = sys.stdin.readline()
    if not line:
        end("Sohbet sona erdi.")
        return False
    try:
        msg = json.loads(line)
    except ValueError:
        return True
    if msg.get("t") == "msg":
        append(msg.get("author") or "Yönetici", msg.get("text") or "")
        win.show_all()
        win.present()
    elif msg.get("t") == "end":
        end("Yönetici sohbeti kapattı.")
    return True


start_vt = active_vt()


def watch_vt():
    if active_vt() != start_vt:
        os._exit(EXIT_VT_CHANGED)
    return True


button.connect("clicked", submit)
entry.connect("activate", submit)
win.connect("delete-event", on_close)
GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, on_stdin)
GLib.timeout_add_seconds(2, watch_vt)
append(None, "Yönetici bu bilgisayarla sohbet başlattı.")
win.show_all()
send({"t": "ready"})
Gtk.main()
