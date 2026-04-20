1. Projeyi /opt/nucleomic altına kopyala
2. python3 -m venv .venv
3. pip install -r requirements.txt
4. chmod +x bin/linux/muscle
5. chmod +x bin/linux/clustalw
6. chmod +x bin/linux/iqtree3
7. .env dosyasını oluştur
8. systemd dosyalarını /etc/systemd/system/ altına kopyala
9. nginx config dosyasını /etc/nginx/sites-available/ altına kopyala
10. systemctl daemon-reload
11. servisleri enable/start et