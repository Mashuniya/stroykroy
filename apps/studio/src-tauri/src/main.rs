// Минимальная точка входа Tauri. Локальное хранилище (SQLite) для офлайн-работы
// разработчика — следующий шаг (см. README в корне проекта, раздел "Статус"):
// подключить tauri-plugin-sql или rusqlite и команды чтения/записи профилей клиентов.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running stroykroy-studio");
}
