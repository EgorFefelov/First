/*
  registry.js — реестр МОДУЛЕЙ движка (control / transitions / inventory / overlays).

  Отдельный от Mechanics (реестр испытаний). Модули регистрируются по имени;
  ядро (core.js) создаёт активные через Modules.create(name), не зная про
  конкретные реализации. Контракт модуля — см. PLAN.md плана level-2-modular.

  Наращивание: модуль активен, только если его <script> подключён в index.html
  (тогда register отработал → has(name) === true) И имя есть в CONFIG.MODULES.
*/

const Modules = {
  _factories: {},

  // зарегистрировать модуль: имя + фабрика, возвращающая объект-модуль
  register(name, factory) {
    this._factories[name] = factory;
  },

  // создать экземпляр модуля по имени (один на всю игру, не на кадр)
  create(name) {
    const factory = this._factories[name];
    if (!factory) {
      console.warn(`Modules: модуль "${name}" не зарегистрирован`);
      return null;
    }
    return factory();
  },

  // подключён ли модуль (его <script> загружен)
  has(name) {
    return !!this._factories[name];
  },

  // имена всех зарегистрированных модулей
  names() {
    return Object.keys(this._factories);
  },
};

window.Modules = Modules;
