// Reactions and the rating's global thresholds. Awards and records are rules
// in the database (game_rules, #106); their keys are persistent identities.
export const reactions = Object.freeze({
  wild: "Безумие",
  clean: "Чистая сборка",
  dream: "Хочу такой",
});
export const defaultGamification = Object.freeze({
  currency: "RUB",
  reactionsEnabled: true,
  minimumCompleteness: 50,
  budgetMinimum: 5000,
  weightMinimum: 3,
  weightMaximum: 50,
});
