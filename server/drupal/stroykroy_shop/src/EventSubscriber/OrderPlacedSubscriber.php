<?php

namespace Drupal\stroykroy_shop\EventSubscriber;

use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Url;
use Drupal\stroykroy_shop\OrderFiles;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Заказ оформлен (оплачен) — строим файлы. Сбой не должен ломать оформление: покупателю скажем, что файлы придут позже.
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
      $this->messenger->addStatus(t('Файлы лекал готовы: <a href=":u">скачать</a>. Сохраните эту ссылку.', [':u' => $url]));
    }
    else {
      $this->messenger->addWarning(t('Файлы формируются дольше обычного. Мы уже разбираемся и пришлём их на почту. Страница заказа: <a href=":u">:u</a>', [':u' => $url]));
    }
  }

}
