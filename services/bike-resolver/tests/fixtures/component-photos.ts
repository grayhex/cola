// Synthetic Commons response: no third-party image or network dependency in CI.
export const commonsFixture = (name = "Fixture saddle") => ({
  query: {
    pages: Object.fromEntries(
      [1, 2].map((id) => [
        id,
        {
          title: `File:${name} ${id}.png`,
          imageinfo: [
            {
              mime: "image/png",
              size: 4096,
              width: 600,
              height: 400,
              url: `https://upload.wikimedia.org/wikipedia/commons/fixture-${id}.png`,
              descriptionurl: `https://commons.wikimedia.org/wiki/File:Fixture-${id}.png`,
              extmetadata: {
                Artist: {
                  value: "<a href='https://example.test'>Fixture author</a>",
                },
                Credit: { value: "Own work" },
                LicenseShortName: { value: "CC BY-SA 4.0" },
                LicenseUrl: {
                  value: "https://creativecommons.org/licenses/by-sa/4.0/",
                },
              },
            },
          ],
        },
      ]),
    ),
  },
});
