<?php

namespace Drupal\stroykroy_shop\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/** Лекала цифровые: одну и ту же позицию в корзине покупают один раз, количество всегда 1. */
class CartSubscriber implements EventSubscriberInterface {

  public static function getSubscribedEvents(): array {
    return ['commerce_cart.entity.add' => 'onAdd'];
  }

  public function onAdd($event): void {
    $item = $event->getOrderItem();
    if (!$item->hasField('field_sk_selection') || $item->get('field_sk_selection')->isEmpty()) {
      return;
    }
    if ((float) $item->getQuantity() > 1) {
      $item->setQuantity('1')->save();
      $cart = $event->getCart();
      $cart->recalculateTotalPrice()->save();
    }
  }

}
