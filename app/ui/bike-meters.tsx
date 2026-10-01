export default function BikeMeters({
  scores,
}: {
  scores?: { completeness: number; upgrade: number };
}) {
  return (
    <div className="bike-meters">
      {(
        [
          ["Заполненность", scores?.completeness || 0, "complete"],
          ["Прокаченность", scores?.upgrade ?? 50, "upgrade"],
        ] as const
      ).map(([label, value, kind]) => (
        <div
          key={kind}
          className={"bike-meter " + kind}
          title={label + ": " + value + "%"}
        >
          <span>
            {label}
            <small>{value}%</small>
          </span>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: value + "%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
