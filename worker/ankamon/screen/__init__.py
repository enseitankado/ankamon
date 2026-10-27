# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canlı tahta ekranı: tarayıcıdaki noVNC ile tahtadaki x11vnc arasında WebSocket ↔ SSH köprüsü.

Tahtada kalıcı bir VNC servisi ya da ağa açık port yoktur. İzleme isteği gelince köprü SSH ile
x11vnc'yi yalnız tahtanın kendi 127.0.0.1'inde, tek bağlantılık başlatır; sonra standart bir SSH
tüneliyle (ssh -W) ona bağlanır ve baytları olduğu gibi WebSocket'e geçirir (çözme/yeniden kodlama
yok — bu makineye yük bindirmez). İzleyici kapanınca tünel, onunla birlikte x11vnc de biter.
Tahtada gereken tek şey x11vnc paketidir (ve sshd'de TCP yönlendirmenin açık olması).
"""
