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
    $repro = (string) ($data['debug']['repro'] ?? '');
    if (isset($data['debug']['repro'])) {
      // текст для вставки идёт отдельным блоком вверху письма, в общих данных его не дублируем
      $dbg = $data['debug'];
      unset($dbg['repro']);
      $debug = json_encode($dbg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    if (!empty($data['report'])) {
      // отчёт самопроверки алгоритмов: готовый текст
      $body = implode("\n", [
        'Время: ' . ($data['time'] ?? ''),
        (string) ($data['error'] ?? ''),
        '',
        (string) $data['report'],
      ]);
      $subject = 'Проверка алгоритмов: ' . (string) ($data['error'] ?? '');
    }
    else {
      $body = implode("\n", array_filter([
        'Ошибка: ' . ($data['error'] ?? ''),
        'Модель: ' . ($data['modelName'] ?? '') . ' (' . ($data['model'] ?? '') . ')',
        '',
        $repro !== '' ? "=== ВСТАВИТЬ В АЛГОРИТМ (VS Code): мерки и опции, с которыми случилась ошибка ===\n" . $repro . "\n=== конец блока ===\n" : NULL,
        'Время: ' . ($data['time'] ?? ''),
        'Таких же ошибок подавлено за последние минуты: ' . ($data['suppressedSince'] ?? 0),
        'IP покупателя: ' . ($data['ip'] ?? ''),
        'Браузер: ' . ($data['userAgent'] ?? ''),
        'Страница: ' . ($data['referer'] ?? ''),
        '',
        'Все переданные данные (выбор покупателя, детали построения):',
        $debug,
      ], fn($x) => $x !== NULL));
      $subject = '';
    }
    $params = [
      'model' => (string) ($data['model'] ?? ''),
      'name' => (string) ($data['modelName'] ?? ''),
      'error' => (string) ($data['error'] ?? ''),
      'subject' => $subject,
      'body' => $body,
    ];
    $ok = \Drupal::service('plugin.manager.mail')->mail('stroykroy_shop', 'build_error', $to, 'ru', $params, NULL, TRUE);
    if (empty($ok['result'])) {
      \Drupal::logger('stroykroy_shop')->error('Письмо об ошибке построения не отправлено (адрес @to): @e', ['@to' => (string) $to, '@e' => mb_substr((string) ($data['error'] ?? ''), 0, 300)]);
    }
    return new JsonResponse(['ok' => !empty($ok['result'])]);
  }

}
