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
    $section = trim((string) $request->query->get('section', ''));
    $category = trim((string) $request->query->get('category', ''));

    $storage = $this->entityTypeManager()->getStorage('commerce_product');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('type', Setup::BUNDLE)
      ->condition('status', 1)
      ->sort('title')
      ->execute();
    $all = $storage->loadMultiple($ids);

    // Разделы и категории — только те, где есть товары.
    $sections = [];
    $categories = [];
    foreach ($all as $p) {
      $s = (string) $p->get('field_section')->value;
      $c = (string) $p->get('field_category')->value;
      if ($s !== '') {
        $sections[$s] = TRUE;
        if ($c !== '' && ($section === '' || $section === $s)) {
          $categories[$c] = TRUE;
        }
      }
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

    $html = '<div class="sk-catalog">';
    $html .= $this->nav('section', array_keys($sections), $section, []);
    if ($section !== '' && $categories) {
      $html .= $this->nav('category', array_keys($categories), $category, ['section' => $section]);
    }
    $html .= $items
      ? '<div class="sk-catalog__grid">' . implode('', $items) . '</div>'
      : '<p class="sk-catalog__empty">Пока здесь нет лекал.</p>';
    $html .= '</div>';

    return [
      '#markup' => Markup::create($html),
      '#attached' => ['library' => ['stroykroy_shop/catalog']],
      '#cache' => [
        'contexts' => ['url.query_args'],
        'tags' => ['commerce_product_list'],
      ],
    ];
  }

  /** Ряд «пилюль»: «Все» + значения. */
  protected function nav(string $param, array $values, string $current, array $keep): string {
    $out = '<ul class="sk-catalog__nav">';
    $out .= $this->pill('Все', Url::fromRoute('stroykroy_shop.catalog', [], ['query' => $keep])->toString(), $current === '');
    foreach ($values as $v) {
      $url = Url::fromRoute('stroykroy_shop.catalog', [], ['query' => $keep + [$param => $v]])->toString();
      $out .= $this->pill($v, $url, $current === $v);
    }
    return $out . '</ul>';
  }

  protected function pill(string $label, string $url, bool $active): string {
    return '<li><a href="' . Html::escape($url) . '"' . ($active ? ' class="is-active"' : '') . '>' . Html::escape($label) . '</a></li>';
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
