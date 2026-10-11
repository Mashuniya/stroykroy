<?php

namespace Drupal\stroykroy_shop\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Принимает отчёт об ошибке построения от сервиса чертежей и шлёт письмо.
 * Доступно только с самого сервера (127.0.0.1).
 */
class ErrorReportController extends ControllerBase {

  const MAX_PER_HOUR = 20;

  public function receive(Request $request): JsonResponse {
    $ip = $request->server->get('REMOTE_ADDR');
    if (!in_array($ip, ['127.0.0.1', '::1'], TRUE) || $request->headers->has('X-Forwarded-For')) {
      return new JsonResponse(['ok' => FALSE], 403);
    }
    $data = json_decode((string) $request->getContent(), TRUE);
    if (!is_array($data)) {
      return new JsonResponse(['ok' => FALSE], 400);
    }
    $state = \Drupal::state();
    $now = time();
    $win = $state->get('stroykroy_shop.err_window', ['t' => $now, 'n' => 0]);
    if ($now - $win['t'] > 3600) {
      $win = ['t' => $now, 'n' => 0];
    }
    if ($win['n'] >= self::MAX_PER_HOUR) {
      return new JsonResponse(['ok' => TRUE, 'throttled' => TRUE]);
    }
    $win['n']++;
    $state->set('stroykroy_shop.err_window', $win);

    $to = \Drupal::config('system.site')->get('mail');
    $override = \Drupal\Core\Site\Settings::get('stroykroy_error_mail');
    if ($override) {
      $to = $override;
    }
    $debug = json_encode($data['debug'] ?? NULL, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $params = [
      'model' => (string) ($data['model'] ?? ''),
      'name' => (string) ($data['modelName'] ?? ''),
      'error' => (string) ($data['error'] ?? ''),
      'body' => implode("\n", [
        'Время: ' . ($data['time'] ?? ''),
        'Модель: ' . ($data['modelName'] ?? '') . ' (' . ($data['model'] ?? '') . ')',
        'Ошибка: ' . ($data['error'] ?? ''),
        'Таких же ошибок подавлено за последние минуты: ' . ($data['suppressedSince'] ?? 0),
        'IP покупателя: ' . ($data['ip'] ?? ''),
        'Браузер: ' . ($data['userAgent'] ?? ''),
        'Страница: ' . ($data['referer'] ?? ''),
        '',
        'Все переданные данные (выбор покупателя, мерки, опции, детали построения):',
        $debug,
      ]),
    ];
    $ok = \Drupal::service('plugin.manager.mail')->mail('stroykroy_shop', 'build_error', $to, 'ru', $params, NULL, TRUE);
    return new JsonResponse(['ok' => !empty($ok['result'])]);
  }

}
