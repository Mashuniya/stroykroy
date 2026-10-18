<?php

namespace Drupal\stroykroy_shop\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Личные сохранения покупателя: «Мои мерки» (kind = body) и «Мои варианты» изделий (kind = variant).
 * Только для вошедших на сайт; у каждого не больше 20 записей каждого вида.
 */
class SavedController extends ControllerBase {

  const LIMIT = 20;

  /** Список: ?kind=body или ?kind=variant&model=… */
  public function list(Request $request): JsonResponse {
    $kind = $this->kind((string) $request->query->get('kind'));
    if (!$kind) {
      return new JsonResponse(['ok' => FALSE], 400);
    }
    $q = \Drupal::database()->select('stroykroy_saved', 's')
      ->fields('s', ['id', 'name', 'model', 'data'])
      ->condition('uid', (int) $this->currentUser()->id())
      ->condition('kind', $kind)
      ->orderBy('id', 'DESC');
    if ($kind === 'variant') {
      $q->condition('model', substr((string) $request->query->get('model'), 0, 128));
    }
    $items = [];
    foreach ($q->execute() as $r) {
      $items[] = ['id' => (int) $r->id, 'name' => $r->name, 'data' => json_decode($r->data, TRUE)];
    }
    return $this->json(['ok' => TRUE, 'items' => $items, 'limit' => self::LIMIT]);
  }

  /** Новая запись или (если есть такое имя) замена. */
  public function save(Request $request): JsonResponse {
    $in = json_decode((string) $request->getContent(), TRUE);
    $kind = is_array($in) ? $this->kind((string) ($in['kind'] ?? '')) : NULL;
    $name = is_array($in) ? trim(mb_substr(strip_tags((string) ($in['name'] ?? '')), 0, 60)) : '';
    if (!$kind || $name === '') {
      return new JsonResponse(['ok' => FALSE, 'error' => 'Введите название'], 400);
    }
    $model = $kind === 'variant' ? substr((string) ($in['model'] ?? ''), 0, 128) : '';
    $data = $kind === 'body' ? $this->cleanBody($in['data'] ?? NULL) : $this->cleanVariant($in['data'] ?? NULL);
    if ($data === NULL || ($kind === 'variant' && $model === '')) {
      return new JsonResponse(['ok' => FALSE, 'error' => 'Нечего сохранять'], 400);
    }
    $db = \Drupal::database();
    $uid = (int) $this->currentUser()->id();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    $same = $db->select('stroykroy_saved', 's')->fields('s', ['id'])
      ->condition('uid', $uid)->condition('kind', $kind)->condition('model', $model)->condition('name', $name)
      ->execute()->fetchField();
    if ($same) {
      $db->update('stroykroy_saved')->fields(['data' => $json, 'created' => time()])->condition('id', $same)->execute();
      return $this->json(['ok' => TRUE, 'id' => (int) $same, 'replaced' => TRUE]);
    }
    $count = (int) $db->select('stroykroy_saved', 's')->condition('uid', $uid)->condition('kind', $kind)->countQuery()->execute()->fetchField();
    if ($count >= self::LIMIT) {
      return new JsonResponse(['ok' => FALSE, 'error' => 'Можно сохранить не больше ' . self::LIMIT . '. Удалите ненужное.'], 400);
    }
    $id = $db->insert('stroykroy_saved')->fields([
      'uid' => $uid, 'kind' => $kind, 'model' => $model, 'name' => $name, 'data' => $json, 'created' => time(),
    ])->execute();
    return $this->json(['ok' => TRUE, 'id' => (int) $id]);
  }

  public function delete(int $id): JsonResponse {
    \Drupal::database()->delete('stroykroy_saved')
      ->condition('id', $id)->condition('uid', (int) $this->currentUser()->id())->execute();
    return $this->json(['ok' => TRUE]);
  }

  protected function json(array $d): JsonResponse {
    $r = new JsonResponse($d);
    $r->setPrivate();
    $r->headers->set('Cache-Control', 'private, no-store');
    return $r;
  }

  protected function kind(string $k): ?string {
    return in_array($k, ['body', 'variant'], TRUE) ? $k : NULL;
  }

  protected function num($v, float $lo, float $hi): ?float {
    return (is_int($v) || is_float($v)) && is_finite($v) && $v >= $lo && $v <= $hi ? (float) $v : NULL;
  }

  /** Мерки: типовой размер ИЛИ рост, обхват груди и мерки по ключам. */
  protected function cleanBody($d): ?array {
    if (!is_array($d)) {
      return NULL;
    }
    if (!empty($d['figure']) && is_string($d['figure'])) {
      return ['figure' => substr($d['figure'], 0, 32)];
    }
    $out = ['figure' => NULL, 'height' => $this->num($d['height'] ?? NULL, 100, 230), 'bust' => $this->num($d['bust'] ?? NULL, 60, 200), 'measurements' => []];
    foreach ((array) ($d['measurements'] ?? []) as $k => $v) {
      if (is_string($k) && preg_match('/^[A-Za-z0-9_]{1,32}$/', $k) && ($n = $this->num($v, 0.1, 400)) !== NULL) {
        $out['measurements'][$k] = $n;
      }
    }
    return $out['measurements'] && $out['height'] !== NULL && $out['bust'] !== NULL ? $out : NULL;
  }

  /** Вариант изделия: выбор покупателя как есть, но с ограничением размера (чертёж всё равно проверит сервер). */
  protected function cleanVariant($d): ?array {
    if (!is_array($d) || strlen(json_encode($d)) > 20000) {
      return NULL;
    }
    return $d;
  }

}
