<?php

namespace Drupal\stroykroy_shop;

use Drupal\commerce_order\Entity\OrderInterface;
use Drupal\Component\Utility\Crypt;
use Drupal\Core\Site\Settings;
use GuzzleHttp\ClientInterface;
use Psr\Log\LoggerInterface;

/**
 * Файлы для покупателя: строятся сервисом чертежей по сохранённому выбору, лежат вне сайта,
 * отдаются только через проверку доступа.
 */
class OrderFiles {

  /** Что отдаём покупателю: ключ файла → [подпись в названии, расширение, подпись в списке]. */
  const KINDS = [
    'pdfA4' => ['A4', 'pdf', 'PDF для печати на А4 со склейкой'],
    'pdf' => ['1-1', 'pdf', 'PDF в натуральную величину (плоттер)'],
    // dxfAama — простой DXF, больше не выдаётся (старый CLO не читает в нём внутренние линии); оставлен, чтобы файлы уже оплаченных заказов находились
    'dxfAama' => ['DXF', 'dxf', 'DXF'],
    'aama' => ['DXF-AAMA', 'dxf', 'DXF-AAMA (формат ASTM, для CLO3D, Gerber, Optitex и др.)'],
  ];

  public function __construct(protected ClientInterface $http, protected LoggerInterface $logger) {}

  public static function baseDir(): string {
    return rtrim((string) Settings::get('stroykroy_orders_dir', '/var/lib/stroykroy/orders'), '/');
  }

  public function orderDir($orderId): string {
    return self::baseDir() . '/' . (int) $orderId;
  }

  /** Подпись для ссылок: по ней открываются файлы без входа на сайт (письмо, гостевой заказ). */
  public static function token(string $what): string {
    return Crypt::hmacBase64('stroykroy|' . $what, \Drupal::service('private_key')->get() . Settings::getHashSalt());
  }

  /** Описание готовых файлов заказа: [itemId => ['title' => ..., 'files' => [kind => name]]]. */
  public function meta($orderId): array {
    $f = $this->orderDir($orderId) . '/meta.json';
    $data = is_file($f) ? json_decode((string) file_get_contents($f), TRUE) : NULL;
    return is_array($data) ? $data : [];
  }

  /**
   * Строит и сохраняет файлы всех позиций заказа с выбором конфигуратора.
   * @return bool TRUE, если всё построилось.
   */
  public function generate(OrderInterface $order): bool {
    $dir = $this->orderDir($order->id());
    if (!is_dir($dir) && !@mkdir($dir, 0750, TRUE)) {
      $this->logger->error('Не удалось создать папку @d для файлов заказа', ['@d' => $dir]);
      return FALSE;
    }
    $url = rtrim((string) Settings::get('stroykroy_engine_url', 'http://127.0.0.1:3100'), '/') . '/api/files';
    $meta = $this->meta($order->id());
    $allOk = TRUE;
    foreach ($order->getItems() as $item) {
      if (!$item->hasField('field_sk_selection') || $item->get('field_sk_selection')->isEmpty()) {
        continue;
      }
      $saved = json_decode((string) $item->get('field_sk_selection')->value, TRUE);
      if (!is_array($saved) || empty($saved['model']) || !is_array($saved['selection'] ?? NULL)) {
        $allOk = FALSE;
        continue;
      }
      $variation = $item->getPurchasedEntity();
      $sku = $variation ? (string) $variation->getSku() : 'lekala';
      $summary = (string) ($saved['summary'] ?? '');
      $number = $order->getOrderNumber() ?: $order->id();
      try {
        $resp = $this->http->request('POST', $url, [
          'json' => [
            'model' => $saved['model'], 'selection' => $saved['selection'],
            'title' => trim($sku . ' ' . $summary), 'stamp' => trim('СтройКрой · заказ ' . $number . ' · ' . (string) $order->getEmail()),
          ],
          'timeout' => 90, 'http_errors' => FALSE,
        ]);
        $data = json_decode((string) $resp->getBody(), TRUE);
      }
      catch (\Throwable $e) {
        $this->logger->error('Сервис чертежей недоступен при построении файлов заказа @o: @m', ['@o' => $order->id(), '@m' => $e->getMessage()]);
        $allOk = FALSE;
        continue;
      }
      if (!is_array($data) || empty($data['ok']) || empty($data['files'])) {
        $allOk = FALSE;
        continue;
      }
      $itemDir = $dir . '/' . (int) $item->id();
      if (!is_dir($itemDir)) {
        @mkdir($itemDir, 0750, TRUE);
      }
      $base = trim(preg_replace('/[\\\\\/:*?"<>|,]+/u', ' ', $sku . ' ' . $summary));
      $files = [];
      foreach ($data['files'] as $f) {
        $kind = $f['kind'] ?? '';
        if (!isset(self::KINDS[$kind])) {
          continue;
        }
        [$suffix, $ext] = self::KINDS[$kind];
        $bytes = base64_decode((string) ($f['data'] ?? ''), TRUE);
        if ($bytes === FALSE || $bytes === '' || file_put_contents($itemDir . '/' . $kind . '.' . $ext, $bytes) === FALSE) {
          $allOk = FALSE;
          continue;
        }
        $files[$kind] = $base . ' ' . $suffix . '.' . $ext;
      }
      $meta[$item->id()] = ['title' => ($sku !== '' ? 'Артикул ' . $sku . ' · ' : '') . $item->getTitle(), 'files' => $files];
    }
    file_put_contents($dir . '/meta.json', json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    return $allOk;
  }

}
