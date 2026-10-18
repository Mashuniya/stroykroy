# Обновление Drupal на сервере stroykroy.com

Пошаговая инструкция для самостоятельного обновления ядра и модулей Drupal.
Все команды выполняются в SSH-консоли сервера (VPS SpaceWeb).
Пароли в этот файл и в чат не записывать.

## Где что лежит

- Сайт (Drupal): `/var/www/stroykroy` — отсюда запускаются `composer` и `bin/drush`.
- Наш код (модуль магазина, движок лекал): `/opt/stroykroy-repo`.
- Модели лекал: `/var/lib/stroykroy/models`.
- Файлы оплаченных заказов: `/var/lib/stroykroy/orders`.
- Журнал ошибок построения: `/var/lib/stroykroy/errors.log`.
- Настройки сайта и доступ к базе: `/var/www/stroykroy/web/sites/default/settings.php`.
- Composer: `/usr/bin/composer`, PHP: `php8.3`.

## 1. Резервная копия (всегда первым шагом)

```
cd /var/www/stroykroy
sudo -u www-data bin/drush sql:dump | gzip > ~/db-$(date +%F).sql.gz
cp composer.json ~/composer.json.bak && cp composer.lock ~/composer.lock.bak
ls -la ~/db-*.sql.gz
```

Размер файла дампа не должен быть нулевым.

## 2. Что устарело

```
cd /var/www/stroykroy
php8.3 /usr/bin/composer outdated "drupal/*"
php8.3 /usr/bin/composer audit
```

Обновления со сменой основной версии (например, 3.x → 4.x) сначала показать Claude или специалисту.

## 3. Обновление

Только ядро и тема админки:

```
php8.3 /usr/bin/composer update "drupal/core-*" drupal/gin --with-all-dependencies
```

Все модули Drupal:

```
php8.3 /usr/bin/composer update "drupal/*" --with-all-dependencies
```

Если packagist не отвечает (ошибка `curl 28`), просто повторить команду, иногда нужно 3–4 попытки.

## 4. Применить изменения и сбросить кеш

```
sudo -u www-data bin/drush updb -y
sudo -u www-data bin/drush cr
```

## 5. Проверка

```
sudo -u www-data bin/drush core:requirements --severity=2
php8.3 /usr/bin/composer audit
sudo -u www-data bin/drush watchdog:show --count=20 --severity=Error
```

Первая команда не должна показывать ошибок, вторая — уязвимостей.
Затем вручную открыть: страницу товара с конфигуратором, корзину,
оформление тестового заказа, страницу «Файлы заказа».

## 6. Режим обслуживания (если на сайте есть живые покупатели)

Включить перед шагом 3:

```
sudo -u www-data bin/drush state:set system.maintenance_mode 1 --input-format=integer
```

Выключить после проверки:

```
sudo -u www-data bin/drush state:set system.maintenance_mode 0 --input-format=integer
sudo -u www-data bin/drush cr
```

## 7. Если что-то сломалось

Вернуть версии пакетов:

```
cd /var/www/stroykroy
cp ~/composer.json.bak composer.json && cp ~/composer.lock.bak composer.lock
php8.3 /usr/bin/composer install
sudo -u www-data bin/drush cr
```

Если после отката сайт всё равно не работает, восстановить базу из дампа (подставить дату):

```
zcat ~/db-ДАТА.sql.gz | sudo -u www-data bin/drush sql:cli
```

## Полезное

Открыть консоль базы данных (пароль подставляется автоматически):

```
cd /var/www/stroykroy
sudo -u www-data bin/drush sql:cli
```

Обновить наш код магазина и движка (не относится к обновлению Drupal):

```
cd /opt/stroykroy-repo && git pull origin main
sudo systemctl restart stroykroy-engine
cd /var/www/stroykroy && sudo -u www-data bin/drush cr
```
