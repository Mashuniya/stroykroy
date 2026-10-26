<?php

namespace Drupal\stroykroy_shop\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Site\Settings;

/**
 * Страница «Проверка алгоритмов»: прогон моделей каталога по базе типовых размеров ОСТ (147 фигур) с выбором вариантов и элементов.
 * Ошибки сводятся в группы; для каждой есть готовый текст «мерки и опции» для вставки в алгоритм в VS Code. Отчёт можно отправить на почту.
 */
class SelfTestForm extends FormBase {

  public function getFormId(): string {
    return 'stroykroy_shop_selftest';
  }

  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['intro'] = [
      '#markup' => '<p>Каждый алгоритм каталога строится на типовых размерах ОСТ с разными опциями и элементами (рукав, воротник и др.). '
        . '«Быстро» — все варианты на нескольких размерах и вариант по умолчанию на всех 147; «Полностью» — все варианты на всех размерах (может занять несколько минут). '
        . 'Для каждой ошибки показаны размеры, где она случилась, и текст с мерками и опциями, который вставляется в алгоритм.</p>',
    ];
    $form['model'] = [
      '#type' => 'textfield',
      '#title' => 'Одна модель (код файла, например JPL10001)',
      '#description' => 'Пусто — проверить все модели каталога.',
      '#size' => 30,
    ];
    $form['mode'] = [
      '#type' => 'radios',
      '#title' => 'Режим',
      '#options' => ['quick' => 'Быстро', 'full' => 'Полностью (все размеры и все варианты)'],
      '#default_value' => 'quick',
    ];
    $form['mail'] = [
      '#type' => 'checkbox',
      '#title' => 'Если есть ошибки — отправить отчёт на почту владельца',
      '#default_value' => TRUE,
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = ['#type' => 'submit', '#value' => 'Проверить', '#button_type' => 'primary'];
    if ($text = $form_state->get('report_text')) {
      $form['report'] = [
        '#type' => 'textarea',
        '#title' => 'Отчёт (можно скопировать целиком)',
        '#value' => $text,
        '#rows' => 30,
        '#attributes' => ['readonly' => 'readonly', 'style' => 'font-family:monospace;font-size:12px;width:100%'],
        '#weight' => 100,
      ];
    }
    return $form;
  }

  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $url = rtrim((string) Settings::get('stroykroy_engine_url', 'http://127.0.0.1:3100'), '/') . '/api/selftest';
    $payload = [
      'model' => trim((string) $form_state->getValue('model')),
      'mode' => $form_state->getValue('mode') === 'full' ? 'full' : 'quick',
      'mail' => (bool) $form_state->getValue('mail'),
    ];
    set_time_limit(900);
    try {
      $resp = \Drupal::httpClient()->request('POST', $url, ['json' => $payload, 'timeout' => 850, 'http_errors' => FALSE]);
      $data = json_decode((string) $resp->getBody(), TRUE);
    }
    catch (\Throwable $e) {
      $this->messenger()->addError('Сервис чертежей недоступен: ' . $e->getMessage());
      return;
    }
    if (!is_array($data) || empty($data['ok'])) {
      $this->messenger()->addError('Проверка не выполнена: ' . (string) ($data['error'] ?? 'неизвестная ошибка'));
      return;
    }
    $msg = sprintf('Проверено моделей: %d, с ошибками: %d.', $data['models'], $data['failedModels']);
    if ($data['failedModels'] > 0) {
      $this->messenger()->addWarning($msg . ($payload['mail'] ? ' Отчёт отправлен на почту.' : ''));
    }
    else {
      $this->messenger()->addStatus($msg . ' Всё строится.');
    }
    $form_state->set('report_text', (string) ($data['text'] ?? ''));
    $form_state->setRebuild(TRUE);
  }

}
