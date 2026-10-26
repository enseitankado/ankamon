"""Dosya yöneticisi köprüsü: bir tahta açıldığında onun tüm dosya sistemini (root, SFTP) bu
makinede geçici bir dizine bağlar (sshfs), tek bir FileBrowser Quantum örneği o dizin ağacını
sunar (bkz. docker/rootfs/services/filemanager.sh). Burada yalnız bağlama/ayırma orkestrasyonu var;
gezinme, önizleme, indirme, yükleme FileBrowser Quantum'un kendi işi. Kullanılmayan bağlar bir süre
sonra kendiliğinden ayrılır (bkz. IDLE_MINUTES).
"""
