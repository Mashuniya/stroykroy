<?php

namespace Drupal\stroykroy_shop\PathProcessor;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\PathProcessor\InboundPathProcessorInterface;
use Drupal\Core\PathProcessor\OutboundPathProcessorInterface;
use Drupal\Core\Render\BubbleableMetadata;
use Drupal\stroykroy_shop\Controller\CatalogController;
use Symfony\Component\HttpFoundation\Request;

/**
 * Чистые адреса групп: /zhenshchinam и /zhenshchinam/platya.
 *
 * Drupal не находит маршруты, где весь путь состоит из переменных (/{section}),
 * поэтому внутри сайта страница живёт по /sk-group/…, а здесь адрес переводится туда и обратно.
 */
class CatalogPathProcessor implements InboundPathProcessorInterface, OutboundPathProcessorInterface {

  public function __construct(
    protected Connection $database,
    protected CacheBackendInterface $cache,
  ) {}

  /** Адресные части существующих групп (zhenshchinam, muzhchinam…). */
  protected function sectionSlugs(): array {
    if ($hit = $this->cache->get('stroykroy_shop:section_slugs')) {
      return $hit->data;
    }
    $slugs = [];
    try {
      $names = $this->database->query('SELECT DISTINCT field_section_value FROM {commerce_product__field_section}')->fetchCol();
      foreach ($names as $n) {
        if ((string) $n !== '') {
          $slugs[CatalogController::slugFor((string) $n)] = TRUE;
        }
      }
    }
    catch (\Throwable $e) {
      return [];
    }
    $this->cache->set('stroykroy_shop:section_slugs', $slugs, CacheBackendInterface::CACHE_PERMANENT, ['commerce_product_list']);
    return $slugs;
  }

  public function processInbound($path, Request $request) {
    if (preg_match('#^/([a-z0-9-]+)(/[a-z0-9-]+)?$#', $path, $m) && isset($this->sectionSlugs()[$m[1]])) {
      return '/sk-group/' . $m[1] . ($m[2] ?? '');
    }
    return $path;
  }

  public function processOutbound($path, &$options = [], ?Request $request = NULL, ?BubbleableMetadata $bubbleable_metadata = NULL) {
    if (str_starts_with($path, '/sk-group/')) {
      return '/' . substr($path, strlen('/sk-group/'));
    }
    return $path;
  }

}
