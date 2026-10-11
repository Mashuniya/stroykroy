<?php

namespace Drupal\stroykroy_shop;

use Drupal\Core\Site\Settings;
use GuzzleHttp\ClientInterface;
use Psr\Log\LoggerInterface;

/**
 * Проверяет выбор покупателя в сервисе чертежей (он же приводит его к «чистому» виду).
 */
class SelectionChecker {

  public function __construct(protected ClientInterface $http, protected LoggerInterface $logger) {}

  /**
   * @return array|null ['selection' => array, 'summary' => string, 'title' => string] или NULL, если чертёж не строится.
   */
  public function check(string $model, array $selection): ?array {
    $url = rtrim((string) Settings::get('stroykroy_engine_url', 'http://127.0.0.1:3100'), '/') . '/api/validate';
    try {
      $resp = $this->http->request('POST', $url, [
        'json' => ['model' => $model, 'selection' => $selection],
        'timeout' => 20,
        'http_errors' => FALSE,
      ]);
      $data = json_decode((string) $resp->getBody(), TRUE);
    }
    catch (\Throwable $e) {
      $this->logger->error('Сервис чертежей недоступен: @m', ['@m' => $e->getMessage()]);
      return NULL;
    }
    if (!is_array($data) || empty($data['ok']) || !is_array($data['selection'] ?? NULL)) {
      return NULL;
    }
    return [
      'selection' => $data['selection'],
      'summary' => (string) ($data['summary'] ?? ''),
      'title' => (string) ($data['title'] ?? ''),
    ];
  }

}
