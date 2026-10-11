<?php

namespace Drupal\stroykroy_shop\EventSubscriber;

use Drupal\Component\Utility\Html;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Url;
use Drupal\stroykroy_shop\OrderFiles;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Заказ оформлен (оплачен): строим файлы и отправляем покупателю письмо со ссылкой.
 * Сбой не должен ломать оформление: покупателю скажем, что файлы придут позже.
 */
class OrderPlacedSubscriber implements EventSubscriberInterface {

  public function __construct(protected OrderFiles $files, protected MessengerInterface $messenger) {}

  public static function getSubscribedEvents(): array {
    return ['commerce_order.place.post_transition' => 'onPlace'];
  }

  public function onPlace($event): void {
    $order = $event->getEntity();
    try {
      $ok = $this->files->generate($order);
    }
    catch (\Throwable $e) {
      \Drupal::logger('stroykroy_shop')->error('Файлы заказа @o: @m', ['@o' => $order->id(), '@m' => $e->getMessage()]);
      $ok = FALSE;
    }
    if (!$this->files->meta($order->id()) && $ok) {
      return; // в заказе нет лекал из конфигуратора
    }
    $url = Url::fromRoute('stroykroy_shop.order_files', ['commerce_order' => $order->id()], [
      'query' => ['t' => OrderFiles::token('order|' . $order->id())], 'absolute' => TRUE,
    ])->toString();
    if ($ok) {
      $this->messenger->addStatus(t('Файлы лекал готовы: <a href=":u">скачать</a>. Ссылка также отправлена на вашу почту.', [':u' => $url]));
    }
    else {
      $this->messenger->addWarning(t('Файлы формируются дольше обычного. Мы уже разбираемся и пришлём ссылку на почту.'));
    }
    $this->sendMail($order, $ok, $url);
  }

  /** Письмо покупателю: что куплено, сколько заплачено и где скачать файлы. */
  protected function sendMail($order, bool $ok, string $url): void {
    $to = $order->getEmail();
    if (!$to) {
      return;
    }
    try {
      $fmt = \Drupal::service('commerce_price.currency_formatter');
      $price = fn($p) => $p ? $fmt->format($p->getNumber(), $p->getCurrencyCode()) : '';
      $number = $order->getOrderNumber() ?: $order->id();
      $rows = '';
      foreach ($order->getItems() as $item) {
        $variation = $item->getPurchasedEntity();
        $sku = $variation ? (string) $variation->getSku() : '';
        $saved = $item->hasField('field_sk_selection') && !$item->get('field_sk_selection')->isEmpty() ? json_decode((string) $item->get('field_sk_selection')->value, TRUE) : [];
        $note = trim(($sku !== '' ? 'Артикул ' . $sku : '') . (!empty($saved['summary']) ? ' · ' . $saved['summary'] : ''), ' ·');
        $title = $variation && $variation->getProduct() ? $variation->getProduct()->label() : $item->getTitle();
        $rows .= '<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>' . Html::escape($title) . '</strong>'
          . ($note !== '' ? '<br><span style="color:#666;font-size:13px">' . Html::escape($note) . '</span>' : '')
          . '</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">' . Html::escape($price($item->getTotalPrice())) . '</td></tr>';
      }
      $store = $order->getStore();
      $shop = $store ? $store->label() : 'СтройКрой';
      $block = $ok
        ? '<p>Ваши файлы готовы: <a href="' . Html::escape($url) . '">скачать файлы лекал</a>.</p><p style="color:#666;font-size:13px">Ссылка работает без входа на сайт. Сохраните это письмо: по ссылке файлы можно скачать повторно. PDF для печати на А4 печатайте в масштабе 100%.</p>'
        : '<p>Файлы формируются дольше обычного. Мы уже разбираемся и пришлём ссылку на скачивание отдельным письмом.</p>';
      $html = '<div style="max-width:620px;font-family:Arial,sans-serif;font-size:15px;color:#222">'
        . '<h2 style="margin:0 0 12px">Заказ № ' . Html::escape((string) $number) . ' оформлен</h2>'
        . '<table style="width:100%;border-collapse:collapse">' . $rows
        . '<tr><td style="padding:10px 0"><strong>Итого</strong></td><td style="padding:10px 0;text-align:right"><strong>' . Html::escape($price($order->getTotalPrice())) . '</strong></td></tr></table>'
        . $block . '<p style="margin-top:24px">Спасибо за заказ!<br>' . Html::escape($shop) . '</p></div>';
      \Drupal::service('commerce.mail_handler')->sendMail($to, 'Заказ № ' . $number . ' — ' . $shop, ['#markup' => \Drupal\Core\Render\Markup::create($html)], array_filter([
        'id' => 'stroykroy_order_files', 'from' => $store ? $store->getEmail() : NULL, 'langcode' => 'ru',
      ]));
    }
    catch (\Throwable $e) {
      \Drupal::logger('stroykroy_shop')->error('Письмо о заказе @o не отправлено: @m', ['@o' => $order->id(), '@m' => $e->getMessage()]);
    }
  }

}
