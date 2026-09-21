export function garminCsv(overrides = {}) {
  const row = {
    "Activity Type": "Gravel/Unpaved Cycling",
    Date: "2026-09-16 03:00:00",
    Favorite: "false",
    Title: 'Test, "Gravel"',
    Distance: "10.00",
    Calories: "450",
    Time: "01:00:00",
    "Avg HR": "130",
    "Max HR": "170",
    "Aerobic TE": "3.1",
    "Avg Speed": "10.0",
    "Max Speed": "30.0",
    "Total Ascent": "70",
    "Total Descent": "65",
    "Avg Bike Cadence": "72",
    "Max Bike Cadence": "100",
    "Normalized Power® (NP®)": "160",
    "Training Stress Score®": "45.5",
    "Max Avg Power (20 min)": "140",
    "Avg Power": "120",
    "Max Power": "1,234",
    "Total Strokes": "3019",
    "Body Battery Drain": "'-8",
    "Min Temp": "15.0",
    Decompression: "No",
    "Best Lap Time": "00:30:00",
    "Number of Laps": "2",
    "Max Temp": "25.0",
    "Moving Time": "00:55:00",
    "Elapsed Time": "01:00:00",
    "Min Elevation": "100",
    "Max Elevation": "150",
    ...overrides,
  };
  const quote = (v) => '"' + String(v).replaceAll('"', '""') + '"';
  return (
    Object.keys(row).map(quote).join(",") +
    "\r\n" +
    Object.values(row).map(quote).join(",") +
    "\r\n"
  );
}
