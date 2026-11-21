const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export const presentLanguage = (value: string) => {
  try { return languageNames.of(value) ?? value; }
  catch { return value; }
};
