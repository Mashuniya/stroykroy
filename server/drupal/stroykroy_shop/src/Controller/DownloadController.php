<?php

namespace Drupal\stroykroy_shop\Controller;

use Drupal\commerce_order\Entity\OrderInterface;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Url;
use Drupal\stroykroy_shop\OrderFiles;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/** Страница заказа с файлами и выдача самих файлов. */
class DownloadController extends ControllerBase {

  /** Доступ: владелец заказа, администратор или верная подпись в ссылке. */
  protected function check(OrderInterface $order, Request $request, string $what): void {
    if ($order->getState()->getId() === 'draft') {
      throw new NotFoundHttpException();
    }
    $user = $this->currentUser();
    if ($user->hasPermission('administer commerce_order')) {
      return;
    }
    if ($user->isAuthenticated() && (int) $order->getCustomerId() === (int) $user->id()) {
      return;
    }
    $t = (string) $request->query->get('t', '');
    if ($t !== '' && hash_equals(OrderFiles::token($what), $t)) {
      return;
    }
    throw new AccessDeniedHttpException();
  }

  public function page(OrderInterface $commerce_order, Request $request): array {
    $this->check($commerce_order, $request, 'order|' . $commerce_order->id());
    $files = \Drupal::service('stroykroy_shop.order_files');
    $meta = $files->meta($commerce_order->id());
    $build = ['#cache' => ['max-age' => 0], '#title' => $this->t('Файлы заказа @n', ['@n' => $commerce_order->getOrderNumber() ?: $commerce_order->id()])];
    if (!$meta) {
      $build['empty'] = ['#markup' => '<p>' . $this->t('Файлы ещё не готовы. Если они не появятся в течение нескольких минут, мы пришлём их на почту.') . '</p>'];
    }
    foreach ($meta as $itemId => $info) {
      $links = [];
      foreach (OrderFiles::KINDS as $kind => [, , $label]) {
        if (!isset($info['files'][$kind])) {
          continue;
        }
        $links[] = ['#type' => 'link', '#title' => $label, '#url' => Url::fromRoute('stroykroy_shop.download', [
          'commerce_order' => $commerce_order->id(), 'item' => $itemId, 'kind' => $kind,
        ], ['query' => ['t' => OrderFiles::token("file|{$commerce_order->id()}|$itemId|$kind")]])];
      }
      $build['item_' . $itemId] = [
        '#theme' => 'item_list', '#title' => $info['title'] ?? '', '#items' => $links, '#list_type' => 'ul',
      ];
    }
    $build['note'] = ['#markup' => '<p>' . $this->t('PDF для А4 печатайте в масштабе 100%: на каждом листе есть контрольная линия 10 см.') . '</p>'];
    return $build;
  }

  public function download(OrderInterface $commerce_order, string $item, string $kind, Request $request): BinaryFileResponse {
    $this->check($commerce_order, $request, "file|{$commerce_order->id()}|$item|$kind");
    if (!isset(OrderFiles::KINDS[$kind]) || !ctype_digit($item)) {
      throw new NotFoundHttpException();
    }
    $files = \Drupal::service('stroykroy_shop.order_files');
    $meta = $files->meta($commerce_order->id());
    $name = $meta[$item]['files'][$kind] ?? NULL;
    $path = $files->orderDir($commerce_order->id()) . '/' . (int) $item . '/' . $kind . '.' . OrderFiles::KINDS[$kind][1];
    if (!$name || !is_file($path)) {
      throw new NotFoundHttpException();
    }
    $resp = new BinaryFileResponse($path);
    $resp->setContentDisposition(ResponseHeaderBag::DISPOSITION_ATTACHMENT, $name, 'lekala-' . $kind . '.' . OrderFiles::KINDS[$kind][1]);
    $resp->headers->set('Cache-Control', 'private, no-store');
    return $resp;
  }

  /** Администратор: построить файлы заказа заново (если при оплате что-то не получилось). */
  public function rebuild(OrderInterface $commerce_order): RedirectResponse {
    $ok = \Drupal::service('stroykroy_shop.order_files')->generate($commerce_order);
    $ok ? $this->messenger()->addStatus($this->t('Файлы построены.')) : $this->messenger()->addError($this->t('Не всё построилось, смотрите журнал и почту с ошибкой.'));
    return new RedirectResponse(Url::fromRoute('stroykroy_shop.order_files', ['commerce_order' => $commerce_order->id()])->toString());
  }

}
