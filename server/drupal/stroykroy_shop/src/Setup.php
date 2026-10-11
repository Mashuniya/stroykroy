<?php

namespace Drupal\stroykroy_shop;

use Drupal\commerce_product\Entity\ProductType;
use Drupal\commerce_product\Entity\ProductVariationType;
use Drupal\commerce_price\Entity\Currency;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\user\Entity\Role;

/**
 * Создаёт тип товара «Лекала» и всё, что ему нужно. Повторный запуск безопасен.
 */
class Setup {

  const BUNDLE = 'lekala';

  public function run(): void {
    $this->currency();
    $this->types();
    $this->fields();
    $this->display();
    $this->menu();
    $this->store();
    $this->orderItemField();
    (new StorePages())->run();
    $this->testGateway();
    $this->roles();
    $this->russian();
  }

  /** Рубль должен быть подключён. */
  protected function currency(): void {
    if (!Currency::load('RUB')) {
      \Drupal::service('commerce_price.currency_importer')->import('RUB');
    }
  }

  protected function types(): void {
    $etm = \Drupal::entityTypeManager();
    if (!$etm->getStorage('commerce_product_variation_type')->load(self::BUNDLE)) {
      ProductVariationType::create([
        'id' => self::BUNDLE,
        'label' => 'Лекала',
        'status' => TRUE,
        'orderItemType' => 'default',
        'generateTitle' => TRUE,
      ])->save();
    }
    $type = $etm->getStorage('commerce_product_type')->load(self::BUNDLE);
    if (!$type) {
      $type = ProductType::create([
        'id' => self::BUNDLE,
        'label' => 'Лекала',
        'status' => TRUE,
        'description' => 'Цифровые лекала: файлы создаются после оплаты.',
        'variationType' => self::BUNDLE,
        'injectVariationFields' => TRUE,
        'multipleVariations' => FALSE,
      ]);
      $type->save();
    }
    // Служебные поля типа товара (магазины, вариации, описание) создаём сами:
    // в новых версиях Commerce готовых функций для этого нет.
    $this->coreFields();
  }

  protected function coreFields(): void {
    $widgets = \Drupal::service('plugin.manager.field.widget');
    $repo = \Drupal::service('entity_display.repository');

    // «Магазины» и «Вариации» в Commerce 3.x — встроенные поля товара, создавать их не нужно:
    // достаточно показать их в форме.
    $form = $repo->getFormDisplay('commerce_product', self::BUNDLE);
    if (!$form->getComponent('stores')) {
      $form->setComponent('stores', [
        'type' => $widgets->hasDefinition('commerce_entity_select') ? 'commerce_entity_select' : 'options_buttons',
        'weight' => 3,
      ]);
    }
    if (!$form->getComponent('variations')) {
      $form->setComponent('variations', [
        'type' => $widgets->hasDefinition('commerce_product_single_variation') ? 'commerce_product_single_variation' : 'inline_entity_form_complex',
        'weight' => 4,
      ]);
    }
    $form->save();

    $this->ensureStorage('body', 'text_with_summary', 1, []);
    if (!FieldConfig::loadByName('commerce_product', self::BUNDLE, 'body')) {
      FieldConfig::create([
        'field_name' => 'body', 'entity_type' => 'commerce_product', 'bundle' => self::BUNDLE,
        'label' => 'Описание', 'required' => FALSE,
        'settings' => ['display_summary' => FALSE],
      ])->save();
      $repo->getFormDisplay('commerce_product', self::BUNDLE)->setComponent('body', ['type' => 'text_textarea_with_summary', 'weight' => 1])->save();
      $repo->getViewDisplay('commerce_product', self::BUNDLE)->setComponent('body', ['type' => 'text_default', 'label' => 'hidden', 'weight' => 1])->save();
    }
  }

  protected function ensureStorage(string $name, string $type, int $cardinality, array $settings): void {
    if (!FieldStorageConfig::loadByName('commerce_product', $name)) {
      FieldStorageConfig::create([
        'field_name' => $name, 'entity_type' => 'commerce_product', 'type' => $type,
        'cardinality' => $cardinality, 'settings' => $settings,
      ])->save();
    }
  }

  protected function fields(): void {
    $this->addField('field_photos', 'image', 'Фото', 4, [], [
      'file_extensions' => 'png jpg jpeg',
      'alt_field' => TRUE,
    ], 'image_image', ['preview_image_style' => 'thumbnail'], 'image', ['image_style' => 'large', 'image_link' => ''], 10);
    $this->addField('field_section', 'string', 'Раздел', 1, ['max_length' => 100], [], 'string_textfield', [], 'string', [], 11);
    $this->addField('field_category', 'string', 'Категория', 1, ['max_length' => 100], [], 'string_textfield', [], 'string', [], 12);
    $this->addField('field_mode', 'list_string', 'Тип изделия', 1, [
      'allowed_values' => ['ready' => 'Готовое изделие', 'constructor' => 'Конструктор'],
    ], [], 'options_select', [], 'list_default', [], 13);
    // Служебные поля заполняет импорт: в форме товара и на странице их не показываем.
    $this->addField('field_catalog_id', 'string', 'Код модели в студии', 1, ['max_length' => 128], [], NULL, [], NULL, [], 0);
    $this->addField('field_payload', 'string_long', 'Данные построения (JSON)', 1, [], [], NULL, [], NULL, [], 0);
  }

  protected function addField(string $name, string $type, string $label, int $cardinality, array $storage, array $instance, ?string $widget, array $widgetSettings, ?string $formatter, array $formatterSettings, int $weight): void {
    if (!FieldStorageConfig::loadByName('commerce_product', $name)) {
      FieldStorageConfig::create([
        'field_name' => $name,
        'entity_type' => 'commerce_product',
        'type' => $type,
        'cardinality' => $cardinality,
        'settings' => $storage,
      ])->save();
    }
    if (!FieldConfig::loadByName('commerce_product', self::BUNDLE, $name)) {
      FieldConfig::create([
        'field_name' => $name,
        'entity_type' => 'commerce_product',
        'bundle' => self::BUNDLE,
        'label' => $label,
        'required' => FALSE,
        'settings' => $instance,
      ])->save();
    }
    $repo = \Drupal::service('entity_display.repository');
    if ($widget) {
      $repo->getFormDisplay('commerce_product', self::BUNDLE)
        ->setComponent($name, ['type' => $widget, 'weight' => $weight, 'settings' => $widgetSettings])
        ->save();
    }
    if ($formatter) {
      $repo->getViewDisplay('commerce_product', self::BUNDLE)
        ->setComponent($name, ['type' => $formatter, 'weight' => $weight, 'label' => 'hidden', 'settings' => $formatterSettings])
        ->save();
    }
  }

  /** Вид страницы товара: без лишних подписей и артикула. */
  protected function display(): void {
    $repo = \Drupal::service('entity_display.repository');
    $view = $repo->getViewDisplay('commerce_product', self::BUNDLE);
    $view->setComponent('title', ['type' => 'string', 'label' => 'hidden', 'weight' => -10, 'settings' => ['link_to_entity' => FALSE]]);
    $view->setComponent('field_photos', ['type' => 'image', 'label' => 'hidden', 'weight' => 0, 'settings' => ['image_style' => 'large', 'image_link' => '']]);
    $view->setComponent('body', ['type' => 'text_default', 'label' => 'hidden', 'weight' => 1]);
    // Кнопка «В корзину» с ценой — без подписи «Вариации».
    if ($view->getComponent('variations')) {
      $opts = $view->getComponent('variations');
      $opts['label'] = 'hidden';
      $opts['weight'] = 5;
      // Каждое сочетание размера, прибавок и припусков — отдельная строка в корзине, строки не склеиваются
      $opts['settings']['combine'] = FALSE;
      $view->setComponent('variations', $opts);
    }
    $view->save();

    // Поля вариации (цена, артикул), которые показываются на странице товара.
    $var = $repo->getViewDisplay('commerce_product_variation', self::BUNDLE);
    if ($var->getComponent('price')) {
      $price = $var->getComponent('price');
      $price['label'] = 'hidden';
      $var->setComponent('price', $price);
    }
    $var->setComponent('sku', ['type' => 'string', 'label' => 'inline', 'weight' => -5]);
    $var->save();
  }

  /** Пункт «Каталог» в главном меню. */
  protected function menu(): void {
    $storage = \Drupal::entityTypeManager()->getStorage('menu_link_content');
    if ($storage->loadByProperties(['menu_name' => 'main', 'link__uri' => 'internal:/catalog'])) {
      return;
    }
    $storage->create([
      'title' => 'Каталог',
      'link' => ['uri' => 'internal:/catalog'],
      'menu_name' => 'main',
      'weight' => -10,
    ])->save();
  }

  /**
   * Тестовая «оплата»: ручной шлюз Commerce. Заказ оформляется без реальных денег — для проверки выдачи файлов.
   * Когда подключим ЮKassa, этот шлюз отключается в админке (Commerce → Конфигурация → Платежи).
   */
  protected function testGateway(): void {
    if (!\Drupal::moduleHandler()->moduleExists('commerce_payment')) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('commerce_payment_gateway');
    // Лекала цифровые: адрес покупателя не нужен, только электронная почта
    if ($existing = $storage->load('stroykroy_test')) {
      $conf = $existing->getPluginConfiguration();
      if (!empty($conf['collect_billing_information'])) {
        $conf['collect_billing_information'] = FALSE;
        $existing->setPluginConfiguration($conf)->save();
      }
      return;
    }
    $storage->create([
      'id' => 'stroykroy_test',
      'label' => 'Тестовая оплата',
      'plugin' => 'manual',
      'configuration' => [
        'display_label' => 'Тестовая оплата (без списания денег)',
        'collect_billing_information' => FALSE,
        'instructions' => ['value' => 'Это тестовый режим: деньги не списываются.', 'format' => 'plain_text'],
      ],
      'status' => TRUE,
    ])->save();
  }

  /** В позиции заказа храним выбор покупателя (JSON): по нему после оплаты строятся файлы. */
  protected function orderItemField(): void {
    if (!FieldStorageConfig::loadByName('commerce_order_item', 'field_sk_selection')) {
      FieldStorageConfig::create([
        'field_name' => 'field_sk_selection', 'entity_type' => 'commerce_order_item',
        'type' => 'string_long', 'cardinality' => 1,
      ])->save();
    }
    if (!FieldConfig::loadByName('commerce_order_item', 'default', 'field_sk_selection')) {
      FieldConfig::create([
        'field_name' => 'field_sk_selection', 'entity_type' => 'commerce_order_item', 'bundle' => 'default',
        'label' => 'Выбор покупателя (JSON)', 'required' => FALSE,
      ])->save();
    }
  }

  /**
   * Роли для коллег. Права выдаются только те, что есть в этой версии Drupal;
   * повторный запуск добавляет недостающие и ничего не отнимает.
   */
  protected function roles(): void {
    $known = array_keys(\Drupal::service('user.permissions')->getPermissions());
    $roles = [
      'catalog_manager' => ['Менеджер каталога', [
        'access toolbar', 'view the administration theme', 'access content overview',
        'access administration pages', 'access commerce administration pages',
        'view commerce_product', 'view unpublished commerce_product',
        'create lekala commerce_product', 'update any lekala commerce_product',
        'view commerce_order', 'access files overview',
        'create page content', 'edit any page content', 'view own unpublished content',
        'access content', 'view any unpublished content',
        'use text format basic_html',
      ]],
      'reviewer' => ['Рецензент', [
        'access toolbar', 'view the administration theme', 'access content overview',
        'access content', 'view commerce_product', 'view unpublished commerce_product',
        'view any unpublished content', 'view commerce_order',
      ]],
    ];
    foreach ($roles as $id => [$label, $perms]) {
      $role = Role::load($id) ?: Role::create(['id' => $id, 'label' => $label]);
      foreach ($perms as $perm) {
        if (in_array($perm, $known, TRUE)) {
          $role->grantPermission($perm);
        }
      }
      $role->save();
    }
  }

  /** Магазин работает в рублях. */
  protected function store(): void {
    $siteMail = (string) \Drupal::config('system.site')->get('mail');
    foreach (\Drupal::entityTypeManager()->getStorage('commerce_store')->loadMultiple() as $store) {
      $changed = FALSE;
      if ($store->getDefaultCurrencyCode() !== 'RUB') {
        $store->setDefaultCurrencyCode('RUB');
        $changed = TRUE;
      }
      // Название магазина от заготовки Commerce Kickstart заменяем на своё
      if (stripos($store->label(), 'kickstart') !== FALSE || stripos($store->label(), 'commerce') !== FALSE) {
        $store->setName('СтройКрой');
        $changed = TRUE;
      }
      $mail = (string) $store->getEmail();
      if ($siteMail !== '' && ($mail === '' || stripos($mail, 'example') !== FALSE || stripos($mail, 'kickstart') !== FALSE)) {
        $store->setEmail($siteMail);
        $changed = TRUE;
      }
      if ($changed) {
        $store->save();
      }
    }
    // Письмо о заказе отправляем сами (со ссылкой на файлы), стандартное «подтверждение» Commerce отключаем
    if ($type = \Drupal::entityTypeManager()->getStorage('commerce_order_type')->load('default')) {
      if ($type->shouldSendReceipt()) {
        $type->setSendReceipt(FALSE)->save();
      }
    }
  }


  /**
   * Русские тексты для того, что в теме и Commerce осталось английским: страница «заказ оформлен», корзина.
   * Переводы заводятся как пользовательские (не затираются обновлением переводов).
   */
  protected function russian(): void {
    // Сообщение на странице «заказ оформлен»
    $flow = \Drupal::entityTypeManager()->getStorage('commerce_checkout_flow')->load('default');
    if ($flow) {
      $conf = $flow->get('configuration');
      if (isset($conf['panes']['completion_message'])) {
        $conf['panes']['completion_message']['message'] = [
          'value' => "Номер вашего заказа: [commerce_order:order_number].\r\nФайлы с лекалами пришлют на вашу почту, их также можно скачать в разделе «Заказы» в личном кабинете.",
          'format' => 'plain_text',
        ];
        $flow->set('configuration', $conf)->save();
      }
    }
    $map = [
      'Order Complete!' => 'Заказ оформлен!',
      'Thank you for your purchase' => 'Спасибо за покупку',
      'Thank you for your purchase!' => 'Спасибо за покупку!',
      'Payment Instructions' => 'Как оплатить',
      'Item' => 'Товар',
      'Items' => 'Товары',
      'Order summary' => 'Ваш заказ',
      'Order Summary' => 'Ваш заказ',
      'Order date:' => 'Дата заказа:',
      'Order number' => 'Номер заказа',
      'Your order number is [commerce_order:order_number].' => 'Номер вашего заказа: [commerce_order:order_number].',
      'You can view your order on your account page when logged in.' => 'Заказ можно посмотреть в личном кабинете.',
      'View order details' => 'Подробности заказа',
      'View all orders' => 'Все заказы',
      'Checkout complete! Thank you for your purchase.' => 'Заказ оформлен! Спасибо за покупку.',
    ];
    $storage = \Drupal::service('locale.storage');
    foreach ($map as $en => $ru) {
      $string = $storage->findString(['source' => $en, 'context' => '']);
      if (!$string) {
        $string = $storage->createString(['source' => $en, 'context' => ''])->save();
      }
      $tr = $storage->findTranslation(['lid' => $string->getId(), 'language' => 'ru']);
      if ($tr) {
        $tr->setString($ru)->setCustomized()->save();
      }
      else {
        $storage->createTranslation(['lid' => $string->getId(), 'language' => 'ru', 'translation' => $ru, 'customized' => 1])->save();
      }
    }
    \Drupal::service('string_translation')->reset();
  }

}
