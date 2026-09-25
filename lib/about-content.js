// /about (#127): value, advantages, four scenarios with interface demos,
// first steps and the technical part. Only released features; keep in step
// with docs/modules/navigation-about.md.
/**
 * @typedef {object} AboutItem
 * @property {string} id
 * @property {"feature" | "scenario" | "steps" | "technology"} kind
 * @property {string} icon
 * @property {string} title
 * @property {string} text
 * @property {string} [eyebrow] Topic pill above a scenario.
 * @property {"amber" | "blue" | "violet" | "green"} [tone] Scenario colour.
 * @property {string[]} [points] Short facts under the text.
 * @property {{title: string, text: string}[]} [steps] Numbered steps.
 */
/**
 * @typedef {object} AboutSection
 * @property {"guide" | "technology" | "history"} id
 * @property {string} title
 * @property {string} intro
 * @property {AboutItem[]} items
 */
export const aboutHero = {
  title: "Велосипед, у\u00a0которого",
  accent: "есть история",
  lead: "ColaBike — сообщество, где велосипед показывают целиком: сборку, изменения и поездки. Владельцы делятся опытом, а читатели находят его по марке, модели и детали.",
};
/** @type {AboutSection[]} */
export const aboutSections = [
  {
    id: "guide",
    title: "Как устроен ColaBike",
    intro:
      "В центре — велосипед. К нему привязаны комплектация, журнал и покатушки, а люди находят друг друга через сборки.",
    items: [
      {
        id: "why-build",
        kind: "feature",
        icon: "bike",
        title: "Сборка целиком",
        text: "Фото, комплектация, размер и вес в одной карточке. Заводская комплектация хранится отдельно от текущей.",
      },
      {
        id: "why-history",
        kind: "feature",
        icon: "journal",
        title: "История, а не витрина",
        text: "Сборка, обслуживание, впечатления и вопросы остаются в журнале велосипеда с датой и пробегом.",
      },
      {
        id: "why-experience",
        kind: "feature",
        icon: "search",
        title: "Опыт владельцев",
        text: "Поиск по марке, модели, году и детали. У модели и детали есть страницы с реальными сборками.",
      },
      {
        id: "why-privacy",
        kind: "feature",
        icon: "shield",
        title: "Приватность под контролем",
        text: "Скрытое не видно другим и не попадает в поиск. Цену и показания датчиков вы открываете сами.",
      },
      {
        id: "demo-bike",
        kind: "scenario",
        icon: "bike",
        tone: "amber",
        eyebrow: "Велосипед",
        title: "Страница велосипеда и комплектация",
        text: "Вставьте ссылку на модель в магазине или у производителя — Bike Resolver разберёт характеристики и предложит фото. Проверьте результат, поправьте детали и решите, показывать ли велосипед на витрине.",
        points: [
          "Компоненты и аксессуары по группам",
          "Ручное заполнение доступно всегда",
          "Приватный велосипед виден только вам",
        ],
      },
      {
        id: "demo-journal",
        kind: "scenario",
        icon: "journal",
        tone: "blue",
        eyebrow: "Журнал",
        title: "Журнал изменений и обслуживания",
        text: "Каждая замена детали, сервис или впечатление — отдельная запись у велосипеда. Компоненты сохраняются снимком на дату записи, поэтому история не меняется вместе с деталями.",
        points: [
          "Дата, пробег и покатушка у записи",
          "Черновик «Рассказать об изменении» после правки комплектации",
          "Вопрос можно закрыть выбранным ответом",
        ],
      },
      {
        id: "demo-reading",
        kind: "scenario",
        icon: "reading",
        tone: "violet",
        eyebrow: "Чтение",
        title: "Чтение и подписки",
        text: "Подпишитесь на автора, на конкретный велосипед или на обоих — лента не покажет запись дважды. Полезное сохраните в «Сохранённое». Свой велосипед для этого не нужен.",
        points: [
          "Статьи по рубрикам — от обслуживания до маршрутов",
          "Колокольчик — только реакции, ответы и новые подписчики",
        ],
      },
      {
        id: "demo-rides",
        kind: "scenario",
        icon: "rides",
        tone: "green",
        eyebrow: "Покатушки",
        title: "Покатушки и сообщество",
        text: "Загрузите GPX, FIT или TCX либо CSV из Garmin Connect — ColaBike посчитает дистанцию, набор и скорость. Зоны приватности скроют начало и конец маршрута, а запланированную покатушку можно повторять каждую неделю.",
        points: [
          "Ответы «Иду» и «Может быть» у запланированных покатушек",
          "Лайки и обсуждения у публичных маршрутов",
        ],
      },
      {
        id: "steps",
        kind: "steps",
        icon: "flag",
        title: "С чего начать",
        text: "Пять шагов до первой истории велосипеда.",
        steps: [
          {
            title: "Зарегистрируйтесь",
            text: "Имя пользователя станет адресом профиля.",
          },
          {
            title: "Добавьте велосипед",
            text: "По ссылке на модель или вручную.",
          },
          {
            title: "Проверьте сборку",
            text: "Фото, компоненты и видимость на витрине.",
          },
          {
            title: "Загрузите покатушку",
            text: "GPX, FIT, TCX или CSV из Garmin Connect.",
          },
          {
            title: "Напишите в журнал",
            text: "Превью ссылки для мессенджеров соберётся само.",
          },
        ],
      },
    ],
  },
  {
    id: "technology",
    title: "Под капотом",
    intro:
      "Веб-приложение и отдельный сервис распознавания велосипедов, которые работают с одной моделью велосипеда.",
    items: [
      {
        id: "tech-stack",
        kind: "technology",
        icon: "code",
        title: "Интерфейс и API",
        text: "Next.js 16 и React 19. Публичные страницы собираются на сервере — поисковики и превью видят содержимое без JavaScript.",
      },
      {
        id: "tech-resolver",
        kind: "technology",
        icon: "scan",
        title: "Bike Resolver",
        text: "Node.js, Fastify и Cheerio читают таблицы характеристик и хранят их происхождение. Без языковой модели и без доступа к локальной сети.",
      },
      {
        id: "tech-privacy",
        kind: "technology",
        icon: "lock",
        title: "Публичное и личное",
        text: "API отдаёт только выбранные поля, доступ к записи и каждому фото проверяется. Оригиналы GPX хранятся отдельно.",
      },
      {
        id: "tech-checks",
        kind: "technology",
        icon: "check",
        title: "Проверка изменений",
        text: "ESLint, типы, тесты на PostgreSQL, Playwright в Chromium и WebKit, CodeQL. Docker Compose собирает приложение, базу и Resolver.",
      },
    ],
  },
];
export const aboutDefaults = {
  sections: aboutSections.map(({ id, title }) => ({
    id,
    title,
    visible: true,
    showIllustration: true,
  })),
  hiddenItems: [],
};
export const aboutItemIds = aboutSections.flatMap((s) =>
  s.items.map((i) => i.id),
);
// Items of the previous page layout: stored settings may still hide them.
export const legacyAboutItemIds = [
  "start",
  "discovery",
  "experience",
  "journal",
  "bike",
  "parser",
  "rides",
  "score",
  "awards",
  "community",
  "market",
  "articles",
  "account",
  "stack",
  "architecture",
  "privacy",
  "operations",
  "milestones",
  "metrics",
  "process",
];
