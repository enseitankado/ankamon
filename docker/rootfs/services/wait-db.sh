#!/bin/sh
# Veritabanı göçleri bitene dek bekler. Servis sarmalayıcıları başta bunu çağırır.
while [ ! -f /run/ankamon/db-ready ]; do
    sleep 1
done
