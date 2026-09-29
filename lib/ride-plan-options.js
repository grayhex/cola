// Stable values shared by planned rides and future riding intentions. No SDK/schema in the UI bundle.
export const ridePlanOptions = {
  purpose: {
    leisure: "Прогулка",
    social: "Общение",
    training: "Тренировка",
    exploration: "Новые места",
    adventure: "Приключение",
  },
  pace: { relaxed: "Спокойный", moderate: "Умеренный", sporty: "Спортивный" },
  surface: {
    asphalt: "Асфальт",
    gravel: "Гравий / грунт",
    trail: "Трейлы",
    mixed: "Смешанное",
  },
  difficulty: {
    easy: "Без технических препятствий",
    intermediate: "Нужны базовые навыки",
    technical: "Технический маршрут",
  },
  regroupPolicy: {
    wait: "Ждём всех",
    regroup: "Собираемся на остановках",
    independent: "Каждый в своём темпе",
  },
};
// sessionStorage key: a slot offered on the home page pre-fills the plan form.
export const planDraftKey = "cola:plan-draft";
