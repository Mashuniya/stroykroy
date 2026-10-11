<?php

namespace Drupal\stroykroy_shop;

use Drupal\commerce_product\Entity\ProductType;
use Drupal\commerce_product\Entity\ProductVariationType;
use Drupal\commerce_price\Entity\Currency;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;

/**
 * Создаёт тип товара «Лекала» и всё, что ему нужно. Повторный запуск безопасен.
 */
class Setup {

  const BUNDLE = 'lekala';

  public function run(): void {
    $this->currency();
    $this->types();
    $this->fields();
    $this->store();
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

    $this->ensureStorage('stores', 'entity_reference', -1, ['target_type' => 'commerce_store']);
    if (!FieldConfig::loadByName('commerce_product', self::BUNDLE, 'stores')) {
      FieldConfig::create([
        'field_name' => 'stores', 'entity_type' => 'commerce_product', 'bundle' => self::BUNDLE,
        'label' => 'Магазины', 'required' => TRUE,
        'settings' => ['handler' => 'default:commerce_store', 'handler_settings' => []],
      ])->save();
      $repo->getFormDisplay('commerce_product', self::BUNDLE)->setComponent('stores', [
        'type' => $widgets->hasDefinition('commerce_entity_select') ? 'commerce_entity_select' : 'options_buttons',
        'weight' => 3,
      ])->save();
    }

    $this->ensureStorage('variations', 'entity_reference', -1, ['target_type' => 'commerce_product_variation']);
    if (!FieldConfig::loadByName('commerce_product', self::BUNDLE, 'variations')) {
      FieldConfig::create([
        'field_name' => 'variations', 'entity_type' => 'commerce_product', 'bundle' => self::BUNDLE,
        'label' => 'Вариации', 'required' => TRUE,
        'settings' => [
          'handler' => 'default:commerce_product_variation',
          'handler_settings' => ['target_bundles' => [self::BUNDLE => self::BUNDLE]],
        ],
      ])->save();
      $widget = $widgets->hasDefinition('commerce_product_single_variation') ? 'commerce_product_single_variation' : 'inline_entity_form_complex';
      $repo->getFormDisplay('commerce_product', self::BUNDLE)->setComponent('variations', ['type' => $widget, 'weight' => 4])->save();
    }

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

  /** Магазин работает в рублях. */
  protected function store(): void {
    foreach (\Drupal::entityTypeManager()->getStorage('commerce_store')->loadMultiple() as $store) {
      if ($store->getDefaultCurrencyCode() !== 'RUB') {
        $store->setDefaultCurrencyCode('RUB')->save();
      }
    }
  }

}
