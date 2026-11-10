<!-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com> -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# ETAP akıllı tahtaları — üretici (OUI) özeti

Kaynak: ulusal ETAP envanteri (private enseitankado/etapi), 537.368 tekil MAC, 387 OUI. `scripts/build-etap-vendors.py` üretir; makine okur hâli `etap_vendors.json`. Yalnız toplu sayılar — tam MAC ve okul bilgisi yok.

- **Ayrık**: OUI MEB akıllı tahtalarına ayrılmış — bütün MAC'leri tahta sayılır (`boardmac.is_board_mac`). Faz, OUI'nin kayıtları tek fazdaysa OUI'den, değilse `etap_prefixes.tsv` bloğundan (`etap_phase.lookup`).
- **Genel üretici**: GIGABYTE / Elitegroup / Realtek gibi OUI'ler okulun sıradan bilgisayarlarında da görülür — tahta kararı yalnız `etap_prefixes.tsv` bloğuyla.
- **Kirli**: envanterde az (< 50) kaydı olan ya da bilinen bir tahta modeline düşmeyen OUI (kayıtlı ama tahta olmayan cihazlar: laboratuvar PC'leri, USB ağ kartları …).

| OUI | Üretici | Kayıt | Tahta payı | Faz dağılımı | Baskın modeller | Durum |
|---|---|---:|---:|---|---|---|
| `00:09:df` | Vestel Elektronik San ve Tic. A.S. | 340.711 | %100.0 | Faz 2: 282.785, Faz 1: 57.657, ?: 267, Faz 3: 1, tahta değil: 1 | vestel-14mb57, vestel-14mb24a, vestel-14mb37c1 | ayrık |
| `a4:17:91` | Shenzhen Decnta Technology Co.,LTD. | 46.120 | %100.0 | Faz 3: 46.098, tahta değil: 22 | decenta-s24-rplp-opsc28-c, decenta-s22-tglu-opsc22, decenta-s21-rkls-opsc12 | ayrık |
| `d8:5e:d3` | Giga-Byte Technology Co.,Ltd. | 41.662 | %100.0 | Faz 3: 41.662 | gigabyte-mh310bp-r6, gigabyte-mh410ap-r6 | genel üretici |
| `18:c0:4d` | Giga-Byte Technology Co.,Ltd. | 22.100 | %100.0 | Faz 3: 22.099, tahta değil: 1 | gigabyte-mh310bp-r6, gigabyte-mh410ap-r6, gigabyte-mdh11bp-r6 | genel üretici |
| `e8:51:9e` | Guangzhou Shiyuan Electronic Technology Company Limited | 16.557 | %100.0 | Faz 3: 16.557 | mainbrd-ops62a-shb, mainbrd-ops72a-shb | ayrık |
| `90:e4:68` | Guangzhou Shiyuan Electronic Technology Company Limited | 16.327 | %100.0 | Faz 3: 16.327 | mainbrd-ops62a-shb | ayrık |
| `b4:2e:99` | Giga-Byte Technology Co.,Ltd. | 14.922 | %99.7 | Faz 3: 14.880, tahta değil: 42 | gigabyte-mh310bp-r6, gigabyte-mdh11bp-r6 | genel üretici |
| `74:56:3c` | Giga-Byte Technology Co.,Ltd. | 14.371 | %100.0 | Faz 3: 14.370, tahta değil: 1 | gigabyte-mh410ap-r6, gigabyte-mh310bp-r6, gigabyte-technology-co-ltd-a520m-k-v2 | genel üretici |
| `1c:2f:a2` | Guangzhou Shiyuan Electronic Technology Company Limited | 5.663 | %100.0 | Faz 3: 5.663 | mainbrd-ops72a-shb, mainbrd-ops62a-shb | ayrık |
| `8c:35:92` | Guangzhou Shiyuan Electronic Technology Company Limited | 5.647 | %100.0 | Faz 3: 5.647 | mainbrd-ops63a-sha | ayrık |
| `84:47:09` | Shenzhen IP3 Century Intelligent Technology CO.,Ltd | 4.005 | %100.0 | Faz 3: 4.005 | default-string-default-string | ayrık |
| `a8:2c:3e` | Shenzhen Cultraview Digital Technology Co., Ltd | 2.506 | %100.0 | Faz 3: 2.506 | decenta-s24-rplp-opsc28-c | ayrık |
| `00:e0:4c` | Realtek Semiconductor Corp. | 1.937 | %93.4 | Faz 3: 1.782, tahta değil: 127, Faz 2: 23, Faz 1: 5 | decenta-s24-rplp-opsc28-c, oem-a86-mops, aidata-th510-d4-v2-4 | genel üretici |
| `f4:4d:30` | Elitegroup Computer Systems Co.,Ltd. | 1.809 | %100.0 | Faz 1: 1.353, Faz 2: 456 | vestel-14mb24a, vestel-14mb57, vestel-14mb37a1 | genel üretici |
| `b8:ae:ed` | Elitegroup Computer Systems Co.,Ltd. | 713 | %99.9 | Faz 1: 684, Faz 2: 28, tahta değil: 1 | vestel-14mb24a, vestel-14mb37a1, vestel-14mb57 | genel üretici |
| `c0:3f:d5` | Elitegroup Computer Systems Co.,Ltd. | 417 | %99.8 | Faz 1: 413, Faz 2: 3, tahta değil: 1 | vestel-14mb24a, vestel-14mb37a1, acer-veriton-x2632g | genel üretici |

## Kirli kayıtlar: 366 OUI, 1.259 kayıt

En kalabalık 15'i (bunlara dayanılarak tahta kararı verilmez):

| OUI | Üretici | Kayıt | Tahta payı |
|---|---|---:|---:|
| `08:00:27` | PCS Systemtechnik GmbH | 86 | %0 |
| `00:f1:f5` | ? | 79 | %0 |
| `d0:46:0c` | Dell Inc. | 56 | %0 |
| `bc:6b:ff` | Guangzhou Shiyuan Electronic Technology Company Limited | 48 | %77 |
| `02:41:da` | ? | 41 | %100 |
| `8c:32:23` | JWIPC Technology Co.,Ltd. | 38 | %5 |
| `de:ad:be` | ? | 33 | %0 |
| `00:01:80` | AOpen, Inc. | 32 | %0 |
| `c4:ef:bb` | LCFC(Hefei) Electronics Technology co., ltd | 29 | %0 |
| `d8:74:ef` | Guangzhou Shiyuan Electronic Technology Company Limited | 28 | %100 |
| `d0:50:99` | ASRock Incorporation | 27 | %100 |
| `fc:aa:14` | Giga-Byte Technology Co.,Ltd. | 25 | %96 |
| `70:85:c2` | ASRock Incorporation | 22 | %100 |
| `e0:27:6c` | Guangzhou Shiyuan Electronic Technology Company Limited | 22 | %64 |
| `18:84:c1` | Guangzhou Shiyuan Electronic Technology Company Limited | 21 | %67 |
