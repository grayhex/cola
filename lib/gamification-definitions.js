// Central public definitions; keys are persistent identities, never record titles.
/**
 * @typedef {'user'|'bike'} AwardScope
 * @typedef {{key:string,name:string,description:string,scope:AwardScope,target:number,metric:'bikes'|'completeness'|'likes'|'followers'|'categories'|'discussions'}} AchievementDefinition
 */
/** @type {ReadonlyArray<AchievementDefinition>} */
export const achievements = Object.freeze([
  {
    key: "first_public",
    name: "Первый выход",
    description: "Опубликовать первый велосипед",
    scope: "user",
    target: 1,
    metric: "bikes",
  },
  {
    key: "full_build",
    name: "Сборка до винтика",
    description: "Фото и полный набор компонентов по правилам площадки",
    scope: "bike",
    target: 100,
    metric: "completeness",
  },
  ...[10, 50, 100].map((n) => ({
    key: "bike_likes_" + n,
    name: n + " сердец",
    description: n + " лайков на одном велосипеде",
    scope: "bike",
    target: n,
    metric: "likes",
  })),
  {
    key: "owner_likes_100",
    name: "Любимец витрины",
    description: "100 лайков публичных велосипедов",
    scope: "user",
    target: 100,
    metric: "likes",
  },
  ...[10, 50].map((n) => ({
    key: "followers_" + n,
    name: n + " попутчиков",
    description: n + " подписчиков",
    scope: "user",
    target: n,
    metric: "followers",
  })),
  {
    key: "all_categories",
    name: "Без границ",
    description: "Публичные велосипеды трёх категорий",
    scope: "user",
    target: 3,
    metric: "categories",
  },
  {
    key: "discussion_20",
    name: "В теме",
    description: "Обсудить 20 разных публичных велосипедов других владельцев",
    scope: "user",
    target: 20,
    metric: "discussions",
  },
]);
export const reactions = Object.freeze({
  wild: "Безумие",
  clean: "Чистая сборка",
  dream: "Хочу такой",
});
export const recordDefinitions = Object.freeze([
  {
    key: "expensive",
    name: "Без компромиссов",
    group: "Цена",
    metric: "price",
    direction: "desc",
  },
  {
    key: "budget",
    name: "Бюджетный герой",
    group: "Цена",
    metric: "price",
    direction: "asc",
  },
  ...["mtb", "gravel", "road"].map((category) => ({
    key: "lightest_" + category,
    name: "Легче ветра · " + category.toUpperCase(),
    group: "Вес",
    metric: "weight",
    direction: "asc",
    category,
  })),
  {
    key: "popular",
    name: "Любимец публики",
    group: "Популярность",
    metric: "likes",
    direction: "desc",
  },
  {
    key: "upgrade",
    name: "На максималках",
    group: "Прокаченность",
    metric: "upgrade",
    direction: "desc",
  },
  {
    key: "complete",
    name: "Каждая деталь на месте",
    group: "Прокаченность",
    metric: "completeness",
    direction: "desc",
  },
  ...Object.keys(reactions).map((key) => ({
    key,
    name: {
      wild: "Безумная сборка",
      clean: "Чистая работа",
      dream: "Велосипед мечты",
    }[key],
    group: "Community",
    metric: key,
    direction: "desc",
  })),
  {
    key: "community",
    name: "Выбор сообщества",
    group: "Community",
    metric: "community",
    direction: "desc",
  },
]);
export const defaultGamification = Object.freeze({
  currency: "RUB",
  enabledRecords: recordDefinitions.map((r) => r.key),
  reactionsEnabled: true,
  minimumCompleteness: 50,
  budgetMinimum: 5000,
  weightMinimum: 3,
  weightMaximum: 50,
});
