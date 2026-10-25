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
      // название не задано отдельно (совпадает с кодом из студии) — показываем код русскими буквами, как артикул: ЖПЛ10001
      if (mb_strtoupper($title) === mb_strtoupper(trim((string) ($p['name'] ?? '')))) {
        $title = $this->article($title);
      }
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
        $this->removeModel($cid);
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
      // Адрес страницы — артикул латиницей (/mov11001), чтобы любое изделие находилось по номеру
      $this->setAlias($product, $sku);
      // Построения в базе сайта не храним: они лежат только в файле модели для сервиса. Здесь только адреса фото элементов (рукав и т. п.)
      $elementPhotos = $this->elementPhotos($cid, (array) ($p['elements'] ?? []));
      $payload = [];
      if ($elementPhotos) {
        $payload['elementPhotos'] = $elementPhotos;
      }
      // Технические рисунки (слоями): основа и рисунки элементов с точками привязки
      $sketch = $this->saveSketch("$cid-base", $p['sketch'] ?? NULL);
      if ($sketch) {
        $sketch['anchors'] = $this->cleanPoints($p['sketch']['anchors'] ?? []);
        $payload['sketch'] = $sketch;
      }
      $elementSketches = $this->elementSketches($cid, (array) ($p['elements'] ?? []));
      if ($elementSketches) {
        $payload['elementSketches'] = $elementSketches;
      }
      $product->set('field_payload', $payload ? json_encode($payload, JSON_UNESCAPED_UNICODE) : '');
      $product->save();
      if (!$this->writeModel($cid, $p)) {
        $stats['skipped'][] = "$title: товар создан, но файл модели для конфигуратора записать не удалось (папка " . $this->modelsDir() . ")";
      }
    }
    return $stats;
  }

  /**
   * Артикул на сайте — код из студии русскими буквами (в студии пишем латиницей).
   * Обычная транслитерация по звучанию (M→М, O→О, V→В, N→Н…).
   */
  public const LETTERS = [
    'A' => 'А', 'B' => 'Б', 'C' => 'Ц', 'D' => 'Д', 'E' => 'Е', 'F' => 'Ф', 'G' => 'Г',
    'H' => 'Х', 'I' => 'И', 'J' => 'Ж', 'K' => 'К', 'L' => 'Л', 'M' => 'М', 'N' => 'Н',
    'O' => 'О', 'P' => 'П', 'Q' => 'КВ', 'R' => 'Р', 'S' => 'С', 'T' => 'Т', 'U' => 'У',
    'V' => 'В', 'W' => 'Ш', 'X' => 'КС', 'Y' => 'Ы', 'Z' => 'З',
  ];

  /** Адрес страницы по артикулу: «МОВ11001» → /mov11001. Если адрес уже занят другой страницей, адрес не меняется. */
  public function setAlias($product, string $sku): void {
    if (!$product->hasField('path')) {
      return;
    }
    // обратно в латиницу по той же таблице (ЖПЛ10001 → jpl10001), а не по звучанию (иначе Ж → zh)
    $back = ['Й' => 'J', 'КВ' => 'Q', 'КС' => 'X'];
    foreach (self::LETTERS as $lat => $ru) {
      if (mb_strlen($ru) === 1) {
        $back[$ru] = $lat;
      }
    }
    $t = strtr(mb_strtoupper($sku), $back);
    $t = \Drupal::transliteration()->transliterate($t, 'ru');
    $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($t)), '-');
    if ($slug === '') {
      return;
    }
    $alias = '/' . $slug;
    $own = $product->id() ? '/product/' . $product->id() : NULL;
    foreach (\Drupal::entityTypeManager()->getStorage('path_alias')->loadByProperties(['alias' => $alias]) as $a) {
      if ($a->getPath() !== $own) {
        return;
      }
    }
    $product->set('path', ['alias' => $alias]);
  }

  protected function article(string $code): string {
    $code = trim(mb_strtoupper($code));
    return strtr($code, self::LETTERS);
  }

  /** Папка, из которой сервис конфигуратора читает модели (по умолчанию /var/lib/stroykroy/models). */
  protected function modelsDir(): string {
    return rtrim((string) \Drupal\Core\Site\Settings::get('stroykroy_models_dir', '/var/lib/stroykroy/models'), '/');
  }

  /** Модель для сервиса: построения и настройки без фото и текстов витрины. На сайт (в браузер) этот файл не попадает никогда. */
  protected function writeModel(string $cid, array $p): bool {
    if (!preg_match('/^[A-Za-z0-9_.-]{1,128}$/', $cid)) {
      return FALSE;
    }
    $dir = $this->modelsDir();
    if (!is_dir($dir) || !is_writable($dir)) {
      return FALSE;
    }
    $model = [
      'id' => $cid,
      'name' => $p['name'] ?? '',
      'mode' => $p['mode'] ?? 'constructor',
      'script' => $p['script'] ?? '',
      'shownOptions' => $p['shownOptions'] ?? NULL,
      'elements' => $this->withoutPhotos((array) ($p['elements'] ?? [])) ?: new \stdClass(),
      'links' => $p['links'] ?? [],
      'requiredElements' => $p['requiredElements'] ?? new \stdClass(),
      'defaultElements' => $p['defaultElements'] ?? new \stdClass(),
      'shop' => ['title' => (string) (($p['shop']['title'] ?? '') ?: ($p['name'] ?? ''))],
    ];
    $tmp = $dir . '/.' . $cid . '.tmp';
    if (file_put_contents($tmp, json_encode($model, JSON_UNESCAPED_UNICODE)) === FALSE) {
      return FALSE;
    }
    return rename($tmp, $dir . '/' . $cid . '.json');
  }

  protected function removeModel(string $cid): void {
    if (preg_match('/^[A-Za-z0-9_.-]{1,128}$/', $cid)) {
      @unlink($this->modelsDir() . '/' . $cid . '.json');
    }
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

  /** Элементы без фото: сервису чертежей фото не нужны, а файл модели не должен разрастаться. */
  protected function withoutPhotos(array $elements): array {
    foreach ($elements as $kind => $list) {
      foreach ((array) $list as $i => $e) {
        unset($elements[$kind][$i]['photos'], $elements[$kind][$i]['sketch']);
      }
    }
    return $elements;
  }

  /**
   * Фото элементов (рукав и т. п.) → файлы на сайте. Возвращает адреса вида [вид => [id элемента => [uri…]]].
   */
  protected function elementPhotos(string $cid, array $elements): array {
    $out = [];
    $dir = 'public://lekala';
    foreach ($elements as $kind => $list) {
      foreach ((array) $list as $e) {
        $eid = (string) ($e['id'] ?? '');
        $urls = (array) ($e['photos'] ?? []);
        if ($eid === '' || !$urls) {
          continue;
        }
        $slug = preg_replace('/[^A-Za-z0-9_-]/', '-', $cid . '-' . $kind . '-' . $eid);
        foreach (array_values($urls) as $i => $url) {
          if (!is_string($url) || !preg_match('#^data:image/(jpeg|png);base64,(.+)$#s', $url, $m)) {
            continue;
          }
          $bin = base64_decode($m[2], TRUE);
          if ($bin === FALSE || $bin === '') {
            continue;
          }
          \Drupal::service('file_system')->prepareDirectory($dir, FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS);
          $file = \Drupal::service('file.repository')->writeData($bin, "$dir/$slug-" . ($i + 1) . ($m[1] === 'png' ? '.png' : '.jpg'), FileExists::Replace);
          $out[$kind][$eid][] = $file->getFileUri();
        }
      }
    }
    return $out;
  }

  /** PNG-рисунок из data-URL → файл на сайте. Возвращает ['uri','w','h'] или NULL. */
  protected function saveSketch(string $slug, $sk): ?array {
    if (!is_array($sk) || !is_string($sk['src'] ?? NULL) || !preg_match('#^data:image/png;base64,(.+)$#s', $sk['src'], $m)) {
      return NULL;
    }
    $bin = base64_decode($m[1], TRUE);
    if ($bin === FALSE || $bin === '') {
      return NULL;
    }
    $dir = 'public://lekala';
    \Drupal::service('file_system')->prepareDirectory($dir, FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS);
    $slug = preg_replace('/[^A-Za-z0-9_-]/', '-', $slug);
    $file = \Drupal::service('file.repository')->writeData($bin, "$dir/sketch-$slug.png", FileExists::Replace);
    return ['uri' => $file->getFileUri(), 'w' => (float) ($sk['w'] ?? 0), 'h' => (float) ($sk['h'] ?? 0)];
  }

  /** Точки привязки: оставляем только полные пары {x,y}. */
  protected function cleanPoints($pts) {
    $pt = static fn($q) => is_array($q) && isset($q['x'], $q['y']) && is_numeric($q['x']) && is_numeric($q['y']) ? ['x' => (float) $q['x'], 'y' => (float) $q['y']] : NULL;
    if (isset($pts[0]) || $pts === []) {
      $a = array_map($pt, array_slice(array_values((array) $pts), 0, 4));
      if (count($a) === 4 && $a[0] && $a[1] && $a[2] && $a[3]) {
        return $a;
      }
      return count($a) >= 2 && $a[0] && $a[1] ? array_slice($a, 0, 2) : [];
    }
    $out = [];
    foreach ((array) $pts as $k => $v) {
      $a = $this->cleanPoints(array_values((array) $v));
      if ($a) {
        $out[$k] = $a;
      }
    }
    return $out ?: new \stdClass();
  }

  /** Рисунки элементов: [вид => [id => {uri,w,h,points,behind}]]. */
  protected function elementSketches(string $cid, array $elements): array {
    $out = [];
    foreach ($elements as $kind => $list) {
      foreach ((array) $list as $e) {
        $eid = (string) ($e['id'] ?? '');
        $sk = $eid !== '' ? $this->saveSketch("$cid-$kind-$eid", $e['sketch'] ?? NULL) : NULL;
        if (!$sk) {
          continue;
        }
        $sk['points'] = $this->cleanPoints($e['sketch']['points'] ?? []);
        $sk['behind'] = !empty($e['sketch']['behind']);
        // рисунки по значениям опции (например, длина рукава)
        $opt = (string) ($e['sketch']['variantOption'] ?? '');
        if ($opt !== '' && is_array($e['sketch']['variants'] ?? NULL)) {
          foreach ($e['sketch']['variants'] as $val => $v) {
            $val = (string) $val;
            if (!preg_match('/^-?[0-9]+(\.[0-9]+)?$/', $val)) {
              continue;
            }
            $vs = $this->saveSketch("$cid-$kind-$eid-v" . str_replace(['.', '-'], ['_', 'm'], $val), $v);
            if ($vs) {
              $vs['points'] = $this->cleanPoints($v['points'] ?? []);
              $sk['variants'][$val] = $vs;
            }
          }
          if (!empty($sk['variants'])) {
            $sk['variantOption'] = $opt;
          }
        }
        $out[$kind][$eid] = $sk;
      }
    }
    return $out;
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
