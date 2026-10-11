# stroykroy_shop — магазин лекал для Drupal (Commerce)

Что делает:
- при включении создаёт тип товара «Лекала» (поля: фото, раздел, категория, тип изделия, описание) и подключает рубль;
- страница `/admin/commerce/stroykroy-import` принимает файл `stroykroy-catalog.json` из студии (формат версии 3) и
  создаёт/обновляет товары; модели без галочки «Выставить лекала в магазин» скрываются с витрины.

Установка на сервере:
    git clone https://github.com/Mashuniya/stroykroy.git /opt/stroykroy-repo
    ln -s /opt/stroykroy-repo/server/drupal/stroykroy_shop /var/www/stroykroy/web/modules/custom/stroykroy_shop
    cd /var/www/stroykroy && sudo -u www-data bin/drush en stroykroy_shop -y

Обновление: `cd /opt/stroykroy-repo && git pull`, затем `sudo -u www-data bin/drush cr`.
