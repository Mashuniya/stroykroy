<?php

namespace Drupal\stroykroy_shop\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Страница «Импорт каталога лекал»: загружаем stroykroy-catalog.json из студии.
 */
class CatalogImportForm extends FormBase {

  public function getFormId(): string {
    return 'stroykroy_shop_catalog_import';
  }

  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['intro'] = [
      '#markup' => '<p>Выберите файл каталога, сохранённый в студии кнопкой «Файл каталога для сайта (.json)». '
        . 'Модели с галочкой «Выставить лекала в магазин» будут созданы или обновлены; снятые с галочки — скрыты с витрины. '
        . 'Загрузку можно повторять: товары не дублируются.</p>',
    ];
    $form['catalog'] = [
      '#type' => 'file',
      '#title' => 'Файл каталога (.json)',
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => 'Загрузить и обновить магазин',
      '#button_type' => 'primary',
    ];
    return $form;
  }

  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $upload = $this->getRequest()->files->get('files')['catalog'] ?? NULL;
    if (!$upload) {
      $form_state->setErrorByName('catalog', 'Выберите файл.');
      return;
    }
    if (!$upload->isValid()) {
      $form_state->setErrorByName('catalog', 'Файл не загрузился: ' . $upload->getErrorMessage() . ' (возможно, он больше допустимого размера).');
      return;
    }
    $data = json_decode((string) file_get_contents($upload->getRealPath()), TRUE);
    if (!is_array($data) || ($data['format'] ?? '') !== 'stroykroy-catalog') {
      $form_state->setErrorByName('catalog', 'Это не файл каталога СтройКроя.');
      return;
    }
    if ((int) ($data['version'] ?? 0) < 3) {
      $form_state->setErrorByName('catalog', 'Файл старого формата: обновите студию и сохраните каталог заново.');
      return;
    }
    $form_state->set('catalog_data', $data);
  }

  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $stats = \Drupal::service('stroykroy_shop.importer')->import($form_state->get('catalog_data'));
    $this->messenger()->addStatus(sprintf('Создано товаров: %d, обновлено: %d, снято с витрины: %d.', $stats['created'], $stats['updated'], $stats['unpublished']));
    foreach ($stats['skipped'] as $msg) {
      $this->messenger()->addWarning('Пропущено — ' . $msg);
    }
  }

}
