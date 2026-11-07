<?php

namespace Drupal\stroykroy_shop\Controller;

use Drupal\commerce_order\Entity\OrderInterface;
use Drupal\Component\Utility\Html;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Render\Markup;
use Drupal\Core\Url;

/**
 * Оплаченные заказы, у которых не собрались файлы лекал.
 *
 * Чтобы о таком заказе не узнавать от покупателя: список за последние дни
 * со ссылкой на пересборку.
 */
class FilesReportController extends ControllerBase {

  /** Сколько дней назад смотреть. */
  const DAYS = 14;

  /**
   * Список заказов без файлов.
   */
  public function page(): array {
    $storage = $this->entityTypeManager()->getStorage('commerce_order');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('state', 'completed')
      ->condition('changed', \Drupal::time()->getRequestTime() - self::DAYS * 86400, '>=')
      ->sort('changed', 'DESC')
      ->range(0, 200)
      ->execute();

    $files = \Drupal::service('stroykroy_shop.order_files');
    $rows = [];
    $checked = 0;
    foreach ($storage->loadMultiple($ids) as $order) {
      if (!$this->hasPatterns($order)) {
        continue;
      }
      $checked++;
      $missing = $this->missingItems($order, $files->meta($order->id()));
      if (!$missing) {
        continue;
      }
      $rows[] = [
        'id' => $order->id(),
        'number' => (string) ($order->getOrderNumber() ?: $order->id()),
        'time' => \Drupal::service('date.formatter')->format((int) ($order->getPlacedTime() ?: $order->getChangedTime()), 'short'),
        'mail' => (string) $order->getEmail(),
        'missing' => count($missing),
      ];
    }

    $build = ['#cache' => ['max-age' => 0]];
    $build['intro'] = ['#markup' => Markup::create('<p>Оплаченные заказы за последние ' . self::DAYS . ' дней, у которых файлы лекал не собраны. Собрать: открыть заказ → вкладка «Файлы лекал» → «Пересобрать» (или сразу <code>/stroykroy/rebuild/НОМЕР</code>).</p>')];
    $build['summary'] = ['#markup' => Markup::create('<p>Проверено заказов с лекалами: <strong>' . $checked . '</strong>. Без файлов: <strong>' . count($rows) . '</strong>.</p>')];

    if (!$rows) {
      $build['empty'] = ['#markup' => Markup::create('<p style="color:#0b7a62">Все заказы с файлами — делать ничего не нужно.</p>')];
      return $build;
    }

    $table = [
      '#type' => 'table',
      '#header' => ['Заказ', 'Оформлен', 'Покупатель', 'Позиций без файлов', ''],
      '#rows' => [],
    ];
    foreach ($rows as $r) {
      $orderUrl = Url::fromRoute('entity.commerce_order.canonical', ['commerce_order' => $r['id']])->toString();
      $rebuildUrl = Url::fromRoute('stroykroy_shop.rebuild', ['commerce_order' => $r['id']])->toString();
      $table['#rows'][] = [
        Markup::create('<a href="' . Html::escape($orderUrl) . '">№ ' . Html::escape($r['number']) . '</a>'),
        Html::escape($r['time']),
        Html::escape($r['mail']),
        (string) $r['missing'],
        Markup::create('<a href="' . Html::escape($rebuildUrl) . '">Пересобрать</a>'),
      ];
    }
    $build['table'] = $table;
    return $build;
  }

  /**
   * В заказе есть позиции из конфигуратора.
   */
  protected function hasPatterns(OrderInterface $order): bool {
    foreach ($order->getItems() as $item) {
      if ($item->hasField('field_sk_selection') && !$item->get('field_sk_selection')->isEmpty()) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * ID позиций, для которых в meta.json нет файлов.
   */
  protected function missingItems(OrderInterface $order, array $meta): array {
    $out = [];
    foreach ($order->getItems() as $item) {
      if (!$item->hasField('field_sk_selection') || $item->get('field_sk_selection')->isEmpty()) {
        continue;
      }
      $info = $meta[$item->id()] ?? NULL;
      if (!$info || empty($info['files'])) {
        $out[] = $item->id();
      }
    }
    return $out;
  }

}