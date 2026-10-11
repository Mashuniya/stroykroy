<?php

namespace Drupal\stroykroy_shop;

use Drupal\commerce_price\Price;
use Drupal\commerce_product\Entity\Product;
use Drupal\commerce_product\Entity\ProductVariation;
use Drupal\Core\File\FileExists;
use Drupal\Core\File\FileSystemInterface;
use Drupal\filter\Entity\FilterFormat;

/**
 * Читает файл каталога из студии (stroykroy-catalog.json, версия 3) и создаёт/обновляет товары «Лекала».
 */
class CatalogImporter {

  /**
   * @return array{created:int,updated:int,unpublished:int,skipped:string[]}
   */
  public function import(array $data): array {
    $stats = ['created' => 0, 'updated' => 0, 'unpublished' => 0, 'skipped' => []];
    $storage = \Drupal::entityTypeManager()->getStorage('commerce_product');
    $stores = \Drupal::entityTypeManager()->getStorage('commerce_store')->loadMultiple();
    $storeIds = array_keys($stores);

    foreach (($data['products'] ?? []) as $p) {
      $cid = (string) ($p['id'] ?? '');
      $shop = $p['shop'] ?? [];
      $title = trim((string) ($shop['title'] ?? '')) ?: (string) ($p['name'] ?? $cid);
      if ($cid === '') {
        $stats['skipped'][] = "$title: нет кода модели";
        continue;
      }
      $ids = $storage->getQuery()->accessCheck(FALSE)
        ->condition('type', Setup::BUNDLE)
        ->condition('field_catalog_id', $cid)
        ->execute();
      /** @var \Drupal\commerce_product\Entity\ProductInterface|null $product */
      $product = $ids ? $storage->load(reset($ids)) : NULL;

      // Не выставлена в магазин: если уже была — снимаем с витрины.
      if (empty($shop['forSale'])) {
        if ($product && $product->isPublished()) {
          $product->setUnpublished()->save();
          $stats['unpublished']++;
        }
        continue;
      }
      $price = (float) ($shop['price'] ?? 0);
      if ($price <= 0) {
        $stats['skipped'][] = "$title: не указана цена";
        continue;
      }
      if (!$storeIds) {
        $stats['skipped'][] = "$title: в Drupal нет магазина";
        continue;
      }

      $payload = json_encode([
        'id' => $cid,
        'name' => $p['name'] ?? '',
        'mode' => $p['mode'] ?? 'constructor',
        'section' => $p['section'] ?? '',
        'category' => $p['category'] ?? '',
        'script' => $p['script'] ?? '',
        'elements' => $p['elements'] ?? new \stdClass(),
        'links' => $p['links'] ?? [],
        'defaultElements' => $p['defaultElements'] ?? new \stdClass(),
      ], JSON_UNESCAPED_UNICODE);

      $body = ['value' => (string) ($shop['description'] ?? ''), 'format' => $this->textFormat()];
      $photos = $this->photos($cid, $title, (array) ($shop['photos'] ?? []));
      $sku = $this->article((string) ($p['name'] ?? $cid));
      $money = new Price(number_format($price, 2, '.', ''), 'RUB');

      if ($product) {
        $variation = $product->getDefaultVariation();
        if (!$variation) {
          $variation = $this->newVariation($cid, $money, $sku);
          $product->addVariation($variation);
        }
        else {
          $variation->setPrice($money)->setSku($sku);
          $variation->save();
        }
        $product->setTitle($title)->setPublished();
        $stats['updated']++;
      }
      else {
        $variation = $this->newVariation($cid, $money, $sku);
        $product = Product::create([
          'type' => Setup::BUNDLE,
          'title' => $title,
          'stores' => $storeIds,
          'variations' => [$variation],
          'status' => TRUE,
        ]);
        $stats['created']++;
      }
      $product->set('body', $body);
      $product->set('field_photos', $photos);
      $product->set('field_section', (string) ($p['section'] ?? ''));
      $product->set('field_category', (string) ($p['category'] ?? ''));
      $product->set('field_mode', ($p['mode'] ?? 'constructor') === 'ready' ? 'ready' : 'constructor');
      $product->set('field_catalog_id', $cid);
      $product->set('field_payload', $payload);
      $product->save();
    }
    return $stats;
  }

  /**
   * Артикул на сайте — код из студии русскими буквами (в студии пишем латиницей).
   * Обычная транслитерация по звучанию (M→М, O→О, V→В, N→Н…).
   */
  public const LETTERS = [
    'A' => 'А', 'B' => 'Б', 'C' => 'Ц', 'D' => 'Д', 'E' => 'Е', 'F' => 'Ф', 'G' => 'Г',
    'H' => 'Х', 'I' => 'И', 'J' => 'Й', 'K' => 'К', 'L' => 'Л', 'M' => 'М', 'N' => 'Н',
    'O' => 'О', 'P' => 'П', 'Q' => 'КВ', 'R' => 'Р', 'S' => 'С', 'T' => 'Т', 'U' => 'У',
    'V' => 'В', 'W' => 'Ш', 'X' => 'КС', 'Y' => 'Ы', 'Z' => 'З',
  ];

  protected function article(string $code): string {
    $code = trim(mb_strtoupper($code));
    return strtr($code, self::LETTERS);
  }

  protected function newVariation(string $cid, Price $price, string $sku): ProductVariation {
    $variation = ProductVariation::create([
      'type' => Setup::BUNDLE,
      'sku' => $sku !== '' ? $sku : 'LEKALA-' . substr(md5($cid), 0, 10),
      'price' => $price,
      'status' => TRUE,
    ]);
    $variation->save();
    return $variation;
  }

  /** Формат текста, который точно есть на сайте. */
  protected function textFormat(): ?string {
    foreach (['plain_text', 'basic_html', 'restricted_html'] as $id) {
      if (FilterFormat::load($id)) {
        return $id;
      }
    }
    return NULL;
  }

  /** Фото из файла каталога (data-URL) → файлы Drupal. */
  protected function photos(string $cid, string $title, array $urls): array {
    $out = [];
    $dir = 'public://lekala';
    \Drupal::service('file_system')->prepareDirectory($dir, FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS);
    $slug = preg_replace('/[^A-Za-z0-9_-]/', '-', $cid);
    foreach (array_values($urls) as $i => $url) {
      if (!is_string($url) || !preg_match('#^data:image/(jpeg|png);base64,(.+)$#s', $url, $m)) {
        continue;
      }
      $bin = base64_decode($m[2], TRUE);
      if ($bin === FALSE || $bin === '') {
        continue;
      }
      $ext = $m[1] === 'png' ? 'png' : 'jpg';
      $file = \Drupal::service('file.repository')->writeData($bin, "$dir/$slug-" . ($i + 1) . ".$ext", FileExists::Replace);
      $out[] = ['target_id' => $file->id(), 'alt' => $title];
    }
    return $out;
  }

}
