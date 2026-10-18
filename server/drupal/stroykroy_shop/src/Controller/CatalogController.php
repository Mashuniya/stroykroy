<?php

namespace Drupal\stroykroy_shop\Controller;

use Drupal\Component\Utility\Html;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Render\Markup;
use Drupal\Core\Url;
use Drupal\stroykroy_shop\Setup;
use Symfony\Component\HttpFoundation\Request;

/**
 * Витрина: плитки лекал с фильтром по разделу и категории.
 */
class CatalogController extends ControllerBase {

  public function page(Request $request): array {
    // В адресе — транслит («zhenskaya-odezhda»); старые адреса с русскими названиями тоже понимаем
    $rawSection = trim((string) $request->query->get('section', ''));
    $rawCategory = trim((string) $request->query->get('category', ''));

    $storage = $this->entityTypeManager()->getStorage('commerce_product');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('type', Setup::BUNDLE)
      ->condition('status', 1)
      ->sort('title')
      ->execute();
    $all = $storage->loadMultiple($ids);

    // Половозрастные группы (раздел) и ассортимент (категория) — только те, где есть товары; в скобках число лекал.
    $sections = [];
    $catsBySection = [];
    foreach ($all as $p) {
      $s = (string) $p->get('field_section')->value;
      $c = (string) $p->get('field_category')->value;
      if ($s !== '') {
        $sections[$s] = ($sections[$s] ?? 0) + 1;
        if ($c !== '') {
          $catsBySection[$s][$c] = ($catsBySection[$s][$c] ?? 0) + 1;
        }
      }
    }
    $allCategories = [];
    foreach ($catsBySection as $cats) {
      foreach ($cats as $c => $n) {
        $allCategories[$c] = TRUE;
      }
    }
    $section = $this->resolve($rawSection, array_keys($sections));
    $category = $this->resolve($rawCategory, array_keys($allCategories));
    $categories = [];
    foreach ($catsBySection as $s => $cats) {
      if ($section === '' || $section === $s) {
        foreach ($cats as $c => $n) {
          $categories[$c] = ($categories[$c] ?? 0) + $n;
        }
      }
    }
    // Выбранный ассортимент, которого нет в выбранной группе, сбрасываем
    if ($category !== '' && !isset($categories[$category])) {
      $category = '';
    }

    $items = [];
    foreach ($all as $p) {
      if ($section !== '' && (string) $p->get('field_section')->value !== $section) {
        continue;
      }
      if ($category !== '' && (string) $p->get('field_category')->value !== $category) {
        continue;
      }
      $items[] = $this->card($p);
    }

    $html = '<div class="sk-catalog sk-catalog--side">';
    $html .= '<aside class="sk-catalog__side">';
    $html .= $this->group('Половозрастная группа', 'section', $sections, $section, $category !== '' ? ['category' => $this->slug($category)] : [], count($all));
    if ($categories) {
      $html .= $this->group('Ассортимент', 'category', $categories, $category, $section !== '' ? ['section' => $this->slug($section)] : [], array_sum($section === '' ? $sections : [$sections[$section] ?? 0]));
    }
    $html .= '</aside><div class="sk-catalog__main">';
    $html .= $items
      ? '<div class="sk-catalog__grid">' . implode('', $items) . '</div>'
      : '<p class="sk-catalog__empty">Пока здесь нет лекал.</p>';
    $html .= '</div></div>';

    return [
      '#markup' => Markup::create($html),
      '#attached' => ['library' => ['stroykroy_shop/catalog']],
      '#cache' => [
        'contexts' => ['url.query_args'],
        'tags' => ['commerce_product_list'],
      ],
    ];
  }

  /** Короткие адреса для основных групп; остальное — транслит названия без слов «одежда», «для». */
  const SLUGS = [
    'женская одежда' => 'zhenshchinam', 'женщинам' => 'zhenshchinam', 'женская' => 'zhenshchinam', 'для женщин' => 'zhenshchinam',
    'мужская одежда' => 'muzhchinam', 'мужчинам' => 'muzhchinam', 'мужская' => 'muzhchinam', 'для мужчин' => 'muzhchinam',
    'детская одежда' => 'detyam', 'детям' => 'detyam', 'детская' => 'detyam', 'для детей' => 'detyam',
    'одежда для девочек' => 'devochkam', 'девочкам' => 'devochkam', 'для девочек' => 'devochkam', 'девочки' => 'devochkam',
    'одежда для мальчиков' => 'malchikam', 'мальчикам' => 'malchikam', 'для мальчиков' => 'malchikam', 'мальчики' => 'malchikam',
  ];

  /** Адресная часть из названия: «Женская одежда» → zhenshchinam; остальное — транслит («Платья» → platya). */
  protected function slug(string $name): string {
    $key = mb_strtolower(trim($name));
    if (isset(self::SLUGS[$key])) {
      return self::SLUGS[$key];
    }
    $short = trim((string) preg_replace('/\b(одежда|одежды|для)\b/u', ' ', $key));
    $t = \Drupal::transliteration()->transliterate($short !== '' ? $short : $key, 'ru');
    $t = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($t)), '-');
    return $t !== '' ? $t : 'x';
  }

  /** Название по значению из адреса: транслит или (для старых ссылок) само название. */
  protected function resolve(string $raw, array $names): string {
    if ($raw === '') {
      return '';
    }
    foreach ($names as $n) {
      if ($raw === (string) $n || $raw === $this->slug((string) $n)) {
        return (string) $n;
      }
    }
    return '';
  }

  /** Колонка слева: заголовок, «Все» и значения со счётчиками. $keep — параметры другой колонки, которые сохраняются. */
  protected function group(string $title, string $param, array $values, string $current, array $keep, int $total): string {
    $out = '<div class="sk-catalog__group"><h2 class="sk-catalog__group-title">' . Html::escape($title) . '</h2><ul class="sk-catalog__nav">';
    $out .= $this->pill('Все', Url::fromRoute('stroykroy_shop.catalog', [], ['query' => $keep])->toString(), $current === '', $total);
    foreach ($values as $v => $n) {
      $url = Url::fromRoute('stroykroy_shop.catalog', [], ['query' => $keep + [$param => $this->slug((string) $v)]])->toString();
      $out .= $this->pill((string) $v, $url, $current === (string) $v, (int) $n);
    }
    return $out . '</ul></div>';
  }

  protected function pill(string $label, string $url, bool $active, int $count = 0): string {
    return '<li><a href="' . Html::escape($url) . '"' . ($active ? ' class="is-active"' : '') . '>' . Html::escape($label)
      . ($count > 0 ? ' <span class="sk-catalog__count">' . $count . '</span>' : '') . '</a></li>';
  }

  protected function card($product): string {
    $url = $product->toUrl()->toString();
    $img = '';
    $file = $product->get('field_photos')->entity;
    if ($file) {
      $style = $this->entityTypeManager()->getStorage('image_style')->load('large');
      $src = $style ? $style->buildUrl($file->getFileUri()) : \Drupal::service('file_url_generator')->generateAbsoluteString($file->getFileUri());
      $img = '<img src="' . Html::escape($src) . '" alt="' . Html::escape($product->label()) . '" loading="lazy">';
    }
    $variation = $product->getDefaultVariation();
    $sku = $variation ? $variation->getSku() : '';
    $price = '';
    if ($variation && $variation->getPrice()) {
      $n = $variation->getPrice()->getNumber();
      $price = number_format((float) $n, ((float) $n == floor((float) $n)) ? 0 : 2, ',', ' ') . ' ₽';
    }
    return '<a class="sk-card" href="' . Html::escape($url) . '">'
      . '<div class="sk-card__img">' . $img . '</div>'
      . '<h3 class="sk-card__title">' . Html::escape($product->label()) . '</h3>'
      . ($sku !== '' ? '<div class="sk-card__sku">Артикул ' . Html::escape($sku) . '</div>' : '')
      . ($price !== '' ? '<div class="sk-card__price">' . Html::escape($price) . '</div>' : '')
      . '</a>';
  }

}
